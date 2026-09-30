// The two pages that read the pricing engine's answer: the Ops Sheet and the studio's per-guest
// breakdown.
//
// The ops sheet's defining property is what is NOT on it. It is printed and carried, so "no money
// anywhere on the page" is asserted as a property of the whole document rather than checked field by
// field — a price added later in any block fails this test.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { buildHonoQuotationDraft } from "../../../packages/extractor/src/application/quotationTool.js";
import { saveQuotationDraft } from "../src/stores/quotationStore.js";
import { issueSession } from "../src/auth/demoAuth.js";
import { buildBffTrip } from "../../../packages/extractor/src/application/odooHandoff.js";
import type { Trip } from "../../../packages/extractor/src/domain/schema.js";

const VERIFY_TOKEN = "ops-sheet-token";

function sampleTrip(): Trip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  return {
    language: f("en", "default"),
    contactName: f("Ana"),
    checkIn: f("2026-11-20"),
    checkOut: f("2026-11-22"),
    nights: f(2),
    guests: f(2),
    rooms: f(1),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none"),
    diver: f(true),
    divers: f(1),
    diveFrom: f("2026-11-21"),
    diveTo: f("2026-11-21"),
    diveNotes: f(null, "missing"),
    specialRequests: f(null, "missing"),
    guestNames: f(["Ana", "Ben"]),
  } as Trip;
}

async function storedQuote(id: string) {
  const draft = buildHonoQuotationDraft(sampleTrip(), "https://example.test", id);
  return saveQuotationDraft({ ...draft, bffTrip: buildBffTrip(sampleTrip()) });
}

