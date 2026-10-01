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
import { buildBffTrip } from "../../ai/src/index.ts";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.ts";
import { createEstimatorClient } from "../src/services/estimatorClient.ts";
import { buildHonoQuotationDraft } from "../src/quote/index.ts";
import { listQuotations, saveQuotationDraft } from "../src/store/quotationStore.ts";

import type { BffTrip } from "../../ai/src/index.ts";
import type { Trip } from "../../ai/src/index.ts";

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

/**
 * The FIRST save on a quotation the engine has never priced.
 *
 * The studio chooses which route to call by whether the record has an engine scenario yet
 * (`needsPrice = tripDirty || !hasScenario`), so a fresh enquiry's first "Save & get price" goes to
 * `sync-estimate` — and that route used to ignore the request body and price the trip already stored.
 * Measured on production, 2026-09-28: a dive day moved from the guest to their companion in the review
 * grid, "Save & get price" answered `Priced — needs approval`, and the record still had the original
 * guest diving with `staffEdits: []`. The person's work was gone and the screen said it had saved.
 */
function firstSave(
  app: ReturnType<typeof createApp>,
  id: string,
  trip: unknown,
  token = VERIFY_TOKEN,
) {
  return app.request(`/v1/quotes/${id}/sync-estimate?token=${token}`, {
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

  it("prices and stores the trip the first save posts, instead of the one already on the record", async () => {
    const draft = await pricedQuote("QT-FIRST-SAVE");
    // A fresh enquiry carries no estimator session: the engine has never seen this trip, which is
    // exactly when the studio calls this route rather than `/trip`.
    await saveQuotationDraft({ ...draft, status: "pending_hono_review", estimator: null });
    const app = createApp();

    // The person changed the room type in the review grid — the biggest per-night lever there is.
    const corrected = withRoomType(draft.bffTrip!, "deluxe");
    const res = await firstSave(app, draft.quoteId, corrected);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const stored = (await listQuotations()).find((q) => q.quoteId === draft.quoteId)!;
    // The trip the price belongs to is the corrected one…
    expect(stored.bffTrip?.rooms.map((r) => r.type)).toEqual(corrected.rooms.map((r) => r.type));
    // …and the correction is on the record, so the channel can defend it later: `pathsRestatedByGuest`
    // only protects a record that knows somebody corrected it.
    expect(stored.staffEdits?.some((e) => e.source === "trip")).toBe(true);
    expect(stored.staffEdits?.at(-1)?.fields.some((f) => f.includes("rooms"))).toBe(true);
  });

  it("still refuses a trip the engine cannot price, rather than pricing the stored one", async () => {
    const draft = await pricedQuote("QT-FIRST-SAVE-BAD");
    await saveQuotationDraft({ ...draft, status: "pending_hono_review", estimator: null });
    const app = createApp();

    // Both guests marked as diving with no dive days: the precheck refuses this outright.
    const broken = structuredClone(draft.bffTrip!);
    broken.guests = broken.guests.map((g) => ({ ...g, diver: true, days: {} }));

    const res = await firstSave(app, draft.quoteId, broken);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.reason).toBe("trip_not_priceable");
    // A refused save changes nothing: the record still holds the trip it had, not the broken one.
    const stored = (await listQuotations()).find((q) => q.quoteId === draft.quoteId)!;
    expect(stored.bffTrip).toEqual(draft.bffTrip);
    expect(stored.staffEdits ?? []).toHaveLength(0);
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

  it("drops the approval when the engine prices it again, because the price is what was approved", async () => {
    // The same rule as an edited trip, from the other direction, and the reason it exists: production's
    // seeded fixture was approved at the built-in sample engine's figure, and the approval survived the
    // real engine pricing it — so the record read "approved" for a price nobody had seen.
    const draft = await pricedQuote("QT-EDIT-PRICE-AGAIN");
    const app = createApp();
    expect(draft.status).toBe("confirmed_by_hono");
    expect(draft.aiConfirmedReply).toBeTruthy();

    const res = await app.request(`/v1/quotes/${draft.quoteId}/sync-estimate?token=${VERIFY_TOKEN}`, { method: "POST" });
    expect(res.status).toBe(200);

    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).json();
    expect(stored.quotation.status).toBe("pending_hono_review");
    expect(stored.quotation.confirmedAt).toBeUndefined();
    expect(stored.quotation.confirmedBy).toBeUndefined();
    expect(stored.quotation.aiConfirmedReply).toBeUndefined();
    // …and the engine now owns the quotation, which is what publishing needs.
    expect(stored.quotation.estimator.id).toBeTruthy();

    const publish = await app.request(`/v1/quotes/${draft.quoteId}/publish?token=${VERIFY_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledgeSample: true }),
    });
    expect(publish.status).toBe(409);
    expect((await publish.json()).reason).toBe("not_approved");
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
    expect(body.recovered).toBe(false);
    expect(body.pricing.kpis.revenue).toBe(38400);
  });

  it("prices the edited trip again when the engine has forgotten the scenario", async () => {
    // Their store keeps one draft per session, and a swept draft answers 404 to every scenario-scoped
    // call — the edit, the commit, the share. Measured on production 2026-09-28, on a quotation eleven
    // minutes old: a dive day moved between guests in the review grid, "Save & get price", and the
    // studio answered `Saved the guest details, but not the trip: unexpected not found`. The record
    // still held an id the engine did not know, so the same button could only fail the same way.
    //
    // Re-pricing the trip on screen is the repair: a real engine answer for the trip the person is
    // looking at, recorded against the same session, instead of an editable-looking record that can
    // never be priced or published again.
    const draft = await pricedQuote("QT-EDIT-FORGOTTEN");
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const method = String(init.method);
      calls.push({ url: String(url), method });
      if (method === "PATCH") {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: "scenario-fresh",
          role: "guest",
          model: { kpis: { revenue: 38400 } },
          issues: [],
          sample: true,
          mode: "fixture",
        }),
        { status: 201, headers: { "content-type": "application/json", "set-cookie": "ubg_sid=fresh; Path=/; HttpOnly" } },
      );
    });
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    const res = await editTrip(app, draft.quoteId, withRoomType(draft.bffTrip!, "deluxe"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recovered).toBe(true);
    expect(body.pricing.kpis.revenue).toBe(38400);
    expect(body.changedFields).toContain("rooms[0].type");

    // The repair is addressed to the quotation's own session, so the new scenario belongs to the same
    // cookie — a second anonymous session would leave the guest link pointing at a different draft.
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(calls[1]!.url).toBe("https://quotes.customer.test/api/estimates");

    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).json();
    expect(stored.quotation.estimator.id).toBe("scenario-fresh");
    expect(stored.quotation.estimator.cookie).toContain("fresh");
    expect(stored.quotation.pricing.kpis.revenue).toBe(38400);
  });

  it("does not re-create a scenario for a failure that is not a missing one", async () => {
    // The repair above must not swallow a real refusal: an engine that rejects our payload (422) is a
    // defect on this side, and answering it by minting a second scenario would hide the defect and
    // leave two drafts for one enquiry.
    const draft = await pricedQuote("QT-EDIT-REJECTED");
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(String(init.method));
      return new Response(JSON.stringify({ error: "Trip thiếu trường ảnh hưởng giá", fields: ["checkIn"] }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    const res = await editTrip(app, draft.quoteId, withRoomType(draft.bffTrip!, "suite"));
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("rejected");
    expect(calls).toEqual(["PATCH"]);

    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).json();
    expect(stored.quotation.estimator.id).toBe(`sim-${draft.quoteId}`);
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
