import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOpenAiCompatibleTransport } from "../../src/infra/providers/openAiCompatible.ts";
import { createGeminiTransport } from "../../src/infra/providers/geminiTransport.ts";
import { createAnthropicTransport } from "../../src/infra/providers/anthropicTransport.ts";

const REAL_FETCH = globalThis.fetch;

describe("Transports (T3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
  });

  describe("openAiCompatibleTransport", () => {
    it("formats request correctly: endpoint, auth, thinking disabled, stripped schema", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "extract_trip",
                        arguments: JSON.stringify({ nights: 3 }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 15, completion_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const transport = createOpenAiCompatibleTransport({
        apiKey: "test-openai-key",
        baseUrl: "https://gateway.example.com/v1///",
        model: "deepseek-flash",
        disableThinking: true,
      });

      const res = await transport.structured({
        system: "system prompt",
        user: "user prompt",
        toolName: "extract_trip",
        schema: {
          type: "object",
          properties: {
            guests: { type: "integer", exclusiveMinimum: true, minimum: 1 },
          },
        },
      });

      expect(capturedUrl).toBe("https://gateway.example.com/v1/chat/completions");
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["authorization"] || headers["Authorization"]).toBe("Bearer test-openai-key");

      const body = JSON.parse(String(capturedInit?.body));
      expect(body.model).toBe("deepseek-flash");
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.tool_choice).toEqual({ type: "function", function: { name: "extract_trip" } });
      const schema = body.tools[0].function.parameters;
      expect(schema.properties.guests.exclusiveMinimum).toBeUndefined();
      expect(schema.properties.guests.minimum).toBe(1);

      expect(res.json).toBe(JSON.stringify({ nights: 3 }));
      expect(res.tokensIn).toBe(15);
      expect(res.tokensOut).toBe(5);
    });

    it("supports plain text completion", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "  Hello world  " } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const transport = createOpenAiCompatibleTransport({
        apiKey: "key",
        baseUrl: "https://gateway.test",
        model: "deepseek-flash",
      });

      const text = await transport.text!({ system: "system", user: "user" });
      expect(text).toBe("Hello world");
    });
  });

  describe("geminiTransport", () => {
    it("formats request correctly: key in query, cleaned schema, responseSchema", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "{\"guests\":2}" }] } }],
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, cachedContentTokenCount: 4 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const transport = createGeminiTransport({
        apiKey: "my-gemini-key",
        model: "gemini-3.1-flash-lite",
      });

      const res = await transport.structured({
        system: "sys",
        user: "usr",
        toolName: "extract_trip",
        schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          $ref: "#/def",
          additionalProperties: false,
          type: "object",
          properties: {
            count: { type: "integer", exclusiveMinimum: true },
          },
        },
      });

      expect(capturedUrl).toContain("generativelanguage.googleapis.com");
      expect(capturedUrl).toContain("models/gemini-3.1-flash-lite:generateContent?key=my-gemini-key");

      const body = JSON.parse(String(capturedInit?.body));
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      const schema = body.generationConfig.responseSchema;
      expect(schema.$schema).toBeUndefined();
      expect(schema.$ref).toBeUndefined();
      expect(schema.additionalProperties).toBeUndefined();
      expect(schema.properties.count.exclusiveMinimum).toBeUndefined();

      expect(res.json).toBe("{\"guests\":2}");
      expect(res.tokensIn).toBe(20);
      expect(res.tokensOut).toBe(8);
      expect(res.cacheRead).toBe(4);
    });

    it("retries on 429 rate limit with capped backoff", async () => {
      let attempts = 0;
      globalThis.fetch = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response(
            JSON.stringify({
              error: {
                code: 429,
                message: "Resource exhausted",
                details: [{ retryDelay: "0.05s" }],
              },
            }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "{}" }] } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const transport = createGeminiTransport({
        apiKey: "key",
        model: "gemini-3.1-flash-lite",
      });

      const res = await transport.structured({
        system: "s",
        user: "u",
        toolName: "extract_trip",
        schema: {},
      });

      expect(attempts).toBe(2);
      expect(res.json).toBe("{}");
    });
  });

  describe("anthropicTransport", () => {
    it("formats request correctly: x-api-key, anthropic-version, tool_choice", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                name: "extract_trip",
                input: { checkIn: "2026-11-20" },
              },
            ],
            usage: { input_tokens: 40, output_tokens: 12, cache_read_input_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const transport = createAnthropicTransport({
        apiKey: "anthropic-key-123",
        model: "claude-haiku-5-5",
      });

      const res = await transport.structured({
        system: "sys",
        user: "usr",
        toolName: "extract_trip",
        schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: { checkIn: { type: "string" } },
        },
      });

      expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("anthropic-key-123");
      expect(headers["anthropic-version"]).toBe("2023-06-01");

      const body = JSON.parse(String(capturedInit?.body));
      expect(body.model).toBe("claude-haiku-5-5");
      expect(body.tool_choice).toEqual({ type: "tool", name: "extract_trip" });
      expect(body.tools[0].name).toBe("extract_trip");
      expect(body.tools[0].input_schema.$schema).toBeUndefined();

      expect(res.json).toEqual({ checkIn: "2026-11-20" });
      expect(res.tokensIn).toBe(40);
      expect(res.tokensOut).toBe(12);
      expect(res.cacheRead).toBe(10);
    });

    it("supports plain text completion", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Welcome guest" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const transport = createAnthropicTransport({
        apiKey: "key",
      });

      const text = await transport.text!({ system: "s", user: "u" });
      expect(text).toBe("Welcome guest");
    });
  });
});
