import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGeminiProvider } from "../../src/providers/gemini.js";

const REAL_FETCH = global.fetch;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  global.fetch = REAL_FETCH;
});

describe("createGeminiProvider timeout", () => {
  it("times out after 8s instead of hanging forever on a stuck request", async () => {
    // A fetch that never settles — mirrors a genuinely hung connection.
    // The mock must reject (not just never resolve) when aborted, matching
    // real fetch's behavior: it rejects the promise with an AbortError as
    // soon as controller.abort() fires.
    global.fetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const provider = createGeminiProvider("fake-key");
    const callPromise = provider.call({ text: "hi", jsonSchema: {}, today: "2026-09-15" });

    // Attach a rejection observer immediately so advancing timers doesn't
    // race an "unhandled rejection" before the assertion below attaches.
    const assertion = expect(callPromise).rejects.toThrow(/timed out after 8000ms/);

    await vi.advanceTimersByTimeAsync(9_000);
    await assertion;
  });
});
