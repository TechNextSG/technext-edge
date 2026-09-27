// `normalizePricing` is the seam between the customer's response and every page that draws it, so
// what it has to survive is the response being *slightly different* from the one we developed
// against. Their captured fixture carries a single warning as an object; an array is the general
// form; a real Odoo answer may carry neither. Every read is defensive, and these tests are what
// keep that from quietly becoming "assume the shape we saw first".
import { describe, it, expect } from "vitest";
import { normalizePricing, readWarnings } from "../src/pricing.js";

/** The captured `compute.retail-couple.json`, trimmed to the fields a page reads. */
const COUPLE = {
  N: 2,
  stayDates: ["2026-11-20", "2026-11-21"],
  diveDates: ["2026-11-21"],
  quotes: [
    {
      g: { id: "g1", name: "Ana" },
      total: 20600,
      discountTotal: 0,
      lines: [
        { cat: "room", label: "Standard A — 2 nights", sub: "nightly rate ÷ that night’s roommates, summed over your stay", gross: 7600, net: 7600 },
        { cat: "meals", label: "Full board — 2 days", sub: "₱1,500 per person/day · never guest-type discounted", gross: 3000, net: 3000 },
        { cat: "dive", label: "Boat dives — Sat, Nov 21", sub: "2-dive boat trip · 1 diver out", gross: 10000, net: 10000 },
      ],
    },
    {
      g: { id: "g2", name: "Ben" },
      total: 10600,
      discountTotal: 0,
      lines: [
        { cat: "room", label: "Standard A — 2 nights", sub: "…", gross: 7600, net: 7600 },
        { cat: "meals", label: "Full board — 2 days", sub: "…", gross: 3000, net: 3000 },
      ],
    },
  ],
  catRev: { room: 15200, meals: 6000, dive: 10000, course: 0, transport: 0, gear: 0, extras: 0 },
  kpis: { revenue: 31200, guests: 2, nights: 2, discounts: 0, rpgn: 7800 },
  // A single warning arrives as an OBJECT in their capture.
  warnings: { level: "warn", text: "Sat, Nov 21: no boat picked yet for Ana." },
  presence: {
    "2026-11-20": [{ name: "Ana", roomId: "r1", meals: true, diver: true }, { name: "Ben", roomId: "r1", meals: true, diver: false }],
    "2026-11-21": [{ name: "Ana", roomId: "r1", meals: true, diver: true }, { name: "Ben", roomId: "r1", meals: true, diver: false }],
  },
  covers: { "2026-11-20": 2, "2026-11-21": 2 },
  dayPlans: [{ date: "2026-11-21", divers: [{ name: "Ana" }] }],
  vanRuns: null,
};

function read(model: unknown, extra: Partial<Parameters<typeof normalizePricing>[0]> = {}) {
  return normalizePricing({ model, source: "simulated", sample: true, mode: "fixture", role: "guest", ...extra });
}

describe("normalizePricing — the captured couple", () => {
  const pricing = read(COUPLE);

  it("reads one card per guest, with the engine's own lines", () => {
    expect(pricing.guests.map((g) => g.name)).toEqual(["Ana", "Ben"]);
    expect(pricing.guests.map((g) => g.total)).toEqual([20600, 10600]);
    expect(pricing.guests[0]!.lines.map((l) => [l.cat, l.net])).toEqual([
      ["room", 7600],
      ["meals", 3000],
      ["dive", 10000],
    ]);
    expect(pricing.guests[0]!.lines[0]!.sub).toContain("nightly rate");
  });

  it("keeps the category split and the KPIs the engine reported", () => {
    expect(pricing.catRev.room).toBe(15200);
    expect(pricing.catRev.dive).toBe(10000);
    expect(pricing.catRev.transport).toBe(0);
    expect(pricing.kpis).toEqual({ revenue: 31200, guests: 2, nights: 2, discounts: 0, rpgn: 7800 });
  });

  it("reads a single warning out of the object form their capture uses", () => {
    expect(pricing.warnings).toEqual(["Sat, Nov 21: no boat picked yet for Ana."]);
  });

  it("carries the operational half the Ops Sheet draws from", () => {
    expect(pricing.ops).not.toBeNull();
    expect(pricing.ops!.stayDates).toEqual(["2026-11-20", "2026-11-21"]);
    expect(pricing.ops!.covers).toEqual({ "2026-11-20": 2, "2026-11-21": 2 });
    expect(pricing.ops!.presence["2026-11-20"]!.map((g) => [g.name, g.room, g.meals])).toEqual([
      ["Ana", "r1", true],
      ["Ben", "r1", true],
    ]);
    expect(pricing.ops!.dayPlans).toEqual([{ date: "2026-11-21", divers: ["Ana"] }]);
    expect(pricing.ops!.transfers).toEqual([]);
  });

  it("labels where the price came from, because 'sample' depends on it", () => {
    expect(pricing.source).toBe("simulated");
    expect(pricing.sample).toBe(true);
    expect(pricing.mode).toBe("fixture");
  });
});

