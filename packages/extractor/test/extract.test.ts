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
    expect(askedFields).toEqual(["rooms", "meals", "transport"]);

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
});
