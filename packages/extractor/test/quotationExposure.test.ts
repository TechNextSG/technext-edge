// The guest-facing quotation link is unauthenticated by design (staff paste it into
// WhatsApp), so the slug is the only thing between a URL and someone else's booking. This
// file pins both halves of that: a slug that cannot be guessed, and a miss that is a miss.
//
// It exists because the old behaviour was a live data leak, verified against the production
// deployment with no credential:
//
//   GET /q/made-up-slug-xyz  -> 200, an entire real quotation ("QT-1010-SKY", "Prepared for
//                               Sky", 10-12 Oct, 6 pax / 2 rooms, PHP 73,800)
//   GET /v1/quotes           -> 200, JSON including phone "84359386414" and guestName "Sky"
//
// Two root causes, both asserted below: `getQuotationByIdOrSlug` fell back to the newest
// quotation for anything unknown (and cloned the seeded record for any `/^QT-/` id), and the
// staff routes had no guard at all.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import {
  listQuotations,
  getQuotationByIdOrSlug,
  saveQuotationDraft,
} from "../../../apps/casa-bff/src/quotationStore.js";
import { buildHonoQuotationDraft, recalculateQuotationTotals } from "../../../packages/extractor/src/quotationTool.js";
import {
  validateBffTripPrecheck,
  buildBffTrip,
} from "../../../packages/extractor/src/odooHandoff.js";
import type { Trip } from "../../../packages/extractor/src/schema.js";
import type { HonoQuotationDraft } from "../../../packages/extractor/src/quotationTool.js";

