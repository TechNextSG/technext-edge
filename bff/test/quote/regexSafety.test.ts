import { describe, it, expect } from "vitest";
import type { Trip } from "../../../ai/src/index.ts";
import { buildHonoQuotationDraft } from "../../src/quote/index.ts";

// The split-day dive parser reads the guest's diveNotes verbatim. It was rewritten to stay linear on
// a long digit run (CodeQL js/polynomial-redos); this pins that, and that the count it reads is unchanged.
const f = (value: unknown, state = "stated") => ({ value, state, evidence: null });

function tripWithNotes(notes: string): Trip {
  return {
    language: f("en", "default"), contactName: f("Ana"), checkIn: f("2026-11-20"), checkOut: f("2026-11-22"),
    nights: f(2), guests: f(3), rooms: f(1, "default"), meals: f("full_board"), transport: f(false),
    guestType: f("retail", "default"), transportType: f("none"), diver: f(true),
    divers: f(null, "missing"), diveFrom: f(null, "missing"), diveTo: f(null, "missing"),
    diveNotes: f(notes), specialRequests: f(null, "missing"), guestNames: f([]), roomType: f("standard"),
  } as unknown as Trip;
}

describe("the split-day dive parser", () => {
  it("stays linear on a long digit run in the notes", () => {
    const started = Date.now();
    buildHonoQuotationDraft(tripWithNotes("9".repeat(100_000) + " x"));
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("still adds the day-one diver to the both-days group", () => {
    const draft = buildHonoQuotationDraft(tripWithNotes("1 person dives day 1, 5 people dive both days"));
    expect(draft.totalGroupSize).toBe(6);
  });
});
