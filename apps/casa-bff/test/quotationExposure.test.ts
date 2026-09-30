// The guest-facing quotation link is unauthenticated by design (staff paste it into
// WhatsApp), so the slug is the only thing between a URL and someone else's booking. This
// file pins both halves of that: a slug that cannot be guessed, and a miss that is a miss.
//
// It exists because the old behaviour was a live data leak, verified against the production
// deployment with no credential:
//
//   GET /q/made-up-slug-xyz  -> 200, an entire real quotation ("QT-1010-SKY", "Prepared for
//                               Sky", 10-12 Oct, 6 pax / 2 rooms, PHP 73,800)
//   GET /v1/quotes           -> 200, JSON including the guest's phone number and name
//
// Two root causes, both asserted below: `getQuotationByIdOrSlug` fell back to the newest
// quotation for anything unknown (and cloned the seeded record for any `/^QT-/` id), and the
// staff routes had no guard at all.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { createEstimatorClient } from "../src/services/estimatorClient.js";
import {
  listQuotations,
  getQuotationByIdOrSlug,
  saveQuotationDraft,
} from "../src/stores/quotationStore.js";
import { buildHonoQuotationDraft, recalculateQuotationTotals, synthesizeConfirmedQuotationReply } from "../../../packages/extractor/src/application/quotationTool.js";
import {
  validateBffTripPrecheck,
  buildBffTrip,
} from "../../../packages/extractor/src/application/odooHandoff.js";
import type { Trip } from "../../../packages/extractor/src/domain/schema.js";
import type { HonoQuotationDraft } from "../../../packages/extractor/src/application/quotationTool.js";

const STAFF_TOKEN = "test-staff-token";
const savedToken = process.env.WHATSAPP_VERIFY_TOKEN;

/**
 * The seeded record's guest name and phone number, as `quotationStore.ts` writes them.
 *
 * These used to be a real guest's name and number, copied out of a live enquiry. They are
 * synthetic now, and these tests still assert the values do not appear in the unauthenticated
 * responses — the leak fix has to keep working whatever the seed contains, which is why the
 * assertions read from here rather than hardcoding a string.
 */
const SEED_PHONE = "639000000000";
const SEED_GUEST = "Sample Group";
const SEED_QUOTE_ID = "QT-1010-SKY";
const SEED_PII = [SEED_GUEST, SEED_PHONE, "Sample", "42,400", "42400", "QT-1010"];

