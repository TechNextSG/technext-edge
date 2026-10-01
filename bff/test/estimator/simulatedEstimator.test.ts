// The simulated estimator is what the whole demo prices from until Phillip's keys arrive, so the
// thing worth pinning is not "it returns a number" but "it returns the CUSTOMER'S number".
//
// Every expectation below is copied from `contracts/odoo/examples/compute.retail-couple.json` in
// the cloned `tn-casa-quotation-estimator` repo — a real captured Odoo response — and written as a
// literal rather than read from that file, so this test keeps meaning if the clone moves and so a
// change to the simulation has to be a deliberate change to a number a human can check against the
// capture.
//
// The couple case is the strongest available check because we can reproduce it exactly:
//   Ana   room 7,600 + meals 3,000 + one boat-dive day 10,000 = 20,600
//   Ben   room 7,600 + meals 3,000                             = 10,600
//   total 31,200, rpgn 7,800, room 15,200 / meals 6,000 / dive 10,000
import { buildBffTrip } from "../../../ai/src/index.ts";
import { describe, it, expect, vi } from "vitest";
import { createApp } from "../../src/app.ts";
import {
  buildSimulatedEnvelope,
  buildSimulatedModel,
  formatCardDay,
  roomNamesFor,
  createSimulatedEstimator,
  type SimModel,
} from "../../src/estimator/index.ts";
import {
  createEstimatorPortFromEnv,
  estimatorModeFromEnv,
  type SubmitInput,
} from "../../src/estimator/index.ts";

import type { BffTrip } from "../../../ai/src/index.ts";
import type { Trip } from "../../../ai/src/index.ts";

/** The couple in the captured fixture: Ana dives one day, Ben does not, both full board. */
function retailCoupleSource(overrides: Partial<Record<keyof Trip, unknown>> = {}): Trip {
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
    ...overrides,
  } as Trip;
}

function retailCoupleTrip(): BffTrip {
  return buildBffTrip(retailCoupleSource());
}

/** The same trip quoted on a partner account — the Agent View's second model. */
function agentCoupleTrip(): BffTrip {
  const trip = retailCoupleTrip();
  return { ...trip, guestType: "agent" };
}

/**
 * The couple's stay, in a room type the guest actually named.
 *
 * `buildBffTrip` writes the type onto every room it creates, and the pricing path reads it back
 * per room — so this is the whole chain from the extractor's `roomType` field to the money.
 */
function coupleTripInRoomType(type: "standard" | "deluxe" | "suite"): BffTrip {
  const trip = retailCoupleTrip();
  return { ...trip, rooms: trip.rooms.map((r) => ({ ...r, type })) };
}

