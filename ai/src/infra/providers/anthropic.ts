import type { ExtractProvider } from "../../ports/provider.ts";
import { createExtractProvider } from "./core.ts";
import { createAnthropicTransport } from "./anthropicTransport.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

export interface AnthropicProviderOptions {
  timeoutMs?: number | undefined;
  baseUrl?: string | undefined;
}

/**
 * Anthropic provider built on the shared core and Anthropic transport (Pattern 1 & Pattern 3).
 * Now has all 5 passes (extract, guests, checkIn, diveWindow, generateText).
 */
export function createAnthropicProvider(
  apiKey: string,
  model = DEFAULT_ANTHROPIC_MODEL,
  options: AnthropicProviderOptions = {},
): ExtractProvider {
  if (!apiKey) throw new Error("Anthropic API key is required");
  const transport = createAnthropicTransport({
    apiKey,
    model,
    baseUrl: options.baseUrl,
  });
  return createExtractProvider(transport, {
    id: `anthropic:${model}`,
    timeoutMs: options.timeoutMs,
  });
}
