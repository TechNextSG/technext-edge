import type { ExtractProvider } from "./provider.js";
import { createGeminiProvider } from "./providers/gemini.js";
import { createDeepSeekProvider } from "./providers/deepseek.js";

export const KNOWN_PROVIDER_NAMES = ["gemini", "deepseek-flash", "deepseek-pro"] as const;
export type ProviderName = (typeof KNOWN_PROVIDER_NAMES)[number];

// Builds a provider from an explicit (name, key) pair — used for the test
// page's per-request override and by createProviderFromEnv below. Kept
// separate so "which provider, which key" is decided in exactly one place
// regardless of whether the answer came from env vars or a request body.
export function createProviderByName(name: string, apiKey: string): ExtractProvider {
  switch (name.toLowerCase()) {
    case "gemini":
      return createGeminiProvider(apiKey);
    case "deepseek":
    case "deepseek-flash":
      return createDeepSeekProvider(apiKey, "deepseek-flash");
    case "deepseek-pro":
      return createDeepSeekProvider(apiKey, "deepseek-pro");
    default:
      throw new Error(`Unknown provider: "${name}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }
}

// The one place that turns config into a live provider. app.ts (or any other
// caller) never imports a providers/*.ts adapter directly — that would put
// vendor selection back in the hands of the caller instead of one env var,
// exactly what ADR-005a's adapter architecture exists to avoid.
export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ExtractProvider {
  const which = (env.EXTRACTOR_PROVIDER ?? "gemini").toLowerCase();

  switch (which) {
    case "gemini": {
      const key = env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY not set");
      return createGeminiProvider(key, env.GEMINI_MODEL);
    }
    case "deepseek":
    case "deepseek-flash":
    case "deepseek-pro": {
      const key = env.DEEPSEEK_GATEWAY_KEY;
      if (!key) throw new Error("DEEPSEEK_GATEWAY_KEY not set");
      const model = which === "deepseek" ? (env.DEEPSEEK_MODEL as "deepseek-flash" | "deepseek-pro" | undefined) ?? "deepseek-flash" : which;
      return createDeepSeekProvider(key, model);
    }
    default:
      throw new Error(`Unknown EXTRACTOR_PROVIDER: "${which}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }
}