describe("buildSimulatedModel — the captured couple, reproduced", () => {
  const model = buildSimulatedModel(retailCoupleTrip());

  it("totals exactly what the captured compute response totals", () => {
    expect(model.kpis.revenue).toBe(31200);
    expect(model.kpis.guests).toBe(2);
    expect(model.kpis.nights).toBe(2);
    expect(model.kpis.rpgn).toBe(7800);
    expect(model.kpis.discounts).toBe(0);
  });

  it("splits revenue by category the way their `catRev` does", () => {
    expect(model.catRev.room).toBe(15200);
    expect(model.catRev.meals).toBe(6000);
    expect(model.catRev.dive).toBe(10000);
    expect(model.catRev.transport).toBe(0);
    expect(model.catRev.course).toBe(0);
  });

  it("gives each guest their own line items, not a share of a group total", () => {
    const [ana, ben] = model.quotes;
    expect(model.quotes).toHaveLength(2);
    expect(ana!.g.name).toBe("Ana");
    expect(ben!.g.name).toBe("Ben");
    expect(ana!.total).toBe(20600);
    expect(ben!.total).toBe(10600);

    // The room line is "nightly rate ÷ that night's roommates, summed" — 7,600 for two people
    // over two nights is 3,800 each per night, not 7,600 each.
    expect(ana!.lines.map((l) => [l.cat, l.gross])).toEqual([
      ["room", 7600],
      ["meals", 3000],
      ["dive", 10000],
    ]);
    expect(ben!.lines.map((l) => [l.cat, l.gross])).toEqual([
      ["room", 7600],
      ["meals", 3000],
    ]);
  });

  it("prices the dive day per diver out, and only for the guests who dive", () => {
    const dive = model.quotes[0]!.lines.find((l) => l.cat === "dive")!;
    expect(dive.label).toBe("Boat dives — Sat, Nov 21");
    expect(dive.sub).toContain("1 diver out");
    expect(model.quotes[1]!.lines.some((l) => l.cat === "dive")).toBe(false);
    expect(model.diverCount).toBe(1);
    expect(model.nonDivers).toBe(1);
  });

  it("derives the operational fields the Ops Sheet and the Day plans read", () => {
    expect(model.stayDates).toEqual(["2026-11-20", "2026-11-21"]);
    expect(model.diveDates).toEqual(["2026-11-21"]);
    expect(model.covers).toEqual({ "2026-11-20": 2, "2026-11-21": 2 });
    expect(model.maxCovers).toBe(2);
    expect(model.gn).toBe(4);
    expect(model.roomNightsUsed).toEqual({ r1: 2 });
    expect(model.roomPeak).toEqual({ r1: 2 });
    expect(model.dayPlans).toHaveLength(1);
    expect(model.dayPlans[0]!.divers.map((g) => g.name)).toEqual(["Ana"]);
    expect(model.gwin.g1).toEqual({
      a: "2026-11-20",
      dep: "2026-11-22",
      n: 2,
      dates: ["2026-11-20", "2026-11-21"],
    });
  });

  it("emits their boat warning verbatim, because that is the sentence staff act on", () => {
    expect(model.warnings).toEqual([{ level: "warn", text: "Sat, Nov 21: no boat picked yet for Ana." }]);
  });

  it("puts a group of seven in two vans, the way the engine's own runs do", () => {
    // Their captured runs carry a van of 6 and a van of 1 for seven guests, and the transfer is split
    // across the riders. This simulation priced one van for any group, which is the one transport
    // number a big booking would have been quoted wrong.
    const seven = buildSimulatedModel(
      buildBffTrip(
        retailCoupleSource({
          guests: { value: 7, state: "stated", evidence: null },
          rooms: { value: 4, state: "stated", evidence: null },
          transport: { value: true, state: "stated", evidence: null },
          transportType: { value: "roundtrip", state: "stated", evidence: null },
          guestNames: { value: [], state: "missing", evidence: null },
        }),
      ),
    );

    expect(seven.vans).toBe(2);
    expect(seven.vanRuns?.map((run) => run.vans)).toEqual([
      [{ pax: 6 }, { pax: 1 }],
      [{ pax: 6 }, { pax: 1 }],
    ]);
    // 2 vans × PHP 13,000 (the figure in the customer's own rate card), split across the seven riders.
    // The three-cent drift is that split: 26,000 does not divide by 7, and the model rounds each
    // passenger's share rather than hiding the remainder somewhere.
    expect(seven.catRev.transport).toBeCloseTo(26000, 1);
    const rider = seven.quotes[0]!;
    expect(rider.lines.find((l) => l.cat === "transport")!.gross).toBeCloseTo(26000 / 7, 2);
  });

  it("keeps one van for a couple, at the rate the customer's own card carries", () => {
    const couple = buildSimulatedModel(
      buildBffTrip(
        retailCoupleSource({
          transport: { value: true, state: "stated", evidence: null },
          transportType: { value: "roundtrip", state: "stated", evidence: null },
        }),
      ),
    );
    expect(couple.vans).toBe(1);
    expect(couple.catRev.transport).toBe(13000);
  });

  it("keeps the nullable cost half null — we have no cost data in any mode", () => {
    expect(model.cost).toBeNull();
    expect(model.costs).toBeNull();
    expect(model.catCost).toBeNull();
    expect(model.kpis.cost).toBeNull();
    expect(model.kpis.profit).toBeNull();
    expect(model.kpis.margin).toBeNull();
  });

  it("offers the room inventory their tool expects, by type", () => {
    expect(model.roomAvailability.standard).toHaveLength(16);
    expect(model.roomAvailability.standard[0]).toBe("Standard A");
    expect(model.roomAvailability.deluxe).toEqual(["Deluxe A", "Deluxe B", "Deluxe C", "Deluxe D"]);
    expect(roomNamesFor("suite")).toHaveLength(4);
  });
});

