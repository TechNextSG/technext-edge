// PLACEHOLDER values — these are guesses standing in for real Casa house norms.
// Confirm the actual defaults with Jett/Eloa before this feeds the eval run;
// wrong guesses here surface as fabricated-looking fields, which the eval's
// zero-tolerance metric will (correctly) flag.
export const HOUSE_NORMS = {
  meals: "full_board",
  transport: false,
  rooms: 1,
  language: "en",
} as const;

export type RoomCaps = Partial<Record<"standard" | "deluxe" | "suite", number>>;

/**
 * How many people one room of each type holds, as the source engine enforces it.
 *
 * The source derives this from `rates.roomRates[type]` (`roomCaps` in its `bff/src/trip/validate.ts`):
 * the largest pax count in the tier keys ("2pax" -> 2, "3-4pax" -> 4). This table is the fallback
 * for when we have not read `/api/rates`; `bffContractParity.test.ts` pins it against the vendored
 * snapshot so a change on their side turns a test red instead of a staff PATCH into a 422.
 */
export const DEFAULT_ROOM_CAPS: Readonly<Required<RoomCaps>> = {
  standard: 2,
  deluxe: 4,
  suite: 4,
};

/** Same rule as the source's `roomCaps`: largest number in the tier keys of each known room type. */
export function roomCapsFromRates(
  rates: { roomRates?: Record<string, unknown> | null } | null | undefined,
): RoomCaps {
  const caps: RoomCaps = {};
  const table = rates?.roomRates;
  if (typeof table !== "object" || table === null) return caps;
  for (const type of ["standard", "deluxe", "suite"] as const) {
    const tiers = table[type];
    if (typeof tiers !== "object" || tiers === null || Array.isArray(tiers)) continue;
    const counts = Object.keys(tiers).flatMap((key) => (key.match(/\d+/g) ?? []).map(Number));
    if (counts.length > 0) caps[type] = Math.max(...counts);
  }
  return caps;
}
