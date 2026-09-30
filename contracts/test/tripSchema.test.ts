import { describe, it, expect } from "vitest";
import { BffGuest, BffTrip, GuestType } from "../src/index.js";

// The schema's own guarantees, independent of how quotation/ builds a payload. The parity test in
// quotation/ checks this file against the vendored upstream spec; these check the rules a reader of
// trip.zod.ts relies on.
describe("the BFF trip contract", () => {
  const minimal = {
    guestType: "retail",
    transportType: "none",
    checkIn: "2026-11-20",
    checkOut: "2026-11-22",
    diveFrom: null,
    diveTo: null,
  };

  it("fills every defaulted field, so an omitted key and upstream's default are the same value", () => {
    const trip = BffTrip.parse(minimal);
    expect(trip).toMatchObject({ label: null, bookedDaysAhead: 0, rooms: [], guests: [], items: [], vanSplit: null });
  });

  it("rejects a guest type the estimator does not price", () => {
    expect(GuestType.safeParse("wholesale").success).toBe(false);
    expect(BffTrip.safeParse({ ...minimal, guestType: "wholesale" }).success).toBe(false);
  });

  it("does not default `diver`: upstream treats a missing flag as a diver, so it must be explicit", () => {
    expect(BffGuest.safeParse({ roomId: "r1" }).success).toBe(false);
    expect(BffGuest.parse({ roomId: "r1", diver: false })).toMatchObject({ diver: false, days: {}, courses: [] });
  });
});
