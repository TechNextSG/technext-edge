/**
 * Fixture rate cards and calculations for the simulated estimator.
 * Used strictly for local development and offline automated testing.
 * Isolated inside bff/src/estimator/ so the estimator never imports quote/.
 */

export type RoomType = "standard" | "deluxe" | "suite";

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  standard: "Standard Room",
  deluxe: "Deluxe Room",
  suite: "Suite",
};

interface RoomBand {
  maxPax: number;
  nightly: number;
}

export const ROOM_RATES: Record<RoomType, readonly RoomBand[]> = {
  standard: [
    { maxPax: 1, nightly: 5500 },
    { maxPax: 2, nightly: 7600 },
  ],
  deluxe: [
    { maxPax: 2, nightly: 11200 },
    { maxPax: 4, nightly: 16400.01 },
  ],
  suite: [
    { maxPax: 2, nightly: 14200 },
    { maxPax: 4, nightly: 18400 },
  ],
};

export const DIVE_TIERS: Record<number, number> = {
  1: 10000,
  2: 5500,
  3: 4500,
  4: 3600,
};

export const MEAL_RATE = 1500;
export const TRANSPORT_RATE = { roundtrip: 13000, oneway: 6500 } as const;
export const VAN_CAPACITY = 6;
export const COURSE_RATES = { dsd: 5500, ow: 22000, aow: 18000 } as const;

export function vansForGuests(guests: number): number {
  return Math.max(1, Math.ceil(Math.max(0, guests) / VAN_CAPACITY));
}

export function vanLoads(guests: number): Array<{ pax: number }> {
  const total = Math.max(0, guests);
  const vans: Array<{ pax: number }> = [];
  for (let left = total; left > 0; left -= VAN_CAPACITY) {
    vans.push({ pax: Math.min(VAN_CAPACITY, left) });
  }
  return vans.length > 0 ? vans : [{ pax: 0 }];
}

export function roomNightlyRate(type: RoomType, occupancy: number): number {
  const bands = ROOM_RATES[type];
  for (const band of bands) {
    if (occupancy <= band.maxPax) return band.nightly;
  }
  return bands[bands.length - 1]!.nightly;
}

export function diveTierPrice(diversOut: number): number {
  const key = Math.max(1, Math.min(4, Math.round(diversOut)));
  return DIVE_TIERS[key]!;
}
