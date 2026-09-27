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
import { describe, it, expect, vi } from "vitest";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import {
  buildSimulatedEnvelope,
  buildSimulatedModel,
  formatCardDay,
  roomNamesFor,
  createSimulatedEstimator,
  type SimModel,
} from "../../../apps/casa-bff/src/simulatedEstimator.js";
import {
  createEstimatorPortFromEnv,
  estimatorModeFromEnv,
  type SubmitInput,
} from "../../../apps/casa-bff/src/estimatorPort.js";
import { buildBffTrip } from "../../../packages/extractor/src/odooHandoff.js";
import type { BffTrip, Trip } from "../../../packages/extractor/src/schema.js";

/** The couple in the captured fixture: Ana dives one day, Ben does not, both full board. */
function retailCoupleTrip(): BffTrip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  const trip = {
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
  return buildBffTrip(trip);
}

/** The same trip quoted on a partner account — the Agent View's second model. */
function agentCoupleTrip(): BffTrip {
  const trip = retailCoupleTrip();
  return { ...trip, guestType: "agent" };
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

describe("buildSimulatedModel — partner pricing", () => {
  it("takes 30% off rooms only, never off meals", () => {
    const model = buildSimulatedModel(agentCoupleTrip());
    const ana = model.quotes[0]!;
    const room = ana.lines.find((l) => l.cat === "room")!;
    const meals = ana.lines.find((l) => l.cat === "meals")!;

    expect(room.gross).toBe(7600);
    expect(room.discs).toEqual([{ label: "Partner rate 30% (rooms)", amount: 2280 }]);
    expect(room.net).toBe(5320);
    // Meals carry no discount row at all — the field guide is explicit that they never do.
    expect(meals.discs).toEqual([]);
    expect(meals.net).toBe(3000);
    expect(model.kpis.discounts).toBe(4560);
  });

  it("returns a retail comparison model for a partner session and none for a retail one", () => {
    const partner = buildSimulatedEnvelope(agentCoupleTrip(), "agent");
    expect(partner.role).toBe("agent");
    expect(partner.retail_model).not.toBeNull();
    expect(partner.retail_model!.kpis.revenue).toBe(31200);
    // The partner's own model is cheaper, and only because of the room discount.
    expect(partner.model.kpis.revenue).toBe(31200 - 4560);

    const retail = buildSimulatedEnvelope(retailCoupleTrip(), "guest");
    expect(retail.retail_model).toBeNull();
  });

  it("labels an agency trip as such on the envelope, which is what Odoo's own role field reports", () => {
    expect(buildSimulatedEnvelope(agentCoupleTrip()).role).toBe("agent");
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
