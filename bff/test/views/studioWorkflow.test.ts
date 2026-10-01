// The studio, as the person at the front desk meets it.
//
// This file exists because the studio had grown three statements of the same state and six buttons
// that had to be pressed in an order the page never explained: an approved-but-unpublished quotation
// read "Ready to Send" on one card beside a link box that said no link existed, and "Send WhatsApp"
// refused until "Publish Link" had been pressed. A receptionist taking a booking had to know the
// pipeline. These tests pin the three things that changed — one status, one bar, one action per step
// — and the trip controls a group booking needs.
//
// They assert on the SERVER-rendered markup wherever the claim is "this is true without the script
// running", because the page's own script necessarily contains the same words (it redraws the same
// status after an action). Asserting on the whole document would pass for the wrong reason.
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { createApp } from "../../src/app.ts";
import { listQuotations, saveQuotationDraft } from "../../src/store/quotationStore.ts";
import { renderHonoQuotationEditorHtml } from "../../src/views/quotationEditorPage.ts";
import type { HonoQuotationDraft } from "../../src/quote/index.ts";
import { ensureSampleQuotation } from "../helpers/sampleQuotation.ts";

// The app no longer seeds a cold-start record; this file reads the sample one.
beforeAll(async () => {
  await ensureSampleQuotation();
});

const STAFF_TOKEN = "studio-workflow-token";

/** Just the markup: everything before the page's own script. */
function markupOnly(html: string): string {
  return html.slice(0, html.indexOf("<script>"));
}

async function studioFor(id: string): Promise<string> {
  const app = createApp();
  return (await app.request(`/quotes/${id}?token=${STAFF_TOKEN}`)).text();
}

/** The seeded fixture, which is priced, unapproved and unpublished — the state staff actually meet. */
async function seed(): Promise<HonoQuotationDraft> {
  const all = await listQuotations();
  const found = all.find((q) => q.quoteId === "QT-1010-SKY");
  expect(found, "the fixture seeds itself on first read").toBeTruthy();
  return found!;
}

/**
 * A copy of the fixture in another state, under its own id.
 *
 * `seedVersion` is dropped so the copy is not itself a fixture: `ensureSeeded` and the deletion rule
 * both key on that field, and a test copy that carried it would be treated as the cold-start record.
 */
