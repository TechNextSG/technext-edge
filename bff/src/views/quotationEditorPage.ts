import { themeCss } from "./theme.ts";
import { escapeHtml } from "./html.ts";
import {
  guestLinkFor,
  quotationValidityLines,
  followUpState,
  followUpWindowFromEnv,
  quotationValidUntil,
  type HonoQuotationDraft,
} from "../../../quotation/src/index.ts";
import { type Trip } from "../../../ai/src/index.ts";
import { type DemoRole } from "../auth/demoAuth.ts";

export function renderHonoQuotationEditorHtml(
  draft: HonoQuotationDraft,
  allQuotes: HonoQuotationDraft[],
  role: DemoRole = "staff",
  /**
   * Which engine prices this deployment. The "Send reservation" bar is hidden when it is `remote`:
   * bookings are taken on the customer's own quotation page (their app owns the folio), and the
   * route refuses with `wrong_place` — offering a button that always refuses is worse than not
   * offering it, because a receptionist reads the refusal as a fault in the quotation.
   */
  estimatorKind: "simulated" | "remote" = "simulated",
): string {  // ---- The one status, and the four steps ---------------------------------
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

  const progressHtml = archived
    ? `<div class="progress-note">This quotation is archived. Nothing is sent to the guest from here.</div>`
    : `<div class="progress">${steps
        .map((s, i) => {
          const n = i + 1;
          // A step ahead of where the record has got to is not offered: the bar says what is
          // possible, not what the workflow would look like if earlier work had been done.
          const reachable = n <= maxStep;
          return `<button type="button" class="pstep ${s.state}" data-step="${n}" onclick="goStep(${n})"${reachable ? "" : " disabled"} title="${
            reachable ? `Go to step ${n}: ${s.label}` : `Finish the earlier steps first`
          }">${`<span class="pnum">${s.state === "done" ? "✓" : n}</span>${s.label}`}</button>`;
        })
        .join('<div class="psep"></div>')}</div>`;


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

  // ---- The engine's own answer, drawn -------------------------------------
  // Everything below is read from `draft.pricing`, which is the pricing engine's response as it was
  // when the quotation was priced. Nothing here is recomputed: a per-guest card that disagrees with
  // the total above it would be worse than no card at all.
  const pricing = draft.pricing ?? null;
  const money = (n: number) => `${draft.currency === "USD" ? "$" : "₱"}${Math.round(n).toLocaleString("en-US")}`;
  // `esc` is the shared escaper (html.ts). A guest's own words reach this page — their name, their
  // dive notes, a line description staff edited — and none of it is trusted markup.
  const esc = escapeHtml;

  const guestCardsHtml =
    !pricing || pricing.guests.length === 0
      ? ""
      : `<div style="margin-top:22px;">
          <div style="font-size:15px;font-weight:800;margin-bottom:4px;">Per guest</div>
          <div style="font-size:13.5px;color:var(--muted);margin-bottom:12px;">The engine's own lines, one card per guest${pricing.sample ? " · SAMPLE DATA" : ""}.</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px;">
            ${pricing.guests
              .map(
                (guest) => `<div style="background:var(--surface-2);border:2px solid var(--border);border-radius:12px;padding:14px 16px;">
              <div style="font-weight:800;font-size:16px;margin-bottom:6px;">${esc(guest.name)}</div>
              ${guest.lines
                .map(
                  (line) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;padding:6px 0;border-bottom:1px dashed var(--border);">
                <span><strong>${esc(line.label)}</strong>${line.sub ? `<br><span style="color:var(--muted);font-size:12.5px;">${esc(line.sub)}</span>` : ""}</span>
                <strong style="white-space:nowrap;">${money(line.net)}</strong>
              </div>`,
                )
                .join("")}
              ${
                guest.discountTotal > 0
                  ? `<div style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--emerald);padding-top:6px;"><span>Partner discount</span><strong>-${money(guest.discountTotal)}</strong></div>`
                  : ""
              }
              <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;padding-top:8px;"><span>Total</span><span>${money(guest.total)}</span></div>
            </div>`,
              )
              .join("")}
          </div>
          ${
            pricing.warnings.length > 0
              ? `<div style="margin-top:12px;padding:12px 14px;background:var(--surface-2);border-left:4px solid #f59e0b;border-radius:8px;font-size:13.5px;color:var(--text);">
                  <strong>From the booking engine</strong>
                  <ul style="margin:6px 0 0 18px;">${pricing.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
                </div>`
              : ""
          }
        </div>`;

  /**
   * Agent View: the retail value next to the partner rate.
   *
   * Only rendered when the engine returned a retail model — a retail session gets none, so this is
   * absent for a guest rather than showing two identical columns and calling the difference margin.
   * The margin is arithmetic on two numbers the engine produced, and it is left unrounded on
   * purpose so nobody mistakes it for a booked figure.
   */
  const retailKpis = pricing?.retail?.kpis ?? null;
  const agentCompareHtml =
    !pricing?.retail || pricing.retail.guests.length === 0
      ? ""
      : `<div style="margin-top:20px;background:var(--surface-2);border:2px solid var(--border);border-radius:12px;padding:16px;">
          <div style="font-size:15px;font-weight:800;margin-bottom:4px;">Agent view — retail value vs your rate</div>
          <div style="font-size:13.5px;color:var(--muted);margin-bottom:12px;">Both columns are the engine's. The difference is your margin on this trip.</div>
          <table class="quote-table" style="width:100%;">
            <thead><tr><th>Guest</th><th style="text-align:right;">Retail</th><th style="text-align:right;">Your rate</th><th style="text-align:right;">Margin</th></tr></thead>
            <tbody>
              ${pricing.retail.guests
                .map((retailGuest, i) => {
                  const netGuest = pricing.guests[i];
                  const retailTotal = retailGuest.total;
                  const netTotal = netGuest ? netGuest.total : 0;
                  const margin = retailTotal - netTotal;
                  const pct = retailTotal > 0 ? Math.round((margin / retailTotal) * 1000) / 10 : 0;
                  return `<tr>
                    <td>${esc(retailGuest.name)}</td>
                    <td style="text-align:right;">${money(retailTotal)}</td>
                    <td style="text-align:right;">${money(netTotal)}</td>
                    <td style="text-align:right;">${money(margin)}${pct ? ` <span style="color:var(--muted);font-size:12.5px;">(${pct}%)</span>` : ""}</td>
                  </tr>`;
                })
                .join("")}
              ${
                retailKpis && retailKpis.revenue !== null
                  ? `<tr style="font-weight:800;"><td>Total</td><td style="text-align:right;">${money(retailKpis.revenue)}</td><td style="text-align:right;">${money(pricing.kpis.revenue ?? 0)}</td><td style="text-align:right;">${money(retailKpis.revenue - (pricing.kpis.revenue ?? 0))}</td></tr>`
                  : ""
              }
            </tbody>
          </table>
        </div>`;

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Staff Quotation Review (${draft.quoteId}) — Casa Escondida Anilao</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
${themeCss()}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 16px;
      line-height: 1.6;
      padding-bottom: 72px;
      transition: background 0.2s, color 0.2s;
    }
    .topbar {
      background: var(--surface);
      border-bottom: 2px solid var(--border);
      padding: 16px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
      gap: 16px;
      flex-wrap: wrap;
      box-shadow: var(--shadow);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-badge {
      background: linear-gradient(135deg, #0284c7, #2563eb);
      color: #fff;
      font-weight: 800;
      font-size: 13px;
      padding: 6px 12px;
      border-radius: 8px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .brand h1 {
      font-size: 20px;
      font-weight: 800;
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .theme-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--surface-2);
      border: 2px solid var(--border);
      color: var(--text);
      border-radius: 999px;
      padding: 8px 16px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
    .theme-btn:hover { border-color: var(--accent); }
    .container {
      max-width: 1360px;
      margin: 24px auto;
      padding: 0 24px;
      display: grid;
      grid-template-columns: 310px 1fr;
      gap: 24px;
    }
    /* A grid item's default min-width: auto lets one wide child (the queue's tab row, a table)
       push the whole page wider than the screen. Measured: a 502px phone viewport had a 716px
       document because of it. */
    .container > * { min-width: 0; }
    @media (max-width: 1024px) {
      /* Narrow screen: the wizard is the work, so it comes FIRST and the queue follows. Measured in
         a browser at 630px: the sidebar (AI check + the whole quotation list) filled the viewport and
         the screen somebody is actually working on was below the fold. The bar also stops being
         sticky here — a sticky bar over a short viewport covers the content it belongs to. */
      .container { grid-template-columns: 1fr; }
      .container > main { order: -1; }
      .wizard-nav { position: static; }
      body { padding-bottom: 16px; }
    }
    /* ---- Phones -------------------------------------------------------------
       A phone is a real device for this page: reading a quotation back to a guest on the phone,
       checking a dive grid while standing at the boat. The two things that break first are the tables
       and the wizard bar, so both are restructured rather than shrunk. */
    @media (max-width: 640px) {
      .topbar { padding: 10px 12px; gap: 10px; }
      .brand { gap: 10px; }
      .brand h1 { font-size: 16.5px; line-height: 1.3; }
      .brand-badge { font-size: 10.5px; padding: 4px 8px; letter-spacing: 0.03em; }
      .top-actions { gap: 8px; }
      .theme-btn { padding: 6px 10px; font-size: 12.5px; }
      .container { padding: 0 10px; margin: 12px auto; }
      .card { padding: 16px 13px; border-radius: 14px; }
      .card-title { font-size: 15px; }
      /* One field per row: two 130px inputs on a 360px screen is a coin flip on every keystroke. */
      .meta-grid { grid-template-columns: 1fr; gap: 10px; }
      /* Four steps wrap to two rows, which is fine; the circles shrink so the labels stay legible. */
      .progress { gap: 6px; }
      .pstep { padding: 5px 10px; font-size: 12.5px; gap: 6px; }
      .pstep .pnum { width: 17px; height: 17px; font-size: 11px; }
      .psep { width: 10px; }
      /* The bar becomes three stacked rows: where you are, the action, then Back. The primary action
         is full width and ABOVE Back, because a thumb reaches the middle of the screen rather than
         the bottom-left corner. */
      .wizard-nav {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        margin-top: 14px;
      }
      .wizard-nav .btn { width: 100%; justify-content: center; padding: 14px 16px; font-size: 16px; }
      .wizard-label { order: 1; text-align: center; }
      #btn-next { order: 2; }
      #btn-back { order: 3; }
      /* Tables keep their columns and scroll sideways inside their card, which is honest about the
         data; squeezing a five-column dive grid into 360px would make it unreadable instead. */
      .quote-table { font-size: 13px; }
      .quote-table th, .quote-table td { padding: 6px 8px; }
      .link-editor-bar { padding: 10px; gap: 8px; }
      .link-editor-bar input { min-width: 100%; font-size: 13.5px; padding: 9px 11px; }
      .link-editor-bar .btn { flex: 1; justify-content: center; }
      .ai-reply-box { font-size: 15px; padding: 14px; border-radius: 12px; }
      .btn { padding: 10px 14px; font-size: 14px; }
      .notice { font-size: 13.5px; padding: 10px 12px; }
      input[type="checkbox"] { width: 15px; height: 15px; }
      /* The dive grid is wider than a phone on purpose (five columns of days cannot be squeezed into
         360px and stay readable), so the screen says it scrolls rather than leaving it to be found. */
      .scroll-hint { display: block; }
    }
    .scroll-hint {
      display: none;
      font-size: 12.5px;
      color: var(--muted);
      font-weight: 700;
      margin-top: 6px;
    }
    .card {
      background: var(--surface);
      border: 2px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: var(--shadow);
    }
    .card-title {
      font-size: 17px;
      font-weight: 800;
      color: var(--accent);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 800;
    }
    .status-pending {
      background: var(--amber-soft);
      color: var(--amber);
      border: 2px solid var(--amber);
    }
    .status-confirmed {
      background: var(--emerald-soft);
      color: var(--emerald);
      border: 2px solid var(--emerald);
    }
    .status-amber {
      background: var(--amber-soft);
      color: var(--amber);
      border: 2px solid var(--amber);
    }
    .status-emerald {
      background: var(--emerald-soft);
      color: var(--emerald);
      border: 2px solid var(--emerald);
    }
    .status-rose {
      background: rgba(244,63,94,0.12);
      color: #e11d48;
      border: 2px solid #f43f5e;
    }
    /* The four steps, and the one place a failure is shown. Both are about the same thing: what is
       left to do before a guest hears from us. */
    .progress {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pstep {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      border-radius: 999px;
      border: 2px solid var(--border);
      background: var(--surface-2);
      color: var(--muted);
      font-size: 13.5px;
      font-weight: 800;
    }
    .pstep .pnum {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--border);
      color: var(--text);
      font-size: 12px;
    }
    .pstep.done {
      border-color: var(--emerald);
      color: var(--emerald);
      background: var(--emerald-soft);
    }
    .pstep.done .pnum { background: var(--emerald); color: #fff; }
    .pstep.current {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--accent-soft);
    }
    .pstep.current .pnum { background: var(--accent); color: #fff; }
    .psep {
      width: 18px;
      height: 2px;
      background: var(--border);
    }
    .progress-note {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--muted);
    }
    .notice {
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .notice-error {
      background: rgba(244,63,94,0.1);
      border-left: 5px solid #f43f5e;
      color: #e11d48;
    }
    .notice-info {
      background: var(--emerald-soft);
      border-left: 5px solid var(--emerald);
      color: var(--emerald);
    }
    /* ---- The wizard: one screen per step ------------------------------------
       The page used to be one long column of cards and a person scrolled to find the next thing to
       do. Each step now owns the screen, the nav bar owns the one action that finishes it, and the
       step that is not being worked on is not in the way.

       The initial screen is chosen SERVER-side (the data-step attribute on the main element), so it
       is correct before any script runs — the same reason the status pill is server-rendered. */
    main > [data-step-card] { display: none; }
    main[data-step="1"] > [data-step-card="1"],
    main[data-step="2"] > [data-step-card="2"],
    main[data-step="3"] > [data-step-card="3"],
    main[data-step="4"] > [data-step-card="4"] { display: block; }
    .pstep { cursor: pointer; }
    .pstep:disabled { cursor: default; opacity: 0.55; }
    .wizard-nav {
      position: sticky;
      bottom: 0;
      z-index: 5;
      margin-top: 18px;
      padding: 12px 16px;
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 14px 14px 0 0;
      box-shadow: 0 -6px 18px rgba(0,0,0,0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .wizard-label {
      font-size: 13.5px;
      font-weight: 800;
      color: var(--muted);
    }
    .wizard-label strong { color: var(--text); }
    .link-editor-bar {
      display: flex;
      gap: 10px;
      align-items: center;
      background: var(--surface-2);
      border: 2px solid var(--border);
      padding: 14px;
      border-radius: 12px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .link-editor-bar input {
      flex: 1;
      min-width: 260px;
      background: var(--input-bg);
      border: 2px solid var(--border);
      color: var(--accent);
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      font-weight: 600;
      padding: 10px 14px;
      border-radius: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
      border: 2px solid transparent;
      transition: 0.15s;
      text-decoration: none;
    }
    .btn-primary {
      background: var(--accent);
      color: #ffffff;
    }
    .btn-primary:hover { filter: brightness(1.08); }
    .btn-emerald {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      font-size: 16px;
      padding: 14px 24px;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.28);
    }
    .btn-emerald:hover { filter: brightness(1.08); }
    .btn-outline {
      background: var(--surface-2);
      color: var(--text);
      border-color: var(--border);
    }
    .btn-outline:hover { border-color: var(--accent); }
    .btn-danger {
      background: rgba(244, 63, 94, 0.12);
      color: var(--rose);
      border-color: rgba(244, 63, 94, 0.35);
      padding: 8px 12px;
      font-size: 14px;
    }
    table.quote-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    table.quote-table th {
      text-align: left;
      font-size: 13.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      padding: 12px 10px;
      border-bottom: 2px solid var(--border);
      background: var(--surface-2);
    }
    table.quote-table td {
      padding: 12px 8px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    .cell-input {
      width: 100%;
      background: var(--input-bg);
      border: 2px solid var(--border);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 9px;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
    }
    .cell-input:focus {
      outline: none;
      border-color: var(--accent);
    }
    .cell-num {
      width: 90px;
      text-align: right;
      font-family: 'JetBrains Mono', monospace;
    }
    .cell-price {
      width: 125px;
      text-align: right;
      font-family: 'JetBrains Mono', monospace;
    }
    .subtotal-cell {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 800;
      font-size: 16px;
      color: var(--accent);
      text-align: right;
      padding-right: 12px;
    }
    .totals-grid {
      display: flex;
      justify-content: flex-end;
      margin-top: 20px;
    }
    .totals-box {
      width: 400px;
      max-width: 100%;
      background: var(--surface-2);
      border: 2px solid var(--border);
      border-radius: 14px;
      padding: 20px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .totals-row.grand {
      border-top: 2px solid var(--border);
      margin-top: 10px;
      padding-top: 14px;
      font-size: 21px;
      font-weight: 800;
      color: var(--emerald);
    }
    /* Two lines, not three. A card used to be ~160px tall — the long quotation id and the status label
       wrapped inside a narrow sidebar — so a laptop screen showed barely one and a half quotations
       before the receptionist had to scroll. Name + status on the first line, the trip on the second;
       the id shrinks to its last eight characters (the full id is still the link's title and is still
       what the search box matches). */
    .quote-list-item {
      display: block;
      padding: 9px 12px;
      border-radius: 10px;
      border: 2px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      text-decoration: none;
      margin-bottom: 8px;
      transition: 0.15s;
    }
    .quote-list-item:hover, .quote-list-item.active {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .ql-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .ql-name { font-size: 15px; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ql-status { font-size: 12.5px; font-weight: 800; display: flex; align-items: center; gap: 6px; white-space: nowrap; flex: none; }
    .ql-meta { font-size: 13px; color: var(--muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ql-id { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; opacity: 0.8; }

    /* Sort + filters. The sort box is always visible; the filters fold away behind one button whose
       badge says how many are on. A display:grid rule would override the hidden attribute, so it is
       restated explicitly below. */
    .queue-tools { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; }
    .queue-sort { flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 800; color: var(--muted); }
    /* The sort box has to show its whole current choice: a select that reads "Check-in soo" tells the
       receptionist nothing. Hence the short option labels and the slim Filters button beside it. */
    .queue-sort select, .queue-filters select {
      flex: 1; min-width: 0; width: 100%;
      border: 2px solid var(--border); border-radius: 8px;
      background: var(--input-bg); color: var(--text);
      padding: 6px 6px; font: inherit; font-size: 12.5px; font-weight: 600;
    }
    .queue-sort select:focus, .queue-filters select:focus { outline: none; border-color: var(--accent); }
    .queue-filter-btn { padding: 6px 8px; font-size: 12.5px; white-space: nowrap; flex: none; }
    .queue-filter-btn.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    #queue-filter-count:not(:empty) {
      margin-left: 4px; background: var(--accent); color: var(--surface);
      border-radius: 999px; padding: 0 6px; font-size: 11px; font-weight: 800;
    }
    .queue-filters {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px;
      margin-bottom: 10px; padding: 10px;
      border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2);
    }
    .queue-filters[hidden] { display: none; }
    .queue-filters label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .queue-filters label:nth-of-type(3) { grid-column: 1 / -1; }
    .queue-clear {
      grid-column: 1 / -1; justify-self: start; border: 0; background: none; padding: 2px 0;
      font: inherit; font-size: 12.5px; font-weight: 800; color: var(--accent); cursor: pointer; text-decoration: underline;
    }
    .queue-clear[hidden] { display: none; }
    .queue-empty { padding: 16px; text-align: center; color: var(--muted); font-size: 13px; font-weight: 600; }
    .queue-empty button { border: 0; background: none; font: inherit; font-weight: 800; color: var(--accent); cursor: pointer; text-decoration: underline; }
    .tab-row {
      display: flex;
      gap: 4px;
      /* Wraps rather than forcing the sidebar wider than the screen: four buttons in a row measured
         706px, which is what made the whole page scroll sideways on a phone. */
      flex-wrap: wrap;
      margin-bottom: 12px;
      background: var(--surface-2);
      padding: 4px;
      border-radius: 8px;
    }
    .tab-btn {
      flex: 1 1 auto;
      min-width: 70px;
      padding: 7px 10px;
      font-size: 13px;
      font-weight: 700;
      border: none;
      background: transparent;
      color: var(--muted);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .tab-btn:hover {
      color: var(--text);
    }
    .tab-btn.active {
      background: var(--card);
      color: var(--accent);
      box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    }
    .ai-reply-box {
      background: var(--surface-2);
      border: 2px solid var(--emerald);
      border-radius: 14px;
      padding: 20px;
      font-size: 16px;
      font-weight: 500;
      white-space: pre-wrap;
      line-height: 1.7;
      color: var(--text);
      margin-top: 14px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }
    @media (max-width: 768px) {
      .meta-grid { grid-template-columns: 1fr 1fr; }
    }
    .meta-field label {
      display: block;
      font-size: 13px;
      font-weight: 800;
      color: var(--muted);
      text-transform: uppercase;
      margin-bottom: 6px;
    }
  </style>
</head>
<body data-role="${role}">
  <div style="background:var(--accent-soft);border-bottom:1px solid var(--border);color:var(--text);font-size:13.5px;padding:8px 20px;text-align:center;font-weight:600;">
    Casa Escondida Anilao · Staff Operations Desk
  </div>
  <header class="topbar">
    <div class="brand">
      <span class="brand-badge">RESORT STAFF DESK · DEMO AUTH</span>
      <h1>Casa Escondida — Quotation Review #${draft.quoteId}</h1>
    </div>
    <div class="top-actions">
      <form method="post" action="/logout" style="display:inline;"><button type="submit" class="theme-btn">Sign out</button></form>
      <button type="button" class="theme-btn" id="theme-toggle-btn" onclick="toggleTheme()">
        <span id="theme-label">Dark Mode</span>
      </button>
    </div>
  </header>

  <div class="container">
    <!-- Sidebar: the quotations a staff member is reviewing -->
    <aside>
      <div class="card">
        <div class="card-title">
          <span>All Quotations</span>
          <span id="queue-count-badge" style="font-size:12px;font-weight:800;background:var(--accent-soft);color:var(--accent);padding:2px 8px;border-radius:999px;"></span>
        </div>
        <input type="text" id="quote-search-input" oninput="filterQuotesList(this.value)" placeholder="Search name, quote ID or date…" class="cell-input" style="margin-bottom:10px;font-size:13.5px;padding:9px 12px;" />
        <div class="tab-row" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">
          <button type="button" class="tab-btn" id="tab-action-needed" onclick="setQuoteFilter('action-needed')">Action Needed</button>
          <button type="button" class="tab-btn" id="tab-waiting" onclick="setQuoteFilter('waiting')">Waiting</button>
          <button type="button" class="tab-btn" id="tab-all" onclick="setQuoteFilter('all')">All</button>
          <button type="button" class="tab-btn" id="tab-cancelled" onclick="setQuoteFilter('cancelled')">Archived</button>
        </div>
        <!-- Sort is always in reach; the three filters fold away, but open themselves whenever one is on,
             so a hidden filter can never be the silent reason a quotation is missing from the list. -->
        <div class="queue-tools">
          <label class="queue-sort"><span>Sort</span>
            <select id="queue-sort" aria-label="Sort quotations" onchange="setQueueView('sort', this.value)">
              <option value="latest">Latest first</option>
              <option value="oldest">Oldest first</option>
              <option value="checkin">Check-in date</option>
              <option value="name">Name A–Z</option>
              <option value="total">Highest total</option>
            </select>
          </label>
          <button type="button" id="queue-filter-toggle" class="btn btn-outline queue-filter-btn" aria-expanded="false" aria-controls="queue-filters" onclick="toggleQueueFilters()">Filters<span id="queue-filter-count"></span></button>
        </div>
        <div id="queue-filters" class="queue-filters" hidden>
          <label>Sent
            <select id="qf-sent" onchange="setQueueView('sent', this.value)">
              <option value="any">Any time</option>
              <option value="unsent">Not sent yet</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
            </select>
          </label>
          <label>Check-in
            <select id="qf-checkin" onchange="setQueueView('checkin', this.value)">
              <option value="any">Any date</option>
              <option value="next7">Next 7 days</option>
              <option value="next30">Next 30 days</option>
              <option value="past">Already past</option>
            </select>
          </label>
          <label>Price
            <select id="qf-price" onchange="setQueueView('price', this.value)">
              <option value="any">Any</option>
              <option value="priced">Priced</option>
              <option value="unpriced">Not priced yet</option>
            </select>
          </label>
          <button type="button" id="queue-clear" class="queue-clear" onclick="clearQueueFilters()">Clear filters</button>
        </div>
        <div id="quote-sidebar-list"></div>
        <div id="quote-pagination" style="display:flex;justify-content:space-between;align-items:center;padding:12px 4px 4px;margin-top:10px;border-top:1px solid var(--border);font-size:12.5px;font-weight:700;">
          <button type="button" class="btn btn-outline" onclick="changeQuotePage(-1)" id="btn-prev-page" style="padding:4px 10px;font-size:12px;">&larr; Prev</button>
          <span id="quote-page-info" style="color:var(--muted);font-size:12px;">Page 1 of 1</span>
          <button type="button" class="btn btn-outline" onclick="changeQuotePage(1)" id="btn-next-page" style="padding:4px 10px;font-size:12px;">Next &rarr;</button>
        </div>
      </div>
    </aside>

    <!-- Main Studio -->
    <main data-step="${initialStep}">
      ${
        archived
          ? `<div style="margin-bottom:18px;padding:14px 18px;border-radius:12px;background:rgba(244,63,94,0.1);border:2px solid #f43f5e;color:#e11d48;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
        <span>This quotation is archived.</span>
        <span style="font-size:13px;font-weight:600;color:var(--muted);">Excluded from the working queue</span>
      </div>`
          : ""
      }

      <!-- Where the quotation is, and what is left to do. One status, one bar. -->
      <div class="card staff-only" id="workflow-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="font-size:15px;font-weight:800;">This quotation</div>
            <span id="quote-status-badge" class="status-pill status-${statusTone}">${statusLabel}</span>
            ${
              isStale
                ? `<span class="status-pill status-amber" title="Sent over ${window.staleHours} hours ago, with no reservation made" style="font-size:12.5px;padding:4px 10px;">⚠️ Stale (&gt;${window.staleHours}h)</span>`
                : isDueForNudge
                  ? `<span class="status-pill status-amber" title="Sent over ${window.nudgeHours} hours ago and no answer yet — a gentle chase is due" style="font-size:12.5px;padding:4px 10px;">⏳ Follow up (&gt;${window.nudgeHours}h)</span>`
                  : ""
            }
          </div>
          <a class="btn btn-outline staff-only" id="workflow-ops-sheet-btn" href="/quotes/${encodeURIComponent(draft.quoteId)}/ops" target="_blank" style="padding:6px 14px;font-size:13px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">Ops Sheet &nearr;</a>
        </div>
        ${progressHtml}
        <!-- The one action that finishes a step lives in the wizard bar at the bottom of the screen,
             so the card in front of the person holds no competing primary button. -->
        <div id="save-hint" class="staff-only" style="margin-top:12px;font-size:13px;color:var(--muted);font-weight:600;">
          ${published ? "Published: the trip and its price are frozen. Change them by starting a new quotation." : "One save for the guest's details and the priced trip."}
        </div>
        <!-- One place for anything that goes wrong. Every action writes here instead of into its own
             corner of the page, so a refusal is never missed because it appeared somewhere the eye
             was not. -->
        <div id="studio-notice" class="notice" style="display:none;" role="status" aria-live="polite"></div>
      </div>

      <!-- STEP 1 — the guest's details and the trip the engine will be asked to price -->
      <div class="card" data-step-card="1">
        <div class="card-title">
          <span>Step 1 · Guest &amp; stay details</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">From the guest's message — correct anything that is wrong</span>
        </div>

        ${
          Array.isArray(draft.staffAlerts) && draft.staffAlerts.length > 0
            ? `<div style="margin-bottom:18px;padding:14px 16px;border-left:5px solid var(--amber);background:var(--amber-soft);border-radius:10px;">
          <div style="font-size:15px;font-weight:800;color:var(--amber);margin-bottom:6px;">Check before approving</div>
          <ul style="margin:0;padding-left:22px;font-size:15px;line-height:1.65;font-weight:600;">
            ${draft.staffAlerts.map((a) => `<li>${String(a).replace(/</g, "&lt;")}</li>`).join("")}
          </ul>
        </div>`
            : ""
        }

        <!-- Guest & Stay Metadata (Editable) -->
        <div class="meta-grid">
          <div class="meta-field">
            <label>Guest Full Name</label>
            <input class="cell-input" id="meta-guestName" value="${esc(draft.guestName)}" />
          </div>
          <div class="meta-field">
            <label>Check-in Date</label>
            <input class="cell-input" id="meta-checkIn" value="${esc(draft.checkIn)}" />
          </div>
          <div class="meta-field">
            <label>Check-out Date</label>
            <input class="cell-input" id="meta-checkOut" value="${esc(draft.checkOut)}" />
          </div>
          <div class="meta-field">
            <label>Nights / Rooms / Guests</label>
            <input class="cell-input" value="${draft.nights} nights · ${draft.rooms} rooms · ${draft.stayingGuests}/${draft.totalGroupSize} pax" readonly style="color:var(--muted);background:var(--surface-2);" />
          </div>
        </div>

        ${draft.specialRequests || draft.dietNotes || draft.transferDirection ? `
        <div style="margin-top:18px;padding:14px 16px;background:var(--surface-2);border:2px solid var(--border);border-radius:12px;font-size:14px;font-weight:600;">
          <div style="font-size:13px;font-weight:800;color:var(--muted);margin-bottom:6px;">From the guest — for the desk, not sent to the engine</div>
          ${draft.specialRequests ? `<div>Special requests: ${esc(draft.specialRequests)}</div>` : ''}
          ${draft.dietNotes ? `<div>Diet / allergies: ${esc(draft.dietNotes)}</div>` : ''}
          ${draft.transferDirection ? `<div>Transfer: ${draft.transferDirection === 'arrival' ? 'arrival only' : 'departure only'}</div>` : ''}
        </div>` : ''}

        <div style="margin-top:18px;">
          <label style="display:block;font-size:15px;font-weight:800;color:var(--text);margin-bottom:8px;">Note for the guest (printed on their quotation page)</label>
          <input type="text" id="input-staff-notes" class="cell-input" value="${esc(draft.staffNotes)}" />
        </div>

        <!-- The save for the whole review step lives at the bottom of the screen (the wizard bar):
             the guest's details and the trip go together. -->
        <div class="staff-only" style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span style="font-size:13px;color:var(--muted);font-weight:600;">Saved by <strong>Save &amp; get price</strong> at the bottom of this screen.</span>
        </div>
      </div>

      <!-- STEP 1, continued: the trip itself -->
      <div class="card" data-step-card="1">
        <div class="card-title">
          <span>Step 1 · Rooms &amp; diving</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">What the resort's engine prices</span>
        </div>

        <!-- The trip review block FIRST: verify rooms & divers before calculating price -->
        <div class="staff-only" style="margin-bottom:18px;">
          <div style="margin-bottom:10px;">
            <div style="font-size:15px;font-weight:800;color:var(--text);">Trip review</div>
            <div style="font-size:13.5px;color:var(--muted);">Add or remove rooms, set each room's type, move guests between rooms, and tick the dives and courses. The button at the bottom of the screen saves this and asks the engine to price it.</div>
          </div>
          <div id="trip-review"></div>
        </div>
      </div>

      <!-- STEP 2 — what the engine answered. Nothing to edit here: the figures are the engine's, and
           the only action is to ask it again or to move on. -->
      <div class="card" data-step-card="2">
        <div class="card-title">
          <span>Step 2 · The price</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">From the resort's booking engine — the only source of a figure</span>
        </div>

        <!-- The engine bar. One button that always works: it prices a new scenario, and re-prices an
             existing one. -->
        <div class="staff-only" style="margin-bottom:18px;padding:14px 16px;background:var(--surface-2);border:2px solid var(--border);border-radius:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--text);">Price</div>
            <div style="font-size:13.5px;color:var(--muted);">
              ${
                priced
                  ? `Priced ${esc(String(draft.pricing?.computedAt ?? "").slice(0, 16).replace("T", " "))} — saving the trip again replaces this figure.`
                  : "Not priced yet. The resort's booking engine calculates every figure on this screen."
              }
            </div>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <span id="estimator-status-badge" style="font-size:13.5px;font-weight:700;color:var(--muted);">Checking the booking engine…</span>
            <span style="font-size:13px;color:var(--muted);font-weight:600;">The button at the bottom of the screen asks the engine${priced ? " again" : ""}.</span>
          </div>
        </div>

        <!-- Booking the reservation (simulated engine only). Kept off the guest's path and away from
             the two things this screen is for: reading the price and moving on. -->
        ${
          estimatorKind === "simulated"
            ? `<details class="staff-only" style="margin-bottom:18px;padding:12px 16px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;">
          <summary style="font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;user-select:none;">Book this as a reservation</summary>
          <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div style="font-size:12.5px;color:var(--muted);">Creates the booking in the resort's engine. Only available with the built-in sample engine.</div>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
              <button class="btn btn-outline" onclick="submitReservation()" id="btn-submit-reservation">Create booking</button>
              <span id="reservation-status-badge" style="font-size:13px;font-weight:700;color:var(--muted);"></span>
            </div>
          </div>
        </details>`
            : ""
        }

        <div class="totals-grid">
          <div class="totals-box">
            <div class="totals-row">
              <span>Engine total${pricing?.sample ? " (SAMPLE)" : ""}:</span>
              <strong>${pricing ? money(pricing.kpis.revenue ?? 0) : "not priced yet"}</strong>
            </div>
            <div class="totals-row">
              <span>Guests / nights / rooms:</span>
              <span>${pricing?.kpis.guests ?? "—"} · ${pricing?.kpis.nights ?? "—"} · ${draft.rooms}</span>
            </div>
            <div class="totals-row">
              <span>Revenue per guest-night:</span>
              <span>${pricing?.kpis.rpgn != null ? money(pricing.kpis.rpgn) : "—"}</span>
            </div>
            <div class="totals-row" style="color:var(--muted);font-size:13.5px;font-weight:600;">
              <span>No discount field: the only discount this resort has is the partner rate, and the engine applies it by itself.</span>
            </div>
          </div>
        </div>

        ${guestCardsHtml}
        ${agentCompareHtml}

        ${
          // The honest note about a sample engine, which is the one thing that confuses a demo:
          // editing the trip changes the payload and the frozen revision, while a captured price
          // does not move. Better said here than discovered by whoever is being shown.
          pricing?.sample
            ? `<div style="margin-top:16px;padding:12px 14px;border-radius:10px;background:var(--amber-soft);border-left:5px solid var(--amber);font-size:13.5px;font-weight:600;">
          <strong>Sample price.</strong> This figure is not from the resort's live books — this deployment is pointed at a sample engine. A correction still changes what the engine is asked to price and what the guest's frozen page shows; the figure here may not move until the live engine is connected.
        </div>`
            : ""
        }
      </div>

      <!-- STEP 3 — one decision, and the message it prepares -->
      <div class="card staff-only" data-step-card="3">
        <div class="card-title">
          <span>Step 3 · Approve</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">
            ${approved ? "Approved" : priced ? "Waiting for your approval" : "Get the price first"}
          </span>
        </div>

        <p style="font-size:13.5px;color:var(--muted);font-weight:600;margin:0 0 14px;">
          Approving locks in the price for this trip. The guest's link is created when you send, on the next screen.
        </p>

        <!-- Approving is the bar's button: the screen in front of the person holds no second copy of
             the same decision, which is what the first version of this wizard got wrong. -->
        <div style="display:flex;justify-content:flex-start;align-items:center;flex-wrap:wrap;gap:14px;">
          <button class="btn btn-outline" onclick="cancelQuotationAction()" id="btn-cancel-quote" style="color:var(--rose, #f43f5e);border-color:var(--rose, #f43f5e);">Archive quotation</button>
        </div>

        <div class="ai-reply-box" id="ai-confirmed-reply-box" style="${draft.status === "confirmed_by_hono" ? "" : "color:var(--muted);font-style:italic;"}">${
          draft.status === "confirmed_by_hono" && draft.aiConfirmedReply
            ? draft.aiConfirmedReply
            : "The message to the guest is prepared once the quotation is approved."
        }</div>
      </div>

      <!-- STEP 4 — the link, the number, and one button that does both -->
      <div class="card staff-only" data-step-card="4" id="ai-response-card">
        <div class="card-title">
          <span>Step 4 · Send to the guest</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">
            ${
              published
                ? `Link created ${esc(String(draft.estimator?.sharedAt ?? "").slice(0, 16).replace("T", " "))}`
                : "The link is created when you send"

            }
          </span>
        </div>

        <div class="link-editor-bar">
          <input type="text" id="input-quotation-url" value="${esc(guestLink ?? "")}" placeholder="No link yet — it appears here when you send" readonly title="The guest's quotation link" />
          <button class="btn btn-outline" onclick="copyQuoteLink()" ${published ? "" : "disabled"}>Copy link</button>
          <a class="btn btn-outline" id="btn-open-public-quote" href="${esc(guestLink ?? "#")}" target="_blank" rel="noopener" style="${published ? "" : "display:none;"}">Open guest page &rarr;</a>
        </div>

        ${
          // When their app could not hold the link it issued, the guest is sent OUR copy of the same
          // frozen revision. Staff are told, because "why is the link not on the customer's domain"
          // is a fair question to be asked in a demo — and because it is their deployment's fault,
          // not this quotation's.
          draft.estimator?.mirrorUrl
            ? `<div style="margin-top:12px;padding:12px 14px;border-radius:10px;background:var(--amber-soft);border-left:5px solid var(--amber);font-size:13px;font-weight:600;">
          <strong>The guest's link is a copy on our own page.</strong> ${esc(draft.estimator.mirrorReason ?? "")}
          <br><span style="color:var(--muted);">Their app's link: ${esc(draft.estimator.guestUrl ?? "(none)")}</span>
        </div>`
            : ""
        }

        <div style="margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:14px;font-weight:800;">Guest's WhatsApp number</label>
          <input type="text" id="whatsapp-phone-input" class="cell-input" style="width:220px;" placeholder="e.g. 639171234567" value="${draft.phone ?? ""}" />
          ${
            // The acknowledgement sits beside BOTH actions that publish, and until it is ticked the
            // primary button is disabled with the reason on screen — a button that is refused only
            // after the click teaches nothing, and this is the one place a sample price can reach a
            // guest.
            pricing?.sample
              ? `<label style="font-size:13px;font-weight:700;color:var(--accent);display:flex;align-items:center;gap:6px;">
                   <input type="checkbox" id="ack-sample" onchange="updateSendControls()" /> I have checked this sample price
                 </label>`
              : ""
          }
          <button class="btn btn-outline" onclick="publishQuote()" id="btn-publish-quote">Create link only</button>
          <span id="publish-status-badge" style="font-size:13px;font-weight:700;color:var(--muted);"></span>
          <span id="wa-toast" style="font-size:14px;font-weight:700;color:var(--accent);"></span>
        </div>
        <p id="send-hint" style="font-size:13px;color:var(--muted);font-weight:600;margin-top:10px;">
          The message carries the guest's own quotation link and no price of ours: the figures they read are the engine's, on their page.
          ${published ? "" : "The button at the bottom of the screen creates the link and sends it."}
        </p>

        ${
          // Only once the guest actually has the quotation. Chasing somebody about a link they were
          // never sent is how a helpful follow-up reads as a mistake, and the box also stated a
          // scarcity nobody has checked: "rooms are filling up quickly" is not something this system
          // knows (availability lives in the team Odoo, and we never ask). What it says instead
          // is what is true: the quotation's own deadline and the link
          // to look at. Whether the resort holds a room, and whether rooms are first-come, are
          // questions for Phillip — see `quotationValidityLines`.
          followUp === "none"
            ? ""
            : `<div style="margin-top:20px;padding:16px 18px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px;">
            <div style="font-size:14px;font-weight:800;color:var(--text);">
              ${isStale ? `⚠️ Past its validity (${window.staleHours}h) — chase or release` : `⏳ Follow-up due (${window.nudgeHours}h, still valid)`}
            </div>
            <button type="button" class="btn btn-outline" onclick="copyFollowupMessage()" style="padding:6px 12px;font-size:12.5px;font-weight:700;">Copy follow-up message</button>
          </div>
          <div id="followup-preview" style="font-size:13px;color:var(--muted);line-height:1.55;white-space:pre-line;">${esc(followUpText)}</div>
        </div>`
        }
      </div>

      <!-- The wizard bar. One action finishes the screen it belongs to, and Back is always there:
           a person who is unsure of a figure goes back and looks, which is what the long column of
           cards made awkward. Server-rendered state, like the progress bar, so the right button is
           in front of the person before any script runs. -->
      <div class="wizard-nav staff-only">
        <button type="button" class="btn btn-outline" onclick="goStep(stepNumber() - 1)" id="btn-back" ${initialStep <= 1 ? "disabled" : ""}>&larr; Back</button>
        <div class="wizard-label">
          Step <strong id="wizard-step-num">${initialStep}</strong> of 4 · <span id="wizard-step-name">${steps[initialStep - 1]?.label ?? ""}</span>
        </div>
        <button type="button" class="btn btn-primary" onclick="wizardNext()" id="btn-next">
          ${nextLabel}
        </button>
      </div>
    </main>
  </div>

  <script>
    let state = ${initialJson};
    const allQuotes = ${allQuotesJson};
    // The follow-up window and its text, decided on the server so the badge here, the badge on the
    // record and the sentence in the guest's message cannot disagree about when a quotation lapses.
    const FOLLOW_UP_HOURS = { nudge: ${window.nudgeHours}, stale: ${window.staleHours} };
    const FOLLOW_UP_TEXT = ${followUpJsString};

    // The same escaping the server does (html.ts), for the parts of this page the browser draws. A
    // line description and a guest name arrive from WhatsApp, so a less-than sign in either is not
    // markup — it is a guest's own text, and it reaches staff who are signed in.
    function escHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // "2026-11-20" -> "Nov 20", or "Nov 20 '27" when it is not this year. The queue card has room for
    // about thirty characters on its second line; a full ISO date pushed the short id off the end and
    // it was cut to "#735DA7…", which is worse than not showing it. Falls back to the raw text for
    // anything that is not an ISO date, so a malformed value is still visible rather than blank.
    function shortDate(iso) {
      var m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(iso || '');
      if (!m) return iso || '';
      var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      var s = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      return (+m[1] === new Date().getUTCFullYear()) ? s : s + " '" + m[1].slice(2);
    }

    /**
     * One place for anything that goes wrong, and one for anything that went right.
     *
     * Every action used to write into its own corner of the page — four separate <pre> blocks, two
     * toasts and two window.alert()s — so a refusal could appear somewhere the person was not
     * looking, and a refusal from Meta arrived as a sentence in one place and as raw JSON in
     * another. Now: failures go to the box at the top of the page, successes to a short green line.
     *
     * The server sends '{ok:false, reason, detail}'. The reason is the stable part; 'help' turns the
     * ones a receptionist will actually meet into the next thing to do, and whatever sentence the
     * server wrote is printed underneath. Nothing raw is ever rendered.
     */
    const ERROR_HELP = {
      not_priced: 'Get the price first, then approve.',
      no_scenario: 'This price did not come from the booking engine. Go to step 2 and press Get price, then try again.',
      trip_changed: 'The trip changed after it was priced. Save the trip again to get a new price, then approve.',
      not_approved: 'Approve the quotation first.',
      not_published: 'The guest link does not exist yet — sending creates it.',
      already_shared: 'This quotation is already published, and a published link cannot change. Start a new quotation instead.',
      sample_not_acknowledged: 'Tick the sample-price box before sending.',
      no_trip: 'This quotation has no trip to price.',
      seeded_fixture: 'This record is the cold-start example in this studio. Take a real enquiry through the flow and publish that one.',
      partner_needs_own_login: 'This enquiry is from an agent. They quote in the customer system after signing in, so there is nothing to publish here — reply to them instead.',
      guest_text_failed_fact_gate: 'The message does not match the trip, so it was not sent. Check the trip and the message, then send again.',
      rejected: 'The booking engine refused this trip. The line below says what to change; fix it in the trip review and save again.',
      trip_not_priceable: 'The engine cannot price this trip yet — check the fields it named.',
      invalid_trip: 'The trip is not in the shape the engine accepts.',
      phone_missing: "Enter the guest's WhatsApp number, including the country code.",
      phone_invalid: "That number does not look right. Include the country code, for example 639171234567.",
      send_failed: 'WhatsApp refused the message. The sentence below says what to fix.',
      not_configured: 'The pricing engine is not configured on this deployment.',
      unauthorized: 'Your session expired. Sign in again.',
      not_found: 'That quotation no longer exists.'
    };

    function showError(source, data) {
      const box = document.getElementById('studio-notice');
      const d = data || {};
      const reason = d.reason || d.error || 'failed';
      const help = ERROR_HELP[reason] || '';
      const lines = [source + ': ' + (help || reason)];
      if (typeof d.detail === 'string' && d.detail && d.detail !== help) lines.push(d.detail);
      else if (typeof d.error === 'string' && d.error && d.error !== help) lines.push(d.error);
      if (Array.isArray(d.fields) && d.fields.length) lines.push('Fields: ' + d.fields.join(', '));
      if (Array.isArray(d.issues) && d.issues.length && !(typeof d.detail === 'string' && d.detail)) {
        lines.push('Notes: ' + d.issues.map(function (i) { return (i && (i.code || i.detail)) || String(i); }).join(', '));
      }
      if (!box) return lines.join('\\n');
      box.className = 'notice notice-error';
      box.textContent = lines.join('\\n');
      box.style.display = 'block';
      if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
      return box.textContent;
    }

    function showInfo(message) {
      const box = document.getElementById('studio-notice');
      if (!box) return;
      box.className = 'notice notice-info';
      box.textContent = message;
      box.style.display = 'block';
    }

    function clearNotice() {
      const box = document.getElementById('studio-notice');
      if (box) {
        box.style.display = 'none';
        box.textContent = '';
      }
    }

    async function safeJson(res) {
      if (typeof res.text === 'function') {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (err) {
          const snippet = text ? text.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
          return {
            ok: false,
            reason: 'server_error',
            error: 'Server returned ' + (res.status || 'error') + (res.statusText ? ' ' + res.statusText : '') + (snippet ? ': ' + snippet : '')
          };
        }
      }
      if (typeof res.json === 'function') {
        try {
          return await res.json();
        } catch (err) {
          return { ok: false, reason: 'parse_error', error: String(err) };
        }
      }
      return { ok: false, reason: 'unknown_response', error: 'Invalid response' };
    }

    /**
     * The wizard: which screen is in front, and what the button at the bottom does.
     *
     * The four screens are in the page at once and CSS shows one of them (the data-step attribute on main), so a
     * step change is an attribute write and never a re-render. The step is remembered in
     * sessionStorage because finishing a step RELOADS the page — every figure on screen comes from
     * the record, so the record is what the next screen is drawn from — and coming back to step 1
     * after saving the trip would make the person walk the wizard again.
     */
    const STEP_NAMES = ['Review trip', 'Get price', 'Approve', 'Send'];
    const STEP_KEY = 'casa_studio_step';

    function stepNumber() {
      const main = document.querySelector('main');
      return Number(main && main.getAttribute('data-step')) || 1;
    }

    /** The furthest step the record has earned. A step after it is not offered at all. */
    function maxStep() {
      const published = Boolean(state.estimator && state.estimator.sharedAt);
      const approved = state.status === 'confirmed_by_hono';
      // The engine must own the quotation before there is anything to approve or publish: a price
      // from the built-in sample engine has no scenario to freeze (see the server-side note).
      const enginePriced = Boolean(state.estimator && state.estimator.id);
      if (published) return 4;
      if (enginePriced) return approved ? 4 : 3;
      if (state.bffTrip) return 2;
      return 1;
    }

    function goStep(n) {
      const target = Math.max(1, Math.min(4, Math.min(n, maxStep())));
      const main = document.querySelector('main');
      if (main) main.setAttribute('data-step', String(target));
      rememberStep(target);
      updateWizard();
      const box = document.getElementById('studio-notice');
      if (box) box.scrollIntoView({ block: 'nearest' });
    }

    /**
     * Where to open next time. The actions that finish a step reload the page — every figure on it
     * comes from the record — so the step has to survive the reload, or saving the trip would put the
     * person back on step 1 to walk the wizard again.
     */
    function rememberStep(n) {
      try { sessionStorage.setItem(STEP_KEY, String(n)); } catch (err) {}
    }

    /** The nav: where we are, what Back does, and the one action that finishes this screen. */
    function updateWizard() {
      const step = stepNumber();
      const num = document.getElementById('wizard-step-num');
      const name = document.getElementById('wizard-step-name');
      if (num) num.textContent = String(step);
      if (name) name.textContent = STEP_NAMES[step - 1] || '';

      const back = document.getElementById('btn-back');
      if (back) back.disabled = step <= 1;

      const next = document.getElementById('btn-next');
      if (next) {
        const published = Boolean(state.estimator && state.estimator.sharedAt);
        const approved = state.status === 'confirmed_by_hono';
        // 'Priced' means the ENGINE priced it: a figure with no scenario behind it cannot become a
        // guest link, so screen 2 is where that quotation still is.
        const enginePriced = Boolean(state.estimator && state.estimator.id);
        // The label is the ACTION, not "next" — but it must also be TRUE: on screen 2 with a price in
        // hand the button only walks to the approval screen, so it says so rather than claiming to
        // approve. Verified in a browser, where 'Approve quotation' on screen 2 read as if pressing it
        // would approve the quotation.
        next.textContent = published
          ? (state.sentToGuestAt ? 'Send the message again' : 'Send the message')
          : step === 1
            ? 'Save & get price'
            : step === 2
              ? (enginePriced ? 'Continue to approve →' : 'Get price')
              : step === 3
                ? (approved ? 'Continue to send →' : 'Approve quotation')
                : (published ? (state.sentToGuestAt ? 'Send the message again' : 'Send the message') : 'Create link & send');
        // Step 4's send also needs the sample acknowledgement; updateSendControls owns that and is
        // called from here so the two gates cannot drift.
        if (step === 4) updateSendControls();
      }

      // The bar is clickable for the steps the record allows, so a person can jump back to a figure
      // without walking the wizard.
      document.querySelectorAll('.pstep').forEach(function (btn) {
        const n = Number(btn.getAttribute('data-step'));
        btn.disabled = n > maxStep();
        btn.classList.toggle('current', n === step);
        btn.classList.toggle('done', n < step);
      });
    }

    /** The one action that finishes the screen in front of the person. */
    async function wizardNext() {
      const step = stepNumber();
      if (step === 1) return saveStudio();          // save the details AND price the trip, then reload
      if (step === 2) {
        if (!state.pricing) return syncEstimate();  // nothing priced yet: ask for the price
        return goStep(3);
      }
      if (step === 3) {
        if (state.status !== 'confirmed_by_hono') return confirmAndSendToAI();
        return goStep(4);
      }
      return sendToGuest();
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('casa_theme', theme);
      const icon = document.getElementById('theme-icon');
      const label = document.getElementById('theme-label');
      if (icon && label) {
        if (theme === 'dark') {
          icon.textContent = '☀️';
          label.textContent = 'Light Mode';
        } else {
          icon.textContent = '🌙';
          label.textContent = 'Dark Mode';
        }
      }
    }
    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    }
    (function initTheme() {
      const saved = localStorage.getItem('casa_theme') || 'light';
      applyTheme(saved);
    })();

    function fmtMoney(n, currency) {
      const sym = (currency || state.currency) === 'USD' ? '$' : '₱';
      return sym + Number(n || 0).toLocaleString('en-US');
    }

    let quoteFilter = 'all';
    let quoteSearch = '';

    const PAGE_SIZE = 10;
    let quotePage = 1;

    // ---- Sort and filters for the queue ------------------------------------
    // Pure functions on purpose (no DOM, "now" passed in): the order a receptionist works the queue in
    // is a decision, so it is tested on its own rather than only by looking at the page.
    var QUEUE_VIEW_KEY = 'casa_queue_view';
    var QUEUE_SORTS = ['latest', 'oldest', 'checkin', 'name', 'total'];
    var QUEUE_SENT = ['any', 'unsent', 'today', '7d'];
    var QUEUE_CHECKIN = ['any', 'next7', 'next30', 'past'];
    var QUEUE_PRICE = ['any', 'priced', 'unpriced'];
    var queueView = { sort: 'latest', sent: 'any', checkin: 'any', price: 'any' };

    // When something last happened to a quotation: the time it was sent if it was sent, otherwise the
    // last time staff or the bot touched it. 0 when neither is known, so it sorts as the oldest
    // instead of throwing.
    function activityTime(q) {
      var t = Date.parse(q.sentToGuestAt || q.updatedAt || '');
      return isFinite(t) ? t : 0;
    }
    function checkInTime(q) {
      var t = Date.parse((q.checkIn || '') + 'T00:00:00Z');
      return isFinite(t) ? t : null;
    }
    // Equal keys fall back to the quotation id, so the order cannot shuffle between two renders.
    // The now argument is passed in so the check-in order can be tested against a fixed date.
    function sortQuotes(list, mode, now) {
      var byId = function (a, b) { return String(a.quoteId).localeCompare(String(b.quoteId)); };
      var clock = new Date(now == null ? Date.now() : now);
      var today = Date.UTC(clock.getFullYear(), clock.getMonth(), clock.getDate());
      var cmp = {
        latest: function (a, b) { return (activityTime(b) - activityTime(a)) || byId(a, b); },
        oldest: function (a, b) { return (activityTime(a) - activityTime(b)) || byId(a, b); },
        // Guests who are still to arrive come first, soonest first; guests whose date has passed come
        // after them, most recent first. Plain date order would put someone who arrived last week at
        // the top of the list, which is the opposite of what the front desk is asking for.
        checkin: function (a, b) {
          var x = checkInTime(a), y = checkInTime(b);
          if (x === null && y === null) return byId(a, b);
          if (x === null) return 1;
          if (y === null) return -1;
          var xAhead = x >= today, yAhead = y >= today;
          if (xAhead !== yAhead) return xAhead ? -1 : 1;
          return (xAhead ? x - y : y - x) || byId(a, b);
        },
        name: function (a, b) {
          var x = String(a.guestName || '').trim(), y = String(b.guestName || '').trim();
          if (!x && !y) return byId(a, b);
          if (!x) return 1;
          if (!y) return -1;
          return x.localeCompare(y, 'en', { sensitivity: 'base' }) || byId(a, b);
        },
        total: function (a, b) {
          var x = a.engineRevenue, y = b.engineRevenue;
          if (x == null && y == null) return byId(a, b);
          if (x == null) return 1;
          if (y == null) return -1;
          return (y - x) || byId(a, b);
        }
      };
      return list.slice().sort(cmp[mode] || cmp.latest);
    }
    function matchesViewFilters(q, f, now) {
      if (f.sent !== 'any') {
        var st = q.sentToGuestAt ? Date.parse(q.sentToGuestAt) : NaN;
        var wasSent = isFinite(st);
        if (f.sent === 'unsent' && wasSent) return false;
        if (f.sent === 'today') {
          var midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
          if (!wasSent || st < midnight.getTime()) return false;
        }
        if (f.sent === '7d' && (!wasSent || now - st > 7 * 86400000)) return false;
      }
      if (f.checkin !== 'any') {
        var ci = checkInTime(q);
        if (ci === null) return false;
        var n = new Date(now);
        var today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
        if (f.checkin === 'past' && ci >= today) return false;
        if (f.checkin === 'next7' && (ci < today || ci > today + 7 * 86400000)) return false;
        if (f.checkin === 'next30' && (ci < today || ci > today + 30 * 86400000)) return false;
      }
      if (f.price === 'priced' && q.engineRevenue == null) return false;
      if (f.price === 'unpriced' && q.engineRevenue != null) return false;
      return true;
    }
    function activeFilterCount() {
      return (queueView.sent !== 'any' ? 1 : 0) + (queueView.checkin !== 'any' ? 1 : 0) + (queueView.price !== 'any' ? 1 : 0);
    }
    // A saved choice is a convenience, never a requirement: storage can be blocked or hold junk.
    function loadQueueView() {
      try {
        var v = JSON.parse(localStorage.getItem(QUEUE_VIEW_KEY) || 'null');
        if (v && QUEUE_SORTS.indexOf(v.sort) >= 0) queueView.sort = v.sort;
        if (v && QUEUE_SENT.indexOf(v.sent) >= 0) queueView.sent = v.sent;
        if (v && QUEUE_CHECKIN.indexOf(v.checkin) >= 0) queueView.checkin = v.checkin;
        if (v && QUEUE_PRICE.indexOf(v.price) >= 0) queueView.price = v.price;
      } catch (e) { /* keep the defaults */ }
    }
    function saveQueueView() {
      try { localStorage.setItem(QUEUE_VIEW_KEY, JSON.stringify(queueView)); } catch (e) { /* not persisted */ }
    }
    function syncQueueControls() {
      var set = function (id, value) { var el = document.getElementById(id); if (el) el.value = value; };
      set('queue-sort', queueView.sort);
      set('qf-sent', queueView.sent);
      set('qf-checkin', queueView.checkin);
      set('qf-price', queueView.price);
      var n = activeFilterCount();
      var count = document.getElementById('queue-filter-count');
      if (count) count.textContent = n ? String(n) : '';
      var btn = document.getElementById('queue-filter-toggle');
      var panel = document.getElementById('queue-filters');
      if (btn && btn.classList) btn.classList.toggle('on', n > 0);
      // A filter that is on must never be out of sight: open the panel so the reason for a short list
      // is in view.
      if (panel && n > 0) panel.hidden = false;
      if (btn && panel && btn.setAttribute) btn.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
      var clear = document.getElementById('queue-clear');
      if (clear) clear.hidden = n === 0;
    }
    function setQueueView(key, value) {
      queueView[key] = value;
      quotePage = 1;
      saveQueueView();
      syncQueueControls();
      renderSidebar();
    }
    function clearQueueFilters() {
      queueView.sent = 'any'; queueView.checkin = 'any'; queueView.price = 'any';
      quotePage = 1;
      saveQueueView();
      syncQueueControls();
      renderSidebar();
    }
    function toggleQueueFilters() {
      var panel = document.getElementById('queue-filters');
      var btn = document.getElementById('queue-filter-toggle');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (btn && btn.setAttribute) btn.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    }

    function setQuoteFilter(tab) {
      quoteFilter = tab;
      quotePage = 1;
      document.querySelectorAll('.tab-btn').forEach(b => {
        if (b && b.classList) b.classList.remove('active');
      });
      const activeBtn = document.getElementById('tab-' + tab);
      if (activeBtn && activeBtn.classList) activeBtn.classList.add('active');
      renderSidebar();
    }

    function filterQuotesList(val) {
      quoteSearch = (val || '').toLowerCase().trim();
      quotePage = 1;
      renderSidebar();
    }

    function changeQuotePage(delta) {
      quotePage += delta;
      renderSidebar();
    }

    function renderSidebar() {
      const el = document.getElementById('quote-sidebar-list');
      if (!el) return;
      const tok = staffToken();
      const qs = tok ? '?token=' + encodeURIComponent(tok) : '';
      
      const tabbed = allQuotes.filter(q => {
        const isApproved = q.status === 'confirmed_by_hono';
        const isCancelled = q.status === 'cancelled';
        const sentTime = q.sentToGuestAt ? new Date(q.sentToGuestAt).getTime() : null;
        const hoursSince = (sentTime && Number.isFinite(sentTime)) ? (Date.now() - sentTime) / 3600000 : null;
        const chasable = !isCancelled && !q.submission && hoursSince !== null;
        const isStale = Boolean(chasable && hoursSince >= FOLLOW_UP_HOURS.stale);
        const isNeedsReview = !isCancelled && !isApproved;

        if (quoteFilter === 'action-needed') {
          if (!isNeedsReview && !isStale) return false;
        } else if (quoteFilter === 'waiting') {
          if (isCancelled || isNeedsReview || isStale) return false;
        } else if (quoteFilter === 'cancelled') {
          if (!isCancelled) return false;
        } else if (quoteFilter === 'all') {
          // keep all
        }

        if (quoteSearch) {
          const matchName = (q.guestName || '').toLowerCase().includes(quoteSearch);
          const matchId = (q.quoteId || '').toLowerCase().includes(quoteSearch);
          const matchDate = (q.checkIn || '').toLowerCase().includes(quoteSearch);
          if (!matchName && !matchId && !matchDate) return false;
        }
        return true;
      });
      // Tab and search decide what belongs in the list; the sort and filters decide how it is worked.
      const now = Date.now();
      const filtered = sortQuotes(tabbed.filter(q => matchesViewFilters(q, queueView, now)), queueView.sort, now);

      const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
      if (quotePage > totalPages) quotePage = totalPages;
      if (quotePage < 1) quotePage = 1;

      const badge = document.getElementById('queue-count-badge');
      if (badge) badge.textContent = filtered.length + ' / ' + allQuotes.length;

      const pagEl = document.getElementById('quote-pagination');
      const pageInfo = document.getElementById('quote-page-info');
      const btnPrev = document.getElementById('btn-prev-page');
      const btnNext = document.getElementById('btn-next-page');
      if (pagEl && pageInfo && btnPrev && btnNext) {
        if (filtered.length <= PAGE_SIZE) {
          pagEl.style.display = 'none';
        } else {
          pagEl.style.display = 'flex';
          pageInfo.textContent = 'Page ' + quotePage + ' of ' + totalPages;
          btnPrev.disabled = quotePage <= 1;
          btnNext.disabled = quotePage >= totalPages;
        }
      }

      if (filtered.length === 0) {
        var clearBtn = activeFilterCount() > 0 ? ' <button type="button" onclick="clearQueueFilters()">Clear filters</button>' : '';
        el.innerHTML = '<div class="queue-empty">No quotations match.' + clearBtn + '</div>';
        return;
      }

      const startIdx = (quotePage - 1) * PAGE_SIZE;
      const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

      el.innerHTML = pageItems.map(q => {
        const isApproved = q.status === 'confirmed_by_hono';
        const isCancelled = q.status === 'cancelled';
        const sentTime = q.sentToGuestAt ? new Date(q.sentToGuestAt).getTime() : null;
        const hoursSince = (sentTime && Number.isFinite(sentTime)) ? (Date.now() - sentTime) / 3600000 : null;
        const chasable = !isCancelled && !q.submission && hoursSince !== null;
        const isStale = Boolean(chasable && hoursSince >= FOLLOW_UP_HOURS.stale);
        const isNudge = Boolean(chasable && !isStale && hoursSince >= FOLLOW_UP_HOURS.nudge);
        const statusLabel = isCancelled ? 'Archived' : (isApproved ? 'Approved' : 'Needs Review');
        const statusColor = isCancelled
          ? 'var(--rose, #f43f5e)'
          : (isApproved ? 'var(--emerald)' : 'var(--amber)');
        return \`
        <a class="quote-list-item \${q.quoteId === state.quoteId ? 'active' : ''}" href="/quotes/\${q.quoteId}\${qs}" title="\${escHtml(q.quoteId)}">
          <div class="ql-top">
            <span class="ql-name">\${escHtml(q.guestName)}</span>
            <span class="ql-status" style="color:\${statusColor};">
              \${statusLabel}
              \${isStale
                ? '<span style="font-size:10px;font-weight:800;color:var(--amber);background:var(--amber-soft);padding:1px 5px;border-radius:4px;border:1px solid var(--amber);">Stale</span>'
                : (isNudge
                  ? '<span style="font-size:10px;font-weight:800;color:var(--amber);background:var(--amber-soft);padding:1px 5px;border-radius:4px;border:1px solid var(--amber);">Follow up</span>'
                  : '')}
            </span>
          </div>
          <div class="ql-meta">\${escHtml(shortDate(q.checkIn))} · \${q.nights}n · <strong>\${q.engineRevenue == null ? 'not priced yet' : fmtMoney(q.engineRevenue, q.currency)}</strong> · <span class="ql-id">#\${escHtml(String(q.quoteId).split('-').pop())}</span></div>
        </a>
      \`;
      }).join('');
    }

    (function initQuotePagination() {
      loadQueueView();
      syncQueueControls();
      const isCancelled = state && state.status === 'cancelled';
      const isApproved = state && state.status === 'confirmed_by_hono';
      const sentTime = state && state.sentToGuestAt ? new Date(state.sentToGuestAt).getTime() : null;
      const hoursSince = (sentTime && Number.isFinite(sentTime)) ? (Date.now() - sentTime) / 3600000 : null;
      const isStale = Boolean(!isCancelled && !state.submission && hoursSince !== null && hoursSince >= FOLLOW_UP_HOURS.stale);
      const isNeedsReview = !isCancelled && !isApproved;

      if (isCancelled) quoteFilter = 'cancelled';
      else if (isNeedsReview || isStale) quoteFilter = 'action-needed';
      else quoteFilter = 'waiting';

      document.querySelectorAll('.tab-btn').forEach(b => {
        if (b && b.classList) b.classList.remove('active');
      });
      const activeBtn = document.getElementById('tab-' + quoteFilter);
      if (activeBtn && activeBtn.classList) activeBtn.classList.add('active');

      const initialFiltered = allQuotes.filter(q => {
        const qCancelled = q.status === 'cancelled';
        const qApproved = q.status === 'confirmed_by_hono';
        const qSentTime = q.sentToGuestAt ? new Date(q.sentToGuestAt).getTime() : null;
        const qHoursSince = (qSentTime && Number.isFinite(qSentTime)) ? (Date.now() - qSentTime) / 3600000 : null;
        const qStale = Boolean(!qCancelled && !q.submission && qHoursSince !== null && qHoursSince >= FOLLOW_UP_HOURS.stale);
        const qNeedsReview = !qCancelled && !qApproved;

        if (quoteFilter === 'action-needed') return qNeedsReview || qStale;
        if (quoteFilter === 'waiting') return !qCancelled && !qNeedsReview && !qStale;
        if (quoteFilter === 'cancelled') return qCancelled;
        return true;
      });
      const idx = initialFiltered.findIndex(q => q.quoteId === state.quoteId);
      if (idx !== -1) {
        quotePage = Math.floor(idx / PAGE_SIZE) + 1;
      }
    })();

    /**
     * The trip review panel: the BffTrip the engine is asked to price, as editable controls.
     *
     * Everything here edits state.bffTrip and nothing prints a price — the number comes from the
     * engine, and a page that also did its own arithmetic would be the second source of truth this
     * whole screen exists to avoid. The room type, the room each guest sleeps in, the per-day dive
     * grid and the courses are the four facts a WhatsApp conversation cannot place reliably, and
     * they are exactly the ones the estimator prices: a deluxe room is ₱11,200 a night against
     * ₱7,600, a third dive and a night dive are their own lines, and a course is ₱5,500 upwards.
     *
     * NOTE for whoever edits this next: every backtick and every dollar-brace below is escaped,
     * because this whole block is itself inside a TypeScript template literal. An unescaped
     * backtick anywhere here — including inside a comment like this one — closes the page's own
     * script tag and breaks the studio silently.
     */
    function renderTripReview() {
      const el = document.getElementById('trip-review');
      if (!el) return; // a guest session has no review panel
      const trip = state.bffTrip;
      if (!trip) {
        el.innerHTML = '<p style="font-size:14px;color:var(--muted);font-weight:600;">This quotation was not built from a validated trip, so there is nothing to review. Price it with the engine first.</p>';
        return;
      }

      const ROOM_TYPES = ['standard', 'deluxe', 'suite'];
      const COURSES = ['dsd', 'refresher', 'ow', 'aow', 'rescue'];
      const COURSE_LABELS = { dsd: 'DSD', refresher: 'Refresher', ow: 'Open Water', aow: 'Advanced OW', rescue: 'Rescue' };
      const stayDates = datesInStay(trip.checkIn, trip.checkOut);
      // Frozen once the guest is holding the link: their page resolves to the newest saved revision,
      // so a "correction" here would silently change what they were sent (their Q-005). The controls
      // are drawn read-only rather than left editable and refused later.
      const frozen = Boolean(state.estimator && state.estimator.sharedAt);
      const ro = frozen ? ' disabled' : '';

      const roomRows = trip.rooms.map((room, i) => \`
        <tr>
          <td><strong>\${escHtml(room.id || '—')}</strong></td>
          <td>
            <select class="cell-input" onchange="setRoomType(\${i}, this.value)"\${ro}>
              \${ROOM_TYPES.map(t => \`<option value="\${t}" \${room.type === t ? 'selected' : ''}>\${t}</option>\`).join('')}
            </select>
          </td>
          <td>\${escHtml(trip.guests.filter(g => g.roomId === room.id).map(g => g.name).join(', ') || '— nobody —')}</td>
          <td style="white-space:nowrap;">
            \${frozen ? '' : \`<button class="btn btn-outline" style="padding:4px 10px;font-size:12.5px;" onclick="removeRoom(\${i})">Remove</button>\`}
          </td>
        </tr>\`).join('');

      const guestRows = trip.guests.map((guest) => \`
        <tr>
          <td><strong>\${escHtml(guest.name)}</strong></td>
          <td>
            <select class="cell-input" onchange="setGuestRoom('\${escHtml(guest.id)}', this.value)"\${ro}>
              <option value="" \${guest.roomId ? '' : 'selected'}>— unassigned —</option>
              \${trip.rooms.map(r => \`<option value="\${escHtml(r.id)}" \${guest.roomId === r.id ? 'selected' : ''}>\${escHtml(r.id)} (\${escHtml(r.type)})\</option>\`).join('')}
            </select>
          </td>
          <td>
            \${COURSES.map(c => \`<label style="display:block;white-space:nowrap;font-size:12.5px;"><input type="checkbox" \${(guest.courses || []).includes(c) ? 'checked' : ''} onchange="setGuestCourse('\${escHtml(guest.id)}', '\${c}', this.checked)"\${ro} /> \${COURSE_LABELS[c]}</label>\`).join('')}
          </td>
          \${stayDates.map(d => {
            const day = (guest.days && guest.days[d]) || {};
            return \`<td style="white-space:nowrap;">
              <label title="Boat dives"><input type="checkbox" \${day.dive ? 'checked' : ''} onchange="setGuestDay('\${escHtml(guest.id)}', '\${d}', 'dive', this.checked)"\${ro} /> D</label>
              <label title="Third dive"><input type="checkbox" \${day.third ? 'checked' : ''} onchange="setGuestDay('\${escHtml(guest.id)}', '\${d}', 'third', this.checked)"\${ro} /> 3</label>
              <label title="Night dive"><input type="checkbox" \${day.night ? 'checked' : ''} onchange="setGuestDay('\${escHtml(guest.id)}', '\${d}', 'night', this.checked)"\${ro} /> N</label>
            </td>\`;
          }).join('')}
        </tr>\`).join('');

      el.innerHTML = \`
        \${frozen ? \`<div style="margin-bottom:14px;padding:12px 14px;border-radius:10px;background:var(--amber-soft);border-left:5px solid var(--amber);font-size:13.5px;font-weight:600;">
          Published: this trip and its price are frozen on the guest's link. Start a new quotation to change either.
        </div>\` : ''}
        <div style="overflow-x:auto;margin-bottom:10px;">
          <table class="quote-table">
            <thead><tr><th style="width:90px;">Room</th><th style="width:150px;">Type</th><th>Guests in this room</th><th style="width:110px;"></th></tr></thead>
            <tbody>\${roomRows}</tbody>
          </table>
        </div>
        \${frozen ? '' : \`<div style="margin-bottom:18px;">
          <button class="btn btn-outline" style="padding:6px 14px;font-size:13px;" onclick="addRoom()">+ Add a room</button>
        </div>\`}
        <div style="overflow-x:auto;">
          <table class="quote-table">
            <thead><tr>
              <th style="width:150px;">Guest</th>
              <th style="width:170px;">Room</th>
              <th style="width:190px;">Course</th>
              \${stayDates.map(d => \`<th style="text-align:center;">\${escHtml(dayLabel(d))}<br><span style="font-weight:600;color:var(--muted);">D · 3rd · Night</span></th>\`).join('')}
            </tr></thead>
            <tbody>\${guestRows}</tbody>
            \${stayDates.length && !frozen ? \`<tfoot><tr>
              <td colspan="3" style="font-weight:800;">Everyone on this day</td>
              \${stayDates.map(d => \`<td style="white-space:nowrap;font-size:12.5px;">
                <button class="btn btn-outline" style="padding:2px 8px;font-size:12px;" onclick="setDayForAll('\${d}','dive',true)">D all</button>
                <button class="btn btn-outline" style="padding:2px 8px;font-size:12px;" onclick="setDayForAll('\${d}','third',true)">3 all</button>
                <button class="btn btn-outline" style="padding:2px 8px;font-size:12px;" onclick="setDayForAll('\${d}','night',true)">N all</button>
                <button class="btn btn-outline" style="padding:2px 8px;font-size:12px;" onclick="setDayForAll('\${d}','dive',false);setDayForAll('\${d}','third',false);setDayForAll('\${d}','night',false)">clear</button>
              </td>\`).join('')}
            </tr></tfoot>\` : ''}
          </table>
        </div>
        <p class="scroll-hint">Scroll the grid sideways to see every day.</p>
        <p style="font-size:13px;color:var(--muted);font-weight:600;margin-top:10px;">
          D = boat dive, 3 = third dive, N = night dive. \${frozen ? 'Read-only while the guest holds the link.' : 'Nothing here reaches the engine until you press the button at the bottom of the screen.'}
        </p>\`;
    }

    /** The stay's nights, as the engine's own day keys: check-in day through the night before check-out. */
    function datesInStay(checkIn, checkOut) {
      if (!checkIn || !checkOut) return [];
      const out = [];
      const start = new Date(checkIn + 'T00:00:00Z');
      const end = new Date(checkOut + 'T00:00:00Z');
      for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push(d.toISOString().slice(0, 10));
      }
      return out;
    }

    function dayLabel(iso) {
      const d = new Date(iso + 'T00:00:00Z');
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    }

    function setRoomType(index, type) {
      state.bffTrip.rooms[index].type = type;
      renderTripReview();
      markTripDirty();
    }

    function setGuestRoom(guestId, roomId) {
      const guest = state.bffTrip.guests.find((g) => g.id === guestId);
      if (guest) guest.roomId = roomId || null;
      renderTripReview();
      markTripDirty();
    }

    // A course is added or removed on its own; ticking one never replaces another.
    function setGuestCourse(guestId, course, on) {
      const guest = state.bffTrip.guests.find((g) => g.id === guestId);
      if (guest) {
        const set = new Set(guest.courses || []);
        if (on) set.add(course); else set.delete(course);
        guest.courses = Array.from(set).slice(0, 5);
      }
      renderTripReview();
      markTripDirty();
    }

    function setGuestDay(guestId, date, kind, on) {
      const guest = state.bffTrip.guests.find((g) => g.id === guestId);
      if (!guest) return;
      guest.days = guest.days || {};
      const day = Object.assign({ dive: false, third: false, night: false, boatId: null }, guest.days[date] || {});
      day[kind] = Boolean(on);
      guest.days[date] = day;
      renderTripReview();
      markTripDirty();
    }

    /** A whole day at once, for a group where everyone dives the same schedule. */
    function setDayForAll(date, kind, on) {
      state.bffTrip.guests.forEach(function (guest) {
        guest.days = guest.days || {};
        const day = Object.assign({ dive: false, third: false, night: false, boatId: null }, guest.days[date] || {});
        day[kind] = Boolean(on);
        guest.days[date] = day;
      });
      renderTripReview();
      markTripDirty();
    }

    /**
     * Add a room. The id has to be unique and has to keep the rN shape, because the engine refers
     * to rooms by id: a duplicate id would silently move a guest into the wrong room, and an id the
     * contract does not accept is a 422 from their fillTrip.
     */
    function addRoom() {
      const rooms = state.bffTrip.rooms;
      let n = rooms.length + 1;
      const taken = {};
      rooms.forEach(function (r) { taken[r.id] = true; });
      while (taken['r' + n]) n += 1;
      rooms.push({ id: 'r' + n, type: 'standard', name: null });
      renderTripReview();
      markTripDirty();
    }

    /**
     * Remove a room — refused while somebody is still in it.
     *
     * The alternative (unassign the guests and let staff notice later) produces a trip the engine
     * rejects, which reads as "the engine is broken" rather than "move these two people first". One
     * clear sentence is better than a silent half-edit.
     */
    function removeRoom(index) {
      const rooms = state.bffTrip.rooms;
      if (rooms.length <= 1) {
        showError('Trip review', { reason: 'room_in_use', detail: 'A booking needs at least one room. Change its type instead of removing it.' });
        return;
      }
      const room = rooms[index];
      const occupants = state.bffTrip.guests.filter(function (g) { return g.roomId === room.id; });
      if (occupants.length > 0) {
        showError('Trip review', {
          reason: 'room_in_use',
          detail: 'Move ' + occupants.map(function (g) { return g.name; }).join(', ') + ' out of room ' + room.id + ' first, then remove it.'
        });
        return;
      }
      rooms.splice(index, 1);
      renderTripReview();
      markTripDirty();
    }


    /** Copy the guest's link. Only present once the quotation is published. */
    function copyQuoteLink() {
      const input = document.getElementById('input-quotation-url');
      if (!input || !input.value) return;
      navigator.clipboard.writeText(input.value);
      showInfo('Guest link copied.');
    }

    /**
     * The status, and the four steps — both read from 'state', both re-drawn after any action.
     *
     * One status for the whole page (see the note above 'statusLabel' on the server side): what
     * changed here is only how the same record is described once the page has acted on it.
     */
    function renderStatus() {
      const badge = document.getElementById('quote-status-badge');
      const published = Boolean(
        state.estimator && state.estimator.sharedAt && (state.estimator.mirrorUrl || state.estimator.guestUrl),
      );
      const approved = state.status === 'confirmed_by_hono';
      const archived = state.status === 'cancelled';
      const priced = Boolean(state.pricing);
      const enginePriced = Boolean(state.estimator && state.estimator.id);
      if (badge) {
        badge.className = 'status-pill ' + (
          archived ? 'status-rose' : (published || approved) ? 'status-emerald' : 'status-amber'
        );
        badge.textContent = archived
          ? 'Archived'
          : state.status !== 'confirmed_by_hono' && published
            ? 'Published — needs approval'
            : published
              // Same distinction the server-rendered pill makes: a link is not a delivery.
              ? (state.sentToGuestAt ? 'Sent to guest' : 'Link ready — not sent')
              : priced && !enginePriced
                ? 'Needs a price from the engine'
                : approved
                  ? 'Approved — not sent yet'
                  : priced
                    ? 'Priced — needs approval'
                    : 'Needs review';
      }

      const steps = [
        { label: 'Review trip', state: state.bffTrip ? 'done' : 'current' },
        { label: 'Get price', state: enginePriced ? 'done' : (state.bffTrip ? 'current' : 'todo') },
        { label: 'Approve', state: (approved || published) ? 'done' : (enginePriced ? 'current' : 'todo') },
        { label: 'Send', state: published ? 'done' : (approved ? 'current' : 'todo') }
      ];
      // The bar itself is NOT re-drawn here: it is server-rendered as buttons that can be clicked to
      // jump to a step, and rewriting its markup would take those with it. updateWizard moves its
      // classes and its disabled state instead.
      void steps;

      // The bar is NOT re-drawn here: it is server-rendered, and updateWizard moves its classes,
      // its labels and its disabled state. This function only brought the status pill up to date.
      updateSendControls();
      updateWizard();
    }

    /**
     * The sample-price acknowledgement, applied to every action that publishes.
     *
     * The tick box sits in the Send screen beside the two controls that can create a guest link: the
     * "Create link only" button and the wizard's own button (which publishes AND sends). Until it is
     * ticked both are disabled with the reason on screen — a button that is refused only after the
     * click teaches nothing, and this is the one place a sample price can reach a guest.
     */
    function updateSendControls() {
      const ack = document.getElementById('ack-sample');
      const needsAck = Boolean(ack) && !ack.checked;
      const hint = document.getElementById('send-hint');
      // Only the wizard button when the wizard is ON the send screen: on the other screens its action
      // is unrelated to sample prices.
      const onSendStep = stepNumber() === 4;
      for (const id of ['btn-publish-quote'].concat(onSendStep ? ['btn-next'] : [])) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        if (needsAck) {
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
        } else {
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
          btn.disabled = false;
        }
      }
      if (hint) {
        // Double-quoted, because the sentence contains apostrophes: inside this page's template
        // literal an escaped quote is consumed by the OUTER string and leaves the page's own JS
        // unbalanced.
        hint.textContent = needsAck
          ? 'Tick "I have checked this sample price" to create the guest link. These are sample prices, not a real quote.'
          : "The message carries the guest's own quotation link and no price of ours: the figures they read are the engine's, on their page.";
        hint.style.color = needsAck ? 'var(--accent)' : 'var(--muted)';
      }
    }

    /**
     * Unsaved trip corrections. Editing a room type or a dive day changes what the ENGINE would be
     * asked to price, so the price on screen is no longer this trip's — the page says so until the
     * trip is saved. Without it, a receptionist edits a room type, reads the old total as the new
     * one, and approves; that is the bug this page exists to prevent.
     */
    let tripDirty = false;

    function markTripDirty() {
      tripDirty = true;
      renderStatus();
      const btn = document.getElementById('btn-next');
      if (btn) btn.textContent = 'Save & get price';
      const hint = document.getElementById('save-hint');
      if (hint) {
        hint.textContent = 'Unsaved changes. The price below still belongs to the previous trip.';
        hint.style.color = 'var(--accent)';
      }
    }

    /** The contact fields, and only those: the trip has its own route, the one that prices it. */
    function gatherDetails() {
      return {
        guestName: (document.getElementById('meta-guestName').value || '').trim() || state.guestName,
        checkIn: (document.getElementById('meta-checkIn').value || '').trim() || state.checkIn,
        checkOut: (document.getElementById('meta-checkOut').value || '').trim() || state.checkOut,
        staffNotes: (document.getElementById('input-staff-notes').value || '').trim(),
        phone: (document.getElementById('whatsapp-phone-input').value || '').trim()
      };
    }

    /**
     * THE save. One button for the whole review step, in the order the data needs.
     *
     * 1. The guest's details go to the record (PUT). That route only accepts contact fields — it
     *    will not take a trip, a price or an approval, because those arrive through the routes that
     *    produce them (see EDITABLE_FIELDS in app.ts).
     * 2. The trip goes to the trip route, which re-prices it, or to sync-estimate when the engine has no
     *    scenario for this quotation yet. Both end with the price describing the trip on screen.
     *
     * It steps over the trip when nothing about the trip changed and a price already exists: the
     * figure the guest reads should not move because somebody fixed a spelling.
     */
    async function saveStudio() {
      const btn = document.getElementById('btn-next');
      const hint = document.getElementById('save-hint');
      clearNotice();
      if (btn) btn.disabled = true;
      // The trip as the person just edited it, captured BEFORE the first request.
      //
      // The save is two calls — the guest's details go to PUT, then the trip goes to the engine — and
      // the PUT answers with the record as the server holds it. The trip is not one of the fields PUT
      // accepts (it may only arrive through a route that re-prices it), so that answer carries the OLD
      // trip, and assigning it to state threw the edit away before the second call could send it.
      // Measured in a browser on production, 2026-09-28: a dive day moved between guests in the grid,
      // "Save & get price" then step 2 · Priced — needs approval, and the record still had the original
      // guest diving with staffEdits empty. The route was fixed first and this was still broken, which
      // is precisely why the fix had to be walked by hand to be believed.
      const tripToSave = state.bffTrip;
      try {
        const details = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '?token=' + encodeURIComponent(staffToken()), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(gatherDetails())
        });
        const detailsData = await safeJson(details);
        if (!details.ok || !detailsData.quotation) {
          showError('Could not save', detailsData);
          return;
        }
        // The server's own fields (contact details, status) come back; the trip stays what the person
        // edited, because the trip was never part of this request.
        state = Object.assign({}, detailsData.quotation, { bffTrip: tripToSave });

        const published = Boolean(state.estimator && state.estimator.sharedAt);
        // "Priced" means the ENGINE priced it (estimator.id), not that a figure is on the record: a
        // quotation carrying only the sample engine's number still has to be sent to the real engine.
        // Found by walking step 1 on production, where Save said "Saved." and walked to step 2 without
        // ever asking for a price — the record had 52,400 on it and no scenario anywhere.
        const hasScenario = Boolean(state.estimator && state.estimator.id);
        const needsPrice = tripDirty || !hasScenario;
        if (published || !needsPrice) {
          // Nothing about the trip is pending: a published quotation must not change its trip at
          // all, and an unchanged quotation the engine has already priced has nothing new to send.
          showInfo(published
            ? 'Saved. This quotation is published, so its trip and price are frozen — start a new quotation for a different trip.'
            : 'Saved.');
          rememberStep(published ? 4 : 2);
          window.location.reload();
          return;
        }

        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + (hasScenario ? '/trip' : '/sync-estimate') + '?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // The trip the person edited, not the one the PUT just handed back.
          body: JSON.stringify({ trip: tripToSave })
        });
        const data = await safeJson(res);
        if (!res.ok || !data.ok) {
          // The details ARE saved at this point, and the page says which half failed.
          showError('Saved the guest details, but not the trip', data);
          return;
        }
        const issues = Array.isArray(data.issues) ? data.issues : [];
        showInfo('Saved and priced'
          + (data.sample ? ' — sample prices, not a real quote.' : '.')
          + (data.recovered
            // The engine had dropped the scenario this record pointed at and the route priced the
            // trip again in the same session. Worth saying: the quotation the guest is about to be
            // sent is a new scenario, not the one earlier screens were showing.
            ? ' The engine no longer had this quotation, so it was priced again from the trip on screen.'
            : '')
          + (issues.length ? ' ' + issues.length + ' note(s) from the engine.' : '')
          + ' Reloading…');
        rememberStep(2);
        window.location.reload();
      } catch (err) {
        showError('Could not save', { detail: err && err.message ? err.message : String(err) });
      } finally {
        if (btn) btn.disabled = false;
        if (hint) hint.style.color = 'var(--muted)';
      }
    }

    function copyQuoteLink() {
      const input = document.getElementById('input-quotation-url');
      if (!input || !input.value) return;
      navigator.clipboard.writeText(input.value);
      showInfo('Guest link copied.');
    }

    function copyFollowupMessage() {
      // The text is built server-side (see FOLLOW_UP_TEXT in this page) so the follow-up, the guest's
      // page and the sent message all quote the same terms — and so a scarcity sentence nobody has
      // checked cannot creep back in here, which is where the first version of this had one.
      const text = FOLLOW_UP_TEXT;
      if (!text) return;
      navigator.clipboard.writeText(text).then(function() {
        showInfo('Follow-up message copied to clipboard.');
      }).catch(function() {
        // Clipboard access needs a secure context and permission. Falling back to the preview block,
        // which is already on screen and selectable, beats an error box for a copy button.
        const preview = document.getElementById('followup-preview');
        if (preview) {
          const range = document.createRange();
          range.selectNodeContents(preview);
          const selection = window.getSelection();
          if (selection) { selection.removeAllRanges(); selection.addRange(range); }
        }
        showInfo('Copy is blocked here — the message is selected below, press Ctrl+C.');
      });
    }

    async function cancelQuotationAction() {
      if (!confirm('Archive quotation ' + state.quoteId + '? It leaves the working queue; the record and any published link stay readable.')) {
        return;
      }
      const btn = document.getElementById('btn-cancel-quote');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/cancel?token=' + encodeURIComponent(staffToken()), {
          method: 'POST'
        });
        const data = await safeJson(res);
        if (res.ok && data.ok) {
          window.location.reload();
          return;
        }
        showError('Could not archive', data);
      } catch (err) {
        showError('Could not archive', { detail: err && err.message ? err.message : String(err) });
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function confirmAndSendToAI() {
      const btn = document.getElementById('btn-next');
      const replyBox = document.getElementById('ai-confirmed-reply-box');
      clearNotice();
      if (btn) btn.disabled = true;
      const payload = gatherDetails();
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/confirm?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await safeJson(res);
        if (!res.ok || !data.quotation) {
          // A refusal leaves the quotation exactly as it was, so the page keeps showing the truth.
          showError('Could not approve', data);
          return;
        }
        state = data.quotation;
        renderStatus();
        renderSidebar();
        if (replyBox) {
          replyBox.style.color = 'var(--text)';
          replyBox.style.fontStyle = 'normal';
          replyBox.textContent = data.aiReply || state.aiConfirmedReply || '';
        }
        // Approving is the end of this screen, so the wizard moves on to Send — the same rule as
        // saving on screen 1. Reloaded rather than patched, because the message the guest will get is
        // written from the record and the screen shows the record's version of it.
        rememberStep(4);
        showInfo('Approved. Reloading the message to send…');
        window.location.reload();
      } catch (err) {
        showError('Could not approve', { detail: err && err.message ? err.message : String(err) });
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    /**
     * The staff token, taken from this page's own URL.
     *
     * The studio's routes are guarded (each one lists every quotation with the guest's name and
     * phone number), and staff reach this page by having a link pasted to them — so the token
     * arrives in the query string and every call the page makes carries it on. Without this the
     * guards added on 2026-09-25 turned the studio's own Save/Confirm/Send buttons into 401s:
     * the leak fix broke the tool it was protecting.
     *
     * It is read from the URL on each call rather than cached, so following a fresh link is enough
     * to pick up a rotated token.
     */
    function staffToken() {
      const fromUrl = new URLSearchParams(window.location.search).get('token');
      if (fromUrl) {
        sessionStorage.setItem('casa_staff_token', fromUrl);
        return fromUrl;
      }
      return sessionStorage.getItem('casa_staff_token') || '';
    }

    /**
     * Switch the DEMO role. Cosmetic only: the cookie it re-issues changes what this page says
     * it is viewing as, not what it is allowed to read. Real roles come from the GAIS key.
     */
    /**
     * One action for "the guest should get this": create the link if it does not exist, then send.
     *
     * These were two buttons (Publish Link, then Send WhatsApp) with a rule between them that the
     * page did not explain: the message carries the link, so sending before publishing is refused.
     * A receptionist had to know the order. Now the order is the button's job.
     */
    async function sendToGuest() {
      const phone = document.getElementById('whatsapp-phone-input').value.trim();
      const toast = document.getElementById('wa-toast');
      const sendBtn = document.getElementById('btn-next');
      clearNotice();
      if (!state.estimator || !state.estimator.sharedAt) {
        // false: this flow reloads once, at the end, after the message has gone out.
        const published = await publishQuote(false);
        if (!published) return; // publishQuote() has already said why
        const linkEl = document.getElementById('whatsapp-link');
        const linkVal = (state.estimator && (state.estimator.mirrorUrl || state.estimator.guestUrl)) || '';
        if (linkEl && linkVal) linkEl.value = linkVal;
      }
      if (sendBtn) sendBtn.disabled = true;
      if (toast) toast.textContent = 'Sending…';
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/send-whatsapp?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const data = await safeJson(res);
        if (!res.ok || !data.ok) {
          showError('Could not send to the guest', data);
          if (toast) toast.textContent = '';
          return;
        }
        // The record is the truth about what the guest now has, so the screen is rebuilt from it:
        // link, status ("Sent to guest") and the message that was actually delivered.
        rememberStep(4);
        window.location.reload();
      } catch (err) {
        showError('Could not send to the guest', { detail: err && err.message ? err.message : String(err) });
        if (toast) toast.textContent = '';
      } finally {
        if (sendBtn) sendBtn.disabled = false;
      }
    }

    async function pushConfirmedQuoteToWhatsApp() {
      // Kept as the name that used to be on the button, so an old bookmarklet or a copied snippet
      // that calls it still does the right thing. The button itself now calls sendToGuest().
      return sendToGuest();
    }

    async function checkEstimatorStatus() {
      const badge = document.getElementById('estimator-status-badge');
      // A guest session has no estimator bar at all, so there is no badge to write to. Reading a
      // missing element here used to be a thrown TypeError that killed the rest of the script.
      if (!badge) return;
      try {
        const res = await fetch('/v1/quotes/estimator-status?token=' + encodeURIComponent(staffToken()));
        const data = await safeJson(res);
        if (!data.configured) {
          badge.textContent = 'Not configured — no prices available';
          badge.style.color = 'var(--muted)';
        } else if (!data.reachable) {
          badge.textContent = 'Not answering';
          badge.style.color = 'var(--accent)';
        } else if (data.mode === 'fixture') {
          badge.textContent = data.kind === 'simulated'
            ? 'Sample engine (built in) — not a real quote'
            : 'Sample engine (captured prices) — not a real quote';
          badge.style.color = 'var(--accent)';
        } else {
          badge.textContent = 'Connected — live prices';
          badge.style.color = 'var(--emerald)';
        }
      } catch (err) {
        badge.textContent = 'Status unknown';
        badge.style.color = 'var(--muted)';
      }
    }

    async function syncEstimate() {
      const btn = document.getElementById('btn-next');
      if (!btn) return; // a guest session has no pricing bar
      clearNotice();
      btn.disabled = true;
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/sync-estimate?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' }
        });
        const data = await safeJson(res);
        if (!res.ok || !data.ok) {
          showError('Could not get a price', data);
          return;
        }
        const issues = Array.isArray(data.issues) ? data.issues : [];
        showInfo('Priced by the booking engine'
          + (data.sample ? ' — sample data, not a real quote.' : '.')
          + (issues.length ? ' ' + issues.length + ' note(s) from the engine.' : '')
          + ' Reloading…');
        window.location.reload();
      } catch (err) {
        showError('Could not get a price', { detail: err && err.message ? err.message : String(err) });
      } finally {
        btn.disabled = false;
        checkEstimatorStatus();
      }
    }

    checkEstimatorStatus();
    renderReservationStatus();
    renderPublishStatus();

    /**
     * What the quotation's own record says about its reservation — not what this page remembers.
     * A reload, or a second tab, must agree with it, which is why the state is read back rather
     * than tracked here.
     */
    function renderReservationStatus() {
      const badge = document.getElementById('reservation-status-badge');
      const btn = document.getElementById('btn-submit-reservation');
      if (!badge || !btn) return;
      const s = state.submission;
      if (!s) {
        badge.textContent = '';
        btn.disabled = false;
        return;
      }
      const LABELS = {
        pending: 'Sending — do not press again',
        confirmed: 'Booking created',
        failed: 'Not accepted — you may try again',
        unknown: 'Not confirmed — check with the resort before trying again'
      };
      badge.textContent = LABELS[s.state] || s.state;
      // Only a refusal is retryable. "pending" is in flight; "confirmed" and "unknown" must not
      // be re-sent, because a second send is a second folio.
      btn.disabled = s.state !== 'failed';
    }

    async function submitReservation() {
      const btn = document.getElementById('btn-submit-reservation');
      if (!btn) return; // a guest session has no reservation bar
      clearNotice();
      // Contact details are asked for rather than assumed: they are what the front desk confirms
      // to, and quietly booking under the studio's own account is how a guest never hears back.
      const name = window.prompt('Name for the reservation:', state.guestName || '');
      if (!name) return;
      const email = window.prompt('Email the front desk should confirm to:', '');
      if (!email) return;
      const phone = window.prompt('Phone (optional):', state.phone || '') || '';
      btn.disabled = true;
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/submit?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name, email: email, phone: phone || undefined })
        });
        const data = await safeJson(res);
        if (data.submission) state.submission = data.submission;
        if (!res.ok || !data.ok) {
          showError('Could not create the booking', data);
          return;
        }
        const s = data.submission || {};
        showInfo('Booking created'
          + (s.sample ? ' — sample data, no folio was created.' : '.')
          + (s.folioId ? ' Folio #' + s.folioId : ''));
      } catch (err) {
        showError('Could not create the booking', { detail: err && err.message ? err.message : String(err) });
      } finally {
        renderReservationStatus();
      }
    }

    /**
     * Whether this quotation already has a guest link. Read from the record, not from this page:
     * publishing is one-way (their link always resolves to the newest saved revision), so a reload
     * or a second tab has to agree that it is done.
     */
    function renderPublishStatus() {
      const badge = document.getElementById('publish-status-badge');
      const btn = document.getElementById('btn-publish-quote');
      if (!badge || !btn) return;
      // The same test the status pill uses: a link exists when theirs does OR ours does. A record
      // published with our own copy has no guestUrl, and reading that as "not published" offered to
      // create a link that was already there.
      if (state.estimator && state.estimator.sharedAt && (state.estimator.mirrorUrl || state.estimator.guestUrl)) {
        badge.textContent = 'Link created';
        btn.disabled = true;
      } else {
        badge.textContent = '';
        btn.disabled = false;
      }
    }

    /**
     * Create the guest link. Returns true when there is a link afterwards.
     *
     * reload is for the button that only creates the link: the link field, the "open guest page"
     * link and the status all come from the record, and a page that said "Guest link created" while
     * its link field stayed empty is the page arguing with itself. The send flow passes false,
     * because it reloads once at the end of the whole action.
     */
    async function publishQuote(reload = true) {
      const btn = document.getElementById('btn-publish-quote');
      clearNotice();
      const ack = document.getElementById('ack-sample');
      // The acknowledgement is a deliberate act, not a speed bump: these are captured prices, and a
      // guest who receives one has been quoted a number nobody has agreed to.
      if (ack && !ack.checked) {
        showError('Could not create the guest link', {
          reason: 'sample_not_acknowledged',
          detail: 'These are sample prices. Tick "I have checked this sample price" in the Send section, then try again.'
        });
        return false;
      }
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/publish?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ acknowledgeSample: !!(ack && ack.checked) })
        });
        const data = await safeJson(res);
        if (data.quotation) state = data.quotation;
        renderStatus();
        if (!res.ok || !data.ok) {
          showError('Could not create the guest link', data);
          return false;
        }
        showInfo('Guest link created (version ' + data.seq + ').'
          + (data.guestUrl ? '' : ' Their app is not hosted anywhere we can link to — set ESTIMATOR_BASE_URL.'));
        if (reload) {
          // The link field and the "open guest page" link are drawn from the record, so the page is
          // rebuilt rather than patched — otherwise it says "created" above an empty field.
          rememberStep(4);
          window.location.reload();
        }
        return true;
      } catch (err) {
        showError('Could not create the guest link', { detail: err && err.message ? err.message : String(err) });
        return false;
      } finally {
        renderPublishStatus();
      }
    }

    renderSidebar();
    renderTripReview();
    // Which screen to open on: the step remembered before a reload (see rememberStep), clamped to
    // what the record has actually earned. A remembered step 4 on a quotation that was never
    // approved would otherwise be a screen with nothing to send from.
    (function openRememberedStep() {
      let remembered = 0;
      try { remembered = Number(sessionStorage.getItem(STEP_KEY) || 0); } catch (err) {}
      const main = document.querySelector('main');
      const serverStep = Number((main && main.getAttribute('data-step')) || 1);
      if (remembered > serverStep) goStep(remembered);
      else if (remembered > 0 && remembered < serverStep) goStep(remembered);
      else updateWizard();
    })();
    (function syncOpsLinks() {
      const tok = staffToken();
      if (!tok) return;
      document.querySelectorAll('a[href*="/ops"]').forEach(a => {
        if (!a.href.includes('token=')) {
          a.href += (a.href.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(tok);
        }
      });
    })();
    renderStatus();
  </script>
</body>
</html>`;
}
