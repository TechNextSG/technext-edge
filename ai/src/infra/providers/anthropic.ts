import type {
  ExtractCall,
  ExtractProvider,
  ExtractResult,
  GuestsReadResult,
  CheckInReadResult,
  DiveWindowReadResult,
} from "../../ports/provider.ts";
import { MalformedArgumentsError } from "../../ports/provider.ts";
import { EXTRACT_SYSTEM_PROMPT } from "./extractPrompt.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
const DEFAULT_TIMEOUT_MS = 10_000;
const ANTHROPIC_VERSION = "2023-06-01";
const TOOL_NAME = "extract_trip";

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

function toAnthropicSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toAnthropicSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$schema" || key === "$ref") continue;
      out[key] = toAnthropicSchema(value);
    }
    return out;
  }
  return node;
}

export interface AnthropicProviderOptions {
  timeoutMs?: number | undefined;
  baseUrl?: string | undefined;
}

/**
 * Native fetch-based adapter for Anthropic Claude (e.g. Claude 3.5 Haiku).
 * Adheres to data residency and production gate D-129.
 */
export function createAnthropicProvider(
  apiKey: string,
  model = DEFAULT_ANTHROPIC_MODEL,
  options: AnthropicProviderOptions = {},
): ExtractProvider {
  if (!apiKey) throw new Error("Anthropic API key is required");
  const baseUrl = withoutTrailingSlashes(options.baseUrl ?? "https://api.anthropic.com");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function postMessages(payload: unknown, abortMs: number = timeoutMs): Promise<{ json: any; ms: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), abortMs);
    const start = Date.now();
    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const ms = Date.now() - start;
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const json = await response.json();
      return { json, ms };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: `anthropic:${model}`,

    async call(input: ExtractCall): Promise<ExtractResult> {
      let userPrompt = `Today is ${input.today} (Manila time).\n\nGuest transcript:\n${input.text}`;
      if (input.retry) {
        userPrompt += `\n\n[RETRY NOTICE: Your previous extraction failed validation: ${input.retry.error}. Previous output was: ${JSON.stringify(input.retry.previousRaw)}. Please fix all invalid fields.]`;
      }

      const payload = {
        model,
        max_tokens: 4096,
        system: EXTRACT_SYSTEM_PROMPT,
        tools: [
          {
            name: TOOL_NAME,
            description: "Extract structured trip details from a dive resort inquiry.",
            input_schema: toAnthropicSchema(input.jsonSchema),
          },
        ],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: userPrompt }],
      };

      const { json, ms } = await postMessages(payload);
      const usage = json.usage ?? {};
      const tokensIn = usage.input_tokens ?? 0;
      const tokensOut = usage.output_tokens ?? 0;
      const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

      const content = Array.isArray(json.content) ? json.content : [];
      const toolUse = content.find((c: any) => c.type === "tool_use" && c.name === TOOL_NAME);

      if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
        throw new MalformedArgumentsError(
          "Anthropic response contained no valid extract_trip tool use block",
          JSON.stringify(json),
        );
      }

      return {
        raw: toolUse.input,
        tokensIn,
        tokensOut,
        cacheReadTokens,
        ms,
      };
    },

    async generateText(systemPrompt: string, userPrompt: string): Promise<string> {
      const payload = {
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      };

      const { json } = await postMessages(payload, Math.min(timeoutMs, 8_000));
      const content = Array.isArray(json.content) ? json.content : [];
      const textBlock = content.find((c: any) => c.type === "text");
      return textBlock?.text?.trim() ?? "";
    },
  };
}