beforeAll(() => {
  // The staff guard reuses the WhatsApp handoff secret, so configuring it here is what makes
  // the authorized cases reachable at all.
  process.env.WHATSAPP_VERIFY_TOKEN = STAFF_TOKEN;
});
afterAll(() => {
  if (savedToken === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
  else process.env.WHATSAPP_VERIFY_TOKEN = savedToken;
});

/**
 * `overrides` are whole `{value, state, evidence}` fields, not bare values — `divers: 2` would
 * silently produce `{value: undefined}` and the builder would then assume every guest dives.
 */
function makeTrip(overrides: Partial<Trip> = {}): Trip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  return {
    language: f("en", "default"),
    contactName: f("Sky"),
    checkIn: f("2026-10-10"),
    checkOut: f("2026-10-12"),
    nights: f(2),
    guests: f(4),
    rooms: f(2),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none", "default"),
    diver: f(true),
    divers: f(null, "missing"),
    diveNotes: f(null, "missing"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
    ...overrides,
  } as Trip;
}

/** A Trip whose dive head count is stated, so only some guests carry dive days. */
function tripWithStatedDivers(count: number): Trip {
  return makeTrip({ divers: { value: count, state: "stated", evidence: `${count} divers` } });
}

describe("guest quotation slug is a credential", () => {
  it("is not derived from the guest's own name or dates", () => {
    const draft = buildHonoQuotationDraft(makeTrip(), undefined, undefined, "639171234567");

    // The old slug was `quoteId.toLowerCase()`, i.e. "qt-1010-sky-<2 chars>": guessable by
    // anyone who knows the guest's name, and only ~1,300 possibilities on the random part.
    expect(draft.slug.toLowerCase()).not.toContain("sky");
    expect(draft.slug.toLowerCase()).not.toContain("qt-1010");
    expect(draft.slug.length).toBeGreaterThanOrEqual(20);
  });

  it("is different every time, so one leak cannot be replayed against another booking", () => {
    const a = buildHonoQuotationDraft(makeTrip());
    const b = buildHonoQuotationDraft(makeTrip());
    expect(a.slug).not.toBe(b.slug);
  });

  it("carries enough entropy to be unguessable — a UUID, not a 3-character suffix", () => {
    const draft = buildHonoQuotationDraft(makeTrip());
    // UUID shape: 8-4-4-4-12 hex. Collisions across bookings are what enumeration needs.
    expect(draft.slug).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("keeps the slug stable for an existing quote, so a sent link does not break", () => {
    const first = buildHonoQuotationDraft(makeTrip());
    const reopened = buildHonoQuotationDraft(makeTrip(), undefined, first.quoteId);
    // The id is supplied, so the slug would be regenerated — the caller must pass through the
    // existing draft to preserve it. This pins that the tool does not silently reuse a name
    // derived from the id.
    expect(reopened.quoteId).toBe(first.quoteId);
    expect(reopened.slug).not.toContain("sky");
  });
});

describe("an unknown quotation is a miss, not somebody's booking", () => {
  it("does not answer a made-up slug with the newest quotation", async () => {
    const app = createApp();
    const res = await app.request("/q/made-up-slug-xyz");

    // This exact request returned 200 and a full quotation on production.
    expect(res.status).toBe(404);
    const body = await res.text();
    for (const leak of SEED_PII) {
      expect(body, `an unknown slug leaked ${leak}`).not.toContain(leak);
    }
  });

  it("does not synthesize a quotation for a plausible-looking QT- id", async () => {
    const app = createApp();
    // The old code cloned the seeded record for ANY /^QT-/ input, so guessing the id format
    // was enough. 404 is the only acceptable answer here.
    const res = await app.request("/q/QT-1010-ANYONE-ABC");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(SEED_GUEST);
  });

  it("returns undefined from the lookup rather than falling back", async () => {
    expect(await getQuotationByIdOrSlug("nope")).toBeUndefined();
    expect(await getQuotationByIdOrSlug("QT-9999-NOBODY-XYZ")).toBeUndefined();
  });

  it("serves nothing at all from a slug — the guest page is retired", async () => {
    // This route used to render our own quotation page: a hand-copied price, shown to whoever held
    // the slug, with no staff approval anywhere. A published quotation forwards to the customer's
    // app instead, and an unpublished one has nothing to show — 410, and never a figure.
    const app = createApp();
    const unpublished = await saveQuotationDraft({
      ...buildHonoQuotationDraft(makeTrip()),
      quoteId: "QT-0000-UNPUBLISHED-AAA",
      slug: randomUUID(),
    });
    const res = await app.request(`/q/${unpublished.slug}`);

    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).not.toContain(unpublished.quoteId);
    expect(body).not.toContain("Total");
  });

  it("forwards a published quotation to the link the customer's app minted", async () => {
    // Its own record, not the seed: publishing mutates the stored draft, and the seed is shared
    // with every other test in this file.
    const app = createApp();
    const published = await saveQuotationDraft({
      ...buildHonoQuotationDraft(makeTrip()),
      quoteId: "QT-0000-PUBLISHED-AAA",
      slug: randomUUID(),
      estimator: {
        id: "sim-1",
        cookie: "ubg_sid=sim-1",
        seq: 1,
        guestUrl: "https://quotes.customer.test/quote/tok123",
        sharedAt: new Date().toISOString(),
      },
    });

    const res = await app.request(`/q/${published.slug}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://quotes.customer.test/quote/tok123");
  });

  // The copy we serve when their link does not open (see `mirrorUrl`). Its "reply on WhatsApp" button
  // used to be `https://wa.me/?text=…` — no number — which opens WhatsApp on an empty "choose a chat"
  // screen. A guest-facing button that goes nowhere is worse than no button.
  describe("our copy of a published quotation", () => {
    /** The engine's answer, as `sync-estimate` would have stored it. Revenue is a real figure here. */
    const engineAnswer = (revenue: number, sample = false) => ({
      source: "remote" as const,
      sample,
      mode: "fixture",
      role: "guest",
      computedAt: "2026-09-28T00:00:00.000Z",
      guests: [],
      catRev: { room: revenue },
      kpis: { revenue, guests: 2, nights: 2, discounts: null, rpgn: revenue / 4 },
      warnings: [],
      retail: null,
      ops: null,
    });

    async function mirroredCopy(overrides: Partial<HonoQuotationDraft> = {}) {
      return saveQuotationDraft({
        ...buildHonoQuotationDraft(makeTrip()),
        quoteId: "QT-0000-MIRROR-AAA",
        slug: randomUUID(),
        status: "confirmed_by_hono",
        phone: "639171234567",
        pricing: engineAnswer(31200),
        sentToGuestAt: "2026-09-28T00:00:00.000Z",
        estimator: {
          id: "sim-9",
          cookie: "ubg_sid=sim-9",
          seq: 1,
          guestUrl: "https://quotes.customer.test/quote/tok999",
          sharedAt: new Date().toISOString(),
          mirrorUrl: "http://localhost/q/QT-0000-MIRROR-AAA",
          mirrorReason: "the booking app did not recognise the link it had just issued",
        },
        ...overrides,
      });
    }

    it("offers no reply button when this deployment has no resort number", async () => {
      const saved = await mirroredCopy();
      const app = createApp();

      const html = await (await app.request(`/q/${saved.slug}`)).text();
      expect(html).not.toContain("wa.me/?text=");
      expect(html).not.toContain("wa.me/");
      // …and says what to do instead, rather than leaving a dead end.
      expect(html).toContain("Reply in the WhatsApp conversation");
    });

    it("links straight to the resort's number when one is configured", async () => {
      vi.stubEnv("RESORT_WHATSAPP_NUMBER", "+1 (555) 150-6595");
      const saved = await mirroredCopy();
      const app = createApp();

      const html = await (await app.request(`/q/${saved.slug}`)).text();
      expect(html).toContain("https://wa.me/15551506595?text=");
      vi.unstubAllEnvs();
    });

    it("states the booking terms it can source, and no term it cannot", async () => {
      // The deposit and the balance are the resort's own published terms (their rate card carries
      // `terms.depositPct: 50`, and their site states both). The room hold and the first-come rule are
      // not: nothing in this service holds inventory, and "first-come, first-served" is published
      // about parking. Both were on this page in the first version of the feature.
      const saved = await mirroredCopy();
      const app = createApp();

      const html = await (await app.request(`/q/${saved.slug}`)).text();
      // The customer's tool says one thing here: the front desk confirms availability. No deposit.
      expect(html).toContain("The front desk will confirm availability and contact you.");
      expect(html).not.toContain("Deposit Policy");
      expect(html.toLowerCase()).not.toContain("down payment");
      expect(html.toLowerCase()).not.toContain("first-come");
    });

    /**
     * The page's own promise, from the top of `guestQuotationCopy.ts`: *"renders `draft.pricing` — the
     * ENGINE's own answer… No arithmetic of ours, no rounding: if a number is on this page, the engine
     * said it."*
     *
     * These are the tests that hold it to that. The previous version of this file checked for the
     * words "room hold" and "first-come" while the page said **"Provisional 72-Hour Hold Active"** with
     * a live countdown, printed a **deposit it computed by halving the total**, and offered a currency
     * dropdown that converted the total at a rate typed into the source file. Every one of those
     * passed the old assertions, because a test that looks for one string cannot notice a page that
     * invents a different one.
     */
    it("prints no money the engine did not say", async () => {
      const saved = await mirroredCopy();
      const app = createApp();

      const html = await (await app.request(`/q/${saved.slug}`)).text();
      // The engine's figure is there…
      expect(html).toContain("₱31,200");
      // …and the halved deposit / balance are not, in any form.
      expect(html).not.toContain("15,600");
      expect(html).not.toContain("15.600");
      expect(html).not.toContain("Deposit Due");
      expect(html).not.toContain("Balance Remaining");
      expect(html).not.toContain("Payment Schedule");
      expect(html).not.toContain("Secures room");
    });

    it("promises no hold on a room, in any wording", async () => {
      const saved = await mirroredCopy();
      const app = createApp();

      const html = await (await app.request(`/q/${saved.slug}`)).text();
      // Not "room hold", not "72-Hour Hold", not a countdown — the word, wherever it appears.
      expect(html.toLowerCase()).not.toContain("hold");
      expect(html.toLowerCase()).not.toContain("countdown");
      expect(html).not.toContain("id=\"countdown-val\"");
      expect(html).not.toContain("id=\"hold-active-box\"");
    });

    it("converts nothing: the currency the engine priced in is the currency printed", async () => {
      // A quotation the engine priced in USD was rendered with a peso sign (the symbol map only knew
      // USD), and choosing EUR multiplied those dollars by 0.016. There is no converter left to get
      // this wrong: no rate table, no dropdown, and the symbol follows `draft.currency`.
      const usd = await mirroredCopy({
        quoteId: "QT-0000-USD-AAA",
        currency: "USD",
        pricing: engineAnswer(1000),
      });
      const app = createApp();

      const html = await (await app.request(`/q/${usd.slug}`)).text();
      expect(html).toContain("$1,000");
      expect(html).not.toContain("₱");
      expect(html).not.toContain("convertCurrency");
      expect(html).not.toContain("currency-toggle");
      expect(html).not.toContain("0.018");
    });

    it("says nothing about payment, on a sample price or a real one", async () => {
      // Every price on a simulated deployment is a sample. Asking a guest to pay against an example
      // figure is the failure this page exists to make impossible.
      const sample = await mirroredCopy({
        quoteId: "QT-0000-SAMPLE-AAA",
        pricing: engineAnswer(31200, true),
      });
      const app = createApp();

      const html = await (await app.request(`/q/${sample.slug}`)).text();
      expect(html).toContain("Sample data");
      expect(html).not.toContain("Payment is arranged by our reservations team");
      expect(html).not.toContain("Deposit Due");

      // Nor on a real figure: the customer's tool takes no payment and states no deposit, so this page says
      // only what the front desk does next.
      const real = await mirroredCopy({ quoteId: "QT-0000-REAL-AAA" });
      const realHtml = await (await createApp().request(`/q/${real.slug}`)).text();
      expect(realHtml).not.toContain("Payment is arranged by our reservations team");
      expect(realHtml.toLowerCase()).not.toContain("account to use");
      expect(realHtml).toContain("The front desk will confirm availability and contact you.");
    });
  });
});

describe("staff quotation routes require the staff token", () => {
  const staffOnlyJson: Array<[string, string]> = [
    ["GET", "/v1/quotes"],
    ["GET", "/v1/quotes/estimator-status"],
    ["GET", `/v1/quotes/${SEED_QUOTE_ID}`],
    ["PUT", `/v1/quotes/${SEED_QUOTE_ID}`],
    ["POST", `/v1/quotes/${SEED_QUOTE_ID}/confirm`],
  ];

  it.each(staffOnlyJson)("%s %s is 401 without the token", async (method, path) => {
    const app = createApp();
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
  });

  // The studio is a PAGE, so an unauthenticated visitor is sent to the demo sign-in form rather
  // than a bare 401 they cannot act on. The JSON API above still fails closed with 401 — the two
  // surfaces answer differently on purpose.
  const staffOnlyPages: Array<[string, string]> = [
    ["GET", "/quotes"],
    ["GET", `/quotes/${SEED_QUOTE_ID}`],
  ];

  it.each(staffOnlyPages)("%s %s redirects to /login without a session", async (method, path) => {
    const app = createApp();
    const res = await app.request(path, { method });
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("does not leak guest PII in the 401 body", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes");
    const body = await res.text();
    for (const leak of [...SEED_PII, "guestName"]) {
      expect(body).not.toContain(leak);
    }
  });

  it("rejects a wrong token as firmly as a missing one", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes", { headers: { "x-verify-token": "not-it" } });
    expect(res.status).toBe(401);
  });

  // The queue carried every record it had, always, and the studio filtered the array in the browser:
  // fine for the ten rows a demo has, wrong for a list that only grows and carries guest names and
  // phone numbers. The filter and the cap now live on the server.
  describe("the queue is filtered where the data is", () => {
    async function threeRecords() {
      const make = (quoteId: string, extra: Partial<HonoQuotationDraft>) =>
        saveQuotationDraft({
          ...buildHonoQuotationDraft(makeTrip()),
          quoteId,
          slug: randomUUID(),
          ...extra,
        });
      await make("QT-QUEUE-ANA", { guestName: "Ana Reyes", status: "pending_hono_review", phone: "639170000001" });
      await make("QT-QUEUE-BEN", { guestName: "Ben Cruz", status: "confirmed_by_hono", phone: "639170000002" });
      await make("QT-QUEUE-CAT", { guestName: "Cat Lim", status: "cancelled", phone: "639170000003" });
    }

    const ids = async (query: string) => {
      const app = createApp();
      const body = await (await app.request(`/v1/quotes${query}`)).json();
      return body.quotations.map((q: { quoteId: string }) => q.quoteId);
    };

    it("filters by the studio's own filter names", async () => {
      await threeRecords();
      // Containment plus exclusion rather than equality: the store is one instance for this file, so
      // other cases' records are in the queue too — which is exactly the situation the cap is for.
      const needsReview = await ids(`?status=needs-review&token=${STAFF_TOKEN}`);
      expect(needsReview).toContain("QT-QUEUE-ANA");
      expect(needsReview).not.toContain("QT-QUEUE-BEN");
      expect(needsReview).not.toContain("QT-QUEUE-CAT");

      expect(await ids(`?status=cancelled&token=${STAFF_TOKEN}`)).toEqual(["QT-QUEUE-CAT"]);

      const approved = await ids(`?status=approved&token=${STAFF_TOKEN}`);
      expect(approved).toContain("QT-QUEUE-BEN");
      expect(approved).not.toContain("QT-QUEUE-ANA");
      expect(approved).not.toContain("QT-QUEUE-CAT");
    });

    it("searches the fields staff actually search by", async () => {
      await threeRecords();
      expect(await ids(`?q=ana&token=${STAFF_TOKEN}`)).toEqual(["QT-QUEUE-ANA"]);
      expect(await ids(`?q=639170000003&token=${STAFF_TOKEN}`)).toEqual(["QT-QUEUE-CAT"]);
      expect(await ids(`?q=QT-QUEUE-BEN&token=${STAFF_TOKEN}`)).toEqual(["QT-QUEUE-BEN"]);
    });

    it("caps what it returns and says how much it did not return", async () => {
      await threeRecords();
      const app = createApp();
      const res = await (await app.request(`/v1/quotes?limit=2&token=${STAFF_TOKEN}`)).json();
      expect(res.quotations).toHaveLength(2);
      expect(res.returned).toBe(2);
      expect(res.total).toBeGreaterThan(2);
    });
  });

  // The pre-flight the studio reads when it opens, so staff learn the state before clicking a
  // button that would otherwise answer 503 and leave them guessing.
  describe("GET /v1/quotes/estimator-status", () => {
    it("says not-configured when ESTIMATOR_BASE_URL is unset, without probing anything", async () => {
      const saved = process.env.ESTIMATOR_BASE_URL;
      delete process.env.ESTIMATOR_BASE_URL;
      const fetchImpl = vi.fn();
      try {
        const app = createApp({ estimator: createEstimatorClient({ fetchImpl: fetchImpl as never }) });
        const res = await app.request(`/v1/quotes/estimator-status?token=${STAFF_TOKEN}`);

        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.configured).toBe(false);
        expect(body.baseUrl).toBeNull();
        expect(String(body.detail)).toMatch(/ESTIMATOR_BASE_URL is not set/);
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        if (saved !== undefined) process.env.ESTIMATOR_BASE_URL = saved;
      }
    });

    it("reports fixture mode, so staff are warned the prices are captured", async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, mode: "fixture" }), { status: 200 }));
      const app = createApp({
        estimator: createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never }),
      });

      const res = await app.request(`/v1/quotes/estimator-status?token=${STAFF_TOKEN}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.configured).toBe(true);
      expect(body.reachable).toBe(true);
      expect(body.mode).toBe("fixture");
      expect(String(body.detail)).toMatch(/FIXTURE/);
    });

    it("reports unreachable rather than failing when nothing answers", async () => {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError("fetch failed");
      });
      const app = createApp({
        estimator: createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never }),
      });

      const res = await app.request(`/v1/quotes/estimator-status?token=${STAFF_TOKEN}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.configured).toBe(true);
      expect(body.reachable).toBe(false);
    });
  });

  // The studio is a PAGE whose own fetch calls run from a browser that has no reason to hold a
  // shared secret. Guarding these routes with a header alone 401'd the studio's own buttons —
  // the leak fix broke the tool it was protecting. The token therefore also travels in the query,
  // which is how a staff link already arrives.
  describe("the studio page can still reach its own guarded routes", () => {
    it("accepts the token in the query string", async () => {
      const app = createApp();
      for (const path of ["/v1/quotes", "/quotes"]) {
        const res = await app.request(`${path}?token=${STAFF_TOKEN}`);
        expect(res.status, `${path} rejected a query token`).toBe(200);
      }
    });

    it("still rejects a wrong query token", async () => {
      const app = createApp();
      expect((await app.request("/v1/quotes?token=wrong")).status).toBe(401);
      expect((await app.request("/v1/quotes?token=")).status).toBe(401);
    });

    it("serves the studio page, which carries the token on every call it makes", async () => {
      const app = createApp();
      const res = await app.request(`/quotes?token=${STAFF_TOKEN}`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // Every guarded call the page makes has to carry the token, or that button 401s for staff.
      // The URL is built by concatenation, so capture up to the comma that ends the argument.
      const calls = html.match(/fetch\('\/v1\/quotes\/[^,]*/g) ?? [];
      expect(calls.length).toBeGreaterThanOrEqual(4); // save, confirm, send-whatsapp, sync-estimate
      for (const call of calls) {
        expect(call, `${call} does not carry the staff token`).toContain("token=");
      }
      // …and the page must be able to find it.
      expect(html).toContain("staffToken()");
      expect(html).toContain("/sync-estimate?token=");
    });

    // The guest page is retired (Đợt 1): a quotation is only ever read on the customer's own app,
    // behind the link their app minted. So what these now assert is the stronger property — nothing
    // about a quotation is served from this service to an unauthenticated caller at all.
    it("serves nothing about a quotation publicly, not even the staff token's absence", async () => {
      const app = createApp();
      const quotation = await saveQuotationDraft({
        ...buildHonoQuotationDraft(makeTrip()),
        quoteId: "QT-0000-QUIET-AAA",
        slug: randomUUID(),
      });
      const res = await app.request(`/q/${quotation.slug}`);

      expect(res.status).toBe(410);
      const body = await res.text();
      expect(body).not.toContain("token=");
      expect(body).not.toContain(STAFF_TOKEN);
      expect(body).not.toContain("staffToken");
      expect(body).not.toContain(quotation.quoteId);
      expect(body).not.toContain(quotation.guestName);
    });

    it("offers the guest no route into the staff studio", async () => {
      const app = createApp();
      const built = await saveQuotationDraft(buildHonoQuotationDraft(makeTrip()));
      const res = await app.request(`/q/${built.slug}`);
      const body = await res.text();

      expect(res.status).toBe(410);
      expect(body).not.toContain("/quotes/");
      expect(body).not.toContain("Edit Table");
    });

    // `staffNotes` reaches the customer twice: on their quotation page in the customer's app, and
    // in the message this service sends once staff publish. The message is the half we still own,
    // so that is where the wording is pinned — the studio's own editable field is staff-facing and
    // legitimately shows the raw value, so someone can fix it.
    it("ships no internal workflow wording by default", async () => {
      const built = await saveQuotationDraft(buildHonoQuotationDraft(makeTrip()));
      expect(built.staffNotes).toBe("");

      const message = await synthesizeConfirmedQuotationReply(built);
      expect(message).not.toContain("ready for Hono confirmation");
      expect(message).not.toContain("Verify boat manifest");
      // No published link yet, and the message says so rather than falling back to our own retired
      // `/q/<slug>` page — which answers 410. The route refuses to send in this state; the builder
      // never invents a link.
      expect(built.estimator?.guestUrl ?? null).toBeNull();
      expect(message).not.toContain(built.quotationUrl);
      // Worded for the screen it appears on: this text is the APPROVAL preview, so it says the link
      // is added at send time rather than that the quotation "has not been published yet" — which
      // reads as a fault to the person approving it.
      expect(message).toContain("added when you send");
    });

    // Fixing the default is not enough on its own: a draft saved before the fix keeps whatever note
    // it was saved with, and those records are still sent to customers.
    it("drops the legacy internal note already stored on an old draft", async () => {
      const built = await saveQuotationDraft({
        ...buildHonoQuotationDraft(makeTrip()),
        quoteId: "QT-0000-LEGACYNOTE-AAA",
        slug: randomUUID(),
        staffNotes: "Standard resort quotation draft ready for Hono confirmation.",
      });

      const message = await synthesizeConfirmedQuotationReply(built);
      expect(message).not.toContain("ready for Hono confirmation");
      expect(message).not.toContain("Resort Note");
    });

    it("still prints a genuine resort note to the guest", async () => {
      const built = await saveQuotationDraft({
        ...buildHonoQuotationDraft(makeTrip()),
        quoteId: "QT-0000-REALNOTE-AAA",
        slug: randomUUID(),
        staffNotes: "Boat leaves at 7am; please be at the dive shop by 6:45.",
      });

      const message = await synthesizeConfirmedQuotationReply(built);
      expect(message).toContain("Boat leaves at 7am");
    });

    it("greets the guest once, not twice, when a model writes the opening", async () => {
      // Read from production on 2026-09-28, from the body the send route returned: the message began
      // "Hi Ana Reyes! It's a pleasure to help you start planning…" and then the block said
      // "Hi Ana Reyes!" again. The greeting belongs to whoever writes it — the model when there is
      // one, and the deterministic fallback when there is not.
      const built = await saveQuotationDraft({
        ...buildHonoQuotationDraft(makeTrip()),
        quoteId: "QT-0000-GREETING-AAA",
        slug: randomUUID(),
        guestName: "Ana",
        status: "confirmed_by_hono",
        estimator: {
          id: "sim-greet",
          cookie: null,
          seq: 1,
          guestUrl: "https://their-app.test/quote/live",
          sharedAt: new Date().toISOString(),
        },
      });

      // What the fallback says, minus its own salutation: exactly what a model is asked to append.
      const fallback = await synthesizeConfirmedQuotationReply(built);
      expect(fallback.startsWith("Hi Ana! ")).toBe(true);
      const block = fallback.slice("Hi Ana! ".length);

      const withModel = await synthesizeConfirmedQuotationReply(built, {
        id: "fake:greeting",
        call: async () => ({ raw: {}, tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, ms: 1 }),
        generateText: async () => `Hi Ana! Lovely to hear from you — the team has put your quotation together.\n\n${block}`,
      } as never);

      expect((withModel.match(/Hi Ana/g) ?? []).length).toBe(1);
      // …and the message is still the whole thing: the link, and the terms nobody may drop.
      expect(withModel).toContain("https://their-app.test/quote/live");
      expect(withModel).toContain("nothing is booked yet");
      expect(withModel.toLowerCase()).not.toContain("down payment");
    });
  });

  it("fails closed when no token is configured, rather than opening the routes", async () => {
    const configured = process.env.WHATSAPP_VERIFY_TOKEN;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    try {
      const app = createApp();
      expect((await app.request("/v1/quotes")).status).toBe(401);
      // An empty header must not match an unset secret either.
      expect((await app.request("/v1/quotes", { headers: { "x-verify-token": "" } })).status).toBe(401);
    } finally {
      process.env.WHATSAPP_VERIFY_TOKEN = configured;
    }
  });

  it("lets staff through with the token", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes", { headers: { "x-verify-token": STAFF_TOKEN } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quotations: unknown[] };
    expect(Array.isArray(body.quotations)).toBe(true);
  });
});

