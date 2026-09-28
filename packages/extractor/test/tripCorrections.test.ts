// The gate that keeps the bot from undoing a person's correction.
//
// `pathsRestatedByGuest` is the smallest piece of the fix for the production bug of 2026-09-28 (a
// staff dive-day correction reverted by the guest's next message), and it is the piece worth testing
// on its own: everything else in that path is the channel's bookkeeping, while this decides which of
// the bot's disagreements the guest's own words actually support.
//
// The two cases that must never collapse into one another:
//   * "sorry, there are 4 of us" — a priced fact the guest stated, so the change lands and the price
//     must drop;
//   * "everything else is as we said" / "thanks!" — nothing stated, so the record keeps its trip.
import { describe, it, expect } from "vitest";
import { extractorFieldsForTripPath, pathsRestatedByGuest } from "../src/tripCorrections.js";
import type { Trip } from "../src/schema.js";

const f = (value: unknown, evidence: string | null, state = evidence ? "stated" : "missing") => ({
  value,
  state,
  evidence,
});

/** Only the fields these cases read; the rest of `Trip` is irrelevant to the mapping. */
function trip(overrides: Record<string, unknown> = {}): Trip {
  return {
    checkIn: f("2026-11-20", "nov 20"),
    checkOut: f("2026-11-22", null),
    nights: f(2, "2 nights"),
    guests: f(2, "2 of us"),
    rooms: f(1, "1 room"),
    roomType: f("deluxe", "deluxe"),
    meals: f("full_board", "full board"),
    transport: f(false, "no transport"),
    transportType: f("none", "no transport"),
    guestType: f("retail", null, "default"),
    diver: f(true, "dive"),
    divers: f(2, "both dive"),
    diveFrom: f("2026-11-21", "nov 21"),
    diveTo: f("2026-11-21", "nov 21"),
    diveNotes: f(null, null),
    contactName: f("Minh", "minh"),
    ...overrides,
  } as unknown as Trip;
}

describe("which extractor field a differing trip path is a reading of", () => {
  it("maps the paths the extractor actually produces", () => {
    expect(extractorFieldsForTripPath("guests[1].days.2026-11-21.dive")).toEqual(["diveFrom", "diveTo", "diveNotes"]);
    expect(extractorFieldsForTripPath("guests[0].meals")).toEqual(["meals"]);
    expect(extractorFieldsForTripPath("guests[0].diver")).toEqual(["divers", "diver"]);
    expect(extractorFieldsForTripPath("guests.length")).toEqual(["guests"]);
    expect(extractorFieldsForTripPath("rooms[0].type")).toEqual(["rooms", "roomType"]);
    expect(extractorFieldsForTripPath("checkIn")).toEqual(["checkIn"]);
  });

  it("claims nothing for a path the guest's words cannot justify", () => {
    // `label`, `items` and the van split are built by the tool from other facts, so a difference
    // there is a difference in how the record was assembled — never something the guest restated.
    expect(extractorFieldsForTripPath("label")).toEqual([]);
    expect(extractorFieldsForTripPath("items")).toEqual([]);
    expect(extractorFieldsForTripPath("vanSplit")).toEqual([]);
  });
});

describe("which disagreements the guest's newest message supports", () => {
  it("accepts a priced fact the guest stated in this message", () => {
    // The evidence is the one the extraction returned for THIS turn — "4 of us" — because that is
    // what the gate compares against the newest message.
    const restated = pathsRestatedByGuest(
      ["guests.length", "guests[2].name"],
      trip({ guests: f(4, "4 of us") }),
      "Sorry, there are 4 of us",
    );
    expect(restated).toContain("guests.length");
  });

  it("rejects a difference the guest only stated in an earlier message", () => {
    // The exact production case: the dives were stated on the first turn, and the new message says
    // nothing about them, so the extractor's reading of them must not move the record.
    const restated = pathsRestatedByGuest(
      ["guests[0].days.2026-11-21.dive", "guests[1].days.2026-11-21.dive"],
      trip(),
      "One more thing: our flight lands at 4pm, everything else is as we said.",
    );
    expect(restated).toEqual([]);
  });

  it("is case-insensitive, like the extractor's own evidence check", () => {
    expect(pathsRestatedByGuest(["guests[0].meals"], trip(), "FULL BOARD please")).toContain("guests[0].meals");
  });

  it("treats a differently-worded restatement as not restated, because there is no evidence for it", () => {
    // "make it a suite" would need `roomType` stated with evidence from the model; the model's own
    // evidence string is what is checked, so a guess with no evidence cannot move a corrected record.
    const restated = pathsRestatedByGuest(
      ["rooms[0].type"],
      trip({ roomType: f("suite", null, "inferred") }),
      "actually make it a suite",
    );
    expect(restated).toEqual([]);
  });

  it("keeps several answers when the guest restated several facts", () => {
    const restated = pathsRestatedByGuest(
      ["guests.length", "guests[0].days.2026-11-21.dive", "guests[0].meals"],
      trip({ guests: f(4, "4 of us") }),
      "There are 4 of us now, both dives on Nov 21, and full board for everyone",
    );
    expect(restated).toEqual(["guests.length", "guests[0].days.2026-11-21.dive", "guests[0].meals"]);
  });
});