describe("normalizePricing — surviving a different answer", () => {
  it("reads warnings from an array and from a bare string, not only from their object form", () => {
    expect(readWarnings([{ level: "warn", text: "one" }, { message: "two" }])).toEqual(["one", "two"]);
    expect(readWarnings("just a string")).toEqual(["just a string"]);
    expect(readWarnings(null)).toEqual([]);
    expect(readWarnings(undefined)).toEqual([]);
  });

  it("returns nothing to draw rather than throwing when the model is not an object", () => {
    for (const bad of [null, undefined, "nope", 42, []]) {
      const pricing = read(bad);
      expect(pricing.guests).toEqual([]);
      expect(pricing.warnings).toEqual([]);
      expect(pricing.ops).toBeNull();
    }
  });

  it("leaves a KPI it was not given as null, never as zero", () => {
    // A zero on a quotation reads as "free", which is the most expensive way to be wrong.
    const pricing = read({ quotes: [], catRev: {}, kpis: { revenue: 31200 } });
    expect(pricing.kpis.revenue).toBe(31200);
    expect(pricing.kpis.guests).toBeNull();
    expect(pricing.kpis.nights).toBeNull();
    expect(pricing.kpis.discounts).toBeNull();
    expect(pricing.kpis.rpgn).toBeNull();
  });

  it("drops a line with no label instead of rendering an empty row", () => {
    const pricing = read({ quotes: [{ g: { name: "Ana" }, lines: [{ cat: "room", net: 100 }, { label: "Kept", net: 50 }] }] });
    expect(pricing.guests[0]!.lines.map((l) => l.label)).toEqual(["Kept"]);
  });

  it("falls back to the sum of the lines when the engine gives no per-guest total", () => {
    const pricing = read({ quotes: [{ g: { name: "Ana" }, lines: [{ label: "Room", net: 100 }, { label: "Meals", net: 50 }] }] });
    expect(pricing.guests[0]!.total).toBe(150);
  });

  it("names a guest it was not given, rather than leaving the card blank", () => {
    expect(read({ quotes: [{ lines: [] }] }).guests[0]!.name).toBe("Guest");
  });

  it("carries the retail model only when the engine returned one", () => {
    const retail = read(COUPLE, {
      retailModel: { quotes: [{ g: { name: "Ana" }, total: 20600, lines: [] }], kpis: { revenue: 20600 } },
      role: "agent",
    });
    expect(retail.retail!.guests.map((g) => g.name)).toEqual(["Ana"]);
    expect(retail.retail!.kpis.revenue).toBe(20600);

    // A retail session gets none, and the page must show no comparison rather than two identical
    // columns labelled as a margin.
    expect(read(COUPLE).retail).toBeNull();
  });

  it("reports no ops when the engine sent none, so the sheet says so instead of inventing a day", () => {
    expect(read({ quotes: [], kpis: {} }).ops).toBeNull();
  });
});
