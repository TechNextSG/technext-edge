/**
 * What staff changed in the trip the extractor built, field by field.
 *
 * Why this exists: the WhatsApp half of this product makes a claim — "the model reads the message
 * and code checks the facts" — and the only measurement of that claim is whether a person had to
 * correct the payload afterwards. Nothing in the pipeline could answer it. A quotation that was
 * priced and published told us the flow worked; it did not tell us whether anyone had to fix a
 * room type, move a guest between rooms, or add the dive day the guest actually meant.
 *
 * So the studio's trip review records the diff, and the staff list shows the ratio. Two decisions
 * are deliberate:
 *
 *   * **Field names, never values.** A diff of values would put guest names and dates into a
 *     metric that gets read out in a meeting, and it would not be more useful: the question is
 *     which facts the model gets wrong, not which guests were involved.
 *   * **Paths, not a count.** `guests[2].days.2026-11-21.dive` says the model missed one person's
 *     dive day; "3 changes" says nothing a person can act on. The paths are what make the number
 *     into a backlog item, which is the whole point of measuring it.
 *
 * It compares two `BffTrip`s, which is the shape both sides already speak — the trips the engine
 * was asked to price, before and after the correction — so it needs no access to the extraction
 * `Trip` and cannot disagree with what was actually sent.
 */
import type { BffGuest, BffTrip } from "../domain/schema.js";

/** One correction: when it happened, and which field paths it touched (never their values). */
export interface StaffTripEdit {
  at: string;
  fields: string[];
  /**
   * Which route recorded it. `/trip` is a save from the trip review panel; `/confirm` is an approval
   * that arrived carrying a correction. Both count towards the extractor's scorecard — a correction
   * is a correction — but a reader of the record can tell a deliberate save from something that came
   * in with the approval. Absent on edits recorded before this field existed.
   */
  source?: "trip" | "approve";
}

/** Stable string/JSON form of a leaf value, so `undefined` and a missing key compare equal. */
function leaf(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

function compareInto(prefix: string, before: unknown, after: unknown, out: Set<string>): void {
  if (Array.isArray(before) || Array.isArray(after)) {
    const a = Array.isArray(before) ? before : [];
    const b = Array.isArray(after) ? after : [];
    // A length change is a change to the collection itself, and the caller can see it without every
    // element being listed as moved.
    if (a.length !== b.length) out.add(`${prefix}.length`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      compareInto(`${prefix}[${i}]`, a[i], b[i], out);
    }
    return;
  }

  const bothPlainObjects =
    before !== null && after !== null && typeof before === "object" && typeof after === "object";
  if (bothPlainObjects) {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    for (const key of keys) {
      compareInto(
        prefix ? `${prefix}.${key}` : key,
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        out,
      );
    }
    return;
  }

  if (leaf(before) !== leaf(after)) out.add(prefix);
}

/**
 * The field paths that differ between the trip the bot produced and the trip staff saved.
 *
 * Empty means staff looked at the payload and changed nothing — the case worth counting. The
 * comparison is structural and value-based, so re-saving an identical trip is not a false edit,
 * and the order of the paths is stable (sorted) so two runs cannot disagree about the same diff.
 */
export function diffBffTrip(before: BffTrip, after: BffTrip): string[] {
  const out = new Set<string>();
  compareInto("", before, after, out);
  return [...out].sort();
}

/**
 * One guest's *priced* facts: what the engine charges for, and nothing else.
 *
 * Names, comments and arrival times are deliberately out. They are facts worth keeping, and
 * `diffBffTrip` above counts an edit to any of them, but a price is not a function of them — so
 * treating a corrected spelling of a guest's name as "the trip this price belongs to has changed"
 * would throw away a valid approval for a reason nobody can act on. The distinction is the whole
 * point of this function, so it is stated here rather than left to whoever reads the projection.
 */
function guestPricedFacts(guest: BffGuest): unknown {
  return {
    diver: guest.diver,
    meals: guest.meals,
    transport: guest.transport,
    foc: guest.foc,
    roomId: guest.roomId,
    // Sorted, because the order a guest listed two courses in is not a price.
    courses: [...guest.courses].sort(),
    // Date keys sorted for the same reason; what is priced is the per-day flags, and `boatId`
    // because a boat is a capacity the engine is asked to respect.
    days: Object.keys(guest.days)
      .sort()
      .map((date) => {
        const day = guest.days[date];
        return [date, day?.dive, day?.third, day?.night, day?.boatId];
      }),
    vanA: guest.vanA,
    vanD: guest.vanD,
  };
}

/**
 * The priced facts of a trip, as a stable string. Two trips with the same key are the same
 * quotation as far as money is concerned.
 *
 * Guests are compared in the order given, not sorted: room assignment is positional
 * (`guests[i].roomId`), so swapping two guests between rooms is a change even when the set of
 * facts is identical — the engine is being pointed at different people.
 */
export function pricedFactsKey(trip: BffTrip): string {
  return JSON.stringify({
    guestType: trip.guestType,
    transportType: trip.transportType,
    checkIn: trip.checkIn,
    checkOut: trip.checkOut,
    diveFrom: trip.diveFrom,
    diveTo: trip.diveTo,
    bookedDaysAhead: trip.bookedDaysAhead,
    rooms: trip.rooms.map((room) => [room.id, room.type]),
    guests: trip.guests.map(guestPricedFacts),
    items: trip.items.map((item) => [item.id, item.name, item.price, item.qty, item.mode, item.date, item.dateTo, item.gids]),
    vanSplit: trip.vanSplit,
    vanMeta: Object.keys(trip.vanMeta)
      .sort()
      .map((key) => [key, trip.vanMeta[key] ?? null]),
  });
}

/**
 * Did the guest — or a correction — change anything the price is computed from?
 *
 * Used at the enquiry boundary: an approved quotation whose trip moved is no longer approved,
 * because the approval was given for numbers that no longer describe the booking. Passing `null`
 * for either side answers `false`: with no stored trip there is nothing to compare, and inventing
 * a change would drop approvals at random.
 */
export function pricedFactsChanged(before: BffTrip | null | undefined, after: BffTrip | null | undefined): boolean {
  if (!before || !after) return false;
  return pricedFactsKey(before) !== pricedFactsKey(after);
}
