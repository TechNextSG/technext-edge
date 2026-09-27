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
import type { BffTrip } from "./schema.js";

/** One correction: when it happened, and which field paths it touched (never their values). */
export interface StaffTripEdit {
  at: string;
  fields: string[];
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
