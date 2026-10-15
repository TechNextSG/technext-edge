import type { ExtractProvider } from "../../ports/provider.ts";
import { createExtractProvider } from "./core.ts";
import { createOpenAiCompatibleTransport } from "./openAiCompatible.ts";

export interface DeepSeekOptions {
  timeoutMs?: number | undefined;
  baseUrl: string;
}

/**
 * DeepSeek provider built on the shared core and OpenAI-compatible transport (Pattern 1 & Pattern 3).
 */
export function createDeepSeekProvider(
  apiKey: string,
  model: "deepseek-flash" | "deepseek-pro" = "deepseek-flash",
  options: DeepSeekOptions,
): ExtractProvider {
  if (!options?.baseUrl) throw new Error("DeepSeek is not configured: no gateway base URL (DEEPSEEK_BASE_URL)");
  const transport = createOpenAiCompatibleTransport({
    apiKey,
    model,
    baseUrl: options.baseUrl,
    disableThinking: true,
    name: "DeepSeek",
  });
  return createExtractProvider(transport, {
    id: "deepseek-gateway:" + model,
    timeoutMs: options.timeoutMs ?? 8_000,
  });
}
