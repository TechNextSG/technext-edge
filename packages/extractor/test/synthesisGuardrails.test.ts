// Đợt 2 — the reply layer: what the model is told, and what it is allowed to say back.
//
// Both halves matter for the same reason. The prompt is where a guess becomes a "fact" the model
// dutifully repeats, and the gate is the only thing standing between a confident sentence and a
// guest reading it. Each rule below therefore gets a case that must be caught and a case that must
// NOT be — a gate that rejects correct replies is worse than no gate, because it silently replaces
// every answer with the deterministic fallback.
import { describe, it, expect, vi } from "vitest";
import { synthesizeHospitalityReply, verifySynthesizedReply, verifyGuestFacingText } from "../src/synthesis.js";
import { renderReply, generateQuestions, getStaffAlerts } from "../src/questions.js";
import type { Trip } from "../src/schema.js";
import type { ExtractProvider } from "../src/provider.js";

function blank(): Trip {
  const f = <T,>(value: T | null, state = "missing") => ({ value, state, evidence: null });
  return {
    language: f("en", "inferred"),
    checkIn: f(null),
    checkOut: f(null),
    nights: f(null),
    guests: f(null),
    rooms: f(null),
    meals: f(null),
    transport: f(null),
    contactName: f(null),
    guestType: f("retail", "default"),
    transportType: f(null),
    diver: f(null),
    divers: f(null),
    diveFrom: f(null),
    diveTo: f(null),
    diveNotes: f(null),
    specialRequests: f(null),
    guestNames: f(null),
  } as Trip;
}

/** The trip the prompt tests use: a transfer was asked for, and its type was never given. */
function transferUnstated(): Trip {
  return {
    ...blank(),
    checkIn: { value: "2026-11-20", state: "stated", evidence: "Nov 20" },
    checkOut: { value: "2026-11-22", state: "derived", evidence: null },
    nights: { value: 2, state: "stated", evidence: "2 nights" },
    guests: { value: 4, state: "stated", evidence: "4 of us" },
    rooms: { value: 2, state: "stated", evidence: "2 rooms" },
    transport: { value: true, state: "stated", evidence: "airport pickup" },
    transportType: { value: null, state: "missing", evidence: null },
    contactName: { value: "Ana", state: "stated", evidence: "Ana" },
  } as Trip;
}

function providerThatRecordsAndSays(text: string): { provider: ExtractProvider; prompts: string[] } {
  const prompts: string[] = [];
  const provider: ExtractProvider = {
    id: "fake:synthesis",
    call: vi.fn(),
    generateText: vi.fn(async (_system: string, user: string) => {
      prompts.push(user);
      return text;
    }),
  };
  return { provider, prompts };
}

const FALLBACK = "Deterministic fallback reply that is definitely long enough to pass the length gate.";

describe("what the synthesis prompt is told", () => {
  it("never hands the model a transfer type the guest did not choose", async () => {
    const { provider, prompts } = providerThatRecordsAndSays(FALLBACK);
    await synthesizeHospitalityReply(
      { turns: [], trip: transferUnstated(), questions: [], replyKind: "summary", fallbackText: FALLBACK },
      provider,
    );

    expect(prompts).toHaveLength(1);
    // The bug: `yes (${transportType ?? "roundtrip"})`. The model read it back, and a priced choice
    // the guest never made appeared in their own message as though they had made it.
    expect(prompts[0]).toContain("one-way or return — the guest has NOT said which");
    expect(prompts[0]).not.toContain("yes (roundtrip)");
  });

  it("still states the type once the guest has actually chosen one", async () => {
    const trip = { ...transferUnstated(), transportType: { value: "oneway", state: "stated", evidence: "one way" } } as Trip;
    const { provider, prompts } = providerThatRecordsAndSays(FALLBACK);
    await synthesizeHospitalityReply(
      { turns: [], trip, questions: [], replyKind: "summary", fallbackText: FALLBACK },
      provider,
    );
    expect(prompts[0]).toContain("yes (oneway)");
  });

  it("marks a house-norm default as the resort's assumption", async () => {
    const trip = { ...transferUnstated(), rooms: { value: 1, state: "default", evidence: null } } as Trip;
    const { provider, prompts } = providerThatRecordsAndSays(FALLBACK);
    await synthesizeHospitalityReply(
      { turns: [], trip, questions: [], replyKind: "summary", fallbackText: FALLBACK },
      provider,
    );
    expect(prompts[0]).toContain("HOUSE ASSUMPTION");
  });
});

