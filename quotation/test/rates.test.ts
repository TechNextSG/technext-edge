// Pins the local pricing to the customer's real rate card, so a draft never again shows a
// number Odoo could not reproduce. The rate card is captured from the customer's sources
// (see src/rates.ts for provenance); these tests reproduce the rules from the field guide and
// the compute examples in the cloned tn-casa-quotation-estimator repo.
import { describe, it, expect } from "vitest";
import {
  roomNightlyRate,
  diveTierPrice,
  MEAL_RATE,
  TRANSPORT_RATE,
  vanLoads,
  vansForGuests,
} from "../src/domain/rates.js";
import { buildHonoQuotationDraft } from "../src/application/quotationTool.js";
import type { Trip } from "../../ai/src/index.js";

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

  it("gives an agent no discount: a partner rate comes from their own login, not from the message", () => {
    const draft = buildHonoQuotationDraft(anaTrip({ guestType: f("agent") }));

    expect(draft.discountPercent).toBe(0);
    expect(draft.discountAmount).toBe(0);
    expect(draft.totalAmount).toBe(92400);
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

  it("names the room type it actually charged for, instead of always saying Standard", () => {
    // The description was the fixed string "Standard Room (Twin / Double Occupancy)" beside whatever
    // rate the booked rooms produced, so a deluxe booking read as a standard room at 11,200 a night.
    const deluxe = buildHonoQuotationDraft(anaTrip({ roomType: f("deluxe") }));
    const deluxeRoom = deluxe.lineItems.find((i) => i.category === "room")!;
    expect(deluxeRoom.description).toContain("Deluxe Room");
    expect(deluxeRoom.description).not.toContain("Standard");
    expect(deluxeRoom.unitPrice).toBe(11200);

    const suite = buildHonoQuotationDraft(anaTrip({ roomType: f("suite") }));
    const suiteRoom = suite.lineItems.find((i) => i.category === "room")!;
    expect(suiteRoom.description).toContain("Suite");

    const standard = buildHonoQuotationDraft(anaTrip());
    expect(standard.lineItems.find((i) => i.category === "room")!.description).toContain("Standard Room");
  });
});

describe("the airport transfer", () => {
  // Two customer sources disagreed and the call was made here, so the numbers are pinned with the
  // reason: the customer's own rate card export (`contracts/odoo/examples/rates.json`) says 13,000
  // round trip / 6,500 one way, and their engine's captured runs bill 6,500 per van RUN — so a round
  // trip is 13,000 in both. The resort's public site advertises 14,000: a page disagreeing with the
  // engine that actually charges the guest, and the page is what should be corrected.
  // `docs/specs/resort-website-cross-check.md` §2.1.
  it("matches the customer's own rate card and engine, not the marketing page", () => {
    expect(TRANSPORT_RATE.roundtrip).toBe(13000);
    expect(TRANSPORT_RATE.oneway).toBe(6500);
  });

  it("counts the vans a group actually needs", () => {
    // 6 per van: the only capacity the team estimators demonstrate (seven guests split into a van of
    // 6 and a van of 1). The site says "max 7 pax"; assuming 7 would under-count a van.
    expect(vansForGuests(1)).toBe(1);
    expect(vansForGuests(6)).toBe(1);
    expect(vansForGuests(7)).toBe(2);
    expect(vansForGuests(12)).toBe(2);
    expect(vansForGuests(13)).toBe(3);
    expect(vansForGuests(0)).toBe(1);
    expect(vanLoads(7)).toEqual([{ pax: 6 }, { pax: 1 }]);
    expect(vanLoads(12)).toEqual([{ pax: 6 }, { pax: 6 }]);
  });

  it("drafts one van for a small group, and two for a group of seven", () => {
    const two = buildHonoQuotationDraft(anaTrip({ guests: f(2), rooms: f(1), transport: f(true) }));
    const twoVan = two.lineItems.find((i) => i.category === "transfer")!;
    expect(twoVan.quantity).toBe(1);
    expect(twoVan.unitPrice).toBe(13000);
    expect(twoVan.subtotal).toBe(13000);
    expect(twoVan.description).not.toContain("2 vans");

    // Seven guests riding: one van cannot carry them, and a flat one-van line drafted a transfer
    // ₱13,000 short of what the engine would charge.
    const seven = buildHonoQuotationDraft(anaTrip({ guests: f(7), rooms: f(4), transport: f(true) }));
    const sevenVans = seven.lineItems.find((i) => i.category === "transfer")!;
    expect(sevenVans.quantity).toBe(2);
    expect(sevenVans.unitLabel).toBe("vans");
    expect(sevenVans.subtotal).toBe(26000);
    expect(sevenVans.description).toContain("2 vans");
  });

  it("charges one van when a transfer was asked for but no guest is flagged as riding", () => {
    // `transport: true` with no per-guest flag is what a guest who says "we need the airport pickup"
    // produces; the van is still a van.
    const trip = anaTrip({ transport: f(true), transportType: f("roundtrip") });
    const van = buildHonoQuotationDraft(trip).lineItems.find((i) => i.category === "transfer")!;
    expect(van.quantity).toBe(1);
    expect(van.subtotal).toBe(13000);
  });
});
