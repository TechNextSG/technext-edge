import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { converse } from "../src/converse.js";
import type { ExtractProvider } from "../src/provider.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const PARTIAL_RAW = {
  language: { value: null, state: "missing", evidence: null },
  checkIn: { value: null, state: "stated", evidence: "next Saturday" },
  checkOut: { value: null, state: "missing", evidence: null },
  nights: { value: 3, state: "stated", evidence: "3 nights" },
  guests: { value: null, state: "missing", evidence: null },
  rooms: { value: null, state: "missing", evidence: null },
  meals: { value: null, state: "missing", evidence: null },
  transport: { value: null, state: "missing", evidence: null },
  contactName: { value: null, state: "missing", evidence: null },
  // Tier-2 fields as missing. A provider also omits them sometimes, which
  // extract.ts turns back into missing — either way the diving question lands.
  diver: { value: null, state: "missing", evidence: null },
  diveFrom: { value: null, state: "missing", evidence: null },
  diveTo: { value: null, state: "missing", evidence: null },
  transportType: { value: null, state: "missing", evidence: null },
};

// Fully stated on every field the question list covers. House norms (rooms,
// meals, transport) are *not* asked about any more — they are shown in the
// summary as assumed — so "done" means nothing is left as *missing*, and diving
// has to be answered like everything else.
const COMPLETE_RAW = {
  ...PARTIAL_RAW,
  guests: { value: 2, state: "stated", evidence: "2 of us" },
  rooms: { value: 1, state: "stated", evidence: "1 room" },
  meals: { value: "full_board", state: "stated", evidence: "full board" },
  transport: { value: false, state: "stated", evidence: "no transport needed" },
  diver: { value: false, state: "stated", evidence: "no diving" },
  contactName: { value: "Minh", state: "stated", evidence: "My name is Minh" },
};

// The same partial extraction with the two dates in Vietnamese, for the
// language test: "thứ 7 tuần sau" only resolves through WEEKDAYS' digit form.
const VI_RAW = {
  ...PARTIAL_RAW,
  checkIn: { value: null, state: "stated", evidence: "thứ 7 tuần sau" },
  nights: { value: 3, state: "stated", evidence: "3 đêm" },
};

function providerReturning(raw: unknown): ExtractProvider {
  return {
    id: "fake:v1",
    call: vi.fn().mockResolvedValue({ raw, tokensIn: 100, tokensOut: 100, cacheReadTokens: 0, ms: 10 }),
  };
}

describe("converse", () => {
  it("sends the whole reply back in one message, not one question per turn", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const outcome = await converse(
      [{ role: "guest", text: "Hi, next Saturday for 3 nights please" }],
      provider,
    );

    expect(outcome.done).toBe(false);
    expect(outcome.replyKind).toBe("questions");
    // Every open field, in priority order — the guest can answer all of it in one
    // reply. Form UIs draw their fields from this same array, so the reply and the
    // array are asserted together. Rooms, meals and transport are absent: they are
    // house norms, which are shown rather than asked about.
    expect(outcome.questions.map((q) => q.field)).toEqual(["guests", "diver", "contactName"]);
    for (const { question } of outcome.questions) expect(outcome.reply).toContain(question);
    // What the guest already said is read back in prose, and never asked again.
    expect(outcome.reply).toContain("I've noted down your stay starting Sep 26 for 3 nights.");
    expect(outcome.reply).not.toContain("What date would you like to check in?");
    expect(outcome.reply).not.toContain("How many rooms do you need?");
    expect(provider.call).toHaveBeenCalledTimes(1); // the reply is assembled, not a second model call
  });

  it("resends the whole transcript every turn, so the model sees earlier answers", async () => {
    const provider = providerReturning(COMPLETE_RAW);
    await converse(
      [
        { role: "guest", text: "Hi, next Saturday for 3 nights please" },
        { role: "assistant", text: "How many guests in total?" },
        { role: "guest", text: "2 of us, 1 room" },
      ],
      provider,
    );

    const sentText = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(sentText).toContain("Guest: Hi, next Saturday for 3 nights please");
    expect(sentText).toContain("Assistant: How many guests in total?");
    expect(sentText).toContain("Guest: 2 of us, 1 room");
  });

  it("declares done and hands the whole booking over once nothing is missing", async () => {
    const provider = providerReturning(COMPLETE_RAW);
    const outcome = await converse(
      [
        {
          role: "guest",
          text: "Hi, next Saturday for 3 nights, 2 of us, 1 room, full board, no transport needed, no diving. My name is Minh",
        },
      ],
      provider,
    );

    expect(outcome.done).toBe(true);
    expect(outcome.replyKind).toBe("summary");
    expect(outcome.questions).toHaveLength(0);
    expect(outcome.reply).toMatch(/Here's what I have for your stay/);
    expect(outcome.reply).toContain("• Stay: ");
    expect(outcome.reply).toMatch(/team will follow up/i);
  });

  it("keeps early context instead of dropping it after an arbitrary turn count", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const turns = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "guest" : "assistant") as const,
      text: `turn-marker-${i}`,
    }));

    await converse(turns, provider);

    const sentText = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(sentText).toContain("turn-marker-0"); // early guest facts remain available
    expect(sentText).toContain("turn-marker-3");
    expect(sentText).toContain("turn-marker-11");
  });

  it("accepts a new channel-agnostic message with prior history", async () => {
    const provider = providerReturning(COMPLETE_RAW);
    await converse(
      {
        conversationId: "conv-1",
        channel: "email",
        history: [{ role: "guest", text: "We are 2 guests" }],
        message: "Please add 1 room and full board.",
      },
      provider,
    );

    const sentText = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(sentText).toContain("Guest: We are 2 guests");
    expect(sentText).toContain("Guest: Please add 1 room and full board.");
  });

  it("asks in the guest's detected language, acknowledgment and all", async () => {
    const provider = providerReturning(VI_RAW);
    const outcome = await converse(
      [{ role: "guest", text: "Xin chào, tôi muốn nhận phòng thứ 7 tuần sau, ở 3 đêm" }],
      provider,
    );

    expect(outcome.replyKind).toBe("questions");
    expect(outcome.reply).toContain("Em đã ghi nhận kỳ nghỉ từ 26/09, 3 đêm ạ.");
    expect(outcome.reply).toContain("Tổng cộng có bao nhiêu khách?");
    expect(outcome.reply).not.toContain("How many guests in total?"); // no language mixing
    expect(outcome.reply).not.toContain("Thanks"); // and no English boilerplate
  });
});
