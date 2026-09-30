import { describe, it, expect, vi } from "vitest";
import { createAnthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "../../src/infra/providers/anthropic.js";
import { MalformedArgumentsError } from "../../src/ports/provider.js";

/** What the Messages API answers, as the SDK expects it. */
function messageBody(text: string, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: ANTHROPIC_DEFAULT_MODEL,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 100 },
    ...extra,
  };
}

function fakeFetch(respond: (body: Record<string, unknown>) => Response) {
  const calls: Array<Record<string, unknown>> = [];
  const impl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push(body);
    return respond(body);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CALL = { text: "2 guests, Nov 20", jsonSchema: { type: "object", properties: { a: { type: "number" } } }, today: "2026-09-30" };

describe("createAnthropicProvider", () => {
  it("uses the model the API skill names as default, and says so in its id", () => {
    expect(ANTHROPIC_DEFAULT_MODEL).toBe("claude-opus-5-5");
    expect(createAnthropicProvider("k").id).toBe("anthropic:claude-opus-5-5");
  });

  it("asks for JSON matching the schema and returns it parsed, with token counts", async () => {
    const { impl, calls } = fakeFetch(() => json(200, messageBody('{"a":1}')));
    const provider = createAnthropicProvider("k", "claude-opus-5-5", { fetch: impl });

    const out = await provider.call(CALL);

    expect(out.raw).toEqual({ a: 1 });
    expect(out).toMatchObject({ tokensIn: 120, tokensOut: 40, cacheReadTokens: 100 });
    const sent = calls[0]!;
    expect(sent.model).toBe("claude-opus-5-5");
    expect(String(sent.system)).toContain("Reply with ONLY one JSON object");
    expect(String(sent.system)).toContain('"properties"'); // the schema travels in the prompt
    expect(JSON.stringify(sent.messages)).toContain("Today's date (Asia/Manila): 2026-09-30");
    // A forced tool call is a 400 on this model; this adapter never sends one.
    expect(sent).not.toHaveProperty("tool_choice");
    expect(sent.output_config).toEqual({ effort: "low" });
  });

  it("sends no effort to Haiku 4.5, where it is an error", async () => {
    const { impl, calls } = fakeFetch(() => json(200, messageBody('{"a":1}')));
    await createAnthropicProvider("k", "claude-haiku-4-5", { fetch: impl }).call(CALL);
    expect(calls[0]).not.toHaveProperty("output_config");
  });

  it("reads JSON that the model wrapped in a code fence", async () => {
    const { impl } = fakeFetch(() => json(200, messageBody('```json\n{"a":2}\n```')));
    const out = await createAnthropicProvider("k", undefined, { fetch: impl }).call(CALL);
    expect(out.raw).toEqual({ a: 2 });
  });

  it("puts the previous attempt and its error in front of the model on a retry", async () => {
    const { impl, calls } = fakeFetch(() => json(200, messageBody('{"a":1}')));
    await createAnthropicProvider("k", undefined, { fetch: impl }).call({
      ...CALL,
      retry: { previousRaw: { a: "x" }, error: "a: expected number" },
    });
    expect(JSON.stringify(calls[0]!.messages)).toContain("a: expected number");
  });

  it("reports text that is not JSON as the model's own malformed output, which extract() retries with the error", async () => {
    const { impl } = fakeFetch(() => json(200, messageBody("Sure! Here is the trip: 2 guests")));
    await expect(createAnthropicProvider("k", undefined, { fetch: impl }).call(CALL)).rejects.toBeInstanceOf(
      MalformedArgumentsError,
    );
  });

  it("treats a reply cut off at max_tokens as malformed, not as a short answer", async () => {
    const { impl } = fakeFetch(() => json(200, messageBody('{"a":', { stop_reason: "max_tokens" })));
    await expect(createAnthropicProvider("k", undefined, { fetch: impl }).call(CALL)).rejects.toBeInstanceOf(
      MalformedArgumentsError,
    );
  });

  it("does not retry a safety decline as though it were a glitch", async () => {
    const { impl } = fakeFetch(() =>
      json(
        200,
        messageBody("", {
          content: [],
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "cyber", explanation: null },
        }),
      ),
    );
    await expect(createAnthropicProvider("k", undefined, { fetch: impl }).call(CALL)).rejects.toThrow(/declined.*cyber/);
  });

  it("surfaces a 401 with its status in the message, which is what trips the long circuit-breaker", async () => {
    const { impl } = fakeFetch(() =>
      json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    );
    await expect(createAnthropicProvider("bad", undefined, { fetch: impl }).call(CALL)).rejects.toThrow(/401/);
  });

  it("times out after the configured time instead of hanging", async () => {
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const provider = createAnthropicProvider("k", undefined, { timeoutMs: 60, fetch: hang as unknown as typeof fetch });
    await expect(provider.call(CALL)).rejects.toThrow(/timed out after 60ms/);
  });

  it("writes a reply with generateText", async () => {
    const { impl, calls } = fakeFetch(() => json(200, messageBody("  Hello Ana!  ")));
    const text = await createAnthropicProvider("k", undefined, { fetch: impl }).generateText!("be warm", "greet Ana");
    expect(text).toBe("Hello Ana!");
    expect(calls[0]!.system).toBe("be warm");
  });
});
