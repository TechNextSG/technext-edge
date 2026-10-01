/**
 * Everything the staff editor page needs to know about one quotation, derived once and in one place:
 * the single status and its tone, the four-step wizard, the follow-up chase, and the two JSON blobs the
 * page's script starts from. No markup is built here; `markup.ts`, `styles.ts` and `client.ts` read it.
 */
import {
  guestLinkFor,
  quotationValidityLines,
  followUpState,
  followUpWindowFromEnv,
  quotationValidUntil,
  type HonoQuotationDraft,
} from "../../quote/index.ts";
import { type StaffRole } from "../../auth/session.ts";

export type EditorModel = ReturnType<typeof buildEditorModel>;

export function buildEditorModel(
  draft: HonoQuotationDraft,
  allQuotes: HonoQuotationDraft[],
  role: StaffRole = "staff",
  /**
   * Which engine prices this deployment. The "Send reservation" bar is hidden when it is `remote`:
   * bookings are taken on the team estimator's own quotation page (their app owns the folio), and the
   * route refuses with `wrong_place` — offering a button that always refuses is worse than not
   * offering it, because a receptionist reads the refusal as a fault in the quotation.
   */
  estimatorKind: "simulated" | "remote" = "simulated",
) {
  // ---- The one status, and the four steps ---------------------------------
  //
  // The page used to carry three different statements of where a quotation was: a pill on the guest
  // card ("Waiting for Staff Approval"), a second pill on the send card ("Ready to Send" /
  // "Awaiting Approval"), and a section headed "Customer Quotation Link (Official Invoice)" that
  // looked like a state of its own. Staff had to reconcile them, and they disagreed: an approved but
  // unpublished quotation read "Ready to Send" beside a link box that said no link existed.
  //
  // One status now, derived from the record in one place, and a four-step bar that says what is left
  // to do. Everything is SERVER-rendered first: the script can move the bar after an action, but a
  // quotation that is already approved must not read as unapproved because a script did not run.
  /**
   * The link the guest will actually be sent: our copy when their app lost theirs.
   *
   * Computed before `published`, because what "published" means is "there is a link the guest can
   * open" — and that is this link, not `estimator.guestUrl` specifically. Measured on the sim
   * deployment, 2026-09-28: the simulated engine answers `share` with a relative path and no app host
   * resolves it, so publishing mints our copy and leaves `guestUrl` null; the studio then called the
   * record unpublished and said "Approved — not sent yet" about a quotation whose copy page opens
   * perfectly, with its link sitting in the field right beside the wrong label.
   */
  const guestLink = guestLinkFor(draft);
  const published = Boolean(draft.estimator?.sharedAt && guestLink);
  const priced = Boolean(draft.pricing);
  /**
   * A price is only usable for a guest link when the ENGINE has a scenario behind it: publishing
   * freezes a revision of that scenario, and a figure from the built-in sample engine (which is what
   * the seeded fixture carries) has nothing to freeze. Measured on production: the studio offered
   * Approve → Send for the fixture, and `Create link` answered "price the quotation before publishing
   * it" — true of the scenario, misleading about the price.
   */
  const enginePriced = Boolean(draft.estimator?.id);
  const approved = draft.status === "confirmed_by_hono";
  const archived = draft.status === "cancelled";

  const statusLabel = archived
    ? "Archived"
    : draft.status !== "confirmed_by_hono" && published
        ? "Published — needs approval"
        : published
          ? // A link is not a delivery. "Create link only" publishes without sending, and reading that
            // as "the guest has it" is the one thing this label must never do — measured on production.
            draft.sentToGuestAt
            ? "Sent to guest"
            : "Link ready — not sent"
          : priced && !enginePriced
            ? // Ahead of "approved" on purpose: an approval of a figure the engine never priced is not
              // progress, and it must not hide the one thing to do. Found on production, where the
              // fixture was approved with a sample-engine price and the wizard offered Send.
              "Needs a price from the engine"
            : approved
              ? "Approved — not sent yet"
              : priced
                ? "Priced — needs approval"
                : "Needs review";
  const statusTone = archived ? "rose" : published || approved ? "emerald" : "amber";
  /**
   * Whether the resort owes this guest a chase, and how urgently.
   *
   * `followUpState` is the one place that decides, and it is deliberately strict about what counts:
   * only a quotation that was actually **sent** (a link-only publish is not a delivery), that is not
   * archived, and that has no folio against it. The first version of this badge used `sharedAt` as a
   * fallback and ignored `submission`, so it called a never-sent link "overdue", and it would have
   * kept saying "no deposit yet" about a booking that already had one.
   */
  const followUp = followUpState(draft);
  const validUntil = quotationValidUntil(draft);
  const isStale = followUp === "stale";
  /** Sent, past the nudge threshold, still inside the stated validity: a gentle chase is due. */
  const isDueForNudge = followUp === "nudge";
  const window = followUpWindowFromEnv();
  /**
   * The follow-up staff copy and paste, built here rather than in the browser.
   *
   * It says what is true — the stay, the link, the terms the resort publishes — and nothing about
   * scarcity: "rooms are filling up quickly" was in the first version of this feature and is not
   * something this system can know, because availability lives in the team Odoo and nothing
   * here ever asks. A template that invents urgency is a sentence a guest can check.
   */
  const followUpText =
    followUp === "none"
      ? ""
      : [
          `Hi ${draft.guestName || "there"}! Just checking in about your quotation for ${draft.checkIn} to ${draft.checkOut} at Casa Escondida Anilao.`,
          "",
          ...quotationValidityLines(validUntil),
          guestLink ? `You can look at it here: ${guestLink}` : "",
          "",
          "If you would like to go ahead, just reply here and our front desk will take it from there.",
        ]
          .filter((line) => line !== "")
          .join("\n");
  /** A JS string literal that cannot close the page's template literal, whatever the guest is called. */
  const followUpJsString = JSON.stringify(followUpText).replace(/`/g, "\\u0060");


  // A step is `done` when it is behind us, `current` when it is the next thing to do. "Get price"
  // counts as done only when the ENGINE priced it: a figure with no scenario behind it cannot become
  // a guest link, so calling that step finished would send the person to a button that refuses.
  const steps: Array<{ label: string; state: "done" | "current" | "todo" }> = [
    { label: "Review trip", state: draft.bffTrip ? "done" : "current" },
    { label: "Get price", state: enginePriced ? "done" : draft.bffTrip ? "current" : "todo" },
    { label: "Approve", state: approved || published ? "done" : enginePriced ? "current" : "todo" },
    { label: "Send", state: published ? "done" : approved ? "current" : "todo" },
  ];
  // Which screen opens — and how far the wizard may go. The ENGINE's price is what unlocks approving
  // and sending: their `share` freezes a revision of THEIR scenario, so without one there is nothing
  // to approve and nothing to publish, whatever the record's status happens to say.
  //
  // Server-rendered, like the status: the right step must be in front of the person before any script
  // runs, and the step is derived from the record alone.
  const maxStep = published ? 4 : enginePriced ? (approved ? 4 : 3) : draft.bffTrip ? 2 : 1;
  const initialStep: number = published ? 4 : enginePriced && approved ? 4 : enginePriced ? 3 : 1;

  /**
   * What the wizard's button says before any script runs — and it has to be TRUE, not just present.
   * The label depends on which SCREEN is open, not only on the record: on screen 2 with a price in
   * hand the button only walks forward, while on screen 3 the same button approves. (Rendered wrong
   * once, in a browser: screen 2 offered "Approve quotation" for a button that does not approve.)
   *
   * The script sets the same labels in `updateWizard`; this is the server-rendered starting point, so
   * the button is right for a person whose script has not run yet.
   */
  const nextLabel =
    initialStep === 1
      ? "Save &amp; get price"
      : initialStep === 2
        ? enginePriced
          ? "Continue to approve &rarr;"
          : "Get price"
        : initialStep === 3
          ? approved
            ? "Continue to send &rarr;"
            : "Approve quotation"
          : published
            ? draft.sentToGuestAt
              ? "Send the message again"
              : "Send the message"
            : "Create link &amp; send";

  const initialJson = JSON.stringify(draft).replace(/</g, "\\u003c");
  const allQuotesJson = JSON.stringify(
    allQuotes.map((q) => ({
      quoteId: q.quoteId,
      guestName: q.guestName,
      checkIn: q.checkIn,
      nights: q.nights,
      // The engine's figure, and ONLY the engine's. `totalAmount` is the draft builder's own
      // hand-computed table (still produced, and still useful as a preview while staff look at an
      // enquiry), but it is not what a guest is quoted — so it must never be what the queue shows
      // next to "checkIn (n nights)". A quotation nobody has priced shows no money rather than a
      // number no engine produced; measured on a real quotation where the two disagreed by 7,200.
      engineRevenue: q.pricing?.kpis.revenue ?? null,
      currency: q.currency,
      status: q.status,
      sentToGuestAt: q.sentToGuestAt ?? null,
      // For "latest first": a quotation that has not been sent has no send time, so the queue falls
      // back to the last time anyone touched it.
      updatedAt: q.updatedAt ?? null,
      submission: Boolean(q.submission),
    }))
  ).replace(/</g, "\\u003c");
  // There used to be an "AI reading check" scorecard computed here ("N of M quotations needed no
  // correction"). It was removed on 2026-09-29: it counted a quotation nobody had opened as "unchanged"
  // and it counted test records, so the figure measured nothing a receptionist could act on, and it sat
  // at the top of the queue pushing the working list below the fold. The per-quotation `staffEdits`
  // are still recorded on every save — that is the data a real measure would be built from.

  return {
    draft,
    allQuotes,
    role,
    estimatorKind,
    guestLink,
    published,
    priced,
    enginePriced,
    approved,
    archived,
    statusLabel,
    statusTone,
    followUp,
    validUntil,
    isStale,
    isDueForNudge,
    window,
    followUpText,
    followUpJsString,
    steps,
    maxStep,
    initialStep,
    nextLabel,
    initialJson,
    allQuotesJson,
  };
}