function copyOf(base: HonoQuotationDraft, id: string, patch: Partial<HonoQuotationDraft>): HonoQuotationDraft {
  const { seedVersion: _seed, ...rest } = base;
  return { ...rest, ...patch, quoteId: id, slug: `slug-${id}` };
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", STAFF_TOKEN);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A quotation the ENGINE has priced — the state a quotation is in after step 2. */
function enginePriced(base: HonoQuotationDraft): HonoQuotationDraft {
  return copyOf(base, "QT-STUDIO-ENGINE-PRICED", {
    estimator: { id: "sim-1", cookie: "ubg_sid=1", seq: null, guestUrl: null, sharedAt: null },
  });
}

describe("one status, and it is the record's", () => {
  it("says each state once, in the sequence the work happens in", async () => {
    const base = await seed();
    // Copies, never the fixture itself: every test in this file reads the same seeded record, and a
    // test that saved over it would decide what the next one sees.
    const variant = (id: string, patch: Partial<HonoQuotationDraft>) =>
      saveQuotationDraft(copyOf(base, id, patch));

    // The seeded fixture carries a price from the built-in sample engine and no scenario on theirs,
    // so its status is about the ENGINE's price, not about the figure on the page. Measured on
    // production: it said "Priced — needs approval" and publishing answered "price the quotation
    // before publishing it", which was true of the scenario and misleading about the price.
    expect(markupOnly(await studioFor(base.quoteId))).toContain("Needs a price from the engine");

    const priced = await saveQuotationDraft(enginePriced(base));
    expect(markupOnly(await studioFor(priced.quoteId))).toContain("Priced — needs approval");

    const unpriced = await variant("QT-STUDIO-UNPRICED", { pricing: null, status: "pending_hono_review", estimator: null });
    expect(markupOnly(await studioFor(unpriced.quoteId))).toContain("Needs review");

    const approved = await saveQuotationDraft(copyOf(priced, "QT-STUDIO-APPROVED", { status: "confirmed_by_hono" }));
    expect(markupOnly(await studioFor(approved.quoteId))).toContain("Approved — not sent yet");

    // Published, and the message has not gone out: "Create link only" is one of the two buttons on
    // screen 4, so a link existing is not evidence that a guest was told about it. Found on
    // production, where this state read "Sent to guest" and offered to send "the message again".
    const publishedOnly = await saveQuotationDraft(copyOf(priced, "QT-STUDIO-PUBLISHED", {
      status: "confirmed_by_hono",
      estimator: { id: "sim-seed", cookie: "ubg_sid=seed", seq: 1, guestUrl: "https://their-app.test/quote/tok", sharedAt: "2026-09-28T00:00:00.000Z" },
    }));
    expect(markupOnly(await studioFor(publishedOnly.quoteId))).toContain("Link ready — not sent");

    // Sent: approved, published, and a send was actually recorded.
    const sent = await saveQuotationDraft(copyOf(priced, "QT-STUDIO-SENT", {
      status: "confirmed_by_hono",
      estimator: { id: "sim-seed", cookie: "ubg_sid=seed", seq: 1, guestUrl: "https://their-app.test/quote/tok", sharedAt: "2026-09-28T00:00:00.000Z" },
      sentToGuestAt: "2026-09-28T00:05:00.000Z",
      sentToPhone: "639171234567",
    }));
    expect(markupOnly(await studioFor(sent.quoteId))).toContain("Sent to guest");

    const archived = await variant("QT-STUDIO-ARCHIVED", { status: "cancelled" });
    expect(markupOnly(await studioFor(archived.quoteId))).toContain("Archived");
  });

  it("calls a quotation published when the guest's link is our own copy", async () => {
    // The simulated engine answers `share` with a relative path and no app host resolves it, so a
    // publish mints our copy and leaves `guestUrl` null. The studio read that as unpublished and said
    // "Approved — not sent yet" beside a link field that held a working URL — measured on the sim
    // deployment on 2026-09-28. Published means "there is a link the guest can open", whoever hosts it.
    const base = await seed();
    const mirror = await saveQuotationDraft(
      copyOf(enginePriced(base), "QT-STUDIO-MIRROR", {
        status: "confirmed_by_hono",
        estimator: {
          id: "sim-mirror",
          cookie: "ubg_sid=mirror",
          seq: 1,
          guestUrl: null,
          sharedAt: "2026-09-28T00:00:00.000Z",
          mirrorUrl: "https://bff.test/q/mirror-slug",
          mirrorReason: "this deployment has no guest app to open the booking engine's link on",
        },
      }),
    );

    const markup = markupOnly(await studioFor(mirror.quoteId));
    expect(markup).toContain("Link ready — not sent");
    expect(markup).not.toContain("Approved — not sent yet");
    // The step bar agrees, and the link field is the link the guest actually gets.
    expect(markup).toContain('class="pstep done"');
    expect(await studioFor(mirror.quoteId)).toContain("https://bff.test/q/mirror-slug");
  });

  it("no longer states it twice, and never in the words that disagreed", async () => {
    const base = await seed();
    const html = await studioFor(base.quoteId);

    // "Ready to Send" was rendered on the send card whenever the quotation was approved, while the
    // link box beside it said the link did not exist yet.
    expect(html).not.toContain("Ready to Send");
    expect(html).not.toContain("Awaiting Approval");
    expect(html).not.toContain("Pending Hono Confirmation");
    expect(html).not.toContain("Confirmed by Hono");
    // The link box used to present itself as a state ("Official Invoice") rather than a field.
    expect(html).not.toContain("Customer Quotation Link (Official Invoice)");
  });
});

describe("chasing a guest who has not answered", () => {
  // The 48h nudge / 72h stale pair the operation runs on, drawn from the record rather than from
  // anything in the browser. What counts is a quotation the guest was actually SENT: a link-only
  // publish, an archived record and a booking with a folio are all "nothing to chase".
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

  async function sentQuote(id: string, hours: number, extra: Partial<HonoQuotationDraft> = {}) {
    const base = await seed();
    return saveQuotationDraft(
      copyOf(enginePriced(base), id, {
        status: "confirmed_by_hono",
        phone: "639171234567",
        sentToGuestAt: hoursAgo(hours),
        estimator: {
          id: "sim-sent",
          cookie: "ubg_sid=sent",
          seq: 1,
          guestUrl: "https://their-app.test/quote/tok",
          sharedAt: hoursAgo(hours),
        },
        ...extra,
      }),
    );
  }

  it("is quiet indoors, nudges after 48 hours and goes stale after 72", async () => {
    const fresh = await sentQuote("QT-CHASE-FRESH", 10);
    const markupFresh = markupOnly(await studioFor(fresh.quoteId));
    expect(markupFresh).not.toContain("Stale");
    expect(markupFresh).not.toContain("Follow up");

    const nudge = await sentQuote("QT-CHASE-NUDGE", 50);
    const markupNudge = markupOnly(await studioFor(nudge.quoteId));
    expect(markupNudge).toContain("Follow up (&gt;48h)");
    expect(markupNudge).not.toContain("Stale");

    const stale = await sentQuote("QT-CHASE-STALE", 80);
    const markupStale = markupOnly(await studioFor(stale.quoteId));
    expect(markupStale).toContain("Stale (&gt;72h)");
  });

  it("chases nobody about a link they were never sent", async () => {
    // "Create link only" publishes without sending. The first version of this badge fell back to
    // `sharedAt`, so it called that state overdue for a guest who had received nothing at all.
    const base = await seed();
    const publishedOnly = await saveQuotationDraft(
      copyOf(enginePriced(base), "QT-CHASE-NOSEND", {
        status: "confirmed_by_hono",
        estimator: {
          id: "sim-nosend",
          cookie: "ubg_sid=nosend",
          seq: 1,
          guestUrl: "https://their-app.test/quote/tok",
          sharedAt: hoursAgo(100),
        },
      }),
    );
    const markup = markupOnly(await studioFor(publishedOnly.quoteId));
    expect(markup).not.toContain("Stale");
    expect(markup).not.toContain("Follow up");
    // …and the follow-up box is not offered for it either.
    expect(markup).not.toContain("Copy follow-up message");
  });

  it("stops asking for a deposit the guest has already paid", async () => {
    const booked = await sentQuote("QT-CHASE-BOOKED", 90, {
      submission: { folioId: 7, orderIds: null, sample: false, mode: "fixture" },
    } as Partial<HonoQuotationDraft>);
    const markup = markupOnly(await studioFor(booked.quoteId));
    expect(markup).not.toContain("Stale");
    expect(markup).not.toContain("Copy follow-up message");
  });

  it("offers the follow-up once there is something to follow up, in the resort's own terms", async () => {
    const stale = await sentQuote("QT-CHASE-TEXT", 80);
    const html = await studioFor(stale.quoteId);

    expect(html).toContain("Copy follow-up message");
    // The message quotes the terms the resort publishes, and invents no scarcity: "rooms are filling
    // up quickly" was in the first version of this and is not something this system can know.
    expect(html.toLowerCase()).not.toContain("down payment");
    expect(html).not.toContain("filling up");
    expect(html).not.toContain("secure your room");
  });
});

describe("the four steps", () => {
  it("server-renders which steps are done, and which one is next", async () => {
    const base = await seed();
    const markup = markupOnly(await studioFor(base.quoteId));

    for (const label of ["Review trip", "Get price", "Approve", "Send"]) {
      expect(markup, `the bar is missing the step "${label}"`).toContain(label);
    }
    // The fixture has a trip and a price and no approval: two done, one current, one to come.
    expect(markup).toContain('class="pstep done"');
    expect(markup).toContain('class="pstep current"');
    expect(markup).toContain('class="pstep todo"');
  });

  it("replaces the bar with a sentence when the quotation is archived", async () => {
    const base = await seed();
    const archived = await saveQuotationDraft(copyOf(base, "QT-STUDIO-ARCHIVED-2", { status: "cancelled" }));
    const markup = markupOnly(await studioFor(archived.quoteId));

    expect(markup).toContain("This quotation is archived. Nothing is sent to the guest from here.");
    expect(markup).not.toContain('class="pstep');
  });
});

describe("the trip controls a group booking needs", () => {
  it("offers adding and removing rooms, and a whole day at once", async () => {
    const base = await seed();
    const html = await studioFor(base.quoteId);

    // Drawn by the page's script from the record, so the check is that the controls are wired.
    expect(html).toContain("+ Add a room");
    expect(html).toContain("addRoom()");
    expect(html).toContain("removeRoom(");
    expect(html).toContain("setDayForAll(");
    expect(html).toContain("D all");
  });

  it("refuses to remove a room somebody is still in, in words, rather than half-editing the trip", async () => {
    const base = await seed();
    const html = await studioFor(base.quoteId);

    // The guard's message and its reason. Unassigning the guests silently would produce a trip the
    // engine rejects, which reads as the engine being broken.
    expect(html).toContain("room_in_use");
    expect(html).toContain("out of room ");
    expect(html).toContain("A booking needs at least one room");
  });

  it("marks unsaved trip edits, because the price on screen is still the previous trip's", async () => {
    const base = await seed();
    const html = await studioFor(base.quoteId);

    // The hint beside the single save button, and the marker the edit handlers raise.
    expect(html).toContain("Unsaved changes. The price below still belongs to the previous trip.");
    expect(html).toContain("markTripDirty()");
    expect(html).toContain("One save for the guest's details and the priced trip.");
  });

  it("offers exactly one save for the review step, and it prices the trip", async () => {
    const base = await seed();
    const html = await studioFor(base.quoteId);

    // One action, wired to the one handler that stores the details AND sends the trip to the route
    // that prices it — now carried by the wizard's own Next button, which is the only primary
    // button on the screen.
    expect(html).toContain('id="btn-next"');
    expect(html).toContain("saveStudio()");
    expect(html).toContain("wizardNext()");
    expect(html).not.toContain("saveEditsOnly()");
    expect(html).not.toContain("saveTripAndReprice()");
    expect(html).not.toContain('id="btn-save-draft"');
    expect(html).not.toContain('id="btn-save-trip"');
  });

  it("draws the trip read-only once the guest holds the link", async () => {
    const base = await seed();
    const published = await saveQuotationDraft(copyOf(base, "QT-STUDIO-FROZEN", {
      estimator: { id: "sim-seed", cookie: "ubg_sid=seed", seq: 1, guestUrl: "https://their-app.test/quote/tok-frozen", sharedAt: "2026-09-28T00:00:00.000Z" },
    }));
    const html = await studioFor(published.quoteId);

    // Their link resolves to the newest saved revision, so a "correction" would silently change what
    // the guest was sent. The controls are drawn disabled rather than left editable and refused.
    expect(html).toContain("Published: this trip and its price are frozen on the guest's link.");
    expect(html).toContain("Read-only while the guest holds the link.");
    expect(html).toContain("const ro = frozen ? ' disabled' : ''");
  });
});

describe("the four screens", () => {
  it("puts one screen in front at a time, chosen server-side", async () => {
    const seeded = await seed();
    const priced = await saveQuotationDraft(enginePriced(seeded));
    const markup = markupOnly(await studioFor(priced.quoteId));

    // Every screen is in the page; CSS shows the one `data-step` names. The attribute is rendered by
    // the server, so the right screen is in front before any script runs.
    for (const n of [1, 2, 3, 4]) {
      expect(markup, `screen ${n} is missing`).toContain(`data-step-card="${n}"`);
    }
    // The engine has priced it and nobody has approved it: the next thing to do is approve.
    expect(markup).toMatch(/<main data-step="3">/);
    expect(markup).toContain("Step 3 · Approve");
  });

  it("carries a Back and a Next, and the Next is named after what it does", async () => {
    const seeded = await seed();
    const priced = await saveQuotationDraft(enginePriced(seeded));
    const html = await studioFor(priced.quoteId);
    const markup = markupOnly(html);

    expect(markup).toContain('id="btn-back"');
    expect(markup).toContain('id="btn-next"');
    expect(markup).toContain("wizardNext()");
    // On screen 3 with a price in hand, the button's action is the approval itself — and this is the
    // SERVER-rendered label, so it is right for a person whose script has not run yet.
    expect(markup).toContain("Approve quotation");
    expect(markup).toContain("Step <strong id=\"wizard-step-num\">3</strong> of 4");
    // On screen 2 the same button only walks forward. That label is set by the script after load
    // (`updateWizard`), so it is asserted on the whole document rather than on the markup.
    expect(html).toContain("Continue to approve");
  });

  it("opens on step 1 for a quotation the engine has not priced", async () => {
    // Two cases, same answer: nobody has priced it, and the seeded fixture's figure came from the
    // built-in sample engine so there is no scenario on theirs to freeze. Both begin at the review.
    const base = await seed();
    const unpriced = await saveQuotationDraft(copyOf(base, "QT-WIZ-UNPRICED", { pricing: null, status: "pending_hono_review", estimator: null }));

    for (const id of [base.quoteId, unpriced.quoteId]) {
      const markup = markupOnly(await studioFor(id));
      expect(markup, `${id} should open on step 1`).toMatch(/<main data-step="1">/);
      expect(markup).toContain("Save &amp; get price");
      // The steps after the one the record has earned are not offered.
      expect(markup).toContain("Finish the earlier steps first");
    }
  });

  it("has no guest mode: the studio opens for staff, on the step the record has reached", async () => {
    const all = await listQuotations();
    const markup = markupOnly(renderHonoQuotationEditorHtml(all[0]!, all));

    expect(markup).not.toContain('body[data-role="guest"]');
    expect(markup).not.toMatch(/<main data-step="2">/);
  });
});

describe("one place for failures, and one action that sends", () => {
  it("shows failures in the shared notice box, not in a corner of each section", async () => {
    const base = await seed();
    const html = await studioFor(base.quoteId);

    expect(html).toContain('id="studio-notice"');
    // The four per-action <pre> blocks are gone: a refusal that appears somewhere the eye is not is
    // a refusal nobody acts on.
    for (const dead of ["trip-edit-out", "sync-estimate-out", "publish-out", "reservation-out"]) {
      expect(html, `${dead} is still in the page`).not.toContain(dead);
    }
    // And the codes a person will actually meet are turned into the next thing to do.
    expect(html).toContain("not_priced: 'Get the price first, then approve.'");
    expect(html).toContain("trip_changed:");
    expect(html).toContain("phone_invalid:");
  });

  it("has one button that creates the link and sends, instead of two in a required order", async () => {
    const base = await seed();
    const html = await studioFor(base.quoteId);

    // The action lives in the wizard bar (`wizardNext` → `sendToGuest`), and the only other control
    // that can publish is the deliberate "create the link without messaging" one, beside the same
    // sample-price acknowledgement.
    expect(html).toContain("sendToGuest()");
    expect(html).toContain("wizardNext()");
    expect(html).toContain("Create link only");
    expect(html).not.toContain('id="btn-push-wa"');
    expect(html).not.toContain('id="btn-send-guest"');
    // The sample acknowledgement belongs to that screen, which is where the decision is made.
    expect(html).toContain('id="ack-sample"');
    expect(html).toContain("I have checked this sample price");
  });

  it("keeps the customer's own link as the only link the page offers", async () => {
    const base = await seed();
    const approved = await saveQuotationDraft(copyOf(base, "QT-STUDIO-APPROVED-SEND", { status: "confirmed_by_hono" }));
    const published = await saveQuotationDraft(copyOf(approved, "QT-STUDIO-PUBLISHED", {
      estimator: { id: "sim-seed", cookie: "ubg_sid=seed", seq: 1, guestUrl: "https://their-app.test/quote/tok-studio", sharedAt: "2026-09-28T00:00:00.000Z" },
    }));
    const html = await studioFor(published.quoteId);

    expect(html).toContain("https://their-app.test/quote/tok-studio");
    expect(markupOnly(html)).not.toContain("/q/");
  });
});

describe("the queue tabs, and no deposit anywhere in the studio", () => {
  it("renders the four sidebar tabs, and nothing to record a payment against", async () => {
    const base = await seed();
    const html = await studioFor(base.quoteId);

    expect(html).toContain('id="tab-action-needed"');
    expect(html).toContain('id="tab-waiting"');
    expect(html).toContain('id="tab-all"');
    expect(html).toContain('id="tab-cancelled"');
    expect(html).not.toContain("tab-deposit-received");

    // The team estimator takes no deposit and this studio only simulates it: no recording card, no
    // modal, no bank details.
    expect(html).not.toContain("deposit-section");
    expect(html).not.toContain("deposit-modal");
    expect(html).not.toContain("Bank &amp; Payment Details");
    expect(html).not.toContain("copyBankPaymentInfo");
  });

  it("has no route to record a deposit, and the ops sheet carries no deposit badge", async () => {
    const app = createApp();
    const base = await seed();
    const quote = await saveQuotationDraft(copyOf(base, "QT-STUDIO-PAID-TEST", { status: "confirmed_by_hono" }));

    const res = await app.request(`/v1/quotes/${quote.quoteId}/deposit-payment?token=${STAFF_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referenceNumber: "BDO-998811", amount: 25000 }),
    });
    expect(res.status).toBe(404);

    const ops = await (await app.request(`/quotes/${quote.quoteId}/ops?token=${STAFF_TOKEN}`)).text();
    expect(ops.toLowerCase()).not.toContain("deposit");
  });
});
