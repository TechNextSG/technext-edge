// One enquiry, one quotation — and the state that belongs to it.
//
// This file exists because of what was found on production, not because of a design preference.
// `QT-1120-MIGU-2E430478` was approved, priced, and sitting in the studio showing the *next*
// guest's name: the thread had moved on to a new enquiry, the quotation had not, and everything
// that belonged to the old one — the approval, the price, the customer-app session — was carried
// across as if it described the new one. Two rules close that gap, and they are the two halves of
// this file:
//
//   1. **The enquiry boundary.** A reset ends the enquiry, so its quotation is closed with it. The
//      next enquiry mints its own record rather than inheriting the abandoned one.
//   2. **The money boundary.** Inside one enquiry, changing anything a price is computed from
//      invalidates the price and the approval given for it. The record keeps its id — one enquiry,
//      one quotation, so staff see a correction instead of a second row — but "approved" cannot
//      survive the guest adding a night.
//
// The action runs over the real webhook with a fake provider and a recording sender, so what is
// asserted is the behaviour of the channel rather than of a helper called on its behalf.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { createInMemoryConversationStore } from "../../../apps/casa-bff/src/conversationStore.js";
import { listQuotations, saveQuotationDraft } from "../../../apps/casa-bff/src/quotationStore.js";
import type { ExtractProvider } from "../src/provider.js";
import type { HonoQuotationDraft } from "../src/quotationTool.js";

const VERIFY_TOKEN = "enquiry-token";
const APP_SECRET = "enquiry-secret";

/** One phone per test: the store is one in-memory instance for the whole file. */
function phoneFor(slug: string): string {
  return `6391700${slug.padStart(5, "0").slice(-5)}`;
}

const f = <T,>(value: T | null, state = "stated", evidence: string | null = null) => ({ value, state, evidence });

/**
 * A complete enquiry: stated, diving, and named — so the tool builds a quotation from it.
 *
 * Every `evidence` string is a verbatim substring of the message the test sends, because that is
 * the gate `extract.ts` applies to a `stated` field: a value the guest's own words do not support is
 * thrown away and asked for again. Evidence that does not appear in the text is the difference
 * between a quotation and another round of questions.
 */
function completeRaw(overrides: Record<string, unknown> = {}) {
  return {
    language: f("en", "default"),
    checkIn: f("2026-11-20", "stated", "Nov 20"),
    checkOut: f(null, "missing"),
    nights: f(2, "stated", "2 nights"),
    guests: f(2, "stated", "2 of us"),
    rooms: f(1, "stated", "1 room"),
    roomType: f("deluxe", "stated", "deluxe"),
    meals: f("full_board", "stated", "full board"),
    transport: f(false, "stated", "no transport"),
    transportType: f("none", "stated", "no transport"),
    guestType: f("retail", "default"),
    diver: f(true, "stated", "dive"),
    divers: f(2, "stated", "both dive"),
    diveFrom: f("2026-11-21", "stated", "Nov 21"),
    diveTo: f("2026-11-21", "stated", "Nov 21"),
    diveNotes: f(null, "missing"),
    contactName: f("Minh", "stated", "Minh"),
    ...overrides,
  };
}