describe("the fact gate catches what a model must not say", () => {
  const trip: Trip = {
    ...blank(),
    checkIn: { value: "2026-10-10", state: "stated", evidence: "Oct 10" },
    checkOut: { value: "2026-10-13", state: "derived", evidence: null },
    nights: { value: 3, state: "stated", evidence: "3 nights" },
    guests: { value: 4, state: "stated", evidence: "4 guests" },
    rooms: { value: 2, state: "stated", evidence: "2 rooms" },
    divers: { value: 2, state: "stated", evidence: "2 divers" },
  } as Trip;

  const rejected: Array<[string, string]> = [
    ["a price", "Your total will be ₱31,200 for the stay."],
    ["a false confirmation", "Great news — your booking is confirmed for October."],
    ["an invented 'all set'", "You're all set for your stay with us in October."],
    ["a reserved-for-you claim", "We have reserved for you the two rooms you asked about."],
    ["a booking-complete claim", "Your booking is complete and we look forward to hosting you."],
    ["a confirmation promise the app does not keep", "We will send you a confirmation email shortly."],
    ["a wrong night count", "So that is 4 nights in total, arriving on the 10th."],
    ["a wrong room count", "We have noted 3 rooms for your party of four."],
    ["a wrong guest count", "A party of 6 guests, arriving on the 10th of October."],
    ["a wrong diver count", "That is 3 divers out on the boat that morning."],
    ["a date the trip does not contain", "We have you arriving on 2026-11-05 and leaving on 2026-11-08."],
  ];

  for (const [what, text] of rejected) {
    it(`rejects ${what}`, () => {
      const result = verifySynthesizedReply(text, trip);
      expect(result.ok, `should have rejected: ${text}`).toBe(false);
    });
  }

  it("lets a correct summary through, including the guest's own split-day sentence", () => {
    // The over-catching risk in one case: "1 person dives day 1, 5 people dive both days" contains
    // two numbers against a person noun that are NOT the party size. Reading them as guest counts
    // would reject the correct summary of a six-person trip.
    const splitDay = {
      ...trip,
      guests: { value: 6, state: "stated", evidence: "6 of us" },
      diver: { value: true, state: "stated", evidence: "dives" },
      divers: { value: null, state: "missing", evidence: null },
      diveNotes: {
        value: "1 person dives day 1, 5 people dive both days",
        state: "stated",
        evidence: "1 person dives day 1, 5 people dive both days",
      },
    } as Trip;
    const rendered = renderReply(splitDay, generateQuestions(splitDay));

    expect(verifySynthesizedReply(rendered.text, splitDay).ok).toBe(true);
    expect(rendered.text).toContain("5 people dive both days");
  });

  it("lets the sanctioned follow-up sentence through", () => {
    const text =
      "Thanks Ana! Here is what I have for your stay. Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.";
    expect(verifySynthesizedReply(text, trip).ok).toBe(true);
  });

  it("does not read a bare number as a date", () => {
    // "14 days' notice" and "24 hours" are not dates; only ISO dates are compared, which is what
    // keeps this rule from rejecting ordinary prose.
    const text = "We hold the room for 14 days, and the boat leaves within 24 hours of your arrival.";
    expect(verifySynthesizedReply(text, trip).ok).toBe(true);
  });

  // The gate has a second caller now: the message a staff member sends once a quotation is
  // published, whose greeting a model writes. A copy of these checks for that path is how the two
  // would drift, so both call `verifyGuestFacingText` — and this is what it is for.
  describe("the same gate, for the studio's message to the guest", () => {
    it("rejects a confirmation claim about a stay, which the narrower patterns missed", () => {
      // Verbatim from a real message on production, about a booking that did not exist and a room
      // that had since been changed to a suite.
      const text =
        "Wonderful news, Ana — your customized stay here at Casa Escondida is all confirmed, with your Standard Room, and our team looks forward to welcoming you and Ben.";
      expect(verifyGuestFacingText(text, { roomTypes: new Set(["suite"]) })).toEqual({
        ok: false,
        reason: "false_booking_confirmation",
      });
    });

    it("rejects prose that names a room type the booking does not have", () => {
      const text = "Hi Ana! Your deluxe room is ready to look at, and the link below shows the full breakdown for your stay.";
      expect(verifyGuestFacingText(text, { roomTypes: new Set(["suite"]) })).toEqual({
        ok: false,
        reason: "mismatched_room_type",
      });
      // The same sentence about the right room passes.
      expect(verifyGuestFacingText(text, { roomTypes: new Set(["deluxe"]) }).ok).toBe(true);
    });

    it("rejects a price in a message whose whole job is to hand over the link", () => {
      const text = "Hi Ana! Your quotation comes to ₱31,200 for the two nights — open the link below to see the full breakdown.";
      expect(verifyGuestFacingText(text, {}).ok).toBe(false);
    });

    it("checks only the facts it is given, so a draft with few of them still passes", () => {
      const text = "Hi Ana! Your quotation is ready to look at — open the link below for the full breakdown of your stay.";
      expect(verifyGuestFacingText(text, { roomTypes: new Set(["suite"]) }).ok).toBe(true);
    });
  });
});

describe("the synthesis budget", () => {
  it("falls back rather than letting a hanging model take the turn past its deadline", async () => {
    const provider: ExtractProvider = {
      id: "fake:hang",
      call: vi.fn(),
      generateText: () => new Promise<string>(() => {}),
    };

    const started = Date.now();
    const reply = await synthesizeHospitalityReply(
      {
        turns: [],
        trip: transferUnstated(),
        questions: [],
        replyKind: "summary",
        fallbackText: FALLBACK,
        budgetMs: 120,
      },
      provider,
    );

    expect(reply).toBe(FALLBACK);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("what a partner enquiry is told", () => {
  it("names no discount figure, because this pipeline never applies one", () => {
    const trip = { ...blank(), guestType: { value: "agent", state: "inferred", evidence: null } } as Trip;
    const alerts = getStaffAlerts(trip, "en");
    expect(alerts.join(" ")).toContain("partner rates");
    expect(alerts.join(" ")).not.toMatch(/\d+\s*%/);
  });
});