/** Price it the way staff do, so `pricing` is on the record rather than only in a response. */
async function pricedQuote(id: string) {
  const draft = await storedQuote(id);
  const app = createApp();
  const res = await app.request(`/v1/quotes/${draft.quoteId}/sync-estimate?token=${VERIFY_TOKEN}`, { method: "POST" });
  expect(res.status).toBe(200);
  return { app, draft };
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the ops sheet", () => {
  it("carries no money at all", async () => {
    const { app, draft } = await pricedQuote("QT-OPS-1");
    const html = await (await app.request(`/quotes/${draft.quoteId}/ops?token=${VERIFY_TOKEN}`)).text();

    // The whole point of the page. A price on a sheet that gets printed and left on a counter is a
    // price nobody agreed to publish.
    expect(html).not.toContain("₱");
    expect(html).not.toContain("$");
    expect(html).not.toContain("Total");
  });

  it("gives one sheet per day, with the five blocks the morning meeting works from", async () => {
    const { app, draft } = await pricedQuote("QT-OPS-2");
    const html = await (await app.request(`/quotes/${draft.quoteId}/ops?token=${VERIFY_TOKEN}`)).text();

    expect(html).toContain("Ops sheet");
    for (const block of ["Front desk", "Housekeeping", "Dive centre", "Kitchen", "Transfers"]) {
      expect(html).toContain(block);
    }
    // Two nights plus the departure morning — the last morning is the busiest one.
    expect(html).toContain("Fri, Nov 20, 2026");
    expect(html).toContain("Sat, Nov 21, 2026");
    expect(html).toContain("Sun, Nov 22, 2026");
    expect(html).toContain("arrival day");
    expect(html).toContain("departure day");
  });

  it("names who is in house, where, and who is on the boat", async () => {
    const { app, draft } = await pricedQuote("QT-OPS-3");
    const html = await (await app.request(`/quotes/${draft.quoteId}/ops?token=${VERIFY_TOKEN}`)).text();

    expect(html).toContain("Ana, Ben");
    expect(html).toContain("Standard A");
    // The dive day names the diver the simulated engine put out, and only that day.
    expect(html).toContain("1 diver(s)");
  });

  it("says it is not priced yet instead of inventing an empty day", async () => {
    const draft = await storedQuote("QT-OPS-4");
    const app = createApp();
    const html = await (await app.request(`/quotes/${draft.quoteId}/ops?token=${VERIFY_TOKEN}`)).text();

    expect(html).toContain("not priced yet");
    expect(html).toContain("Price it in the studio first");
  });

  it("needs a session, and deep-links the sign-in back to the sheet", async () => {
    const draft = await storedQuote("QT-OPS-5");
    const app = createApp();
    const res = await app.request(`/quotes/${draft.quoteId}/ops`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/login?next=%2Fquotes%2F${draft.quoteId}%2Fops`);
  });
});

describe("the studio draws the engine's answer", () => {
  it("shows one card per guest, with the engine's own lines", async () => {
    const { app, draft } = await pricedQuote("QT-OPS-6");
    const html = await (await app.request(`/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).text();

    expect(html).toContain("Per guest");
    expect(html).toContain("Ana");
    expect(html).toContain("Ben");
    expect(html).toContain("Boat dives — Sat, Nov 21");
    expect(html).toContain("Standard A — 2 nights");
    // Sample data must be labelled wherever a number appears, not only in the sync output.
    expect(html).toContain("SAMPLE DATA");
    // The engine's own warning reaches staff verbatim.
    expect(html).toContain("no boat picked yet for Ana");
  });

  it("links to the ops sheet", async () => {
    const { app, draft } = await pricedQuote("QT-OPS-7");
    const html = await (await app.request(`/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).text();
    expect(html).toContain(`/quotes/${draft.quoteId}/ops`);
  });

  it("offers the guest's published link, and never the retired /q/ one", async () => {
    // This page used to show our own `/q/<slug>` URL and call itself "the live working copy ….
    // there is no frozen version yet". Both halves were stale: that page is retired and answers 410,
    // and the link a guest receives is minted by the customer's app at Publish and frozen there —
    // so the studio was inviting staff to paste a dead URL into a chat.
    const { app, draft } = await pricedQuote("QT-OPS-9");

    const studio = await (await app.request(`/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).text();
    // Every URL the page OFFERS — an `href` or an input `value` — rather than the whole document:
    // the quotation record is embedded in the page's own script (`let state = …`) and legitimately
    // contains `quotationUrl`. Asserting on the document was a test that could not tell a dead link
    // on a button from a field of data, and passed or failed on whether the state was embedded.
    const offered = (html: string) => [...html.matchAll(/(?:href|value)="([^"]*)"/g)].map((m) => m[1]!);
    expect(offered(studio).some((u) => u.includes("/q/"))).toBe(false);
    // Before anything is published the page says so in words a receptionist reads, and it does not
    // pretend the link is merely "generated upon rate approval" — creating it is the Send action.
    expect(studio).toContain("No link yet — it appears here when you send");
    expect(studio).not.toContain("live working copy");
    expect((await app.request(`/q/${draft.slug}`)).status).toBe(410);

    // Once published, that link — and only that link — is what the studio offers.
    const published = await saveQuotationDraft({
      ...draft,
      estimator: {
        id: "sim-9",
        cookie: "ubg_sid=sim-9",
        seq: 1,
        guestUrl: "https://their-app.test/quote/tok-nine",
        sharedAt: new Date().toISOString(),
      },
    });
    const after = await (await app.request(`/quotes/${published.quoteId}?token=${VERIFY_TOKEN}`)).text();
    expect(offered(after)).toContain("https://their-app.test/quote/tok-nine");
    expect(offered(after).some((u) => u.includes("/q/"))).toBe(false);
  });

  it("marks the page with the role it was opened as, which is what gates the staff actions", async () => {    const draft = await storedQuote("QT-OPS-8");
    const app = createApp();
    const cookie = `casa_gais_session=${issueSession("guest", { WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN } as NodeJS.ProcessEnv)}`;

    const asGuest = await (await app.request(`/quotes/${draft.quoteId}`, { headers: { cookie } })).text();
    expect(asGuest).toContain('data-role="guest"');
    // The bars are still in the document — they are hidden by role, and the class is what hides them.
    expect(asGuest).toContain("staff-only");

    const asStaff = await (await app.request(`/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).text();
    expect(asStaff).toContain('data-role="staff"');
  });
});