/**
 * The room type is not a cosmetic detail: it is the largest per-night lever on the quotation, and
 * until the Trip model learned it every enquiry was sent to the estimator as `standard`. The
 * numbers below come from the customer's own `rates.json` (`standard` 7,600 / `deluxe` 11,200 /
 * `suite` 14,200 for two guests), so the gap between these three totals is the size of the
 * under-quote a guest who asked for a suite used to receive.
 */
describe("buildSimulatedModel — the room type the guest named", () => {
  it("prices each type at its own nightly rate, not at the standard one", () => {
    const standard = buildSimulatedModel(coupleTripInRoomType("standard"));
    const deluxe = buildSimulatedModel(coupleTripInRoomType("deluxe"));
    const suite = buildSimulatedModel(coupleTripInRoomType("suite"));

    // Two guests, two nights, and the rate is per room per night then split across the roommates:
    // 7,600 / 11,200 / 14,200 over the stay ⇒ 7,600 / 11,200 / 14,200 on each guest's room line.
    expect(standard.catRev.room).toBe(15200);
    expect(deluxe.catRev.room).toBe(22400);
    expect(suite.catRev.room).toBe(28400);

    // Only the room moves: meals and diving do not depend on which room the guest sleeps in.
    expect(deluxe.catRev.meals).toBe(standard.catRev.meals);
    expect(deluxe.catRev.dive).toBe(standard.catRev.dive);

    expect(standard.kpis.revenue).toBe(31200);
    expect(deluxe.kpis.revenue).toBe(38400);
    expect(suite.kpis.revenue).toBe(44400);
  });

  it("reaches the price from a Trip, so the field the guest was asked for is the one that is charged", () => {
    // `buildBffTrip` carries the stated type onto every room it creates.
    const source = retailCoupleSource({ roomType: { value: "suite", state: "stated", evidence: "the suite" } });
    expect(buildBffTrip(source).rooms.map((r) => r.type)).toEqual(["suite"]);
    expect(buildSimulatedModel(buildBffTrip(source)).kpis.revenue).toBe(44400);
  });

  it("falls back to a standard room only when the guest never chose one", () => {
    // A missing type is a gap for staff to fill in the studio — never a reason to refuse the
    // enquiry, and never a reason to quote a room nobody asked for at a price nobody agreed to.
    const source = retailCoupleSource({ roomType: { value: null, state: "missing", evidence: null } });
    expect(buildBffTrip(source).rooms.map((r) => r.type)).toEqual(["standard"]);
  });
});

describe("buildSimulatedModel — a trip that calls itself a partner", () => {
  // Their engine takes the role from the session's Odoo key, never from the payload, and the bot only
  // holds a guest session — so "we are a travel agency" in an enquiry is still priced at retail.
  it("prices an agent trip at retail: no partner line, no discount", () => {
    const agent = buildSimulatedModel(agentCoupleTrip());
    const retail = buildSimulatedModel(retailCoupleTrip());
    expect(agent.kpis.revenue).toBe(retail.kpis.revenue);
    expect(agent.kpis.revenue).toBe(31200);
    expect(agent.kpis.discounts).toBe(0);
    for (const q of agent.quotes) for (const l of q.lines) expect(l.discs).toEqual([]);
    expect(JSON.stringify(agent)).not.toMatch(/Partner rate/);
  });

  it("still labels a session that IS an agent, and hands the retail comparison to it alone", () => {
    const partner = buildSimulatedEnvelope(agentCoupleTrip(), "agent");
    expect(partner.role).toBe("agent");
    expect(partner.retail_model).not.toBeNull();
    const retail = buildSimulatedEnvelope(retailCoupleTrip(), "guest");
    expect(retail.retail_model).toBeNull();
  });

  it("reports the guest role for a trip that only claims to be a partner", () => {
    expect(buildSimulatedEnvelope(agentCoupleTrip()).role).toBe("guest");
    expect(buildSimulatedEnvelope(retailCoupleTrip()).role).toBe("guest");
  });
});

