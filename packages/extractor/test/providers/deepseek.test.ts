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
