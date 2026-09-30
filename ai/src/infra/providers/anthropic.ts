// Anthropic (Claude) adapter, through the official SDK.
//
// Why it exists: the customer's README allows only Anthropic and Odoo to see real guest data, while the
// default providers here (Gemini, DeepSeek) sit outside that. Having this behind the same port means the
// answer to "may real messages go to Gemini?" is a setting in the admin dashboard, not a code change.
//
// How it answers: plain JSON text, parsed here — NOT a forced tool call and NOT structured outputs.
//   * Claude Opus 5.5 / Sonnet 5.5 reject a forced `tool_choice` (HTTP 400), which is how the other adapters
//     get their JSON.
//   * Structured outputs take a narrower JSON Schema than the zod-derived one this port hands over, and that
//     subset has not been exercised against the live API from here (no key in the test environment).
// The existing contract covers the difference: `extract.ts` validates with zod, and a reply that is not JSON or
// not the schema goes back to the model once with the error attached (`MalformedArgumentsError`). Switching
// this adapter to structured outputs is a change to `call()` only, once it can be tried with a real key.
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractCall, ExtractProvider, ExtractResult } from "../../ports/provider.js";
import { MalformedArgumentsError } from "../../ports/provider.js";
import { EXTRACT_SYSTEM_PROMPT } from "./extractPrompt.js";

/** `claude-opus-5-5`: the current Opus and the model the API skill names as the default. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/** Models an admin may pick. A list, not a pattern: an id nobody listed is a typo, not a model. */
export const ANTHROPIC_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"] as const;

export interface AnthropicOptions {
  /** Per-call timeout for the extraction pass. Default 15s, like Gemini's. */
  timeoutMs?: number;
  /** Timeout for the written reply. Default 8s. */
  synthesisTimeoutMs?: number;
  /** Injected so a test can answer without a network. */
  fetch?: typeof fetch;
}

/**
 * `output_config.effort` exists on the Opus / Sonnet 5 family and is an error on Haiku 4.5. Low, because this
 * is extraction under a 20s WhatsApp deadline, not open-ended reasoning.
 */
function effortFor(model: string): { output_config: { effort: "low" } } | Record<string, never> {
  return /^claude-(opus|sonnet|fable)-5/.test(model) ? { output_config: { effort: "low" } } : {};
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/** The model is told to reply with bare JSON; a fence around it is still JSON. */
function parseJson(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(stripped);
}

export function createAnthropicProvider(
  apiKey: string,
  model: string = ANTHROPIC_DEFAULT_MODEL,
  options: AnthropicOptions = {},
): ExtractProvider {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const synthesisTimeoutMs = options.synthesisTimeoutMs ?? 8_000;
  // No retries inside the SDK: the circuit breaker and `extract.ts`'s own retry-once decide what happens
  // next, and stacking a third layer is how a 20s deadline gets missed.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs, ...(options.fetch ? { fetch: options.fetch } : {}) });

  return {
    id: "anthropic:" + model,

    async call({ text, jsonSchema, today, retry }: ExtractCall): Promise<ExtractResult> {
      const started = Date.now();
      const system =
        `${EXTRACT_SYSTEM_PROMPT}\n\n` +
        `Reply with ONLY one JSON object that matches this JSON Schema — no prose before or after it, no code fences:\n` +
        JSON.stringify(jsonSchema);

      const userParts = [`Today's date (Asia/Manila): ${today}`, `Guest message:\n${text}`];
      if (retry) {
        userParts.push(
          `Your previous JSON response did not match the schema.\n` +
            `Error: ${retry.error}\n` +
            `Your previous response: ${JSON.stringify(retry.previousRaw)}\n` +
            `Fix it and return JSON matching the schema exactly.`,
        );
      }

      let message: Anthropic.Message;
      try {
        message = await client.messages.create({
          model,
          max_tokens: 4096,
          system,
          messages: [{ role: "user", content: userParts.join("\n\n") }],
          ...effortFor(model),
        });
      } catch (err) {
        if (err instanceof Anthropic.APIConnectionTimeoutError) {
          throw new Error(`Anthropic extract timed out after ${timeoutMs}ms`);
        }
        throw err;
      }

      // A safety decline is an answer, not a transport failure, and retrying it verbatim cannot change it.
      if (message.stop_reason === "refusal") {
        throw new Error(`Anthropic declined the request (${message.stop_details?.category ?? "no category"})`);
      }
      const raw = textOf(message);
      if (message.stop_reason === "max_tokens") {
        throw new MalformedArgumentsError("Anthropic reply was cut off at max_tokens", raw.slice(0, 2000));
      }
      let parsed: unknown;
      try {
        parsed = parseJson(raw);
      } catch (err) {
        throw new MalformedArgumentsError(
          `Anthropic reply was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          raw.slice(0, 2000),
          err,
        );
      }

      return {
        raw: parsed,
        tokensIn: message.usage.input_tokens,
        tokensOut: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        ms: Date.now() - started,
      };
    },

    async generateText(systemPrompt: string, userPrompt: string): Promise<string> {
      const message = await client.messages.create(
        {
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          ...effortFor(model),
        },
        { timeout: synthesisTimeoutMs },
      );
      return textOf(message);
    },
  };
}
