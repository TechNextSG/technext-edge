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
      // "vi" is not even a language the schema allows any more. A provider that still returns
      // one — or labels any language "stated" on the strength of a two-letter greeting — is
      // overruled by detection from the guest's own text.
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

  it("still derives guestType, but no longer guesses transportType or infers diving from a keyword", async () => {
    const diveMsg = "Hi, we are a travel agency booking 4 guests for diving next Saturday, 3 nights. airport transfer.";
    const rawWithTransport = {
      ...HAPPY_RAW,
      transport: { value: true, state: "stated", evidence: "airport transfer" },
    };
    const outcome = await extract(diveMsg, fakeProvider(rawWithTransport));

    // Agent detected from "travel agency" — a phrase about *who is booking* rather
    // than a priced field, so a regex is the right tool for it.
    expect(outcome.trip.guestType?.value).toBe("agent");
    // A wanted transfer gets no type guessed for it: "airport transfer" does not say one way
    // or return, and the transfer is a priced line, so the field stays `missing` and the
    // guest is asked instead (see the test below).
    expect(outcome.trip.transportType).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.questions.map((q) => q.field)).toContain("transportType");
    // The word "diving" is no longer turned into diver=true with the whole stay as
    // its window: that regex fed dive revenue off a keyword nobody confirmed. The
    // guest is asked instead, and only their answer fills it.
    expect(outcome.trip.diver?.state).toBe("missing");
    expect(outcome.questions.map((q) => q.field)).toContain("diver");
    expect(outcome.trip.diveFrom?.state).toBe("missing");
    expect(outcome.trip.diveTo?.state).toBe("missing");
  });

  it("leaves a wanted transfer's type to the guest instead of pricing a guessed one", async () => {
    // The old code wrote `roundtrip, derived` whenever the guest asked for a transfer and then
    // asked them to confirm it — a symptom fix, with the transfer (a priced line) sitting on a
    // value code had invented. "We need airport transfer" does not say one-way or return, so
    // the field stays missing and the guest's own answer is what the estimate is priced from.
    const raw = {
      ...HAPPY_RAW,
      transport: { value: true, state: "stated", evidence: "need airport transfer" },
      transportType: { value: null, state: "missing", evidence: null },
    };
    const outcome = await extract("We need airport transfer", fakeProvider(raw));
    expect(outcome.trip.transport?.value).toBe(true);
    expect(outcome.trip.transportType).toEqual({ value: null, state: "missing", evidence: null });
    // Missing is what makes the question fire, rather than the guest being read back a type
    // nobody chose.
    expect(outcome.questions.map((q) => q.field)).toContain("transportType");

    // The one transfer case code still settles is a declined one: "no transfer" needs no
    // further question, so it is derived as `none` and is not asked about at all.
    const declined = {
      ...HAPPY_RAW,
      transport: { value: false, state: "stated", evidence: "no transfer" },
      transportType: { value: null, state: "missing", evidence: null },
    };
    const declinedOutcome = await extract("No transfer needed, thanks.", fakeProvider(declined));
    expect(declinedOutcome.trip.transportType).toEqual({ value: "none", state: "derived", evidence: null });
    expect(declinedOutcome.questions.map((q) => q.field)).not.toContain("transportType");
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
    // assistant turn is Chinese and full of facts the bot said out loud; if those
    // counted, a value the bot printed would come back as a guest-stated fact on the
    // next turn, and the conversation would stay in Casa's language rather than the
    // guest's.
    const transcript =
      "Guest: 4 of us next Saturday, 3 nights " +
      "Assistant: 好的，已记录半餐、机场接送和 1 间房。 " +
      "Guest: yes that's right";
    const raw = {
      ...HAPPY_RAW,
      meals: { value: "half_board", state: "stated", evidence: "半餐" },
      transport: { value: true, state: "stated", evidence: "机场接送" },
      rooms: { value: 1, state: "stated", evidence: "1 间房" },
    };

    const outcome = await extract(transcript, fakeProvider(raw));

    expect(outcome.trip.meals).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.trip.transport).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.trip.rooms).toEqual({ value: null, state: "missing", evidence: null });
    // The bot's Chinese is not the guest's language either.
    expect(outcome.trip.language).toEqual({ value: "en", state: "inferred", evidence: null });
    // What the guest did say is untouched by the scoping.
    expect(outcome.trip.guests).toEqual({ value: 4, state: "stated", evidence: "4 of us" });
    expect(outcome.trip.checkIn.value).toBe("2026-09-26");
  });

  it("takes the date phrase as written, Chinese included, instead of asking again", async () => {
    // zh-08 of the eval set, verbatim. "下周五" is a phrase dates.ts had no entry for, so
    // this guest's check-in was deleted even when the model had computed the right date —
    // the same loss that hit 8 of the 10 Chinese cases. The model now contributes nothing
    // but the phrase: dates.ts reads 下周 + 周五 itself and code fills the date in.
    const message = "Guest: 我们3个人下周五来，住2晚，全包餐，不需要接送。";
    const raw = {
      ...HAPPY_RAW,
      checkIn: { value: null, state: "inferred", evidence: "下周五" },
      nights: { value: 2, state: "stated", evidence: "住2晚" },
      guests: { value: 3, state: "stated", evidence: "3个人" },
      meals: { value: "full_board", state: "stated", evidence: "全包餐" },
      transport: { value: false, state: "stated", evidence: "不需要接送" },
    };

    const outcome = await extract(message, fakeProvider(raw));

    // 2026-09-25 is a Friday, ten days out, and the phrase says 下周 (next week).
    expect(outcome.trip.checkIn).toEqual({ value: "2026-09-25", state: "stated", evidence: "下周五" });
    expect(outcome.trip.checkOut.value).toBe("2026-09-27"); // +2 nights, still arithmetic
    expect(outcome.questions.map((q) => q.field)).not.toContain("checkIn");
  });

  it("accepts the model's date when the phrase itself corroborates it", async () => {
    // The one case where the model's number is used: a phrase the table cannot read
    // ("the coming" is not a qualifier dates.ts knows), and a date the phrase backs up —
    // a Friday, days away, not three weeks out. The guest keeps their answer instead of
    // being asked for a date they already gave.
    const message = "Guest: 2 of us, arriving the coming Friday, staying 2 nights";
    const raw = {
      ...HAPPY_RAW,
      nights: { value: 2, state: "stated", evidence: "staying 2 nights" },
      checkIn: { value: "2026-09-18", state: "stated", evidence: "the coming Friday" },
    };

    const outcome = await extract(message, fakeProvider(raw));

    expect(outcome.trip.checkIn.value).toBe("2026-09-18");
    expect(outcome.trip.checkOut.value).toBe("2026-09-20"); // +2 nights
    expect(outcome.questions.map((q) => q.field)).not.toContain("checkIn");
  });

  it("rejects a model date the guest's own phrase contradicts, and asks for it", async () => {
    // "the coming Friday" is a qualifier the resolver has no entry for, so the model's
    // date is the only candidate there is — and it is three weeks out. A date that
    // disagrees with the guest's words is not evidence of anything, so the field goes back
    // to being a question instead of a price for the wrong week.
    const message = "Guest: 2 of us, arriving the coming Friday, staying 2 nights";
    const raw = {
      ...HAPPY_RAW,
      nights: { value: 2, state: "stated", evidence: "staying 2 nights" },
      checkIn: { value: "2026-10-09", state: "stated", evidence: "the coming Friday" },
    };

    const outcome = await extract(message, fakeProvider(raw));

    expect(outcome.trip.checkIn).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.trip.checkOut.state).toBe("missing"); // a missing check-in derives nothing
    expect(outcome.questions.map((q) => q.field)).toContain("checkIn");
  });

  it("overrides the model's wrong week with the phrase's own reading", async () => {
    // 下周五 read as *this* Friday is the off-by-one-week error with money behind it.
    // The resolver knows 下周 (dates.test.ts), so its answer is the one that gets priced.
    const raw = {
      ...HAPPY_RAW,
      nights: { value: 2, state: "stated", evidence: "住2晚" },
      checkIn: { value: "2026-09-18", state: "stated", evidence: "下周五" },
    };

    const outcome = await extract("Guest: 我们2个人下周五来，住2晚。", fakeProvider(raw));

    expect(outcome.trip.checkIn.value).toBe("2026-09-25");
    expect(outcome.trip.checkOut.value).toBe("2026-09-27"); // +2 nights
  });

  it("asks rather than accept a model's date for a phrase the guest never pinned down", async () => {
    // A guest who says "大概这个月底" (roughly the end of this month). A model will offer 30
    // September; a month end is not a check-in date, so the question stays.
    const message =
      "Guest: 我们6个人想潜水，还没定日期，大概这个月底，你们有房间吗？";
    const raw = { ...HAPPY_RAW, checkIn: { value: "2026-09-30", state: "stated", evidence: "这个月底" } };

    const outcome = await extract(message, fakeProvider(raw));

    expect(outcome.trip.checkIn).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.questions.map((q) => q.field)).toContain("checkIn");
  });

  it("keeps the resolver's date when the model's own differs — code wins where it can read", async () => {
    // dates.ts resolves "next Saturday" itself, so the model's number is not consulted:
    // two sources for one money field is how the wrong one ends up in the quote.
    const raw = { ...HAPPY_RAW, checkIn: { value: "2099-01-01", state: "stated", evidence: "next Saturday" } };

    const outcome = await extract(MESSAGE, fakeProvider(raw));

    expect(outcome.trip.checkIn.value).toBe("2026-09-26"); // dates.test.ts's answer for this phrase
    expect(outcome.trip.checkIn.state).toBe("stated");
  });

  it("reads an ambiguous day/month pair the way the guest's own language writes it", async () => {
    // "12/10" is 12 October to a Chinese guest and 10 December to an English-speaking one.
    // Both are real dates, so the resolver used to refuse the pair and the model's own reading
    // was the only candidate — which is one wrong month whenever the model read it the other
    // way. The language was already being detected from this same message for trip.language,
    // so it decides the reading too (dates.ts).
    const message = "Guest: 我们2个人，12/10入住，住3晚。";
    const raw = {
      ...HAPPY_RAW,
      nights: { value: 3, state: "stated", evidence: "住3晚" },
      guests: { value: 2, state: "stated", evidence: "2个人" },
      checkIn: { value: "2026-12-10", state: "stated", evidence: "12/10" },
    };

    const outcome = await extract(message, fakeProvider(raw));

    // The model offered December 10 — the English reading. Code read the phrase itself here,
    // so the Chinese guest's own 12 October is what gets priced.
    expect(outcome.trip.language).toEqual({ value: "zh", state: "inferred", evidence: null });
    expect(outcome.trip.checkIn).toEqual({ value: "2026-10-12", state: "stated", evidence: "12/10" });
    expect(outcome.trip.checkOut.value).toBe("2026-10-15"); // +3 nights
    expect(outcome.questions.map((q) => q.field)).not.toContain("checkIn");
  });

  // Money-bug regression: the dive line is priced per head, and `diver` alone only says
  // someone dives — a family of 5 with 2 certified divers used to report `divers` nowhere,
  // leaving the estimate to guess between 2 and 5. This is docs/casa-anilao-test-scenarios.html's
  // EN-LONG-02 shape, previously marked PASS while silently dropping this number.
  it("keeps the diver head count separate from the guest count", async () => {
    const message =
      "Family of 5 arriving Dec 4, 2026 for 3 nights: 2 certified divers + grandma relaxing " +
      "and 2 snorkelling kids. Request 2 rooms, full board, boat diving Dec 5-6.";
    const raw = {
      ...HAPPY_RAW,
      checkIn: { value: "2026-12-04", state: "stated", evidence: "Dec 4, 2026" },
      nights: { value: 3, state: "stated", evidence: "3 nights" },
      guests: { value: 5, state: "stated", evidence: "Family of 5" },
      rooms: { value: 2, state: "stated", evidence: "2 rooms" },
      diver: { value: true, state: "stated", evidence: "2 certified divers" },
      divers: { value: 2, state: "stated", evidence: "2 certified divers" },
      diveFrom: { value: "2026-12-05", state: "stated", evidence: "Dec 5-6" },
      diveTo: { value: "2026-12-06", state: "stated", evidence: "Dec 5-6" },
    };

    const outcome = await extract(message, fakeProvider(raw));

    expect(outcome.trip.guests).toEqual({ value: 5, state: "stated", evidence: "Family of 5" });
    expect(outcome.trip.divers).toEqual({ value: 2, state: "stated", evidence: "2 certified divers" });
    expect(outcome.questions.map((q) => q.field)).not.toContain("divers");
  });

  // The other half of the same bug: a plan that genuinely has no single head count ("one
  // person on the first day, five on both") must not be flattened into a guess (`divers`
  // stays `missing`), AND because `diveNotes` already recorded the exact split-day breakdown,
  // the NEVER RE-ASK guardrail skips re-asking `divers` and routes `diveNotes` to staff.
  it("never invents a diver count and never re-asks when the guest's plan varies per person in diveNotes", async () => {
    const message =
      "Our group has 6 people coming this Saturday, but only 3 are staying for 2 nights. " +
      "One person will dive on the first day and five will dive on both. My name is Michael.";
    const raw = {
      ...HAPPY_RAW,
      checkIn: { value: null, state: "stated", evidence: "this Saturday" },
      nights: { value: 2, state: "stated", evidence: "for 2 nights" },
      guests: { value: 3, state: "stated", evidence: "only 3 are staying" },
      diver: { value: true, state: "stated", evidence: "will dive" },
      divers: { value: null, state: "missing", evidence: null },
      diveNotes: {
        value: "one person will dive on the first day and five will dive on both",
        state: "stated",
        evidence: "One person will dive on the first day and five will dive on both",
      },
      contactName: { value: "Michael", state: "stated", evidence: "My name is Michael" },
    };

    const outcome = await extract(message, fakeProvider(raw));

    expect(outcome.trip.guests).toEqual({ value: 3, state: "stated", evidence: "only 3 are staying" });
    expect(outcome.trip.divers).toEqual({ value: null, state: "missing", evidence: null });
    expect(outcome.questions.map((q) => q.field)).not.toContain("divers");
  });

  // A guest who writes the stay as a date range has already done this arithmetic. Measured
  // against the real DeepSeek API before the fix: all 9 runs asked "how many nights?"
  // immediately after the guest wrote "Oct 17 to Oct 20" — asking someone to repeat a sum
  // they just gave you. The count is now read off the range instead.
  describe("a stay given as a date range is not asked back as a night count", () => {
    const RANGE_MESSAGE = "Hi, we're Ana and Ben, 2 of us. We'd like to stay Oct 17 to Oct 20, full board please.";
    const RANGE_RAW = {
      ...HAPPY_RAW,
      checkIn: { value: null, state: "stated", evidence: "Oct 17" },
      // The model reads the range as both dates and leaves nights missing, because the
      // guest never wrote a night count. That is exactly the state this fixes. Note the
      // model supplies a resolved ISO value for the check-out too: a `stated` field with a
      // null value fails evidence enforcement before the derivation below ever runs.
      nights: { value: null, state: "missing", evidence: null },
      checkOut: { value: "2026-10-20", state: "stated", evidence: "Oct 20" },
      guests: { value: 2, state: "stated", evidence: "2 of us" },
      meals: { value: "full_board", state: "stated", evidence: "full board" },
      contactName: { value: null, state: "missing", evidence: null },
    };

    it("reads nights off the range and never asks for it", async () => {
      const outcome = await extract(RANGE_MESSAGE, fakeProvider(RANGE_RAW));

      expect(outcome.trip.checkIn.value).toBe("2026-10-17");
      expect(outcome.trip.checkOut.value).toBe("2026-10-20");
      expect(outcome.trip.nights).toEqual({ value: 3, state: "derived", evidence: null });
      expect(outcome.questions.map((q) => q.field)).not.toContain("nights");
    });

    it("keeps the guest's stated check-out, which is the date they actually named", async () => {
      const outcome = await extract(RANGE_MESSAGE, fakeProvider(RANGE_RAW));

      // Only true because nights was derived. The bug this guards: deriving checkOut from
      // checkIn + nights and thereby overwriting the check-out the guest wrote with a date
      // computed from a number they never gave.
      expect(outcome.trip.checkOut).toEqual({
        value: "2026-10-20",
        state: "stated",
        evidence: "Oct 20",
      });
    });

    it("a night count the guest did state always wins over the range's arithmetic", async () => {
      // A range that disagrees with a stated count is a real contradiction, and the stated
      // number is the one the guest chose to say. Preferring the arithmetic here would hide
      // the disagreement from the fact gate and from staff instead of surfacing it.
      const raw = {
        ...RANGE_RAW,
        nights: { value: 4, state: "stated", evidence: "4 nights" },
      };
      const outcome = await extract(`${RANGE_MESSAGE} Actually 4 nights.`, fakeProvider(raw));

      expect(outcome.trip.nights).toEqual({ value: 4, state: "stated", evidence: "4 nights" });
    });

    it("still asks for nights when the guest gave a check-in but no range and no count", async () => {
      // The guard is "the stay is already a closed range", not "nights is inconvenient".
      // A check-in on its own leaves the question exactly where it was.
      const raw = {
        ...HAPPY_RAW,
        checkIn: { value: null, state: "stated", evidence: "next Saturday" },
        nights: { value: null, state: "missing", evidence: null },
        checkOut: { value: null, state: "missing", evidence: null },
      };
      const outcome = await extract("Hi, 2 of us next Saturday please.", fakeProvider(raw));

      expect(outcome.trip.nights.state).toBe("missing");
      expect(outcome.questions.map((q) => q.field)).toContain("nights");
    });
  });
});