describe("createSimulatedEstimator", () => {
  it("always labels its price as a sample, so it can never be read as a live quote", async () => {
    const port = createSimulatedEstimator();
    const res = await port.sendEstimate(retailCoupleTrip());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sample).toBe(true);
    expect(res.mode).toBe("fixture");
    expect(res.status).toBe(201);
    expect(res.issues).toEqual([]);
    const model = res.model as SimModel;
    expect(model.kpis.revenue).toBe(31200);
  });

  it("refuses to price nothing rather than inventing a trip", async () => {
    const res = await createSimulatedEstimator().sendEstimate(null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no_validated_trip");
  });

  it("answers a booking with the fixture's shape — success, and no folio, because none was made", async () => {
    const input: SubmitInput = {
      trip: retailCoupleTrip(),
      contact: { name: "Ana", email: "ana@example.test" },
    };
    const res = await createSimulatedEstimator().submit(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sample).toBe(true);
    expect(res.folioId).toBeNull();
    expect(res.orderIds).toBeNull();
  });

  it("can be told to fail, so every branch of the booking state machine stays reachable", async () => {
    const input: SubmitInput = {
      trip: retailCoupleTrip(),
      contact: { name: "Ana", email: "ana@example.test" },
    };
    for (const behaviour of ["rejected", "busy", "unknown"] as const) {
      const res = await createSimulatedEstimator({ submitBehaviour: behaviour }).submit(input);
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe(behaviour);
    }
  });

  it("reports itself healthy in fixture mode, so the studio badge tells the truth", async () => {
    expect(await createSimulatedEstimator().checkHealth()).toEqual({ reachable: true, mode: "fixture" });
  });
});

describe("port selection", () => {
  it("defaults to the simulated engine — a deployment that forgets the env var must not reach Odoo", () => {
    expect(estimatorModeFromEnv({} as NodeJS.ProcessEnv)).toBe("simulated");
    expect(estimatorModeFromEnv({ ESTIMATOR_MODE: "  " } as NodeJS.ProcessEnv)).toBe("simulated");
    expect(estimatorModeFromEnv({ ESTIMATOR_MODE: "SIMULATED" } as NodeJS.ProcessEnv)).toBe("simulated");
    expect(createEstimatorPortFromEnv({} as NodeJS.ProcessEnv).kind).toBe("simulated");
  });

  it("reaches the real BFF only when asked for explicitly", () => {
    expect(estimatorModeFromEnv({ ESTIMATOR_MODE: "remote" } as NodeJS.ProcessEnv)).toBe("remote");
    const port = createEstimatorPortFromEnv({
      ESTIMATOR_MODE: "remote",
      ESTIMATOR_BASE_URL: "http://bff.test",
    } as NodeJS.ProcessEnv);
    expect(port.kind).toBe("remote");
    expect(port.baseUrl).toBe("http://bff.test");
  });

  it("tells staff the studio is connected, because the simulated engine needs no URL to be reachable", async () => {
    // The pre-existing badge short-circuited on `ESTIMATOR_BASE_URL` being unset, which is exactly
    // the simulated configuration — so it told staff the demo was misconfigured while it was
    // pricing perfectly well. "Cannot be priced" is only true of a remote port with no URL.
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "badge-token");
    // The ambient env must not accidentally put this app on the remote path.
    vi.stubEnv("ESTIMATOR_BASE_URL", "");
    try {
      const app = createApp();
      const res = await app.request("/v1/quotes/estimator-status?token=badge-token");
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.configured).toBe(true);
      expect(body.kind).toBe("simulated");
      expect(body.reachable).toBe(true);
      expect(body.mode).toBe("fixture");
      expect(String(body.detail)).toContain("simulated");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("formatCardDay", () => {
  it("writes a day the way their card does", () => {
    expect(formatCardDay("2026-11-21")).toBe("Sat, Nov 21");
    expect(formatCardDay("2026-01-02")).toBe("Fri, Jan 2");
  });
});
