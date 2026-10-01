import { describe, it, expect } from "vitest";
import { buildBffTrip, validateBffTripPrecheck } from "../src/application/odooHandoff.ts";
import type { Trip } from "../src/index.ts";

// The source engine splits an over-full single room on POST but refuses it on PATCH and commit
// (422 `room-over-capacity`). The trip we keep is what gets PATCHed, so it has to be split already.

const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });

function tripOf(overrides: Partial<Record<keyof Trip, unknown>> = {}): Trip {
  return {
    language: f("en", "default"),
    contactName: f("Ana"),
    checkIn: f("2026-11-20"),
    checkOut: f("2026-11-22"),
    nights: f(2),
    guests: f(3),
    rooms: f(1, "default"),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none"),
    diver: f(false),
    divers: f(null, "missing"),
    diveFrom: f(null, "missing"),
    diveTo: f(null, "missing"),
    diveNotes: f(null, "missing"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
    ...overrides,
  } as unknown as Trip;
}

const codes = (t: ReturnType<typeof buildBffTrip>) => validateBffTripPrecheck(t).map((i) => i.code);

describe("buildBffTrip room count", () => {
  it("three guests in standard rooms, count not stated -> 2 rooms, filled in order", () => {
    const t = buildBffTrip(tripOf());
    expect(t.rooms.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(t.guests.map((g) => g.roomId)).toEqual(["r1", "r1", "r2"]);
    expect(codes(t)).not.toContain("room-over-capacity");
  });

  it("uses the capacity of the room type the guest named", () => {
    const deluxe = buildBffTrip(tripOf({ roomType: f("deluxe") }));
    expect(deluxe.rooms).toHaveLength(1);
    const five = buildBffTrip(tripOf({ guests: f(5), roomType: f("deluxe") }));
    expect(five.rooms).toHaveLength(2);
  });

  it("a stated '1 room' for 3 people is kept as said and flagged, not silently raised", () => {
    const t = buildBffTrip(tripOf({ rooms: f(1, "stated") }));
    expect(t.rooms).toHaveLength(1);
    const issue = validateBffTripPrecheck(t).find((i) => i.code === "room-over-capacity");
    expect(issue).toMatchObject({ level: "error", params: { roomId: "r1", date: "2026-11-20", n: 3, cap: 2 } });
    expect(issue!.fields).toEqual(["guests[0].roomId", "guests[1].roomId", "guests[2].roomId"]);
  });

  it("a stated count that holds the group is honoured", () => {
    const t = buildBffTrip(tripOf({ rooms: f(3, "stated") }));
    expect(t.rooms).toHaveLength(3);
    expect(codes(t)).toEqual([]);
  });

  it("counts a guest only on the nights they are in the room", () => {
    const t = buildBffTrip(tripOf({ rooms: f(1, "stated") }));
    t.guests[2]!.arrive = "2026-11-21";
    expect(validateBffTripPrecheck(t).find((i) => i.code === "room-over-capacity")?.params?.date).toBe("2026-11-21");
    // Never in the room on a night -> never more than two at once.
    t.guests[2]!.arrive = "2026-11-22";
    t.guests[2]!.depart = "2026-11-22";
    expect(codes(t)).not.toContain("room-over-capacity");
  });
});
