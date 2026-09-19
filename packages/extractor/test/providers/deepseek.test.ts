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
  // transfer. The recorded live run answered `transport: true` for two guests who were
  // driving themselves (eval's vi-07 and zh-09) — the guest's own sentence as the evidence,
  // so nothing in code could object — and that is one line of the quote per guest. This
  // holds the fix in place: the rule has to be in the prompt, in the guests' own words.
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
    expect(prompt).toContain("airport pickup or transfer");
    expect(prompt).toContain("driving themselves");
    expect(prompt).toContain("xe tụi mình tự đi"); // vi-07, verbatim from the eval corpus
    expect(prompt).toContain("自己开车"); // zh-09
    expect(prompt).toMatch(/Otherwise mark it missing/);
  });
});