const STAFF_TOKEN = "test-staff-token";
const savedToken = process.env.WHATSAPP_VERIFY_TOKEN;

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
    const draft = buildHonoQuotationDraft(makeTrip(), undefined, undefined, "84359386414");

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
    for (const leak of ["Sky", "84359386414", "73,800", "73800", "QT-"]) {
      expect(body, `an unknown slug leaked ${leak}`).not.toContain(leak);
    }
  });

  it("does not synthesize a quotation for a plausible-looking QT- id", async () => {
    const app = createApp();
    // The old code cloned the seeded record for ANY /^QT-/ input, so guessing the id format
    // was enough. 404 is the only acceptable answer here.
    const res = await app.request("/q/QT-1010-ANYONE-ABC");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Sky");
  });

  it("returns undefined from the lookup rather than falling back", () => {
    expect(getQuotationByIdOrSlug("nope")).toBeUndefined();
    expect(getQuotationByIdOrSlug("QT-9999-NOBODY-XYZ")).toBeUndefined();
  });

  it("still serves the real quotation to its own slug", async () => {
    const app = createApp();
    const real = listQuotations()[0]!;
    const res = await app.request(`/q/${real.slug}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(real.quoteId);
  });
});

describe("staff quotation routes require the staff token", () => {
  const staffOnly: Array<[string, string]> = [
    ["GET", "/v1/quotes"],
    ["GET", "/quotes"],
    ["GET", `/quotes/${listQuotations()[0]!.quoteId}`],
    ["GET", `/v1/quotes/${listQuotations()[0]!.quoteId}`],
    ["PUT", `/v1/quotes/${listQuotations()[0]!.quoteId}`],
    ["POST", `/v1/quotes/${listQuotations()[0]!.quoteId}/confirm`],
  ];

  it.each(staffOnly)("%s %s is 401 without the token", async (method, path) => {
    const app = createApp();
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
  });

  it("does not leak guest PII in the 401 body", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes");
    const body = await res.text();
    for (const leak of ["Sky", "84359386414", "guestName"]) {
      expect(body).not.toContain(leak);
    }
  });

  it("rejects a wrong token as firmly as a missing one", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes", { headers: { "x-verify-token": "not-it" } });
    expect(res.status).toBe(401);
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

describe("/v1/quotes/compute stays usable by the AI and reads nothing stored", () => {  it("prices a trip with no credential — the product depends on this", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: makeTrip() }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; computed: { lineItems: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.computed.lineItems.length).toBeGreaterThan(0);
  });

  it("cannot be used to read a stored quotation by naming its id", async () => {
    const app = createApp();
    const real = listQuotations()[0]!;
    const res = await app.request("/v1/quotes/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The old endpoint looked this id up and returned the stored quotation, PII included.
      body: JSON.stringify({ draft: { quoteId: real.quoteId } }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("84359386414");
  });

  it("prices caller-supplied line items without consulting the store", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    expect(body.computed.quoteId).not.toBe(listQuotations()[0]!.quoteId);
  });

  it("never echoes a stored guest's phone number", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: makeTrip() }),
    });
    expect(await res.text()).not.toContain("84359386414");
  });
});

/**
 * `buildBffTrip()` and `validateBffTripPrecheck()` were correct and tested, but nothing
 * Odoo-bound carried their result: `buildOdooGaisEnvelope` is called from handlers that only
 * hold a `HonoQuotationDraft`, and that draft has no column for `guestType`, `transportType`,
 * `diveFrom`/`diveTo` or per-guest `days`. So the whole BFF contract was validated on paper
 * and absent from every request that reached Odoo.
 *
 * These tests pin the wiring, not the builder — the builder has its own suite.
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

  it("rides along on the envelope the sync endpoint returns", async () => {
    const app = createApp();
    // Sync a quotation that came from an extraction Trip, which is the only way to have a
    // `bffTrip` at all. The hand-written seed record is not one: it was typed into
    // quotationStore.ts rather than built from a Trip, so it correctly has none — see the
    // next test, which pins that it reports null instead of inventing one.
    const built = buildHonoQuotationDraft(tripWithStatedDivers(2));
    saveQuotationDraft(built);

    const res = await app.request(`/v1/quotes/${built.quoteId}/sync-odoo`, {
      method: "POST",
      headers: { "x-verify-token": STAFF_TOKEN },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gaisContract: {
        bffTrip: { guests: unknown[]; checkIn: string; guestType: string } | null;
        bffValidationIssues: unknown[];
        payload: { model: string };
      };
    };
    // The envelope still carries the signed human-readable payload…
    expect(body.gaisContract.payload.model).toBe("sale.order");
    // …and now the contract shape Odoo prices from, with no validation errors.
    expect(body.gaisContract.bffTrip).not.toBeNull();
    expect(body.gaisContract.bffTrip!.guests.length).toBeGreaterThan(0);
    expect(body.gaisContract.bffValidationIssues).toEqual([]);
  });

  it("reports `bffTrip: null` rather than inventing one for a draft that never had a Trip", async () => {
    const app = createApp();
    // Each test saves its own record rather than leaning on the shared seed: the suite runs
    // against one module-level store, so an earlier test's draft would otherwise decide what
    // this one sees.
    const built = buildHonoQuotationDraft(tripWithStatedDivers(2));
    // A hand-written / line-items-only record: no `bffTrip`, exactly like the seed.
    const { bffTrip: _dropped, ...withoutTrip } = built;
    const handwritten = saveQuotationDraft({
      ...recalculateQuotationTotals(withoutTrip as HonoQuotationDraft),
      quoteId: "QT-0000-NOTRIP-AAA",
      slug: randomUUID(),
    });
    expect(handwritten.bffTrip).toBeUndefined();

    const res = await app.request(`/v1/quotes/${handwritten.quoteId}/sync-odoo`, {
      method: "POST",
      headers: { "x-verify-token": STAFF_TOKEN },
    });

    const body = (await res.json()) as {
      gaisContract: { bffTrip: unknown; bffValidationIssues: unknown[] };
    };
    // Honest null: this record has no extraction facts to carry, and synthesising a guess is
    // exactly the failure mode the contract exists to prevent.
    expect(body.gaisContract.bffTrip).toBeNull();
    expect(body.gaisContract.bffValidationIssues).toEqual([]);
  });

  it("says `bffTrip: null` rather than inventing one for a line-items-only draft", () => {
    // A draft priced from raw lineItems was never an extraction result, so it has no
    // guest-level facts. Reporting null is honest; synthesising a guess is not.
    const { bffTrip: _omitted, ...withoutTrip } = buildHonoQuotationDraft(makeTrip());
    const app = createApp();
    return app
      .request("/v1/quotes/compute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft: { lineItems: withoutTrip.lineItems } }),
      })
      .then(async (r) => {
        const body = (await r.json()) as { computed: { bffTrip?: unknown } };
        expect(body.computed.bffTrip).toBeUndefined();
      });
  });
});
