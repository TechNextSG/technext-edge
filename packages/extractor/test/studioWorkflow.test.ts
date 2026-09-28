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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { listQuotations, saveQuotationDraft } from "../../../apps/casa-bff/src/quotationStore.js";
import type { HonoQuotationDraft } from "../../../packages/extractor/src/index.js";

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

describe("one status, and it is the record's", () => {
  it("says each state once, in the sequence the work happens in", async () => {
    const base = await seed();
    // Copies, never the fixture itself: every test in this file reads the same seeded record, and a
    // test that saved over it would decide what the next one sees.
    const variant = (id: string, patch: Partial<HonoQuotationDraft>) =>
      saveQuotationDraft(copyOf(base, id, patch));

    const priced = markupOnly(await studioFor(base.quoteId));
    expect(priced).toContain("Priced — needs approval");

    const unpriced = await variant("QT-STUDIO-UNPRICED", { pricing: null, status: "pending_hono_review" });
    expect(markupOnly(await studioFor(unpriced.quoteId))).toContain("Needs review");

    const approved = await variant("QT-STUDIO-APPROVED", { status: "confirmed_by_hono" });
    expect(markupOnly(await studioFor(approved.quoteId))).toContain("Approved — not sent yet");

    // Sent: approved AND published, which is the only state a guest has a link in.
    const sent = await variant("QT-STUDIO-SENT", {
      status: "confirmed_by_hono",
      estimator: { id: "sim-seed", cookie: "ubg_sid=seed", seq: 1, guestUrl: "https://their-app.test/quote/tok", sharedAt: "2026-09-28T00:00:00.000Z" },
    });
    expect(markupOnly(await studioFor(sent.quoteId))).toContain("Sent to guest");

    const archived = await variant("QT-STUDIO-ARCHIVED", { status: "cancelled" });
    expect(markupOnly(await studioFor(archived.quoteId))).toContain("Archived");
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

    // One button, wired to the one handler that stores the details AND sends the trip to the route
    // that prices it. Two buttons asked a receptionist to know which of their edits belonged where.
    expect(html).toContain('id="btn-save-all"');
    expect(html).toContain("saveStudio()");
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

    expect(html).toContain("sendToGuest()");
    expect(html).toContain('id="btn-send-guest"');
    expect(html).not.toContain('id="btn-push-wa"');
    // The sample acknowledgement belongs to the action that sends, which is where the decision is.
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
