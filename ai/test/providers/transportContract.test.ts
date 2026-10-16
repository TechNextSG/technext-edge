import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnthropicProvider } from "../../src/infra/providers/anthropic.ts";
import { createGeminiProvider } from "../../src/infra/providers/gemini.ts";
import { createDeepSeekProvider } from "../../src/infra/providers/deepseek.ts";
import { MalformedArgumentsError } from "../../src/ports/provider.ts";
import type { ExtractProvider } from "../../src/ports/provider.ts";
import { EXTRACT_SYSTEM_PROMPT } from "../../src/infra/providers/prompts.ts";

const REAL_FETCH = globalThis.fetch;

describe("Transport Contract Tests (T1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
  });

  const dirtySchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $ref: "#/definitions/Trip",
    type: "object",
    additionalProperties: false,
    properties: {
      guests: {
        type: "integer",
        minimum: 0,
        exclusiveMinimum: true,
        exclusiveMaximum: 100,
      },
    },
  };

  interface AdapterTestCase {
    name: "gemini" | "deepseek" | "anthropic";
    create: () => ExtractProvider;
    mockSuccessResponse: (rawOutput: Record<string, unknown>) => unknown;
    mockMalformedResponse: () => unknown;
    expectedUrlPattern: RegExp;
    verifyRequest: (url: string, init?: RequestInit) => void;
  }

  const adapters: AdapterTestCase[] = [
    {
      name: "gemini",
      create: () => createGeminiProvider("test-gemini-key"),
      mockSuccessResponse: (rawOutput) => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(rawOutput) }] } }],
        usageMetadata: {
          promptTokenCount: 110,
          candidatesTokenCount: 25,
          cachedContentTokenCount: 10,
        },
      }),
      mockMalformedResponse: () => ({
        candidates: [{ content: { parts: [{ text: "not-json {{{" }] } }],
      }),
      expectedUrlPattern: /generativelanguage\.googleapis\.com.*key=test-gemini-key/,
      verifyRequest: (url, init) => {
        expect(url).toMatch(/generativelanguage\.googleapis\.com/);
        expect(url).toContain("key=test-gemini-key");
        const body = JSON.parse(String(init?.body));
        expect(body.generationConfig?.responseMimeType).toBe("application/json");
        const schema = body.generationConfig?.responseSchema;
        expect(schema).toBeDefined();
        expect(schema.$schema).toBeUndefined();
        expect(schema.$ref).toBeUndefined();
        expect(schema.additionalProperties).toBeUndefined();
        expect(schema.properties?.guests?.exclusiveMinimum).toBeUndefined();
        expect(schema.properties?.guests?.exclusiveMaximum).toBeUndefined();
      },
    },
    {
      name: "deepseek",
      create: () =>
        createDeepSeekProvider("test-deepseek-key", "deepseek-flash", {
          baseUrl: "https://gateway.test",
        }),
      mockSuccessResponse: (rawOutput) => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "extract_trip",
                    arguments: JSON.stringify(rawOutput),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
        },
      }),
      mockMalformedResponse: () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "extract_trip",
                    arguments: "invalid-json {",
                  },
                },
              ],
            },
          },
        ],
      }),
      expectedUrlPattern: /^https:\/\/gateway\.test\/chat\/completions$/,
      verifyRequest: (url, init) => {
        expect(url).toBe("https://gateway.test/chat/completions");
        const headers = init?.headers as Record<string, string>;
        expect(headers["authorization"] || headers["Authorization"]).toBe("Bearer test-deepseek-key");
        const body = JSON.parse(String(init?.body));
        expect(body.tool_choice).toEqual({
          type: "function",
          function: { name: "extract_trip" },
        });
        const tool = body.tools?.find((t: any) => t.function?.name === "extract_trip");
        expect(tool).toBeDefined();
        const schema = tool.function.parameters;
        expect(schema.properties?.guests?.exclusiveMinimum).toBeUndefined();
        expect(schema.properties?.guests?.exclusiveMaximum).toBeUndefined();
      },
    },
    {
      name: "anthropic",
      create: () => createAnthropicProvider("test-anthropic-key"),
      mockSuccessResponse: (rawOutput) => ({
        content: [
          {
            type: "tool_use",
            name: "extract_trip",
            input: rawOutput,
          },
        ],
        usage: {
          input_tokens: 130,
          output_tokens: 35,
          cache_read_input_tokens: 15,
        },
      }),
      mockMalformedResponse: () => ({
        content: [{ type: "text", text: "I did not call any tools." }],
      }),
      expectedUrlPattern: /^https:\/\/api\.anthropic\.com\/v1\/messages$/,
      verifyRequest: (url, init) => {
        expect(url).toBe("https://api.anthropic.com/v1/messages");
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-api-key"]).toBe("test-anthropic-key");
        expect(headers["anthropic-version"]).toBe("2023-06-01");
        const body = JSON.parse(String(init?.body));
        expect(body.tool_choice).toEqual({
          type: "tool",
          name: "extract_trip",
        });
        const tool = body.tools?.find((t: any) => t.name === "extract_trip");
        expect(tool).toBeDefined();
        const schema = tool.input_schema;
        expect(schema.$schema).toBeUndefined();
        expect(schema.$ref).toBeUndefined();
      },
    },
  ];

  describe.each(adapters)("Contract: $name", ({ name, create, mockSuccessResponse, mockMalformedResponse, expectedUrlPattern, verifyRequest }) => {
    it("formats request correctly: URL, auth, tool forced, schema cleaned", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return new Response(JSON.stringify(mockSuccessResponse({ guests: { value: 2, state: "stated", evidence: "2" } })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const provider = create();
      await provider.call({
        text: "We have 2 guests staying",
        jsonSchema: dirtySchema,
        today: "2026-10-15",
      });

      expect(capturedUrl).toMatch(expectedUrlPattern);
      verifyRequest(capturedUrl, capturedInit);
    });

    it("returns correct ExtractResult shape on success", async () => {
      const mockRaw = { guests: { value: 2, state: "stated", evidence: "2 people" } };
      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify(mockSuccessResponse(mockRaw)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const provider = create();
      const result = await provider.call({
        text: "2 people",
        jsonSchema: dirtySchema,
        today: "2026-10-15",
      });

      expect(result.raw).toEqual(mockRaw);
      expect(typeof result.tokensIn).toBe("number");
      expect(typeof result.tokensOut).toBe("number");
      expect(typeof result.cacheReadTokens).toBe("number");
      expect(typeof result.ms).toBe("number");
      expect(result.ms).toBeGreaterThanOrEqual(0);
    });

    it("throws MalformedArgumentsError on invalid JSON / missing tool use", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify(mockMalformedResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const provider = create();
      await expect(
        provider.call({
          text: "hello",
          jsonSchema: dirtySchema,
          today: "2026-10-15",
        }),
      ).rejects.toThrow(MalformedArgumentsError);
    });

    it("throws error with status on non-2xx response", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response("Service Unavailable", {
          status: 503,
          headers: { "content-type": "text/plain" },
        });
      }) as unknown as typeof fetch;

      const provider = create();
      await expect(
        provider.call({
          text: "hello",
          jsonSchema: dirtySchema,
          today: "2026-10-15",
        }),
      ).rejects.toThrow(/503/);
    });

    it("handles timeout with error matching timed out or aborted", async () => {
      globalThis.fetch = vi.fn((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }) as unknown as typeof fetch;

      // Provide small timeoutMs so test finishes promptly without hanging
      let provider: ExtractProvider;
      if (name === "gemini") {
        provider = createGeminiProvider("key", undefined, { timeoutMs: 20 });
      } else if (name === "deepseek") {
        provider = createDeepSeekProvider("key", "deepseek-flash", { baseUrl: "https://gateway.test", timeoutMs: 20 });
      } else {
        provider = createAnthropicProvider("key", undefined, { timeoutMs: 20 });
      }

      await expect(
        provider.call({
          text: "hello",
          jsonSchema: dirtySchema,
          today: "2026-10-15",
        }),
      ).rejects.toThrow(/timed out|aborted/i);
    });
  });

  describe("extractGuests Result shape (for providers supporting it)", () => {
    it("gemini extractGuests returns GuestsReadResult shape", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        value: 4,
                        state: "stated",
                        evidence: "4 guests",
                      }),
                    },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 15 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const provider = createGeminiProvider("key");
      const res = await provider.extractGuests!("4 guests");
      expect(res).toEqual({
        value: 4,
        state: "stated",
        evidence: "4 guests",
        tokensIn: 50,
        tokensOut: 15,
        ms: expect.any(Number),
      });
    });

    it("deepseek extractGuests returns GuestsReadResult shape", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "record_guests",
                        arguments: JSON.stringify({
                          value: 4,
                          state: "stated",
                          evidence: "4 guests",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 15 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const provider = createDeepSeekProvider("key", "deepseek-flash", { baseUrl: "https://gateway.test" });
      const res = await provider.extractGuests!("4 guests");
      expect(res).toEqual({
        value: 4,
        state: "stated",
        evidence: "4 guests",
        tokensIn: 50,
        tokensOut: 15,
        ms: expect.any(Number),
      });
    });
  });

  describe("Prompt snapshots", () => {
    it("locks current EXTRACT_SYSTEM_PROMPT into snapshot", () => {
      expect(EXTRACT_SYSTEM_PROMPT).toMatchSnapshot();
    });

    it("locks current DeepSeek main system prompt into snapshot", async () => {
      let capturedPrompt = "";
      globalThis.fetch = vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        capturedPrompt = body.messages?.[0]?.content ?? "";
        return new Response(
          JSON.stringify({
            choices: [{ message: { tool_calls: [{ function: { name: "extract_trip", arguments: "{}" } }] } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const provider = createDeepSeekProvider("key", "deepseek-flash", { baseUrl: "https://gateway.test" });
      await provider.call({ text: "test", jsonSchema: {}, today: "2026-10-15" });
      expect(capturedPrompt).toMatchSnapshot();
    });
  });
});
