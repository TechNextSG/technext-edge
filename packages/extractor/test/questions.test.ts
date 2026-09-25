import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { converse } from "../src/converse.js";
import {
  fallbackReply,
  generateQuestions,
  getStaffAlerts,
  isReadyForHandoff,
  renderReply,
  wantsHuman,
  HANDOFF_REQUIRED_FIELDS,
  NEVER_ASKED_FIELDS,
} from "../src/questions.js";
import { synthesizeHospitalityReply, verifySynthesizedReply } from "../src/synthesis.js";
import { scoreReplyNaturalness } from "../src/naturalness.js";
import { buildOdooHandoffPayload } from "../src/odooHandoff.js";
import type { ConversationTurn } from "../src/converse.js";
import type { ExtractProvider } from "../src/provider.js";
import type { Trip } from "../src/schema.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

// What a model returns for a guest who said almost nothing: every field missing,
// including the optional Tier-2 ones. House norms still fill rooms, meals,
// transport and language (extract.ts), which is exactly why those never appear in
// the question list below.
const BLANK_RAW = {
  language: { value: null, state: "missing", evidence: null },
  checkIn: { value: null, state: "missing", evidence: null },
  checkOut: { value: null, state: "missing", evidence: null },
  nights: { value: null, state: "missing", evidence: null },
  guests: { value: null, state: "missing", evidence: null },
  rooms: { value: null, state: "missing", evidence: null },
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

function providerReturning(raw: unknown): ExtractProvider {
  return {
    id: "fake:v1",
    call: vi.fn().mockResolvedValue({ raw, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 }),
  };
}

function numbered(message: string): string[] {
  return message.split("\n").filter((line) => /^\d+\. /.test(line));
}

describe("the reply the guest gets back", () => {
  it("introduces Casa and asks for the four things a quote needs when the guest has said nothing yet", async () => {
    const outcome = await converse(
      [{ role: "guest", text: "Hello, we are looking for a room" }],
      providerReturning(BLANK_RAW),
    );

    // The open fields are still listed for a form UI...
    expect(outcome.questions.map((q) => q.field)).toEqual(["checkIn", "nights", "guests", "diver", "contactName"]);
    // ...but the guest gets an introduction, not a numbered questionnaire. House
    // norms (rooms, meals, transport) are never asked about, so they are not in
    // the list to begin with.
    expect(outcome.replyKind).toBe("greeting");
    expect(numbered(outcome.reply)).toHaveLength(0);
    expect(outcome.reply).toContain("Welcome to Casa Escondida");
    expect(outcome.reply).toContain("check-in date");
    expect(outcome.reply).not.toContain("How many rooms do you need?");
    expect(outcome.reply).not.toContain("full board, half board");
  });

  it("acknowledges what the guest said, then asks for the rest in priority order", async () => {
    const raw = {
      ...BLANK_RAW,
      checkIn: { value: null, state: "stated", evidence: "next Saturday" },
      nights: { value: 3, state: "stated", evidence: "3 nights" },
    };
    const outcome = await converse(
      [{ role: "guest", text: "Hi, next Saturday for 3 nights please" }],
      providerReturning(raw),
    );

    expect(outcome.replyKind).toBe("questions");
    // The stay is read back as a stay ("Sep 26", not "2026-09-26"), and the
    // questions are numbered in the backend's priority order for whoever answers.
    expect(outcome.reply).toContain("I've noted down your stay starting Sep 26 for 3 nights.");
    expect(outcome.reply).toContain("To complete your enquiry, could you let me know:");
    expect(numbered(outcome.reply)).toEqual([
      "1. How many guests in total?",
      "2. Would you like to go diving during your stay?",
      "3. What name should we put on the booking?",
    ]);
    // The meals Casa assumed and the room count it defaulted to are *not* read
    // back as the guest's own answers — that is the fabricated confirmation the
    // eval treats as zero-tolerance.
    expect(outcome.reply).not.toContain("full board");
    expect(outcome.reply).not.toContain("Rooms:");
  });

  it("asks whether the guest is diving instead of inferring it from a keyword", async () => {
    // The guest said they want to dive and nothing more. The old keyword regex turned
    // that into diver=true plus a dive window derived from the whole stay — dive revenue
    // priced off a keyword, confirmed by nobody. Now it is asked like any other fact, so
    // the model reporting it (or the guest answering) is what fills it.
    const raw = { ...BLANK_RAW, guests: { value: 4, state: "stated", evidence: "4 guests" } };
    const outcome = await converse(
      [{ role: "guest", text: "We want to dive, there are 4 guests" }],
      providerReturning(raw),
    );

    const fields = outcome.questions.map((q) => q.field);
    expect(fields).toContain("diver");
    // Diving is not confirmed yet, so the window cannot be asked for.
    expect(fields).not.toContain("diveFrom");
    expect(fields).not.toContain("diveTo");
    // The headcount is read back, not re-asked.
    expect(outcome.reply).toContain("I've noted down 4 guests.");
    expect(outcome.reply).toContain("Would you like to go diving during your stay?");
    expect(outcome.reply).not.toContain("How many guests in total?");
  });

  it("asks for the dive window once the guest has confirmed they are diving", async () => {
    const raw = { ...BLANK_RAW, diver: { value: true, state: "stated", evidence: "we want to dive" } };
    const outcome = await converse(
      [{ role: "guest", text: "We want to dive" }],
      providerReturning(raw),
    );

    const fields = outcome.questions.map((q) => q.field);
    // The window is dive revenue, and Odoo drops it from the estimate in silence
    // when it is missing — so it is asked for as soon as diving is confirmed, and
    // only then.
    expect(fields).toContain("diveFrom");
    expect(fields).toContain("diveTo");
    expect(outcome.reply).toContain("I've noted down diving.");
    expect(outcome.reply).toContain("Which day does your diving start?");
  });

  it("leaves the dive window off an enquiry that is not about diving", async () => {
    const raw = { ...BLANK_RAW, guests: { value: 2, state: "stated", evidence: "2 of us" } };
    const outcome = await converse(
      [{ role: "guest", text: "2 of us for a week in October" }],
      providerReturning(raw),
    );

    const fields = outcome.questions.map((q) => q.field);
    expect(fields).not.toContain("diveFrom");
    expect(fields).not.toContain("diveTo");
    // transport defaulted to false, so "one-way or return" cannot apply either.
    expect(fields).not.toContain("transportType");
  });

  it("asks one-way or return while the transfer type is open, and never once the guest has settled it", async () => {
    // A guest who asked for "an airport pickup" has not said one-way or return, and the
    // transfer is a priced line: code derives nothing here, so the question fires and the
    // guest's own answer is what gets priced (extract.ts postProcess, changed 2026-09-24).
    // The old behaviour wrote `roundtrip, derived` and then asked them to confirm it.
    const raw = { ...BLANK_RAW, transport: { value: true, state: "stated", evidence: "airport pickup" } };
    const asked = await converse(
      [{ role: "guest", text: "Can you sort an airport pickup?" }],
      providerReturning(raw),
    );

    expect(asked.trip.transportType).toEqual({ value: null, state: "missing", evidence: null });
    expect(asked.questions.map((q) => q.field)).toContain("transportType");

    // Once the guest answers it, the question stops.
    const answered = { ...raw, transportType: { value: "oneway", state: "stated", evidence: "one way" } };
    const confirmed = await converse(
      [{ role: "guest", text: "One way airport pickup please" }],
      providerReturning(answered),
    );

    expect(confirmed.questions.map((q) => q.field)).not.toContain("transportType");

    // The other case the guest has settled is a declined transfer. "No transfer" needs no
    // further question, so code derives `none` — and a `derived` transportType is not a gap,
    // which is also why the rule is gated on transport being true at all (questions.ts askOn).
    const declined = { ...BLANK_RAW, transport: { value: false, state: "stated", evidence: "no pickup" } };
    const noTransfer = await converse(
      [{ role: "guest", text: "No pickup needed thanks" }],
      providerReturning(declined),
    );

    expect(noTransfer.trip.transportType).toEqual({ value: "none", state: "derived", evidence: null });
    expect(noTransfer.questions.map((q) => q.field)).not.toContain("transportType");
  });

  it("reads the whole booking back — assumptions flagged — once nothing is left to ask", async () => {
    const raw = {
      ...BLANK_RAW,
      checkIn: { value: null, state: "stated", evidence: "next Saturday" },
      nights: { value: 3, state: "stated", evidence: "3 nights" },
      guests: { value: 2, state: "stated", evidence: "2 of us" },
      diver: { value: false, state: "stated", evidence: "no diving" },
      contactName: { value: "Nhat", state: "stated", evidence: "Nhat" },
    };
    const outcome = await converse(
      [{ role: "guest", text: "Hi, next Saturday for 3 nights, 2 of us, no diving. Name: Nhat" }],
      providerReturning(raw),
    );

    // NOTE: this booking is complete for a guest who declined diving, and no question is open
    // — but `done` is false today, because isReadyForHandoff also demands
    // `divers`/`diveFrom`/`diveTo`, which no rule asks about on a non-diving trip
    // (questions.ts, HANDOFF_REQUIRED_FIELDS). The assertion is the contract; it is left
    // failing rather than weakened, because the gap is in the handoff check, not in the trip.
    expect(outcome.done).toBe(true);
    expect(outcome.replyKind).toBe("summary");
    expect(numbered(outcome.reply)).toHaveLength(0);

    const lines = outcome.reply.split("\n");
    expect(lines[0]).toBe("Thanks, Nhat!"); // the name as the guest wrote it, not normalized
    expect(lines[1]).toBe("Here's what I have for your stay:");
    // One stay line, as a range, with no "(derived)" noise on checkOut: it is
    // arithmetic on the guest's own answers, not a guess.
    expect(outcome.reply).toContain("• Stay: Sep 26 – 29, 2026 (3 nights)");
    expect(outcome.reply).not.toContain("Check-out:");
    expect(outcome.reply).toContain("• Guests: 2");
    expect(outcome.reply).toContain("• Diving: no");
    expect(outcome.reply).toContain("• Contact name: Nhat");
    // House norms are shown, but as Casa's guess rather than the guest's words.
    expect(outcome.reply).toContain("• Rooms: 1 (assumed)");
    expect(outcome.reply).toContain("• Meals: full board (assumed)");
    expect(outcome.reply).toContain("• Airport transfer: no (assumed)");
    // Internal fields stay internal.
    expect(outcome.reply).not.toContain("Language:");
    expect(outcome.reply).not.toContain("Guest type:");
    // And the bot never confirms what only a human can confirm.
    expect(outcome.reply).toMatch(/nothing is booked yet/);
  });

  it("flags derived return trip as assumed in summary when transport was stated but transportType was derived", () => {
    // Hand-built, and deliberately so: postProcess no longer derives `roundtrip` for a wanted
    // transfer (only `none`, for a declined one), but `derived`/`default` remain the two states
    // the summary flags as assumed, and this is the renderer rule that shows them.
    const trip = {
      language: { value: "en" as const, state: "default" as const, evidence: null },
      checkIn: { value: "2026-09-26", state: "stated" as const, evidence: "next Saturday" },
      checkOut: { value: "2026-09-29", state: "derived" as const, evidence: null },
      nights: { value: 3, state: "stated" as const, evidence: "3 nights" },
      guests: { value: 2, state: "stated" as const, evidence: "2 of us" },
      rooms: { value: 1, state: "default" as const, evidence: null },
      meals: { value: "full_board" as const, state: "default" as const, evidence: null },
      transport: { value: true, state: "stated" as const, evidence: "need pickup" },
      transportType: { value: "roundtrip" as const, state: "derived" as const, evidence: null },
      diver: { value: false, state: "stated" as const, evidence: "no diving" },
      contactName: { value: "Nhat", state: "stated" as const, evidence: "Nhat" },
    };
    const reply = renderReply(trip, []);
    expect(reply.text).toContain("• Airport transfer: yes · return trip (assumed)");
  });

  it("includes and acknowledges diveNotes and specialRequests in summary", () => {
    const trip = {
      language: { value: "en" as const, state: "default" as const, evidence: null },
      checkIn: { value: "2026-09-26", state: "stated" as const, evidence: "this Saturday" },
      checkOut: { value: "2026-09-28", state: "derived" as const, evidence: null },
      nights: { value: 2, state: "stated" as const, evidence: "2 nights" },
      guests: { value: 3, state: "stated" as const, evidence: "3 are staying" },
      rooms: { value: 1, state: "default" as const, evidence: null },
      meals: { value: "full_board" as const, state: "default" as const, evidence: null },
      transport: { value: false, state: "default" as const, evidence: null },
      diver: { value: true, state: "stated" as const, evidence: "will dive" },
      diveFrom: { value: "2026-09-26", state: "stated" as const, evidence: "first day" },
      diveTo: { value: "2026-09-27", state: "stated" as const, evidence: "both" },
      diveNotes: { value: "1 diver day 1, 5 divers on both days", state: "stated" as const, evidence: "one will dive on first day and five on both" },
      specialRequests: { value: "3 day-visitors joining dives", state: "stated" as const, evidence: "the others are just day visitors" },
      contactName: { value: "Michael", state: "stated" as const, evidence: "Michael" },
    };
    const reply = renderReply(trip, []);
    expect(reply.text).toContain("I've noted your diving arrangement: 1 diver day 1, 5 divers on both days.");
    expect(reply.text).toContain("Special note: 3 day-visitors joining dives.");
    expect(reply.text).toContain("• Diving: yes · Sep 26 – 27, 2026 (1 diver day 1, 5 divers on both days)");
    expect(reply.text).toContain("• Special notes: 3 day-visitors joining dives");
  });

  it("synthesizes natural hospitality reply with provider and falls back gracefully", async () => {
    const trip = {
      language: { value: "en" as const, state: "default" as const, evidence: null },
      checkIn: { value: "2026-09-26", state: "stated" as const, evidence: "this Saturday" },
      checkOut: { value: "2026-09-28", state: "derived" as const, evidence: null },
      nights: { value: 2, state: "stated" as const, evidence: "2 nights" },
      guests: { value: 3, state: "stated" as const, evidence: "3 are staying" },
      rooms: { value: 1, state: "default" as const, evidence: null },
      meals: { value: "full_board" as const, state: "default" as const, evidence: null },
      transport: { value: false, state: "default" as const, evidence: null },
      diver: { value: true, state: "stated" as const, evidence: "will dive" },
      contactName: { value: "Michael", state: "stated" as const, evidence: "Michael" },
    };

    const mockProvider: ExtractProvider = {
      id: "mock",
      call: vi.fn(),
      generateText: vi.fn().mockResolvedValue("Warm welcome, Michael! We've noted your 3 staying guests and 1 vs 5 diver split. Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet."),
    };

    const reply = await synthesizeHospitalityReply(
      {
        turns: [{ role: "guest", text: "One person will dive on the first day and five will dive on both" }],
        trip,
        questions: [],
        replyKind: "summary",
        fallbackText: "Fallback summary text",
      },
      mockProvider,
    );

    expect(reply).toContain("Warm welcome, Michael!");
    expect(reply).toContain("nothing is booked yet");

    // Fallback test when generateText throws
    vi.mocked(mockProvider.generateText!).mockRejectedValueOnce(new Error("Timeout"));
    const fallbackReply = await synthesizeHospitalityReply(
      {
        turns: [],
        trip,
        questions: [],
        replyKind: "summary",
        fallbackText: "Fallback summary text",
      },
      mockProvider,
    );
    expect(fallbackReply).toBe("Fallback summary text");
  });

  it("summarizes in the guest's own language, dates and all", async () => {
    const raw = {
      ...BLANK_RAW,
      checkIn: { value: null, state: "stated", evidence: "下周六" },
      nights: { value: 2, state: "stated", evidence: "2晚" },
      guests: { value: 4, state: "stated", evidence: "4位" },
      diver: { value: true, state: "stated", evidence: "要潜水" },
      divers: { value: 4, state: "stated", evidence: "4位潜水员" },
      diveFrom: { value: "2026-09-26", state: "stated", evidence: "9月26日" },
      diveTo: { value: "2026-09-27", state: "stated", evidence: "9月27日" },
      contactName: { value: "Nhat", state: "stated", evidence: "Nhat" },
    };
    const outcome = await converse(
      [
        {
          role: "guest",
          text: "你好，我们4位，下周六到，住2晚，要潜水，4位潜水员9月26日到9月27日，名字Nhat",
        },
      ],
      providerReturning(raw),
    );

    expect(outcome.replyKind).toBe("summary");
    expect(outcome.reply).toContain("谢谢 Nhat！");
    // "下周六" resolves through dates.ts's 下周 + 周六 form.
    expect(outcome.reply).toContain("• 住宿: 2026年9月26–28日 (2 晚)");
    expect(outcome.reply).toContain("• 是否潜水: 是 · 4 位潜水 · 2026年9月26–27日");
    expect(outcome.reply).toContain("Casa 团队会很快与您联系");
    expect(outcome.reply).not.toContain("Thanks");
  });

  it("keeps a Chinese guest in Chinese end to end", async () => {
    const raw = {
      ...BLANK_RAW,
      checkIn: { value: null, state: "stated", evidence: "26/09/2026" },
      nights: { value: 3, state: "stated", evidence: "3晚" },
      guests: { value: 2, state: "stated", evidence: "2位" },
      diver: { value: false, state: "stated", evidence: "不潜水" },
      contactName: { value: "Li", state: "stated", evidence: "Li" },
    };
    const outcome = await converse(
      [{ role: "guest", text: "我们26/09/2026入住3晚，2位客人，不潜水，我叫Li" }],
      providerReturning(raw),
    );

    expect(outcome.replyKind).toBe("summary");
    expect(outcome.reply).toContain("谢谢 Li！");
    expect(outcome.reply).toContain("• 住宿: 2026年9月26–29日 (3 晚)");
  });

  it("walks the whole arc for one guest: greeting → acknowledgment → summary", async () => {
    // The product spec in three turns, end to end: a guest says "hi", answers what
    // they are asked, and is handed over to a human with every value printed back.
    const call = vi
      .fn()
      .mockResolvedValueOnce({ raw: BLANK_RAW, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 })
      .mockResolvedValueOnce({
        raw: {
          ...BLANK_RAW,
          checkIn: { value: null, state: "stated", evidence: "next Saturday" },
          nights: { value: 3, state: "stated", evidence: "3 nights" },
          guests: { value: 2, state: "stated", evidence: "2 of us" },
          diver: { value: false, state: "stated", evidence: "no diving" },
        },
        tokensIn: 10,
        tokensOut: 10,
        cacheReadTokens: 0,
        ms: 5,
      })
      .mockResolvedValueOnce({
        raw: {
          ...BLANK_RAW,
          checkIn: { value: null, state: "stated", evidence: "next Saturday" },
          nights: { value: 3, state: "stated", evidence: "3 nights" },
          guests: { value: 2, state: "stated", evidence: "2 of us" },
          diver: { value: false, state: "stated", evidence: "no diving" },
          contactName: { value: "Nhat", state: "stated", evidence: "Nhat" },
        },
        tokensIn: 10,
        tokensOut: 10,
        cacheReadTokens: 0,
        ms: 5,
      });
    const provider: ExtractProvider = { id: "fake:v1", call };
    const turns: ConversationTurn[] = [{ role: "guest", text: "Hi" }];

    const first = await converse(turns, provider);
    expect(first.replyKind).toBe("greeting");

    turns.push(
      { role: "assistant", text: first.reply },
      { role: "guest", text: "next Saturday, 3 nights, 2 of us, no diving" },
    );
    const second = await converse(turns, provider);
    expect(second.replyKind).toBe("questions");
    expect(second.reply).toContain("I've noted down your stay starting Sep 26 for 3 nights, 2 guests and no diving.");
    expect(numbered(second.reply)).toEqual(["1. What name should we put on the booking?"]);

    turns.push({ role: "assistant", text: second.reply }, { role: "guest", text: "Nhat" });
    const third = await converse(turns, provider);

    expect(third.replyKind).toBe("summary");
    // NOTE: same gap as the summary test above — every value is settled and nothing is left
    // to ask, but `done` is false while isReadyForHandoff keeps demanding the dive fields of a
    // guest who said "no diving" (questions.ts, HANDOFF_REQUIRED_FIELDS). Left failing rather
    // than weakened: the arc is complete, the handoff check is the defect.
    expect(third.done).toBe(true);
    expect(third.reply).toContain("Thanks, Nhat!");
    expect(third.reply).toContain("• Stay: Sep 26 – 29, 2026 (3 nights)");
    expect(third.reply).toContain("• Guests: 2");
    expect(third.reply).toContain("• Diving: no");
    expect(third.reply).toMatch(/nothing is booked yet/);
    expect(numbered(third.reply)).toHaveLength(0);
  });

  it("treats a Tier-2 key that is absent altogether as something to ask, not as an answer", () => {
    // extract.ts normalizes an omitted key to `missing`, but generateQuestions is
    // public API: the BFF's test console draws its form fields from it and the eval
    // harness builds trips by hand. A key that was simply absent used to end the
    // question here, which is how a live WhatsApp reply lost the diving question.
    const { diver: _diver, diveFrom: _diveFrom, diveTo: _diveTo, ...partial } = BLANK_RAW;
    const questions = generateQuestions(partial as unknown as Trip);

    expect(questions.map((q) => q.field)).toContain("diver");
    // Only the field itself: the window needs diving confirmed first.
    expect(questions.map((q) => q.field)).not.toContain("diveFrom");
  });
});

// The two static sentences for moments with no trip to render, and the one
// keyword check that decides to stop asking before the model is even called. They
// live with the other guest-facing wording because they are what a guest reads
// when the deterministic replies above cannot be produced at all.
describe("fallbacks", () => {
  it("apologizes and promises a person, in the guest's language", () => {
    expect(fallbackReply("apology", "en")).toContain("Sorry");
    expect(fallbackReply("apology", "en")).toContain("a person");

    // The Chinese apology is a translation, not the same string: "Sorry" never
    // reaches a guest who wrote Chinese.
    expect(fallbackReply("apology", "zh")).not.toContain("Sorry");
    expect(fallbackReply("apology", "zh")).toContain("抱歉");
  });

  it("hands over to a person, and says nothing about price or availability", () => {
    for (const language of ["en", "zh"] as const) {
      const text = fallbackReply("handoff", language);
      expect(text.length).toBeGreaterThan(20);
      // A static sentence cannot invent an opening or a rate — and must not read
      // as a confirmation either.
      expect(text).not.toMatch(/VND|PHP|USD|₱|\d{3,}/);
    }
  });

  it("falls back to English rather than throwing when the language is unknown", () => {
    expect(fallbackReply("handoff", null)).toBe(fallbackReply("handoff", "en"));
  });

  it("recognises a guest asking for a person in both languages", () => {
    expect(wantsHuman("Can I talk to a human please?")).toBe(true);
    expect(wantsHuman("please put me through to the manager")).toBe(true);
    expect(wantsHuman("我想找人工客服")).toBe(true);
  });

  it("includes PADI/DAN No-Fly safety advisory when diving on check-out day", async () => {
    const raw = {
      ...BLANK_RAW,
      checkIn: { value: "2026-10-10", state: "stated", evidence: "Oct 10" },
      nights: { value: 2, state: "stated", evidence: "2 nights" },
      guests: { value: 2, state: "stated", evidence: "2 of us" },
      diver: { value: true, state: "stated", evidence: "we dive" },
      divers: { value: 2, state: "stated", evidence: "2 divers" },
      diveFrom: { value: "2026-10-11", state: "stated", evidence: "Oct 11" },
      diveTo: { value: "2026-10-12", state: "stated", evidence: "Oct 12" }, // checkout is Oct 12!
      contactName: { value: "Tom", state: "stated", evidence: "Tom" },
    };
    const outcome = await converse(
      [{ role: "guest", text: "2 of us Oct 10 for 2 nights, Tom. Diving Oct 11 to Oct 12. we dive, 2 divers" }],
      providerReturning(raw),
    );

    expect(outcome.done).toBe(true);
    expect(outcome.replyKind).toBe("summary");
    expect(outcome.reply).toContain("⚠️ Dive Safety Note: PADI/DAN guidelines recommend an 18–24 hour surface interval");
  });
});

describe("Phase 1 Hybrid AI Guardrails: NEVER RE-ASK, Fact Gate & Staff Alerts", () => {
  it("NEVER RE-ASK: skips asking divers/diveFrom/diveTo when diveNotes already records split-day schedule", async () => {
    const raw = {
      ...BLANK_RAW,
      checkIn: { value: "2026-10-10", state: "stated", evidence: "Oct 10" },
      nights: { value: 2, state: "stated", evidence: "2 nights" },
      guests: { value: 6, state: "stated", evidence: "6 of us" },
      diver: { value: true, state: "stated", evidence: "dives" },
      divers: { value: null, state: "missing", evidence: null }, // cannot collapse 1 vs 5 into single integer
      diveNotes: {
        value: "1 person dives day 1, 5 people dive both days",
        state: "stated",
        evidence: "1 person dives day 1, 5 people dive both days",
      },
      contactName: { value: "Sky", state: "stated", evidence: "Sky" },
    };

    const outcome = await converse(
      [
        {
          role: "guest",
          text: "Hi, 6 of us Oct 10 for 2 nights, Sky. 1 person dives day 1, 5 people dive both days.",
        },
      ],
      providerReturning(raw),
    );

    // Must NOT re-ask "How many of you will be diving?" or dive dates
    expect(outcome.questions.map((q) => q.field)).not.toContain("divers");
    expect(outcome.questions.map((q) => q.field)).not.toContain("diveFrom");
    expect(outcome.questions.map((q) => q.field)).not.toContain("diveTo");
    // NOTE: this is the one handoff the guardrail exists to make, and it is the one that never
    // opens. `divers`/`diveFrom`/`diveTo` are gated off for a trip whose diveNotes already
    // records the split-day schedule, so the guest is never asked for them — yet
    // isReadyForHandoff still requires all three, so `done` can never be true here
    // (questions.ts, HANDOFF_REQUIRED_FIELDS). Left failing rather than narrowed away: the
    // assertion is the guardrail's whole point, and removing it would hide the defect.
    expect(outcome.done).toBe(true);
    expect(outcome.replyKind).toBe("summary");
    expect(outcome.reply).toContain("1 person dives day 1, 5 people dive both days");
    expect(outcome.reply).toContain("📋 Custom Dive Schedule:");
  });

  it("Post-Generation Fact Gate: rejects LLM replies that invent prices or contradict verified counts", async () => {
    const trip: Trip = {
      ...(BLANK_RAW as unknown as Trip),
      language: { value: "en", state: "inferred", evidence: null },
      checkIn: { value: "2026-10-10", state: "stated", evidence: "Oct 10" },
      checkOut: { value: "2026-10-13", state: "derived", evidence: null },
      nights: { value: 3, state: "stated", evidence: "3 nights" },
      guests: { value: 4, state: "stated", evidence: "4 guests" },
      rooms: { value: 2, state: "stated", evidence: "2 rooms" },
    };

    // 1. Price invention ($150, ₱4,500, PHP 3000) -> rejected
    expect(
      verifySynthesizedReply("Welcome! Your 3 nights in 2 rooms will cost $150 per night.", trip),
    ).toEqual({ ok: false, reason: "unauthorized_price_quote" });

    expect(
      verifySynthesizedReply("Welcome! Total estimate is ₱12,500 for your stay.", trip),
    ).toEqual({ ok: false, reason: "unauthorized_price_quote" });

    // 2. False booking confirmation -> rejected
    expect(
      verifySynthesizedReply("Great news! Your booking is confirmed for 3 nights in 2 rooms.", trip),
    ).toEqual({ ok: false, reason: "false_booking_confirmation" });

    // 3. Mismatched night count (says 5 nights instead of 3) -> rejected
    expect(
      verifySynthesizedReply("Thank you! I have noted your stay for 5 nights in 2 rooms.", trip),
    ).toEqual({ ok: false, reason: "mismatched_nights_count" });

    // 4. Mismatched room count (says 1 room instead of 2) -> rejected
    expect(
      verifySynthesizedReply("Thank you! I have noted your stay for 3 nights in 1 room.", trip),
    ).toEqual({ ok: false, reason: "mismatched_rooms_count" });

    // 5. Valid warm concierge reply -> passes
    expect(
      verifySynthesizedReply(
        "Thank you so much! I have recorded your stay for 3 nights in 2 rooms. Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.",
        trip,
      ),
    ).toEqual({ ok: true });

    // 6. Verify synthesizeHospitalityReply automatically rolls back to fallbackText on violation
    const badProvider: ExtractProvider = {
      id: "bad-llm",
      call: vi.fn(),
      generateText: vi.fn().mockResolvedValue("Hi! I can offer you 2 rooms for $120 per night, your booking is confirmed!"),
    };
    const safeReply = await synthesizeHospitalityReply(
      {
        turns: [{ role: "guest", text: "Oct 10, 3 nights, 4 guests, 2 rooms" }],
        trip,
        questions: [],
        replyKind: "summary",
        fallbackText: "SAFE_DETERMINISTIC_FALLBACK",
      },
      badProvider,
    );
    expect(safeReply).toBe("SAFE_DETERMINISTIC_FALLBACK");
  });

  it("Staff Alerts: flags travel agency / partner enquiries for 30% discount confirmation", () => {
    const agentTrip: Trip = {
      ...(BLANK_RAW as unknown as Trip),
      language: { value: "en", state: "inferred", evidence: null },
      guestType: { value: "agent", state: "inferred", evidence: null },
    };
    const alerts = getStaffAlerts(agentTrip, "en");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("30% agency discount");
  });

  it("Phase 2 Naturalness Scorer: awards 100/100 to warm non-redundant replies and penalizes re-asking", () => {
    const trip: Trip = {
      ...(BLANK_RAW as unknown as Trip),
      language: { value: "en", state: "inferred", evidence: null },
      checkIn: { value: "2026-10-10", state: "stated", evidence: "Oct 10" },
      checkOut: { value: "2026-10-12", state: "derived", evidence: null },
      nights: { value: 2, state: "stated", evidence: "2 nights" },
      guests: { value: 6, state: "stated", evidence: "6 of us" },
      rooms: { value: 2, state: "stated", evidence: "2 rooms" },
      diver: { value: true, state: "stated", evidence: "dives" },
      divers: { value: null, state: "missing", evidence: null },
      diveNotes: {
        value: "1 person dives day 1, 5 people dive both days",
        state: "stated",
        evidence: "1 person dives day 1, 5 people dive both days",
      },
      contactName: { value: "Sky", state: "stated", evidence: "Sky" },
    };

    const rendered = renderReply(trip, generateQuestions(trip));
    const goodScore = scoreReplyNaturalness(rendered.text, trip, []);
    expect(goodScore.noReAskScore).toBe(1.0);
    expect(goodScore.nuanceAckScore).toBe(1.0);
    expect(goodScore.factGateScore).toBe(1.0);
    expect(goodScore.overallScore).toBe(100);

    // Now simulate a robotic reply that re-asks "How many of you will be diving?"
    const badScore = scoreReplyNaturalness(
      "Thanks! How many of you will be diving?",
      trip,
      [{ field: "divers", question: "How many of you will be diving?" }],
    );
    expect(badScore.noReAskScore).toBe(0.0);
    expect(badScore.overallScore).toBeLessThan(50);
  });

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

// ---- The handoff contract ----------------------------------------------------
//
// `done` is no longer "the question list happens to be empty": it is
// `isReadyForHandoff(trip)` — no question rule is open AND every HANDOFF_REQUIRED_FIELDS
// entry is answered. The failure mode that split exists to prevent is a field handoff
// requires but no reply ever asks the guest about, so these tests hold the two lists to
// each other through the public API instead of reading the private RULES array.

/**
 * A trip every HANDOFF_REQUIRED_FIELDS entry is settled on, built by hand so one field at a
 * time can be knocked out of it. Deliberately a diving guest who wants a transfer (diver and
 * transport both true, dive window and transfer type stated): a rule's `when` gate decides
 * whether its field is in play at all, and this is the shape where every gate is open — so a
 * knocked-out field here is one the guest really would be asked about.
 */
function settledTrip(): Trip {
  return {
    language: { value: "en", state: "inferred", evidence: null },
    checkIn: { value: "2026-09-26", state: "stated", evidence: "next Saturday" },
    checkOut: { value: "2026-09-29", state: "derived", evidence: null },
    nights: { value: 3, state: "stated", evidence: "3 nights" },
    guests: { value: 2, state: "stated", evidence: "2 of us" },
    rooms: { value: 1, state: "default", evidence: null },
    meals: { value: "full_board", state: "default", evidence: null },
    transport: { value: true, state: "stated", evidence: "airport pickup" },
    transportType: { value: "roundtrip", state: "stated", evidence: "return transfer" },
    contactName: { value: "Nhat", state: "stated", evidence: "Nhat" },
    diver: { value: true, state: "stated", evidence: "we dive" },
    divers: { value: 2, state: "stated", evidence: "2 divers" },
    diveFrom: { value: "2026-09-27", state: "stated", evidence: "Sep 27" },
    diveTo: { value: "2026-09-28", state: "stated", evidence: "Sep 28" },
    guestType: { value: "retail", state: "default", evidence: null },
  };
}

/** The same trip with one field gone, the way a provider that omitted it leaves it. */
function missingField(trip: Trip, field: keyof Trip): Trip {
  return { ...trip, [field]: { value: null, state: "missing", evidence: null } } as Trip;
}

/**
 * The same, plus every field code derives FROM it.
 *
 * Clearing one field in isolation can leave the trip in a state no real guest can produce:
 * `nights` missing while `checkOut` is still a `derived` value is literally check-in plus
 * nights, so it cannot be a value some other answer produced. `isReadyForHandoff` only
 * excuses a required field whose rule does not apply, and that exemption is exactly right
 * for a stated date range — which is why this sweep has to knock out the dependent value
 * too. Doing it here keeps every case in the sweep physically reachable, so a genuine
 * gap cannot hide behind a fabricated state.
 *
 * `guests`/`rooms`/`divers` are deliberately NOT closures for each other: those are
 * independent facts the guest states separately, and clearing one really does leave a trip
 * a guest could have described.
 */
function missingFieldAndDependents(trip: Trip, field: keyof Trip): Trip {
  const cleared = missingField(trip, field);
  if (field === "nights" || field === "checkIn") return missingField(cleared, "checkOut");
  return cleared;
}

/**
 * Required fields no question asks about because code always fills them in first — either
 * by arithmetic on the guest's own answers (`checkOut` = check-in + nights) or by reading
 * the answer off a stated date range (`nights` = check-out − check-in, which is the same
 * sum the guest already did). The test below proves each one through the pipeline rather
 * than trusting the name on this list.
 */
const CODE_FILLED_FIELDS: ReadonlyArray<keyof Trip> = ["checkOut", "nights"];

describe("the handoff contract", () => {
  it("is ready only when every required field is answered — a default counts, missing never does", () => {
    const trip = settledTrip();

    // What `done: true` means: nothing open to ask, and nothing required left unknown.
    expect(generateQuestions(trip)).toEqual([]);
    expect(isReadyForHandoff(trip)).toBe(true);

    // A house-norm `default` counts as an answer — rooms = 1 is Casa's assumption and the guest
    // corrects it in the summary — and so does a `derived` value, which is arithmetic on the
    // guest's own answers. `missing` counts for no required field, however it got that way.
    expect([trip.rooms.state, trip.meals.state]).toEqual(["default", "default"]);
    expect(trip.checkOut.state).toBe("derived");

    for (const field of HANDOFF_REQUIRED_FIELDS) {
      expect(
        isReadyForHandoff(missingFieldAndDependents(trip, field)),
        `${field} is required before handoff`,
      ).toBe(false);
    }
  });

  it("fills a required field code derives instead of asking the guest to restate arithmetic", async () => {
    // checkOut has no question rule on purpose: it is the guest's own check-in plus the nights
    // they gave, so asking for it would be asking them to do the sum again. That is what makes
    // it a covered required field (CODE_FILLED_FIELDS) rather than a question nobody asks.
    const raw = {
      ...BLANK_RAW,
      checkIn: { value: null, state: "stated", evidence: "next Saturday" },
      nights: { value: 3, state: "stated", evidence: "3 nights" },
      checkOut: { value: null, state: "missing", evidence: null },
    };
    const outcome = await converse(
      [{ role: "guest", text: "Hi, next Saturday for 3 nights please" }],
      providerReturning(raw),
    );

    expect(outcome.trip.checkOut).toEqual({ value: "2026-09-29", state: "derived", evidence: null });
    expect(outcome.questions.map((q) => q.field)).not.toContain("checkOut");
  });

  it("backs every required field with a question, a code-filled value, or a never-asked reason", () => {
    for (const field of CODE_FILLED_FIELDS) {
      expect(HANDOFF_REQUIRED_FIELDS, `${field} is listed as code-filled but is not required`).toContain(field);
    }

    // The invariant, driven the way a guest experiences it: knock a required field out of an
    // otherwise settled trip and the reply must either put that field to the guest or not need
    // it at all. A field that is required, missing and unasked is the failure this split exists
    // to catch — handoff refused for a reason no reply ever raises, which the guest cannot fix.
    const uncovered: string[] = [];
    for (const field of HANDOFF_REQUIRED_FIELDS) {
      const trip = missingFieldAndDependents(settledTrip(), field);
      if (generateQuestions(trip).some((q) => q.field === field)) continue; // asked of the guest
      if (CODE_FILLED_FIELDS.includes(field)) continue; // code fills it before it can be missing
      if (NEVER_ASKED_FIELDS.some((entry) => entry.field === field)) continue; // never asked, on purpose
      uncovered.push(String(field));
    }
    expect(uncovered).toEqual([]);

    // `guestType` is the field the never-asked escape exists for: a real booking field no
    // guest is asked about, and deliberately NOT a handoff requirement — a partner rate is a
    // commercial decision staff confirm on the quote rather than something a guest states.
    // So a trip with no guestType at all is still ready, and nothing is lost by not asking it.
    //
    // The two lists are therefore NOT disjoint, and must not be asserted to be: `checkOut` is
    // required AND code-filled, so it belongs to both. What matters is that every member of
    // each list is accounted for, which the loop above proves and these assertions pin.
    const neverAsked = NEVER_ASKED_FIELDS.map((entry) => entry.field);
    expect(neverAsked).toContain("guestType");
    for (const entry of NEVER_ASKED_FIELDS) {
      expect(entry.reason.length, `${entry.field} needs a stated reason`).toBeGreaterThan(20);
      expect(["code", "staff"], `${entry.field} needs a source`).toContain(entry.satisfiedBy);
    }
    expect(isReadyForHandoff(missingField(settledTrip(), "guestType"))).toBe(true);
    expect(generateQuestions(missingField(settledTrip(), "guestType")).map((q) => q.field)).not.toContain("guestType");
  });
});
