import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extract, ExtractionValidationError } from "../src/extract.js";
import type { ExtractProvider } from "../src/provider.js";

// Pins "today" to 2026-09-15 Manila time, matching dates.test.ts's anchor, so
// the resolved check-in date below is predictable.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const MESSAGE =
  "Hi! We are 4 of us, want to come next Saturday for 3 nights. " +
  "My name is Minh, contact minh@example.com or +63 917 123 4567.";

function fakeProvider(raw: unknown): ExtractProvider {
  return {
    id: "fake:v1",
    call: vi.fn().mockResolvedValue({
      raw,
      tokensIn: 500,
      tokensOut: 150,
      cacheReadTokens: 400,
      ms: 42,
    }),
  };
}

const HAPPY_RAW = {
  language: { value: null, state: "missing", evidence: null },
  checkIn: { value: null, state: "stated", evidence: "next Saturday" },
  checkOut: { value: null, state: "missing", evidence: null }, // always overwritten — derived
  nights: { value: 3, state: "stated", evidence: "3 nights" },
  guests: { value: 4, state: "stated", evidence: "4 of us" },
  rooms: { value: null, state: "missing", evidence: null },
  meals: { value: null, state: "missing", evidence: null },
  transport: { value: null, state: "missing", evidence: null },
  contactName: { value: "Minh", state: "stated", evidence: "My name is Minh" },
  // Present as missing: diver is the only one code never guesses, which is why it is
  // the field this enquiry is still asked about. A provider that omits the key is
  // normalized to this same state — see postProcess in extract.ts.
  diver: { value: null, state: "missing", evidence: null },
  diveFrom: { value: null, state: "missing", evidence: null },
  diveTo: { value: null, state: "missing", evidence: null },
  transportType: { value: null, state: "missing", evidence: null },
};

