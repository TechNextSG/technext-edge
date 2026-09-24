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
  it("times out after 15s instead of hanging forever on a stuck request", async () => {
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
    const assertion = expect(callPromise).rejects.toThrow(/timed out after 15000ms/);

    await vi.advanceTimersByTimeAsync(16_000);
    await assertion;
  });
});

describe("createGeminiProvider prompt", () => {
  // Gemini is the configured fallback (providerFromEnv.ts), so it has to carry the same
  // transport rule DeepSeek's prompt does: a rule that lives in one prompt only is a bug
  // waiting for a missing API key. test/providers/deepseek.test.ts has the reasoning — the
  // recorded live run priced an airport transfer for a guest who was driving themselves.
  it("tells the model how to read transport, self-driving included", async () => {
    vi.useRealTimers(); // the call below has no timers to advance
    let request: Record<string, any> | undefined;
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await createGeminiProvider("fake-key").call({
      text: "hi",
      jsonSchema: { type: "object", properties: {} },
      today: "2026-09-15",
    });

    const prompt: string = request?.systemInstruction?.parts?.[0]?.text ?? "";
    // The rule itself…
    expect(prompt).toContain("airport pickup or transfer");
    expect(prompt).toContain("driving themselves");
    // …and the self-driving examples, in both supported languages — the same set DeepSeek's
    // prompt carries, so the fallback is not a weaker prompt.
    expect(prompt).toContain("'own van'");
    expect(prompt).toContain("'we have a car'");
    expect(prompt).toContain("自己开车");
    expect(prompt).toContain("不需要接送");
    expect(prompt).toMatch(/Otherwise mark it missing/);
  });
});
