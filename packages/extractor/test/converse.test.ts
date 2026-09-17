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
};

// Fully stated on every field the question-priority list checks (checkIn,
// nights, guests, rooms, meals, transport) — a "default" house-norm value
// still generates a question (see questions.test.ts), so "done" here means
// nothing is left as missing *or* default, not just "nothing missing".
const COMPLETE_RAW = {
  ...PARTIAL_RAW,
  guests: { value: 2, state: "stated", evidence: "2 of us" },
  rooms: { value: 1, state: "stated", evidence: "1 room" },
  meals: { value: "full_board", state: "stated", evidence: "full board" },
  transport: { value: false, state: "stated", evidence: "no transport needed" },
};

function providerReturning(raw: unknown): ExtractProvider {
  return {
    id: "fake:v1",
    call: vi.fn().mockResolvedValue({ raw, tokensIn: 100, tokensOut: 100, cacheReadTokens: 0, ms: 10 }),
  };
}

describe("converse", () => {
  it("asks a question (no extra model call) when fields are still missing", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const outcome = await converse(
      [{ role: "guest", text: "Hi, next Saturday for 3 nights please" }],
      provider,
    );

    expect(outcome.done).toBe(false);
    expect(outcome.reply).toContain("How many guests");
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

  it("declares done and gives a closing reply once nothing is missing or default", async () => {
    const provider = providerReturning(COMPLETE_RAW);
    const outcome = await converse(
      [
        {
          role: "guest",
          text: "Hi, next Saturday for 3 nights, 2 of us, 1 room, full board, no transport needed",
        },
      ],
      provider,
    );

    expect(outcome.done).toBe(true);
    expect(outcome.reply).toMatch(/team will follow up/i);
  });
});
