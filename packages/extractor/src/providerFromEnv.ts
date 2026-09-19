import type { ExtractProvider } from "./provider.js";
import { createGeminiProvider } from "./providers/gemini.js";
import { createDeepSeekProvider } from "./providers/deepseek.js";

export const KNOWN_PROVIDER_NAMES = [
  "gemini",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-3-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "deepseek-flash",
  "deepseek-pro",
] as const;
export type ProviderName = (typeof KNOWN_PROVIDER_NAMES)[number];

// Builds a provider from an explicit (name, key) pair — used for the test
// page's per-request override and by createProviderFromEnv below. Kept
// separate so "which provider, which key" is decided in exactly one place
// regardless of whether the answer came from env vars or a request body.
export function createProviderByName(name: string, apiKey: string): ExtractProvider {
  const lower = name.toLowerCase();
  if (lower === "gemini" || lower === "gemini-flash") {
    return createGeminiProvider(apiKey, process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite");
  }
  if (lower === "gemini-3.1-flash-lite" || lower === "gemini-flash-lite") {
    return createGeminiProvider(apiKey, "gemini-3.1-flash-lite");
  }
  if (lower === "gemini-3.5-flash") {
    return createGeminiProvider(apiKey, "gemini-3.5-flash");
  }
  if (lower === "gemini-3.8-flash") {
    return createGeminiProvider(apiKey, "gemini-3.8-flash");
  }
  if (lower === "gemini-flash-latest") {
    return createGeminiProvider(apiKey, "gemini-flash-latest");
  }
  if (lower === "gemini-3-flash" || lower === "gemini-3" || lower === "gemini-3.1-flash") {
    return createGeminiProvider(apiKey, "gemini-3.1-flash-lite");
  }
  if (lower === "gemini-2.5-pro" || lower === "gemini-pro") {
    return createGeminiProvider(apiKey, "gemini-2.5-pro");
  }
  if (lower === "gemini-2.5-flash") {
    return createGeminiProvider(apiKey, "gemini-2.5-flash");
  }
  if (lower === "gemini-2.0-flash" || lower === "gemini-2") {
    return createGeminiProvider(apiKey, "gemini-2.0-flash");
  }
  if (lower.startsWith("gemini:")) {
    return createGeminiProvider(apiKey, name.slice(7).trim());
  }
  if (lower === "deepseek" || lower === "deepseek-flash") {
    return createDeepSeekProvider(apiKey, "deepseek-flash");
  }
  if (lower === "deepseek-pro") {
    return createDeepSeekProvider(apiKey, "deepseek-pro");
  }
  throw new Error(`Unknown provider: "${name}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
}

function createResilientProvider(primary: ExtractProvider, fallback?: ExtractProvider): ExtractProvider {
  if (!fallback) return primary;
  return {
    id: primary.id,
    async call(args) {
      try {
        return await primary.call(args);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[provider] Primary ${primary.id} failed (${err instanceof Error ? err.message : String(err)}); falling over to fallback ${fallback.id}`);
        return await fallback.call(args);
      }
    },
  };
}

// The one place that turns config into a live provider.
// Policy: DeepSeek is primary/default. Gemini is secondary/fallback.
export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ExtractProvider {
  const which = (env.EXTRACTOR_PROVIDER ?? "deepseek-flash").toLowerCase();

  switch (which) {
    case "deepseek":
    case "deepseek-flash":
    case "deepseek-pro": {
      const key = env.DEEPSEEK_GATEWAY_KEY;
      const model = which === "deepseek" ? (env.DEEPSEEK_MODEL as "deepseek-flash" | "deepseek-pro" | undefined) ?? "deepseek-flash" : which;
      if (key) {
        const primary = createDeepSeekProvider(key, model);
        if (env.GEMINI_API_KEY) {
          const fallback = createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
          return createResilientProvider(primary, fallback);
        }
        return primary;
      }
      // Graceful fallback to secondary provider (Gemini) if configured
      if (env.GEMINI_API_KEY) {
        // eslint-disable-next-line no-console
        console.warn(`[provider] DEEPSEEK_GATEWAY_KEY not set; falling back to secondary provider Gemini (${env.GEMINI_MODEL ?? "gemini-2.5-flash"})`);
        return createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
      }
      throw new Error("DEEPSEEK_GATEWAY_KEY not set (and no fallback GEMINI_API_KEY found)");
    }
    case "gemini": {
      const key = env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY not set");
      return createGeminiProvider(key, env.GEMINI_MODEL);
    }
    default:
      throw new Error(`Unknown EXTRACTOR_PROVIDER: "${which}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }
}

