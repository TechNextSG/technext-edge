import type { ExtractProvider } from "../../ports/provider.ts";
import { createExtractProvider } from "./core.ts";
import { createGeminiTransport } from "./geminiTransport.ts";

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

export interface GeminiOptions {
  timeoutMs?: number | undefined;
  synthesisTimeoutMs?: number | undefined;
  baseUrl?: string | undefined;
}

/**
 * Gemini provider built on the shared core and Gemini transport (Pattern 1 & Pattern 3).
 */
export function createGeminiProvider(
  apiKey: string,
  model = DEFAULT_GEMINI_MODEL,
  options: GeminiOptions = {},
): ExtractProvider {
  const transport = createGeminiTransport({
    apiKey,
    model,
    baseUrl: options.baseUrl,
  });
  return createExtractProvider(transport, {
    id: "google:" + model,
    timeoutMs: options.timeoutMs ?? 15_000,
    synthesisTimeoutMs: options.synthesisTimeoutMs,
  });
}
