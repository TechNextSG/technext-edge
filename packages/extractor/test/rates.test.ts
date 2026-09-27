// Pins the local pricing to the customer's real rate card, so a draft never again shows a
// number Odoo could not reproduce. The rate card is captured from the customer's sources
// (see src/rates.ts for provenance); these tests reproduce the rules from the field guide and
// the compute examples in the cloned tn-casa-quotation-estimator repo.
import { describe, it, expect } from "vitest";
import { roomNightlyRate, diveTierPrice, MEAL_RATE } from "../src/rates.js";
import { buildHonoQuotationDraft } from "../src/quotationTool.js";
import type { Trip } from "../src/schema.js";

function f<T>(value: T | null, state = "stated") {
  return { value, state, evidence: null };
}

/** The WhatsApp case from 2026-09-25: 4 guests, 2 twin rooms, 3 nights, 4 divers over 2 days. */
function anaTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    language: f("en", "default"),
    contactName: f("Ana"),
    checkIn: f("2026-10-03"),
    checkOut: f("2026-10-06"),
    nights: f(3),
    guests: f(4),
    rooms: f(2),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none", "default"),
    diver: f(true),
    divers: f(4),
    diveNotes: f(null, "missing"),
    diveFrom: f("2026-10-04"),
    diveTo: f("2026-10-05"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
    ...overrides,
  } as Trip;
}

describe("rate card lookups", () => {
  it("room rates are per night per room, keyed by occupancy", () => {
    expect(roomNightlyRate("standard", 1)).toBe(5500);
    expect(roomNightlyRate("standard", 2)).toBe(7600);
    expect(roomNightlyRate("deluxe", 2)).toBe(11200);
    expect(roomNightlyRate("deluxe", 4)).toBe(16400.01);
    expect(roomNightlyRate("suite", 4)).toBe(18400);
  });

  it("dive tiers read by divers-out that day, capped at 4", () => {
    expect(diveTierPrice(1)).toBe(10000);
    expect(diveTierPrice(2)).toBe(5500);
    expect(diveTierPrice(3)).toBe(4500);
    expect(diveTierPrice(4)).toBe(3600);
    expect(diveTierPrice(6)).toBe(3600); // 6 divers out -> the 4+ tier
  });

  it("meals are a flat 1,500 per person per day", () => {
    expect(MEAL_RATE).toBe(1500);
  });
});

describe("buildHonoQuotationDraft prices with the real model", () => {
  it("prices the WhatsApp case (4 divers, 2 twin rooms, 3 nights, 2 dive days)", () => {
    const draft = buildHonoQuotationDraft(anaTrip());

    const room = draft.lineItems.find((i) => i.category === "room")!;
    const meals = draft.lineItems.find((i) => i.category === "meals")!;
    const dives = draft.lineItems.filter((i) => i.category === "diving");

    // room: 2 rooms × 2pax = 7,600/night × 3 nights
    expect(room.unitPrice).toBe(7600);
    expect(room.subtotal).toBe(45600);
    // meals: 1,500 × 4 guests × 3 days
    expect(meals.unitPrice).toBe(1500);
    expect(meals.subtotal).toBe(18000);
    // dive: ONE line per day, tier[4]=3,600 × 4 divers × 2 days
    expect(dives).toHaveLength(2);
    expect(dives[0]!.unitPrice).toBe(3600);
    expect(dives[0]!.subtotal).toBe(14400);
    expect(dives[1]!.subtotal).toBe(14400);

    expect(draft.subtotalAmount).toBe(92400);
    expect(draft.discountAmount).toBe(0);
    expect(draft.totalAmount).toBe(92400);
  });

  it("applies the partner discount to ROOMS only, never meals or diving", () => {
    const draft = buildHonoQuotationDraft(anaTrip({ guestType: f("agent") }));

    // room subtotal 45,600 × 30% = 13,680 — not 92,400 × 30%.
    expect(draft.discountPercent).toBe(30);
    expect(draft.discountAmount).toBe(13680);
    expect(draft.totalAmount).toBe(92400 - 13680);
  });

  it("does not invent a dive price for a split-day plan routed to staff", () => {
    const trip = anaTrip({
      divers: f(null, "missing"),
      diveFrom: f(null, "missing"),
      diveTo: f(null, "missing"),
      diveNotes: f("1 person dives day 1, 5 people dive both days"),
    });
    const draft = buildHonoQuotationDraft(trip);
    expect(draft.lineItems.filter((i) => i.category === "diving")).toHaveLength(0);
    expect(draft.lineItems.filter((i) => i.category === "room")).toHaveLength(1);
  });
});
