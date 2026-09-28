// Editing the trip behind a quotation, before it is published.
//
// The estimator's answer is only as right as the `BffTrip` it was handed, and that payload comes
// from a WhatsApp conversation — so the facts a chat cannot place (which room a guest is in, what
// type it is, who dives which day, who needs a course) have to be correctable by a person. The
// whole point of routing the correction through the ENGINE again, rather than through a hand-typed
// price, is that there stays exactly one source of the number on the guest's link.
//
// These tests are therefore about two things at once: that an edit really changes what the engine
// charges (the deluxe-room case is ₱3,600 a night, and the simulated port prices it), and that an
// edit cannot leave the quotation approved, published, or holding a second engine scenario.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { createEstimatorClient } from "../../../apps/casa-bff/src/estimatorClient.js";
import { buildHonoQuotationDraft } from "../../../packages/extractor/src/quotationTool.js";
import { saveQuotationDraft } from "../../../apps/casa-bff/src/quotationStore.js";
import { buildBffTrip } from "../../../packages/extractor/src/odooHandoff.js";
import type { BffTrip, Trip } from "../../../packages/extractor/src/schema.js";

const VERIFY_TOKEN = "trip-edit-token";

/** The captured retail couple: two guests, one room, one of them dives one day. */
function coupleTrip(): Trip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  return {
    language: f("en", "default"),
    contactName: f("Ana"),
    checkIn: f("2026-11-20"),
    checkOut: f("2026-11-22"),
    nights: f(2),
    guests: f(2),
    rooms: f(1),
    roomType: f("standard"),
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

/** A stored quotation with a priced trip, as `sync-estimate` would leave it. */
async function pricedQuote(
  id: string,
  overrides: Partial<{ status: "pending_hono_review" | "confirmed_by_hono"; sharedAt: string | null }> = {},
) {
  const trip = buildBffTrip(coupleTrip());
  const draft = buildHonoQuotationDraft(coupleTrip(), "https://example.test", id);
  return saveQuotationDraft({
    ...draft,
    status: overrides.status ?? "confirmed_by_hono",
    confirmedAt: new Date().toISOString(),
    confirmedBy: "staff",
    aiConfirmedReply: "Your quotation is ready.",
    bffTrip: trip,
    pricing: {
      source: "simulated",
      sample: true,
      mode: "fixture",
      role: "guest",
      computedAt: new Date().toISOString(),
      guests: [],
      catRev: {},
      kpis: { revenue: null, guests: null, nights: null, discounts: null, rpgn: null },
      warnings: [],
      retail: null,
      ops: null,
    },
    estimator: {
      id: `sim-${id}`,
      cookie: `ubg_sid=sim-${id}`,
      seq: null,
      guestUrl: null,
      sharedAt: overrides.sharedAt ?? null,
    },
  });
}

function editTrip(
  app: ReturnType<typeof createApp>,
  id: string,
  trip: unknown,
  token = VERIFY_TOKEN,
) {
  return app.request(`/v1/quotes/${id}/trip?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trip }),
  });
}

/** The whole trip with every room's type changed — what the studio's room-type select posts. */
function withRoomType(trip: BffTrip, type: "standard" | "deluxe" | "suite"): BffTrip {
  return { ...trip, rooms: trip.rooms.map((r) => ({ ...r, type })) };
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("editing the trip behind a quotation", () => {
  it("needs a session, and refuses a quotation that does not exist", async () => {
    const draft = await pricedQuote("QT-EDIT-1");
    const app = createApp();

    const unauthenticated = await editTrip(app, draft.quoteId, draft.bffTrip, "wrong-token");
    expect(unauthenticated.status).toBe(401);

    const missing = await editTrip(app, "QT-NOPE", draft.bffTrip);
    expect(missing.status).toBe(404);
  });

  it("re-prices the edited trip on the engine, so the number on the link follows the correction", async () => {
    const draft = await pricedQuote("QT-EDIT-2");
    const app = createApp();

    // Price it first, so the "before" number is the engine's own rather than the fixture's.
    const priced = await app.request(`/v1/quotes/${draft.quoteId}/sync-estimate?token=${VERIFY_TOKEN}`, {
      method: "POST",
    });
    expect(priced.status).toBe(200);
    // The captured fixture is a standard room: 7,600 a night for two guests, 15,200 over the stay.
    expect((await priced.json()).pricing.kpis.revenue).toBe(31200);

    const res = await editTrip(app, draft.quoteId, withRoomType(draft.bffTrip!, "deluxe"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Deluxe is 11,200 a night for the same two guests: the room line doubles, and meals and diving
    // do not move, because only the room type changed.
    expect(body.pricing.catRev.room).toBe(22400);
    expect(body.pricing.catRev.meals).toBe(6000);
    expect(body.pricing.kpis.revenue).toBe(38400);

    // And it is recorded, not merely displayed — a reload must show the corrected trip's price.
    const after = await (await app.request(`/v1/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).json();
    expect(after.quotation.bffTrip.rooms.map((r: { type: string }) => r.type)).toEqual(["deluxe"]);
    expect(after.quotation.pricing.kpis.revenue).toBe(38400);
  });

  it("drops the approval with the trip it was given for, message and all", async () => {
    const draft = await pricedQuote("QT-EDIT-3");
    const app = createApp();
    expect(draft.status).toBe("confirmed_by_hono");

    const res = await editTrip(app, draft.quoteId, withRoomType(draft.bffTrip!, "suite"));
    expect(res.status).toBe(200);

    // Approval is a statement about a specific trip. Keeping it would let a trip nobody has looked
    // at be published by one click of a button labelled "publish" — the exact thing the publish gate
    // exists to prevent. The prepared guest message goes with it: it quotes the old numbers.
    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).json();
    expect(stored.quotation.status).toBe("pending_hono_review");
    expect(stored.quotation.confirmedAt).toBeUndefined();
    expect(stored.quotation.aiConfirmedReply).toBeUndefined();

    const publish = await app.request(`/v1/quotes/${draft.quoteId}/publish?token=${VERIFY_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledgeSample: true }),
    });
    expect(publish.status).toBe(409);
    expect((await publish.json()).reason).toBe("not_approved");
  });

  it("refuses to change a trip a guest is already holding a link to", async () => {
    const draft = await pricedQuote("QT-EDIT-4", { sharedAt: new Date().toISOString() });
    const app = createApp();

    const res = await editTrip(app, draft.quoteId, withRoomType(draft.bffTrip!, "deluxe"));
    expect(res.status).toBe(409);
    // Their Q-005: one link per quotation. Changing the trip under a published link would silently
    // re-quote a guest, so the answer is a new quotation rather than an edit.
    expect((await res.json()).reason).toBe("already_shared");
  });

  it("refuses a trip that does not match the contract, and one our own precheck calls invalid", async () => {
    const draft = await pricedQuote("QT-EDIT-5");
    const app = createApp();

    const notATrip = await editTrip(app, draft.quoteId, { rooms: "one" });
    expect(notATrip.status).toBe(422);
    const notATripBody = await notATrip.json();
    expect(notATripBody.reason).toBe("invalid_trip");
    // The offending paths travel back, so the studio can point at the field rather than guess.
    expect(notATripBody.fields.length).toBeGreaterThan(0);

    // A structurally valid trip that their `fillTrip` would reject: a dive window that ends before
    // it starts. Caught here so it is a message in the studio, not an Odoo 422 in a log.
    const reversed = { ...draft.bffTrip!, diveFrom: "2026-11-21", diveTo: "2026-11-20" };
    const bad = await editTrip(app, draft.quoteId, reversed);
    expect(bad.status).toBe(422);
    expect((await bad.json()).reason).toBe("trip_not_priceable");
  });

  it("keeps one engine scenario across an edit, by PATCHing the one it already has", async () => {
    const draft = await pricedQuote("QT-EDIT-6");
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: String(init.method), body: JSON.parse(String(init.body)) });
      return new Response(
        JSON.stringify({
          id: "scenario-42",
          role: "guest",
          model: { kpis: { revenue: 38400 } },
          issues: [],
          computedAt: new Date().toISOString(),
          sample: true,
          mode: "fixture",
        }),
        { status: 200, headers: { "content-type": "application/json", "set-cookie": "ubg_sid=scenario-42; Path=/; HttpOnly" } },
      );
    });
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    // The quotation was priced against scenario `sim-QT-EDIT-6`; the cookie is what their API
    // addresses the draft by.
    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).json();
    await saveQuotationDraft({ ...stored.quotation, estimator: { ...stored.quotation.estimator, id: "scenario-42" } });

    const res = await editTrip(app, draft.quoteId, withRoomType(draft.bffTrip!, "deluxe"));
    expect(res.status).toBe(200);

    expect(calls).toHaveLength(1);
    // A POST here would mint a SECOND scenario and leave the quotation's `commit`/`share` addressed
    // to whichever id won — two scenarios for one enquiry.
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://quotes.customer.test/api/estimates/scenario-42");
    expect(calls[0]!.body).toMatchObject({ save: true });
    expect((calls[0]!.body as { trip: BffTrip }).trip.rooms[0]!.type).toBe("deluxe");

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pricing.kpis.revenue).toBe(38400);
  });

  it("records what staff changed, as field paths — the only measure of the extractor", async () => {
    const draft = await pricedQuote("QT-EDIT-8");
    const app = createApp();

    // A correction across the things the review panel can touch: the room type, a guest moved into
    // a second room (which has to be created first — the precheck refuses a guest pointing at a room
    // that does not exist, which is the guard working), a course, and two extra dives.
    // Deep-cloned first, because the studio sends its copy over the wire: mutating the stored
    // object in place would make the route compare a trip against itself and report no change.
    const edited = structuredClone(withRoomType(draft.bffTrip!, "deluxe"));
    edited.rooms.push({ id: "r2", type: "deluxe", name: null });
    edited.guests[1]!.roomId = "r2";
    edited.guests[0]!.courses = ["dsd"];
    edited.guests[0]!.days["2026-11-21"] = { dive: true, third: true, night: true, boatId: null };

    const res = await editTrip(app, draft.quoteId, edited);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Field PATHS, not values: the point is which facts the bot got wrong, and a metric that named
    // guests would be a metric full of guest names.
    expect(body.changedFields).toEqual([
      // An empty courses list becoming one course is both a length change and a first element; the
      // pair is what tells "staff added a course" apart from "staff swapped a course".
      "guests[0].courses.length",
      "guests[0].courses[0]",
      "guests[0].days.2026-11-21.night",
      "guests[0].days.2026-11-21.third",
      "guests[1].roomId",
      "rooms.length",
      "rooms[0].type",
      // A room that was not there before reads as the room, not as each of its fields.
      "rooms[1]",
    ]);

    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).json();
    expect(stored.quotation.staffEdits).toHaveLength(1);
    expect(stored.quotation.staffEdits[0].fields).toContain("rooms[0].type");
    expect(stored.quotation.staffEdits[0].at).toEqual(expect.any(String));
  });

  it("records nothing when staff re-price a trip they did not change", async () => {
    const draft = await pricedQuote("QT-EDIT-9");
    const app = createApp();

    // Same trip, saved again: not an edit, and counting it as one would make the scorecard lie.
    const res = await editTrip(app, draft.quoteId, draft.bffTrip!);
    expect(res.status).toBe(200);
    expect((await res.json()).changedFields).toEqual([]);

    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).json();
    expect(stored.quotation.staffEdits).toEqual([]);
  });

  it("keeps the scenario id and cookie an edit answered with, so publish still addresses it", async () => {
    const draft = await pricedQuote("QT-EDIT-7");
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (String(init.method) === "PATCH") {
        return new Response(
          JSON.stringify({ id: "scenario-77", role: "guest", model: {}, issues: [], sample: true, mode: "fixture" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ seq: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    const res = await editTrip(app, draft.quoteId, withRoomType(draft.bffTrip!, "suite"));
    expect(res.status).toBe(200);

    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).json();
    expect(stored.quotation.estimator.id).toBe("scenario-77");
  });
});
