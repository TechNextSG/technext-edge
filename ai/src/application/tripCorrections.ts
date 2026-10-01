/**
 * Which of the bot's disagreements with a record did the guest actually just say?
 *
 * The problem this answers, measured on production on 2026-09-28: the extractor re-reads the WHOLE
 * transcript on every turn, so its answer on turn *n* is a reading of everything the guest has ever
 * said — including text that was already priced and already corrected. Spreading that answer over
 * the record therefore reverted a staff correction the guest never contradicted: a dive day staff
 * had moved from Ana to Ben went back to Ana on the guest's next message ("everything else is as we
 * said"), and because the two trips then differed, the same turn dropped the price and the approval.
 * The record ended up blaming the guest for a change they never made.
 *
 * So a corrected record keeps its trip, and the bot's reading is only allowed to move a field when
 * the guest's own words in THIS turn support it. That is the same gate `extract.ts` applies to a
 * `stated` field — the model's `evidence` must be a verbatim substring of the guest's text — asked
 * of the newest message instead of the whole conversation. It is what separates:
 *
 *   * "Sorry, there are 4 of us"      → `guests` is stated, with evidence in this message: accept,
 *                                       and let the money boundary drop the price as it should;
 *   * "thanks!" / "we arrive at 4pm"  → nothing priced is restated: keep the record's trip, because
 *                                       the only thing that changed is the model's re-reading.
 *
 * The mapping is deliberately conservative — a path it cannot place is *not* treated as restated, so
 * the failure mode is "a human's correction survives and staff are told", never "the bot silently
 * overwrote a human with an old reading".
 */
import type { Trip } from "../domain/schema.ts";

/**
 * Which extracted fields a differing `BffTrip` path is a reading of.
 *
 * Paths come from `diffBffTrip` and look like `guests[1].days.2026-11-22.dive` or `rooms[0].type`.
 * Several extractor fields feed one path (a dive day can come from `diveFrom`, `diveTo` or the
 * dive notes), so the answer is a list and any one of them restating the fact is enough.
 */
export function extractorFieldsForTripPath(path: string): string[] {
  const guestField = /^guests\[\d+\]\.(\w+)/.exec(path)?.[1];
  if (guestField) {
    switch (guestField) {
      case "diver":
        return ["divers", "diver"];
      case "meals":
        return ["meals"];
      case "transport":
        return ["transport", "transportType"];
      case "foc":
        return ["guests", "guestType"];
      case "roomId":
        return ["rooms", "roomType", "guests"];
      case "courses":
        return ["courses"];
      case "days":
        return ["diveFrom", "diveTo", "diveNotes"];
      case "arrive":
      case "depart":
      case "comment":
        return ["diveNotes", "arrive", "depart", "comment"];
      case "vanA":
      case "vanD":
        return ["transport", "transportType"];
      default:
        return ["guests"];
    }
  }
  if (path.startsWith("guests.length")) return ["guests"];
  if (path.startsWith("checkIn")) return ["checkIn"];
  if (path.startsWith("checkOut")) return ["checkOut", "nights"];
  if (path.startsWith("nights")) return ["nights", "checkIn", "checkOut"];
  if (path.startsWith("rooms")) return ["rooms", "roomType"];
  if (path.startsWith("roomType")) return ["roomType", "rooms"];
  if (path.startsWith("transportType") || path.startsWith("transport")) return ["transportType", "transport"];
  if (path.startsWith("diveFrom") || path.startsWith("diveTo") || path.startsWith("diveNotes")) {
    return ["diveFrom", "diveTo", "diveNotes"];
  }
  if (path.startsWith("dmByDay") || path.startsWith("extraDMByDay")) return ["diveFrom", "diveTo", "diveNotes"];
  if (path.startsWith("bookedDaysAhead")) return ["bookedDaysAhead"];
  if (path.startsWith("guestType")) return ["guestType"];
  // `items`, `label`, `vanSplit`, `vanMeta` are built by the tool, not read from the guest, so a
  // difference there is never something the guest's words can justify.
  return [];
}

/**
 * The differing paths the guest's newest message supports, by the same verbatim-evidence rule the
 * extractor applies to a `stated` field.
 *
 * `trip` is the extraction result (its fields carry `evidence`), `guestText` is THIS turn's message
 * — not the transcript, which is what makes the distinction possible at all.
 */
export function pathsRestatedByGuest(changedPaths: string[], trip: Trip, guestText: string): string[] {
  const haystack = guestText.toLowerCase();
  const fields = trip as unknown as Record<string, { evidence?: unknown } | undefined>;
  return changedPaths.filter((path) => {
    const candidates = extractorFieldsForTripPath(path);
    if (candidates.length === 0) return false;
    return candidates.some((field) => {
      const evidence = fields[field]?.evidence;
      return typeof evidence === "string" && evidence.length > 0 && haystack.includes(evidence.toLowerCase());
    });
  });
}
