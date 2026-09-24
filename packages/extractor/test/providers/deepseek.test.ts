import { describe, it, expect, vi, afterEach } from "vitest";
import { createDeepSeekProvider } from "../../src/providers/deepseek.js";

const REAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = REAL_FETCH;
});

describe("createDeepSeekProvider schema compatibility", () => {
  it("removes boolean exclusive bounds rejected by the gateway", async () => {
    let request: Record<string, any> | undefined;
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          usage: {},
          choices: [{ message: { tool_calls: [{ function: { arguments: "{}" } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await createDeepSeekProvider("fake-key").call({
      text: "hi",
      jsonSchema: {
        type: "object",
        properties: {
          nights: { type: "integer", exclusiveMinimum: true, minimum: 0 },
        },
      },
      today: "2026-09-15",
    });

    const nights = request?.tools?.[0]?.function?.parameters?.properties?.nights;
    expect(nights).toEqual({ type: "integer", minimum: 0 });
    expect(request?.thinking).toEqual({ type: "disabled" });
  });
});

describe("createDeepSeekProvider prompt", () => {
  // The prompt is where the transport answer is decided: the pipeline can only check the
  // shape and the evidence of a boolean, never whether the guest actually asked for a
  // transfer. The recorded live run answered `transport: true` for a guest who was driving
  // themselves (eval's zh-09 — the same mistake was made on a Vietnamese message too, but
  // that language is no longer supported) — the guest's own sentence as the evidence, so
  // nothing in code could object — and that is one line of the quote per guest. This holds
  // the fix in place: the rule, and the examples that make it usable, have to be in the
  // prompt.
  it("tells the model how to read transport, self-driving included", async () => {
    let request: Record<string, any> | undefined;
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          usage: {},
          choices: [{ message: { tool_calls: [{ function: { arguments: "{}" } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await createDeepSeekProvider("fake-key").call({
      text: "hi",
      jsonSchema: { type: "object", properties: {} },
      today: "2026-09-15",
    });

    const prompt: string = request?.messages?.[0]?.content ?? "";
    // The rule itself…
    expect(prompt).toContain("airport pickup or transfer");
    expect(prompt).toContain("driving themselves");
    // …and the self-driving examples it is taught with, in both supported languages. A rule
    // with no example is a rule the model has to guess at, which is what cost zh-09 its quote.
    expect(prompt).toContain("'own van'");
    expect(prompt).toContain("'we have a car'");
    expect(prompt).toContain("自己开车");
    expect(prompt).toContain("不需要接送");
    expect(prompt).toMatch(/Otherwise mark it missing/);
  });
});

describe("createDeepSeekProvider generateText", () => {
  // synthesis.ts's warm concierge reply only had Gemini to call — when Gemini's
  // free-tier quota is exhausted, providerFromEnv.ts's withFallback for
  // generateText had nothing on the DeepSeek side to try first, so every
  // reply silently dropped to the plain renderReply() template. This is the
  // method that gives it a second real option.
  it("sends a plain system+user completion, no tool schema, and returns the message text", async () => {
    let request: Record<string, any> | undefined;
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "  Warm reply text.  " } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const text = await createDeepSeekProvider("fake-key").generateText!("system prompt", "user prompt");

    expect(text).toBe("Warm reply text.");
    expect(request?.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ]);
    expect(request?.tools).toBeUndefined();
    expect(request?.thinking).toEqual({ type: "disabled" });
  });

  it("throws on a non-OK response so the resilient provider can fall back", async () => {
    global.fetch = vi.fn(async () => new Response("server error", { status: 500 })) as unknown as typeof fetch;

    await expect(createDeepSeekProvider("fake-key").generateText!("sys", "user")).rejects.toThrow(
      "DeepSeek generateText failed: 500",
    );
  });
});