describe("/v1/quotes/compute is a staff route and reads nothing stored", () => {
  it("refuses a caller with no session", async () => {
    const res = await createApp().request("/v1/quotes/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: makeTrip() }),
    });
    expect(res.status).toBe(401);
  });

  it("prices a trip for staff", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes/compute", {
      method: "POST",
      headers: { "content-type": "application/json", "x-verify-token": STAFF_TOKEN },
      body: JSON.stringify({ trip: makeTrip() }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; computed: { lineItems: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.computed.lineItems.length).toBeGreaterThan(0);
  });

  it("cannot be used to read a stored quotation by naming its id", async () => {
    const app = createApp();
    const real = (await listQuotations())[0]!;
    const res = await app.request("/v1/quotes/compute", {
      method: "POST",
      headers: { "content-type": "application/json", "x-verify-token": STAFF_TOKEN },
      // The old endpoint looked this id up and returned the stored quotation, PII included.
      body: JSON.stringify({ draft: { quoteId: real.quoteId } }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(SEED_PHONE);
  });

  it("prices caller-supplied line items without consulting the store", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes/compute", {
      method: "POST",
      headers: { "content-type": "application/json", "x-verify-token": STAFF_TOKEN },
      body: JSON.stringify({
        draft: {
          lineItems: [
            {
              id: "custom-1",
              category: "custom",
              description: "Airport van",
              quantity: 1,
              unitLabel: "van",
              multiplier: 2,
              multiplierLabel: "trips",
              unitPrice: 2500,
              subtotal: 0,
            },
          ],
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      computed: { subtotalAmount: number; quoteId: string };
    };
    // 1 x 2 x 2500, computed from the request alone.
    expect(body.computed.subtotalAmount).toBe(5000);
    expect(body.computed.quoteId).not.toBe((await listQuotations())[0]!.quoteId);
  });

  it("never echoes a stored guest's phone number", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes/compute", {
      method: "POST",
      headers: { "content-type": "application/json", "x-verify-token": STAFF_TOKEN },
      body: JSON.stringify({ trip: makeTrip() }),
    });
    expect(await res.text()).not.toContain(SEED_PHONE);
  });
});