describe("extract", () => {
  it("resolves dates, derives checkOut, applies house norms, and asks only about what's left", async () => {
    const outcome = await extract(MESSAGE, fakeProvider(HAPPY_RAW));

    // "next Saturday" (vs. bare "Saturday") means a week further out — see dates.test.ts.
    expect(outcome.trip.checkIn.value).toBe("2026-09-26");
    expect(outcome.trip.checkOut.value).toBe("2026-09-29"); // +3 nights, never from the model
    expect(outcome.trip.checkOut.state).toBe("derived");

    expect(outcome.trip.rooms.state).toBe("default");
    expect(outcome.trip.meals.state).toBe("default");
    expect(outcome.trip.transport.state).toBe("default");

    const askedFields = outcome.questions.map((q) => q.field);
    // A house norm is not a question. rooms, meals and transport were all filled
    // from a norm here, so they are shown to the guest as assumed (the summary)
    // rather than asked about. Diving is the one field nobody guessed, so it is
    // the one thing this enquiry is still asked.
    expect(askedFields).toEqual(["diver"]);

    expect(outcome.meta.provider).toBe("fake:v1");
    expect(outcome.meta.retried).toBe(false);
  });

  it("retries once on a schema-invalid response, then reports 422 instead of guessing", async () => {
    // "three" instead of 3 — a model glitch zod must catch, not silently coerce.
    const brokenRaw = { ...HAPPY_RAW, nights: { value: "three", state: "stated", evidence: "3 nights" } };
    const provider = fakeProvider(brokenRaw);

    await expect(extract(MESSAGE, provider)).rejects.toThrow(ExtractionValidationError);
    expect(provider.call).toHaveBeenCalledTimes(2); // Playbook: retry once, then 422
  });

  it("hands the model its own bad output and the real zod error on retry, and accepts a corrected second attempt", async () => {
    const broken = { ...HAPPY_RAW, nights: { value: "three", state: "stated", evidence: "3 nights" } };
    const call = vi
      .fn()
      .mockResolvedValueOnce({ raw: broken, tokensIn: 500, tokensOut: 150, cacheReadTokens: 0, ms: 40 })
      .mockResolvedValueOnce({ raw: HAPPY_RAW, tokensIn: 500, tokensOut: 150, cacheReadTokens: 0, ms: 40 });
    const provider: ExtractProvider = { id: "fake:v1", call };

    const outcome = await extract(MESSAGE, provider);

    expect(outcome.meta.retried).toBe(true);
    expect(outcome.trip.nights.value).toBe(3); // the corrected second attempt, not the broken first

    expect(call).toHaveBeenCalledTimes(2);
    const secondCallArg = call.mock.calls[1][0];
    expect(secondCallArg.retry).toBeDefined();
    expect(secondCallArg.retry.previousRaw).toEqual(broken);
    expect(secondCallArg.retry.error).toMatch(/nights/); // the real zod issue, not a generic message
  });

  it("surfaces a transport-level failure (e.g. rate limit) as-is, not wrapped as a validation error", async () => {
    // Found via the eval harness: a Gemini 429 on both attempts was being
    // reported as "model output did not match the Trip schema" — misleading,
    // since the model was never actually asked to produce anything wrong.
    const rateLimitErr = new Error("Gemini extract failed: 429 RESOURCE_EXHAUSTED");
    const provider: ExtractProvider = { id: "fake:v1", call: vi.fn().mockRejectedValue(rateLimitErr) };

    await expect(extract(MESSAGE, provider)).rejects.toBe(rateLimitErr);
    await expect(extract(MESSAGE, provider)).rejects.not.toBeInstanceOf(ExtractionValidationError);
  });

  it("treats a timeout the same way — transport failure, retried once, never wrapped as a validation error", async () => {
    // The gemini.ts/deepseek.ts AbortController timeout rethrows a plain
    // Error (not a DOMException) — matches the shape those adapters actually
    // throw, not a generic guess.
    const timeoutErr = new Error("Gemini extract timed out after 8000ms");
    const call = vi.fn().mockRejectedValue(timeoutErr);
    const provider: ExtractProvider = { id: "fake:v1", call };

    await expect(extract(MESSAGE, provider)).rejects.toBe(timeoutErr);
    expect(call).toHaveBeenCalledTimes(2); // both attempts timed out — retry-once still fired
  });

  it("downgrades a 'stated' field to 'missing' when its evidence isn't actually in the message", async () => {
    const hallucinated = {
      ...HAPPY_RAW,
      guests: { value: 12, state: "stated", evidence: "a big group of 12" }, // not in MESSAGE
    };
    const outcome = await extract(MESSAGE, fakeProvider(hallucinated));

    expect(outcome.trip.guests.state).toBe("missing");
    expect(outcome.trip.guests.value).toBeNull();
  });

  it("treats a zero count from a provider as missing information, not a fatal schema error", async () => {
    const zeroNights = { ...HAPPY_RAW, nights: { value: 0, state: "missing", evidence: null } };

    const outcome = await extract(MESSAGE, fakeProvider(zeroNights));

    expect(outcome.trip.nights).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.questions.map((q) => q.field)).toContain("nights");
  });

  it("normalizes uncertain metadata so the UI never presents it as stated evidence", async () => {
    const uncertain = {
      ...HAPPY_RAW,
      language: { value: "vi", state: "stated", evidence: "Hi!" },
      checkIn: { value: "2026-09-19", state: "stated", evidence: "19/9/2026" },
      guests: { value: 4, state: "inferred", evidence: "4,2,4,2" },
    };

    const outcome = await extract(MESSAGE, fakeProvider(uncertain));

    expect(outcome.trip.language).toEqual({ value: "en", state: "inferred", evidence: null });
    expect(outcome.trip.checkIn).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.trip.guests).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.questions.map((q) => q.field)).toContain("guests");
  });

  it("still derives guestType and transportType, but no longer infers diving from a keyword", async () => {
    const diveMsg = "Hi, we are a travel agency booking 4 guests for diving next Saturday, 3 nights. airport transfer.";
    const rawWithTransport = {
      ...HAPPY_RAW,
      transport: { value: true, state: "stated", evidence: "airport transfer" },
    };
    const outcome = await extract(diveMsg, fakeProvider(rawWithTransport));

    // Agent detected from "travel agency" — a phrase about *who is booking* rather
    // than a priced field, so a regex is the right tool for it.
    expect(outcome.trip.guestType?.value).toBe("agent");
    // Transport roundtrip derived from transport boolean
    expect(outcome.trip.transportType?.value).toBe("roundtrip");
    // The word "diving" is no longer turned into diver=true with the whole stay as
    // its window: that regex fed dive revenue off a keyword nobody confirmed. The
    // guest is asked instead, and only their answer fills it.
    expect(outcome.trip.diver?.state).toBe("missing");
    expect(outcome.questions.map((q) => q.field)).toContain("diver");
    expect(outcome.trip.diveFrom?.state).toBe("missing");
    expect(outcome.trip.diveTo?.state).toBe("missing");
  });

  // The live WhatsApp run of 2026-09-19 that sent the team looking: the same guest
  // message produced "Would you like to go diving during your stay?" on one turn and
  // no diving question at all on the next, because the provider returned `diver` on
  // one call and left the key out of its tool arguments on the other. The Tier-2
  // fields are optional in the Trip schema, so nothing failed — the question simply
  // went away, for a field dive revenue is priced from.
  it("asks about a Tier-2 field the provider never returned, instead of dropping the question", async () => {
    const { diver: _diver, diveFrom: _diveFrom, diveTo: _diveTo, ...withoutTier2 } = HAPPY_RAW;

    const outcome = await extract(MESSAGE, fakeProvider(withoutTier2));

    // Absent is not an answer: it is the state that becomes a question.
    expect(outcome.trip.diver).toEqual({ value: null, state: "missing", evidence: null });
    // Diving is the one thing nobody guessed, so it is the one thing still asked.
    expect(outcome.questions.map((q) => q.field)).toEqual(["diver"]);
    // And the window stays gated on that answer — asking for one now would price a
    // dive package the guest never agreed to.
    expect(outcome.trip.diveFrom).toEqual({ value: null, state: "missing", evidence: null });
  });

  it("refuses a state only code may set, so a model's own guess cannot pass as a house norm", async () => {
    const modelGuesses = {
      ...HAPPY_RAW,
      // `default` is applied by postProcess to exactly HOUSE_NORM_FIELDS, and
      // `derived` is arithmetic on the guest's own answers. A model that labels its
      // own guess "default" would otherwise skip the question (non-missing) in one
      // field, and be read back to the guest as Casa's norm in the other.
      meals: { value: "room_only", state: "default", evidence: null },
      diver: { value: false, state: "default", evidence: null },
    };

    const outcome = await extract(MESSAGE, fakeProvider(modelGuesses));

    // meals is one of the four norm fields, so the *norm* fills it, not the guess.
    expect(outcome.trip.meals).toEqual({ value: "full_board", state: "default", evidence: null });
    expect(outcome.trip.meals.value).not.toBe("room_only");
    // diver is not a norm field, so the guest is asked instead of assumed.
    expect(outcome.trip.diver).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.questions.map((q) => q.field)).toContain("diver");
  });

  it("asks rather than prices a diving answer the guest never gave", async () => {
    const ambiguous = {
      ...HAPPY_RAW,
      // "we might dive, from the 26th" is not a booking for a dive package. ADR-006
      // Decision 4: ask what money depends on; never infer it.
      diver: { value: true, state: "inferred", evidence: null },
      diveFrom: { value: "2026-09-26", state: "derived", evidence: null },
    };

    const outcome = await extract(MESSAGE, fakeProvider(ambiguous));

    expect(outcome.trip.diver).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.trip.diveFrom).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.questions.map((q) => q.field)).toContain("diver");
  });

  it("reads evidence and language from the guest's words, never from the bot's own reply", async () => {
    // The transcript converse.ts sends carries both sides of the conversation. This
    // assistant turn is Vietnamese and full of facts the bot said out loud; if those
    // counted, a value the bot printed would come back as a guest-stated fact on the
    // next turn, and the conversation would stay in Casa's language rather than the
    // guest's.
    const transcript =
      "Guest: 4 of us next Saturday, 3 nights " +
      "Assistant: Dạ em ghi nhận bữa ăn bán phần, đưa đón sân bay và 1 phòng nhé. " +
      "Guest: yes that's right";
    const raw = {
      ...HAPPY_RAW,
      meals: { value: "half_board", state: "stated", evidence: "bán phần" },
      transport: { value: true, state: "stated", evidence: "đưa đón sân bay" },
      rooms: { value: 1, state: "stated", evidence: "1 phòng" },
    };

    const outcome = await extract(transcript, fakeProvider(raw));

    expect(outcome.trip.meals).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.trip.transport).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.trip.rooms).toEqual({ value: null, state: "missing", evidence: null });
    // The bot's Vietnamese is not the guest's language either.
    expect(outcome.trip.language).toEqual({ value: "en", state: "inferred", evidence: null });
    // What the guest did say is untouched by the scoping.
    expect(outcome.trip.guests).toEqual({ value: 4, state: "stated", evidence: "4 of us" });
    expect(outcome.trip.checkIn.value).toBe("2026-09-26");
  });
});


