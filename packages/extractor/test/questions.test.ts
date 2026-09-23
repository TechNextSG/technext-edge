import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { converse } from "../src/converse.js";
import { fallbackReply, generateQuestions, getStaffAlerts, renderReply, wantsHuman } from "../src/questions.js";
import { synthesizeHospitalityReply, verifySynthesizedReply } from "../src/synthesis.js";
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
    // The guest said "đi lặn" and nothing more. The old keyword regex turned that
    // into diver=true plus a dive window derived from the whole stay — dive revenue
    // priced off a keyword, confirmed by nobody. Now it is asked like any other
    // fact, so the model reporting it (or the guest answering) is what fills it.
    const raw = { ...BLANK_RAW, guests: { value: 4, state: "stated", evidence: "4 người" } };
    const outcome = await converse(
      [{ role: "guest", text: "Mình muốn đi lặn, nhóm mình có 4 người" }],
      providerReturning(raw),
    );

    const fields = outcome.questions.map((q) => q.field);
    expect(fields).toContain("diver");
    // Diving is not confirmed yet, so the window cannot be asked for.
    expect(fields).not.toContain("diveFrom");
    expect(fields).not.toContain("diveTo");
    // Vietnamese in, Vietnamese out — and the headcount is read back, not re-asked.
    expect(outcome.reply).toContain("Em đã ghi nhận 4 khách ạ.");
    expect(outcome.reply).toContain("Mình có muốn đi lặn trong chuyến này không?");
    expect(outcome.reply).not.toContain("Tổng cộng có bao nhiêu khách?");
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

  it("asks one-way or return whenever a transfer is wanted, because a derived roundtrip is an assumption", async () => {
    const raw = { ...BLANK_RAW, transport: { value: true, state: "stated", evidence: "airport pickup" } };
    const asked = await converse(
      [{ role: "guest", text: "Can you sort an airport pickup?" }],
      providerReturning(raw),
    );

    expect(asked.trip.transportType).toEqual({ value: "roundtrip", state: "derived", evidence: null });
    expect(asked.questions.map((q) => q.field)).toContain("transportType");

    // Once the guest answers it, the question stops.
    const answered = { ...raw, transportType: { value: "oneway", state: "stated", evidence: "one way" } };
    const confirmed = await converse(
      [{ role: "guest", text: "One way airport pickup please" }],
      providerReturning(answered),
    );

    expect(confirmed.questions.map((q) => q.field)).not.toContain("transportType");
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
      checkIn: { value: null, state: "stated", evidence: "thứ 7 tuần sau" },
      nights: { value: 2, state: "stated", evidence: "2 đêm" },
      guests: { value: 4, state: "stated", evidence: "4 người" },
      diver: { value: true, state: "stated", evidence: "có lặn" },
      divers: { value: 4, state: "stated", evidence: "4 người lặn" },
      diveFrom: { value: "2026-09-26", state: "stated", evidence: "từ 26/09" },
      diveTo: { value: "2026-09-27", state: "stated", evidence: "đến 27/09" },
      contactName: { value: "Nhat", state: "stated", evidence: "Nhat" },
    };
    const outcome = await converse(
      [
        {
          role: "guest",
          text: "Chào em, 4 người, thứ 7 tuần sau 2 đêm, có lặn, 4 người lặn từ 26/09 đến 27/09, tên Nhat",
        },
      ],
      providerReturning(raw),
    );

    expect(outcome.replyKind).toBe("summary");
    expect(outcome.reply).toContain("Cảm ơn Nhat!");
    // "thứ 7 tuần sau" resolves through WEEKDAYS' Vietnamese digit form.
    expect(outcome.reply).toContain("• Kỳ nghỉ: 26–28/09/2026 (2 đêm)");
    expect(outcome.reply).toContain("• Có lặn: có · 4 người lặn · 26–27/09/2026");
    expect(outcome.reply).toContain("Đội ngũ Casa sẽ sớm liên hệ");
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

    // The Vietnamese and Chinese apologies are translations, not the same string:
    // "Sorry" never reaches a guest who wrote Vietnamese.
    expect(fallbackReply("apology", "vi")).not.toContain("Sorry");
    expect(fallbackReply("apology", "vi")).toContain("Xin lỗi");
    expect(fallbackReply("apology", "zh")).toContain("抱歉");
  });

  it("hands over to a person, and says nothing about price or availability", () => {
    for (const language of ["en", "vi", "zh"] as const) {
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

  it("recognises a guest asking for a person in all three languages", () => {
    expect(wantsHuman("Can I talk to a human please?")).toBe(true);
    expect(wantsHuman("please put me through to the manager")).toBe(true);
    expect(wantsHuman("Cho mình gặp nhân viên nhé")).toBe(true);
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
});

