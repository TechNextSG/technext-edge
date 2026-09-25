import { describe, it, expect } from "vitest";
import {
  BffTrip,
  buildBffTrip,
  buildOdooHandoffPayload,
  validateBffTripPrecheck,
  type Trip,
} from "../src/index.js";

function makeCompleteSarahTrip(): Trip {
  return {
    language: { value: "en", state: "default", evidence: null },
    contactName: { value: "Sarah Jenkins", state: "stated", evidence: "Sarah Jenkins" },
    checkIn: { value: "2026-10-17", state: "stated", evidence: "Oct 17, 2026" },
    checkOut: { value: "2026-10-20", state: "derived", evidence: null },
    nights: { value: 3, state: "stated", evidence: "3 nights" },
    guests: { value: 4, state: "stated", evidence: "4 guests" },
    rooms: { value: 2, state: "stated", evidence: "2 Deluxe rooms" },
    meals: { value: "full_board", state: "stated", evidence: "full board" },
    transport: { value: true, state: "stated", evidence: "airport pickup from Manila" },
    guestType: { value: "retail", state: "default", evidence: null },
    transportType: { value: "oneway", state: "stated", evidence: "pickup from Manila" },
    diver: { value: true, state: "stated", evidence: "boat diving" },
    divers: { value: 2, state: "stated", evidence: "2 divers" },
    diveFrom: { value: "2026-10-18", state: "stated", evidence: "Oct 18" },
    diveTo: { value: "2026-10-19", state: "stated", evidence: "Oct 19" },
    diveNotes: { value: "2 divers on Oct 18-19", state: "stated", evidence: "2 divers" },
    specialRequests: { value: null, state: "missing", evidence: null },
    guestNames: { value: ["Sarah Jenkins"], state: "stated", evidence: "Sarah Jenkins" },
  };
}

describe("P5 BFF & Odoo Estimate Schema Contract (docs/06-p5-bff-schema-contract.md)", () => {
  it("validates the canonical retail couple example from schema.md §2.4", () => {
    const canonicalPayload = {
      label: "Retail couple — 2 nights",
      guestType: "retail",
      transportType: "none",
      checkIn: "2026-11-20",
      checkOut: "2026-11-22",
      diveFrom: "2026-11-21",
      diveTo: "2026-11-21",
      bookedDaysAhead: 0,
      rooms: [{ id: "r1", type: "standard", name: null }],
      guests: [
        {
          id: "g1",
          name: "Ana",
          diver: true,
          meals: true,
          transport: false,
          foc: false,
          roomId: "r1",
          courses: [],
          days: { "2026-11-21": { dive: true, third: false, night: false, boatId: null } },
        },
        {
          id: "g2",
          name: "Ben",
          diver: false,
          meals: true,
          transport: false,
          foc: false,
          roomId: "r1",
          courses: [],
          days: {},
        },
      ],
      items: [],
      vanSplit: null,
      vanMeta: {},
      extraDMByDay: {},
      dmByDay: {},
    };

    const parsed = BffTrip.parse(canonicalPayload);
    expect(parsed.guests).toHaveLength(2);
    expect(parsed.guests[0]?.diver).toBe(true);
    expect(parsed.guests[1]?.diver).toBe(false);
    expect(validateBffTripPrecheck(parsed)).toEqual([]);
  });

  it("builds a valid BffTrip from Sarah Jenkins's 4-guest, 2-room, 2-diver Trip", () => {
    const trip = makeCompleteSarahTrip();
    const envelope = buildOdooHandoffPayload(trip);

    expect(envelope.bffTrip).not.toBeNull();
    const bffTrip = envelope.bffTrip!;

    // Zod schema parse
    expect(() => BffTrip.parse(bffTrip)).not.toThrow();

    // 6 mandatory ★ groups
    expect(bffTrip.guestType).toBe("retail");
    expect(bffTrip.transportType).toBe("oneway");
    expect(bffTrip.checkIn).toBe("2026-10-17");
    expect(bffTrip.checkOut).toBe("2026-10-20");
    expect(bffTrip.diveFrom).toBe("2026-10-18");
    expect(bffTrip.diveTo).toBe("2026-10-19");

    // Rooms and Guest assignments
    expect(bffTrip.rooms).toEqual([
      { id: "r1", type: "standard", name: null },
      { id: "r2", type: "standard", name: null },
    ]);
    expect(bffTrip.guests).toHaveLength(4);

    // First 2 guests are divers with Oct 18 and Oct 19 in `days`
    expect(bffTrip.guests[0]?.diver).toBe(true);
    expect(Object.keys(bffTrip.guests[0]!.days)).toEqual(["2026-10-18", "2026-10-19"]);
    expect(bffTrip.guests[1]?.diver).toBe(true);
    expect(Object.keys(bffTrip.guests[1]!.days)).toEqual(["2026-10-18", "2026-10-19"]);

    // Remaining 2 guests explicitly set `diver: false` and `days: {}`
    expect(bffTrip.guests[2]?.diver).toBe(false);
    expect(bffTrip.guests[2]?.days).toEqual({});
    expect(bffTrip.guests[3]?.diver).toBe(false);
    expect(bffTrip.guests[3]?.days).toEqual({});

    // Zero validation errors or warnings
    expect(envelope.bffValidationIssues).toEqual([]);
    expect(envelope.bffEstimateRequest).toEqual({ trip: bffTrip });
  });

  it("detects pre-compute validation errors matching schema.md §3", () => {
    const trip = makeCompleteSarahTrip();
    const bffTrip = buildBffTrip(trip);

    // 1. Reversed dive window
    const badWindow = { ...bffTrip, diveFrom: "2026-10-19", diveTo: "2026-10-18" };
    expect(validateBffTripPrecheck(badWindow)).toContainEqual({
      code: "dive-window-reversed",
      fields: ["diveFrom", "diveTo"],
      level: "error",
    });

    // 2. Dive window outside stay
    const outsideStay = { ...bffTrip, diveFrom: "2026-10-16", diveTo: "2026-10-19" };
    expect(validateBffTripPrecheck(outsideStay)).toContainEqual({
      code: "dive-window-outside-stay",
      fields: ["diveFrom", "diveTo"],
      level: "error",
    });

    // 3. Empty room warning
    const extraRoom = {
      ...bffTrip,
      rooms: [...bffTrip.rooms, { id: "r3", type: "standard" as const, name: null }],
    };
    expect(validateBffTripPrecheck(extraRoom)).toContainEqual({
      code: "room-empty",
      fields: ["rooms[2]"],
      level: "warn",
    });
  });
});
