// The handoff envelope decides whether a finished Trip can be auto-priced or has to go to staff.
// Moved from ai/test/questions.test.ts with the adapter itself: the AI package no longer builds it.
import { describe, it, expect } from "vitest";
import type { Trip } from "../src/index.ts";
import { buildOdooHandoffPayload } from "../src/index.ts";

const BLANK_RAW = {
  language: { value: null, state: "missing", evidence: null },
  checkIn: { value: null, state: "missing", evidence: null },
  checkOut: { value: null, state: "missing", evidence: null },
  nights: { value: null, state: "missing", evidence: null },
  guests: { value: null, state: "missing", evidence: null },
  rooms: { value: null, state: "missing", evidence: null },
  roomType: { value: null, state: "missing", evidence: null },
  meals: { value: null, state: "missing", evidence: null },
  transport: { value: null, state: "missing", evidence: null },
  contactName: { value: null, state: "missing", evidence: null },
  // The optional Tier-2 fields are present-and-missing here. A provider does not
  // always return them (see extract.test.ts) — extract.ts normalizes a key the model
  // omits back to missing, precisely so the diving question still reaches the guest.
  diver: { value: null, state: "missing", evidence: null },
  diveFrom: { value: null, state: "missing", evidence: null },
  diveTo: { value: null, state: "missing", evidence: null },
  transportType: { value: null, state: "missing", evidence: null },
};

describe("the Odoo handoff envelope", () => {
  it("Phase 2 Odoo Handoff Adapter: distinguishes auto_estimate_ready vs manual_staff_review", () => {
    const retailTrip: Trip = {
      ...(BLANK_RAW as unknown as Trip),
      language: { value: "en", state: "inferred", evidence: null },
      guestType: { value: "retail", state: "default", evidence: null },
      checkIn: { value: "2026-10-10", state: "stated", evidence: "Oct 10" },
      checkOut: { value: "2026-10-12", state: "derived", evidence: null },
      nights: { value: 2, state: "stated", evidence: "2 nights" },
      guests: { value: 2, state: "stated", evidence: "2 guests" },
      rooms: { value: 1, state: "default", evidence: null },
      roomType: { value: "standard", state: "stated", evidence: "standard room" },
      meals: { value: "full_board", state: "default", evidence: null },
      transport: { value: false, state: "stated", evidence: "no transfer" },
      transportType: { value: "none", state: "derived", evidence: null },
      diver: { value: false, state: "stated", evidence: "no diving" },
      contactName: { value: "Nhat", state: "stated", evidence: "Nhat" },
    };

    const retailHandoff = buildOdooHandoffPayload(retailTrip);
    expect(retailHandoff.mode).toBe("auto_estimate_ready");
    expect(retailHandoff.readyForAutoQuote).toBe(true);
    expect(retailHandoff.manualReviewReasons).toEqual([]);

    // Agency trip with split-day diveNotes -> manual_staff_review
    const complexAgentTrip: Trip = {
      ...retailTrip,
      guestType: { value: "agent", state: "inferred", evidence: null },
      diver: { value: true, state: "stated", evidence: "dives" },
      divers: { value: null, state: "missing", evidence: null },
      diveNotes: {
        value: "1 person dives day 1, 5 people dive both days",
        state: "stated",
        evidence: "1 person dives day 1, 5 people dive both days",
      },
    };

    const manualHandoff = buildOdooHandoffPayload(complexAgentTrip);
    expect(manualHandoff.mode).toBe("manual_staff_review");
    expect(manualHandoff.readyForAutoQuote).toBe(false);
    expect(manualHandoff.manualReviewReasons).toContain("partner_rate_confirmation_required:agent");
    expect(manualHandoff.manualReviewReasons).toContain("custom_split_day_dive_schedule");
  });
});

describe("a dive window the guest never gave, at handoff", () => {
  function tripWithDiveWindow(from: { value: unknown; state: string }, to: { value: unknown; state: string }): Trip {
    return {
      ...(BLANK_RAW as unknown as Trip),
      language: { value: "en", state: "inferred", evidence: null },
      guestType: { value: "retail", state: "default", evidence: null },
      checkIn: { value: "2026-11-25", state: "stated", evidence: "Nov 25" },
      checkOut: { value: "2026-11-29", state: "derived", evidence: null },
      nights: { value: 4, state: "stated", evidence: "4 nights" },
      guests: { value: 4, state: "stated", evidence: "family of 4" },
      rooms: { value: 2, state: "stated", evidence: "2 rooms" },
      roomType: { value: "standard", state: "stated", evidence: "2 standard rooms" },
      meals: { value: "full_board", state: "default", evidence: null },
      transport: { value: false, state: "stated", evidence: "we'll drive ourselves" },
      transportType: { value: "none", state: "derived", evidence: null },
      diver: { value: true, state: "stated", evidence: "My husband and I dive" },
      divers: { value: 2, state: "stated", evidence: "My husband and I dive" },
      diveNotes: { value: "Adults dive, kids snorkel only", state: "stated", evidence: "the kids will just snorkel" },
      contactName: { value: "Maria Santos", state: "stated", evidence: "Maria Santos" },
      diveFrom: from as never,
      diveTo: to as never,
    };
  }

  it("is not auto-priced: the handoff envelope routes it to manual review", () => {
    const guessed = buildOdooHandoffPayload(tripWithDiveWindow({ value: null, state: "missing" }, { value: null, state: "missing" }));
    expect(guessed.mode).toBe("manual_staff_review");
    expect(guessed.readyForAutoQuote).toBe(false);
    expect(guessed.manualReviewReasons).toContain("dive_window_not_stated");
  });

  it("leaves a guest-stated window on the auto path", () => {
    const stated = buildOdooHandoffPayload(tripWithDiveWindow({ value: "2026-11-26", state: "stated" }, { value: "2026-11-28", state: "stated" }));
    expect(stated.manualReviewReasons).not.toContain("dive_window_not_stated");
  });
});
