import fs from 'node:fs';

const upstreamTestFile = 'E:/tn-casa-quotation-estimator/ai/test/roomCapacity.test.ts';

const testCode = `import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildBffTrip, validateBffTripPrecheck, AiTripSchema } from "../src/index.ts";

type AiTrip = z.infer<typeof AiTripSchema>;

const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });

function tripOf(overrides: Record<string, unknown> = {}): AiTrip {
  return AiTripSchema.parse({
    language: f("en", "default"),
    contactName: f("Ana"),
    checkIn: f("2026-11-20"),
    checkOut: f("2026-11-22"),
    nights: f(2),
    guests: f(3),
    rooms: f(1, "default"),
    roomType: f("standard", "default"),
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
  });
}

const codes = (t: ReturnType<typeof buildBffTrip>) => validateBffTripPrecheck(t).map((i) => i.code);

describe("buildBffTrip capacity-aware room count", () => {
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

  it("a stated '1 room' for 3 people in standard room is kept as said and flagged with room-over-capacity", () => {
    const t = buildBffTrip(tripOf({ rooms: f(1, "stated") }));
    expect(t.rooms).toHaveLength(1);
    const issue = validateBffTripPrecheck(t).find((i) => i.code === "room-over-capacity");
    expect(issue).toBeDefined();
    expect(issue?.level).toBe("error");
  });

  it("a stated count that holds the group is honoured", () => {
    const t = buildBffTrip(tripOf({ rooms: f(3, "stated") }));
    expect(t.rooms).toHaveLength(3);
    expect(codes(t)).not.toContain("room-over-capacity");
  });
});
`;

fs.writeFileSync(upstreamTestFile, testCode, 'utf8');
console.log("Updated " + upstreamTestFile);