/** The provider answers each turn with the next extraction, then repeats the last one. */
function providerSequence(raws: unknown[]): ExtractProvider {
  let index = 0;
  return {
    id: "fake:sequence",
    call: vi.fn().mockImplementation(async () => ({
      raw: raws[Math.min(index++, raws.length - 1)],
      tokensIn: 10,
      tokensOut: 10,
      cacheReadTokens: 0,
      ms: 5,
    })),
  };
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

function textEvent(id: string, text: string, from: string): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15551234567", phone_number_id: "PHONE_ID" },
              contacts: [{ profile: { name: "Guest" }, wa_id: from }],
              messages: [{ from, id, timestamp: "1789700000", type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

let wamid = 0;

function harness(provider: ExtractProvider) {
  const sent: Array<{ to: string; body: string }> = [];
  const app = createApp({
    provider,
    store: createInMemoryConversationStore(),
    sendWhatsApp: async (message) => {
      sent.push(message);
    },
  });
  return {
    app,
    sent,
    say: (text: string, from: string) => {
      const body = textEvent(`wamid.enquiry.${++wamid}`, text, from);
      return app.request("/v1/channels/whatsapp/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
        body,
      });
    },
  };
}

async function quotationsFor(phone: string): Promise<HonoQuotationDraft[]> {
  return (await listQuotations()).filter((q) => q.phone === phone);
}

/** The single live quotation for a phone, as the studio's queue would find it. */
async function liveQuotation(phone: string): Promise<HonoQuotationDraft> {
  const all = await quotationsFor(phone);
  const live = all.filter((q) => q.status !== "cancelled" && !q.estimator?.sharedAt);
  expect(live, `expected exactly one live quotation for ${phone}`).toHaveLength(1);
  return live[0]!;
}

/**
 * What staff leave behind after reviewing: an approval, a price, and the message written for it.
 *
 * Set directly rather than by driving `sync-estimate` + `confirm`, because this file is about what
 * the *channel* does to that state on the next message — the pricing routes have their own file
 * (`tripEdit.test.ts`), and a remote engine is not part of this question.
 */
async function approve(draft: HonoQuotationDraft): Promise<HonoQuotationDraft> {
  return saveQuotationDraft({
    ...draft,
    status: "confirmed_by_hono",
    confirmedAt: "2026-09-15T00:00:00.000Z",
    confirmedBy: "Hono Reservation Studio",
    aiConfirmedReply: "Your quotation is ready.",
    pricing: {
      source: "simulated",
      sample: true,
      mode: "fixture",
      role: "guest",
      computedAt: "2026-09-15T00:00:00.000Z",
      guests: [],
      catRev: {},
      kpis: { revenue: 31_200, guests: 2, nights: 2, discounts: null, rpgn: 15_600 },
      warnings: [],
      retail: null,
      ops: null,
    },
  });
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
  vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
  // The quotation tool is the half of the channel this file is about: without the flag the turn
  // stays a chat and stores nothing.
  vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BOOKING =
  "Hi, Nov 20 for 2 nights, 2 of us, 1 room, deluxe, full board, no transport, both dive Nov 21. My name is Minh";
/** The same phone, a different guest: the shape of the production bug this file closes. */
const SECOND_ENQUIRY =
  "Hi, Dec 10 for 2 nights, 4 of us, 2 rooms, standard, full board, no transport, no diving. My name is Ana";

describe("a restarted conversation is a new enquiry", () => {
  it("closes the quotation the guest walked away from, and mints a new one for the next enquiry", async () => {
    const phone = phoneFor("1");
    const { say } = harness(
      providerSequence([
        completeRaw(),
        // The next enquiry at the same phone — a different guest, a different trip.
        completeRaw({
          contactName: f("Ana", "stated", "Ana"),
          checkIn: f("2026-12-10", "stated", "Dec 10"),
          checkOut: f(null, "missing"),
          guests: f(4, "stated", "4 of us"),
          rooms: f(2, "stated", "2 rooms"),
          roomType: f("standard", "stated", "standard"),
          diver: f(false, "stated", "no diving"),
          divers: f(null, "missing"),
          diveFrom: f(null, "missing"),
          diveTo: f(null, "missing"),
        }),
      ]),
    );

    await say(BOOKING, phone);
    const first = await liveQuotation(phone);
    await approve(first);
    expect((await liveQuotation(phone)).status).toBe("confirmed_by_hono");

    await say("reset", phone);

    // The abandoned quotation is closed rather than deleted: a guest may still hold its link, and
    // staff may still need to read what was offered. What it must not be is *live*.
    const closed = (await quotationsFor(phone)).find((q) => q.quoteId === first.quoteId)!;
    expect(closed.status).toBe("cancelled");
    expect(closed.staffAlerts.join(" ")).toContain("restarted the conversation");
    expect(closed.pricing?.kpis.revenue).toBe(31_200); // read-only history, not scrubbed

    await say(SECOND_ENQUIRY, phone);

    const second = await liveQuotation(phone);
    expect(second.quoteId).not.toBe(first.quoteId);
    expect(second.guestName).toBe("Ana");
    // Nothing of the previous enquiry's decision travelled with it. This is the production bug:
    // an approved, priced quotation showing the next guest's name on it.
    expect(second.status).toBe("pending_hono_review");
    expect(second.confirmedAt).toBeUndefined();
    expect(second.aiConfirmedReply).toBeUndefined();
    expect(second.pricing ?? null).toBeNull();
    expect(second.estimator ?? null).toBeNull();
  });

  it("closes it for the staff reset route too, so clearing a thread is one action", async () => {
    const phone = phoneFor("2");
    const { app, say } = harness(providerSequence([completeRaw()]));

    await say(BOOKING, phone);
    const first = await liveQuotation(phone);
    await approve(first);

    const res = await app.request(`/v1/channels/whatsapp/threads/${phone}/reset`, {
      method: "POST",
      headers: { "x-verify-token": VERIFY_TOKEN },
    });
    expect(res.status).toBe(200);

    const closed = (await quotationsFor(phone)).find((q) => q.quoteId === first.quoteId)!;
    expect(closed.status).toBe("cancelled");
  });

  it("does not close a quotation the guest is already holding a link to", async () => {
    const phone = phoneFor("3");
    const { say } = harness(providerSequence([completeRaw()]));

    await say(BOOKING, phone);
    const first = await liveQuotation(phone);
    await saveQuotationDraft({
      ...first,
      estimator: { ...(first.estimator ?? { id: null, cookie: null, seq: null, guestUrl: null }), guestUrl: "https://example.test/quote/abc", sharedAt: "2026-09-15T00:00:00.000Z" },
    });

    await say("reset", phone);

    // Their link resolves to the newest saved revision, so closing the record underneath a link a
    // guest holds would be a silent change to what they were sent.
    const published = (await quotationsFor(phone)).find((q) => q.quoteId === first.quoteId)!;
    expect(published.status).not.toBe("cancelled");
    expect(published.estimator?.guestUrl).toBe("https://example.test/quote/abc");
  });
});

describe("inside one enquiry, the money boundary holds", () => {
  it("drops the approval and the price when the guest changes a priced fact, keeping the id", async () => {
    const phone = phoneFor("4");
    const { say } = harness(
      providerSequence([
        completeRaw(),
        // Same enquiry, more guests — "actually there are 4 of us".
        completeRaw({ guests: f(4, "stated", "4 of us") }),
      ]),
    );

    await say(BOOKING, phone);
    const first = await liveQuotation(phone);
    await approve(first);
    // A correction staff already made, which must keep counting.
    await saveQuotationDraft({
      ...(await liveQuotation(phone)),
      staffEdits: [{ at: "2026-09-15T00:00:00.000Z", fields: ["rooms[0].type"] }],
    });

    await say("Sorry, there are 4 of us", phone);
    const after = await liveQuotation(phone);
    expect(after.quoteId).toBe(first.quoteId); // one enquiry, one quotation
    expect(after.status).toBe("pending_hono_review");
    expect(after.confirmedAt).toBeUndefined();
    expect(after.confirmedBy).toBeUndefined();
    expect(after.aiConfirmedReply).toBeUndefined(); // written about the old numbers
    expect(after.pricing ?? null).toBeNull(); // a price for the previous trip is worse than none
    expect(after.staffAlerts.join(" ")).toContain("changed the trip after it was priced");
    expect(after.staffEdits).toHaveLength(1); // the extractor's scorecard is cumulative
  });

  it("keeps the approval when the guest says something that does not move the price", async () => {
    const phone = phoneFor("5");
    const { say } = harness(
      providerSequence([
        completeRaw(),
        // The same facts, re-read from the same transcript — plus a question that changes nothing.
        completeRaw(),
      ]),
    );

    await say(BOOKING, phone);
    const first = await liveQuotation(phone);
    const approved = await approve(first);

    await say("Can we also get a late checkout?", phone);

    const after = await liveQuotation(phone);
    expect(after.quoteId).toBe(first.quoteId);
    expect(after.status).toBe("confirmed_by_hono");
    expect(after.confirmedAt).toBe(approved.confirmedAt);
    expect(after.pricing?.kpis.revenue).toBe(31_200);
    expect(after.staffAlerts.join(" ")).not.toContain("changed the trip after it was priced");
  });
});

describe("approving a quotation with no price", () => {
  it("is refused, with a reason rather than a 500", async () => {
    const phone = phoneFor("6");
    const { app, say } = harness(providerSequence([completeRaw()]));

    await say(BOOKING, phone);
    const draft = await liveQuotation(phone);
    expect(draft.pricing ?? null).toBeNull(); // the channel never prices; a person does

    const res = await app.request(`/v1/quotes/${draft.quoteId}/confirm?token=${VERIFY_TOKEN}`, { method: "POST" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("not_priced");
    expect(body.detail).toContain("no price yet");
    // And it really did not write: the studio must not end up with an approval that cannot be
    // explained by a price.
    expect((await liveQuotation(phone)).status).toBe("pending_hono_review");
  });
});

describe("approving is a claim about a trip as well as a price", () => {
  /** The studio posts back the whole draft it rendered, so `bffTrip` is part of an approval. */
  function confirmWith(
    app: ReturnType<typeof createApp>,
    quoteId: string,
    body: Record<string, unknown>,
  ) {
    return app.request(`/v1/quotes/${quoteId}/confirm?token=${VERIFY_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses a trip the stored price does not describe, rather than approving one trip on another's price", async () => {
    const phone = phoneFor("7");
    const { app, say } = harness(providerSequence([completeRaw()]));
    await say(BOOKING, phone);
    const draft = await approve(await liveQuotation(phone));

    // The tab's copy, stale: an edit was saved elsewhere and this page still holds the old trip
    // with a guest moved off the meal plan. Meals are priced, so the stored price is not this trip's.
    const stale = structuredClone(draft.bffTrip!);
    stale.guests[0]!.meals = false;

    const res = await confirmWith(app, draft.quoteId, { bffTrip: stale });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("trip_changed");
    expect(body.detail).toContain("price it again");
    expect(body.fields).toContain("guests[0].meals");
    // The stored trip was not overwritten with the stale one, and the approval still describes the
    // trip the price came from.
    const stored = await liveQuotation(phone);
    expect(stored.bffTrip?.guests[0]?.meals).toBe(true);
    expect(stored.pricing?.kpis.revenue).toBe(31_200);
  });

  it("approves a difference that costs nothing, and counts it as a correction", async () => {
    const phone = phoneFor("8");
    const { app, say } = harness(providerSequence([completeRaw()]));
    await say(BOOKING, phone);
    const draft = await approve(await liveQuotation(phone));

    // A spelling fixed on the name: not a priced fact, so it cannot invalidate the price.
    const corrected = structuredClone(draft.bffTrip!);
    corrected.guests[0]!.name = "Minh N.";

    const res = await confirmWith(app, draft.quoteId, { bffTrip: corrected });
    expect(res.status).toBe(200);

    // Recorded on the same counter `/trip` uses, so the extractor's scorecard counts a correction
    // however it arrived — and the trip itself stays what the price was computed from.
    const stored = await liveQuotation(phone);
    expect(stored.staffEdits?.at(-1)?.fields).toContain("guests[0].name");
    expect(stored.bffTrip?.guests[0]?.name).toBe(draft.bffTrip?.guests[0]?.name);
  });
});