/**
 * `buildBffTrip()` and `validateBffTripPrecheck()` were correct and tested, but nothing
 * Odoo-bound carried their result: the send path is driven from a `HonoQuotationDraft`, and
 * that draft had no column for `guestType`, `transportType`, `diveFrom`/`diveTo` or per-guest
 * `days`. So the whole BFF contract was validated on paper and absent from every request that
 * reached Odoo.
 *
 * These tests pin the wiring, not the builder — the builder has its own suite, and the client
 * has `estimatorClient.test.ts`.
 */
describe("the validated BFF Trip reaches the Odoo-bound envelope", () => {
  it("builds it where the full extraction Trip is still available", () => {
    const draft = buildHonoQuotationDraft(makeTrip());
    // The draft is lossy on purpose; `bffTrip` is what carries what the draft drops.
    expect(draft.bffTrip, "buildHonoQuotationDraft() dropped the BFF Trip").toBeDefined();
    expect(draft.bffTrip!.guestType).toBe("retail");
    expect(draft.bffTrip!.checkIn).toBe("2026-10-10");
    expect(draft.bffTrip!.checkOut).toBe("2026-10-12");
  });

  it("narrows an out-of-contract guestType to the contract's default", () => {
    // "regular" is not one of the three values the contract accepts, and the AI tool
    // description used to offer it by name. The zod gate rejects it before it reaches here,
    // but `buildBffTrip` is exported and any caller can hand it a Trip-shaped object — and an
    // unrecognised guestType reaches Odoo as neither a partner rate nor its own default.
    const trip = makeTrip();
    const odd = { ...trip, guestType: { value: "regular", state: "stated" as const, evidence: null } };
    expect(buildBffTrip(odd as Trip).guestType).toBe("retail");
    // A real partner rate still comes through untouched: the agency discount depends on it.
    const agent = { ...trip, guestType: { value: "agent", state: "stated" as const, evidence: null } };
    expect(buildBffTrip(agent as Trip).guestType).toBe("agent");
  });

  it("carries per-guest facts the flattened draft cannot express", () => {
    // `divers: 2` because that is what makes one guest a diver and three not; with no stated
    // head count the builder assumes everyone dives, which is the conservative reading.
    const bff = buildHonoQuotationDraft(tripWithStatedDivers(2)).bffTrip!;

    // The reason the BFF shape exists at all:
    // `HonoQuotationDraft` exposes only `stayingGuests` and `divers`.
    expect(bff.guests).toHaveLength(4);
    const roomIds = new Set(bff.rooms.map((r) => r.id));
    for (const g of bff.guests) {
      expect(typeof g.diver).toBe("boolean");
      expect(roomIds.has(g.roomId!)).toBe(true);
      if (g.diver) expect(Object.keys(g.days).length).toBeGreaterThan(0);
    }
    expect(bff.guests.filter((g) => g.diver)).toHaveLength(2);
    expect(bff.guests.filter((g) => !g.diver)).toHaveLength(2);
  });

  it("passes its own pre-flight, so Odoo would not 422 it", () => {
    const bff = buildHonoQuotationDraft(makeTrip()).bffTrip!;
    expect(validateBffTripPrecheck(bff)).toEqual([]);
  });

  it("rides along on the response the sync endpoint returns", async () => {
    // Inject the client so this test does not depend on a BFF being up: the point here is the
    // ROUTE (staff guard, draft lookup, status mapping, preview), not the HTTP client, which has
    // its own suite.
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const app = createApp({ estimator: createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never }) });
    // Sync a quotation that came from an extraction Trip, which is the only way to have a
    // `bffTrip` at all. The hand-written seed record is not one: it was typed into
    // quotationStore.ts rather than built from a Trip, so it correctly has none — see the
    // next test, which pins that it reports null instead of inventing one.
    const built = buildHonoQuotationDraft(tripWithStatedDivers(2));
    await saveQuotationDraft(built);

    const res = await app.request(`/v1/quotes/${built.quoteId}/sync-estimate`, {
      method: "POST",
      headers: { "x-verify-token": STAFF_TOKEN },
    });

    // The client was reached and tried to send; the network refused. Infrastructure, so 502.
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      ok: boolean;
      reason?: string;
      estimatePreview: {
        endpoint: string;
        body: string | null;
        bffTrip: { guests: unknown[]; checkIn: string; guestType: string } | null;
        validationIssues: unknown[];
        localTotals: { total: number };
      };
    };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("unreachable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The body that would be POSTed is the `{trip}` envelope, and it is our validated Trip.
    expect(body.estimatePreview.bffTrip).not.toBeNull();
    expect(body.estimatePreview.bffTrip!.guests.length).toBeGreaterThan(0);
    expect(body.estimatePreview.validationIssues).toEqual([]);
    const sent = JSON.parse(body.estimatePreview.body!) as { trip: { checkIn: string } };
    expect(sent.trip.checkIn).toBe("2026-10-10");
    // Amounts stay local: they are Odoo's to compute, not ours to assert.
    expect(body.estimatePreview.endpoint).toContain("/api/estimates");
    expect(body.estimatePreview.localTotals.total).toBeGreaterThan(0);
    expect(body.estimatePreview.body).not.toContain("subtotal");
  });

  it("maps a rejection from their validator to 422 and names the fields", async () => {
    // The outcome this whole integration exists to surface: their `fillTrip` is the authority,
    // and a rejection means WE sent something wrong.
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "missing mandatory", fields: ["transportType"] }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    );
    const app = createApp({ estimator: createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never }) });
    const built = buildHonoQuotationDraft(tripWithStatedDivers(2));
    await saveQuotationDraft(built);

    const res = await app.request(`/v1/quotes/${built.quoteId}/sync-estimate`, {
      method: "POST",
      headers: { "x-verify-token": STAFF_TOKEN },
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { reason: string; fields: string[] };
    expect(body.reason).toBe("rejected");
    expect(body.fields).toEqual(["transportType"]);
  });

  it("reports `bffTrip: null` rather than inventing one for a draft that never had a Trip", async () => {
    const app = createApp();
    // Each test saves its own record rather than leaning on the shared seed: the suite runs
    // against one module-level store, so an earlier test's draft would otherwise decide what
    // this one sees.
    const built = buildHonoQuotationDraft(tripWithStatedDivers(2));
    // A hand-written / line-items-only record: no `bffTrip`, exactly like the seed.
    const { bffTrip: _dropped, ...withoutTrip } = built;
    const handwritten = await saveQuotationDraft({
      ...recalculateQuotationTotals(withoutTrip as HonoQuotationDraft),
      quoteId: "QT-0000-NOTRIP-AAA",
      slug: randomUUID(),
    });
    expect(handwritten.bffTrip).toBeUndefined();

    const res = await app.request(`/v1/quotes/${handwritten.quoteId}/sync-estimate`, {
      method: "POST",
      headers: { "x-verify-token": STAFF_TOKEN },
    });

    const body = (await res.json()) as {
      ok: boolean;
      reason: string;
      estimatePreview: { bffTrip: unknown; body: string | null; validationIssues: unknown[] };
    };
    // Refused before the network: there is nothing to send, and inventing a payload to satisfy
    // the contract is exactly the failure mode the contract exists to prevent.
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("no_validated_trip");
    expect(body.estimatePreview.bffTrip).toBeNull();
    expect(body.estimatePreview.body).toBeNull();
    expect(body.estimatePreview.validationIssues).toEqual([]);
  });

  it("says `bffTrip: null` rather than inventing one for a line-items-only draft", () => {
    // A draft priced from raw lineItems was never an extraction result, so it has no
    // guest-level facts. Reporting null is honest; synthesising a guess is not.
    const { bffTrip: _omitted, ...withoutTrip } = buildHonoQuotationDraft(makeTrip());
    const app = createApp();
    return app
      .request("/v1/quotes/compute", {
        method: "POST",
        headers: { "content-type": "application/json", "x-verify-token": STAFF_TOKEN },
        body: JSON.stringify({ draft: { lineItems: withoutTrip.lineItems } }),
      })
      .then(async (r) => {
        const body = (await r.json()) as { computed: { bffTrip?: unknown } };
        expect(body.computed.bffTrip).toBeUndefined();
      });
  });
});
