// The customer's real rate card, captured 17/09/2026 from 14 live calls into Odoo staging.
//
// SCOPE, since 2026-09-26: this file feeds **only** `apps/casa-bff/src/simulatedEstimator.ts`, the
// built-in stand-in used when `ESTIMATOR_MODE=simulated` (local dev, tests, and a demo with no BFF
// to reach). It is not a pricing authority, and nothing a guest receives is computed from it: the
// price a guest is sent is Odoo's, produced by the customer's own quotation app and published by a
// staff member. Before that rule these numbers were rendered onto a public `/q/:slug` page as soon
// as the bot had enough information — a price quoted to a customer before anyone at the resort had
// seen it. That page is gone.
//
// Provenance (the three sources the lead pointed us at — do not invent numbers here):
//   1. https://casa-escondida-estimator-tools.vercel.app/casa-api-guide  (field guide)
//   2. contracts/odoo/examples/rates.json in the cloned tn-casa-quotation-estimator repo
//   3. contracts/odoo/examples/compute.*.json — real compute responses that show the rules applied
//
// The rules, as the sources state them:
//   * roomRates are PER NIGHT PER ROOM, keyed by how many people occupy that room that night
//     ("nightly rate ÷ that night's roommates, summed over your stay").
//   * diveTiers is read by the NUMBER OF DIVERS IN THE WATER THAT DAY, not the total guest
//     count. One boat-dive line per dive day. (1 diver -> 10,000, 2 -> 5,500, 3 -> 4,500,
//     4+ -> 3,600 — a per-head price, so the more divers share the boat the cheaper each is.)
//   * mealRate is per person per day, and meals are NEVER guest-type discounted.
//   * transport is a per-van price: roundtrip 13,000, oneway 6,500.
//   * the agent/instructor discount is 30% OFF ROOMS ONLY.
//
// This is a COPY that will drift the moment Phillip changes the live rates, so it is a draft
// estimate only — the authoritative price is Odoo's `POST /v1/estimate/compute` response, which
// is what this service surfaces once the estimator leaves FIXTURE_MODE. Until then, "cứ chạy giá,
// giá thật đưa sau" — run this local estimate, swap in Odoo's lines later.
export type RoomType = "standard" | "deluxe" | "suite";

/**
 * How each room type is named on a quotation line.
 *
 * Exists because the room line's description was a fixed "Standard Room (Twin / Double Occupancy)"
 * while its unit price came from whatever rooms were booked, so a deluxe booking showed a standard
 * room carrying a deluxe rate. Caught on production on 2026-09-28, on a quotation used to argue that
 * the arithmetic was trustworthy.
 */
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

/** The per-day, per-diver boat price, keyed by the number of divers out that day (capped at 4). */
export const DIVE_TIERS: Record<number, number> = {
  1: 10000,
  2: 5500,
  3: 4500,
  4: 3600,
};

export const MEAL_RATE = 1500;
export const TRANSPORT_RATE = { roundtrip: 13000, oneway: 6500 } as const;
export const COURSE_RATES = { dsd: 5500, ow: 22000, aow: 18000 } as const;
export const PARTNER_DISCOUNT_PCT = 30;

/**
 * The nightly room rate for a given occupancy, falling back to the highest band when a room is
 * over capacity (an invalid config — standard rooms hold 2 — that Odoo will handle its own way;
 * a draft estimate must not crash on it).
 */
export function roomNightlyRate(type: RoomType, occupancy: number): number {
  const bands = ROOM_RATES[type];
  for (const band of bands) {
    if (occupancy <= band.maxPax) return band.nightly;
  }
  return bands[bands.length - 1]!.nightly;
}

/** Per-diver boat price for the day, keyed by divers-out (capped at 4). */
export function diveTierPrice(diversOut: number): number {
  const key = Math.max(1, Math.min(4, Math.round(diversOut)));
  return DIVE_TIERS[key]!;
}
