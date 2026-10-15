import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "../../src/infra/providers/anthropic.ts";
import { MalformedArgumentsError } from "../../src/ports/provider.ts";

describe("createAnthropicProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("constructs an Anthropic provider with default model and custom model", () => {
    const p1 = createAnthropicProvider("test-key");
    expect(p1.id).toBe(`anthropic:${DEFAULT_ANTHROPIC_MODEL}`);

    const p2 = createAnthropicProvider("test-key", "claude-3-7-sonnet-20250219");
    expect(p2.id).toBe("anthropic:claude-3-7-sonnet-20250219");
  });

  it("throws when API key is missing", () => {
    expect(() => createAnthropicProvider("")).toThrow("Anthropic API key is required");
  });

  it("calls Anthropic messages API with forced tool extraction and returns result", async () => {
    const mockResponse = {
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_456",
          name: "extract_trip",
          input: {
            checkIn: { value: "2026-11-20", state: "stated", evidence: "Nov 20" },
            nights: { value: 3, state: "stated", evidence: "3 nights" },
          },
        },
      ],
      model: DEFAULT_ANTHROPIC_MODEL,
      usage: {
        input_tokens: 150,
        output_tokens: 45,
        cache_read_input_tokens: 80,
      },
    };

    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        json: async () => mockResponse,
      };
    });

    const provider = createAnthropicProvider("my-anthropic-key");
    const result = await provider.call({
      text: "Nov 20 for 3 nights",
      today: "2026-10-15",
      jsonSchema: { type: "object", properties: { nights: { type: "number" } } },
    });

    expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(capturedHeaders["x-api-key"]).toBe("my-anthropic-key");
    expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
    expect(capturedBody.tools[0].name).toBe("extract_trip");
    expect(capturedBody.tool_choice).toEqual({ type: "tool", name: "extract_trip" });

    expect(result.raw).toEqual({
      checkIn: { value: "2026-11-20", state: "stated", evidence: "Nov 20" },
      nights: { value: 3, state: "stated", evidence: "3 nights" },
    });
    expect(result.tokensIn).toBe(150);
    expect(result.tokensOut).toBe(45);
    expect(result.cacheReadTokens).toBe(80);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it("handles retry notices in the user prompt", async () => {
    let capturedPrompt = "";

    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      capturedPrompt = body.messages[0].content;
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "tool_use", name: "extract_trip", input: { nights: 3 } }],
          usage: {},
        }),
      };
    });

    const provider = createAnthropicProvider("key");
    await provider.call({
      text: "3 nights",
      today: "2026-10-15",
      jsonSchema: {},
      retry: { previousRaw: { nights: -1 }, error: "nights must be positive" },
    });

    expect(capturedPrompt).toContain("[RETRY NOTICE: Your previous extraction failed validation: nights must be positive");
  });

  it("throws MalformedArgumentsError when tool use block is missing from content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "I cannot extract that." }],
        usage: {},
      }),
    });

    const provider = createAnthropicProvider("key");
    await expect(
      provider.call({ text: "hello", today: "2026-10-15", jsonSchema: {} }),
    ).rejects.toThrow(MalformedArgumentsError);
  });

  it("throws error when API returns non-200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Invalid API key",
    });

    const provider = createAnthropicProvider("key");
    await expect(
      provider.call({ text: "hello", today: "2026-10-15", jsonSchema: {} }),
    ).rejects.toThrow("Anthropic API error (401): Invalid API key");
  });

  it("supports generateText for synthesis replies", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Welcome to Casa Escondida! We would be delighted to host you." }],
        usage: {},
      }),
    });

    const provider = createAnthropicProvider("key");
    const reply = await provider.generateText!("You are host", "Guest: hello");
    expect(reply).toBe("Welcome to Casa Escondida! We would be delighted to host you.");
  });
});
