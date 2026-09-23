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
  const COOLDOWN_MS = 60_000;
  let primaryCooldownUntil = 0;

  async function withFallback<T>(fnPrimary: () => Promise<T>, fnFallback: () => Promise<T>): Promise<T> {
    if (Date.now() < primaryCooldownUntil) {
      return await fnFallback();
    }
    try {
      return await fnPrimary();
    } catch (err) {
      primaryCooldownUntil = Date.now() + COOLDOWN_MS;
      // eslint-disable-next-line no-console
      console.warn(
        `[provider] Primary ${primary.id} failed (${err instanceof Error ? err.message : String(err)}); tripping 60s circuit-breaker to fallback ${fallback!.id}`
      );
      return await fnFallback();
    }
  }

  return {
    id: primary.id,
    async call(args) {
      return await withFallback(() => primary.call(args), () => fallback.call(args));
    },
    ...(primary.extractGuests || fallback.extractGuests
      ? {
          async extractGuests(text: string) {
            if (primary.extractGuests && fallback.extractGuests) {
              return await withFallback(
                () => primary.extractGuests!(text),
                () => fallback.extractGuests!(text)
              );
            }
            return primary.extractGuests
              ? await primary.extractGuests(text)
              : await fallback.extractGuests!(text);
          },
        }
      : {}),
    ...(primary.extractCheckIn || fallback.extractCheckIn
      ? {
          async extractCheckIn(text: string, today: string) {
            if (primary.extractCheckIn && fallback.extractCheckIn) {
              return await withFallback(
                () => primary.extractCheckIn!(text, today),
                () => fallback.extractCheckIn!(text, today)
              );
            }
            return primary.extractCheckIn
              ? await primary.extractCheckIn(text, today)
              : await fallback.extractCheckIn!(text, today);
          },
        }
      : {}),
    ...(primary.extractDiveWindow || fallback.extractDiveWindow
      ? {
          async extractDiveWindow(text: string, today: string) {
            if (primary.extractDiveWindow && fallback.extractDiveWindow) {
              return await withFallback(
                () => primary.extractDiveWindow!(text, today),
                () => fallback.extractDiveWindow!(text, today)
              );
            }
            return primary.extractDiveWindow
              ? await primary.extractDiveWindow(text, today)
              : await fallback.extractDiveWindow!(text, today);
          },
        }
      : {}),
    ...(primary.generateText || fallback.generateText
      ? {
          async generateText(systemPrompt: string, userPrompt: string) {
            if (primary.generateText && fallback.generateText) {
              return await withFallback(
                () => primary.generateText!(systemPrompt, userPrompt),
                () => fallback.generateText!(systemPrompt, userPrompt)
              );
            }
            return primary.generateText
              ? await primary.generateText(systemPrompt, userPrompt)
              : await fallback.generateText!(systemPrompt, userPrompt);
          },
        }
      : {}),
  };
}

// The one place that turns config into a live provider.
// Policy: Gemini 3.1 Flash-Lite is primary/default for sub-4s latency and
// prevents 502 timeouts on the DeepSeek gateway from exceeding the 20s WhatsApp deadline.
export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ExtractProvider {
  const which = (env.EXTRACTOR_PROVIDER ?? "gemini-3.1-flash-lite").toLowerCase();

  switch (which) {
    case "gemini":
    case "gemini-3.1-flash-lite":
    case "gemini-3.5-flash":
    case "gemini-3.8-flash":
    case "gemini-flash-latest":
    case "gemini-3-flash":
    case "gemini-2.5-pro":
    case "gemini-2.5-flash":
    case "gemini-2.0-flash": {
      const model = which === "gemini" ? (env.GEMINI_MODEL ?? "gemini-3.1-flash-lite") : which;
      if (env.GEMINI_API_KEY) {
        const primary = createGeminiProvider(env.GEMINI_API_KEY, model);
        if (env.DEEPSEEK_GATEWAY_KEY) {
          const fallback = createDeepSeekProvider(env.DEEPSEEK_GATEWAY_KEY, "deepseek-flash");
          return createResilientProvider(primary, fallback);
        }
        return primary;
      }
      if (env.DEEPSEEK_GATEWAY_KEY) {
        // eslint-disable-next-line no-console
        console.warn(`[provider] GEMINI_API_KEY not set; falling back to DeepSeek (deepseek-flash)`);
        return createDeepSeekProvider(env.DEEPSEEK_GATEWAY_KEY, "deepseek-flash");
      }
      throw new Error("GEMINI_API_KEY not set (and no fallback DEEPSEEK_GATEWAY_KEY found)");
    }
    case "deepseek":
    case "deepseek-flash":
    case "deepseek-pro": {
      const key = env.DEEPSEEK_GATEWAY_KEY;
      const model = which === "deepseek" ? (env.DEEPSEEK_MODEL as "deepseek-flash" | "deepseek-pro" | undefined) ?? "deepseek-flash" : which;
      // When both GEMINI_API_KEY and DEEPSEEK_GATEWAY_KEY are present in production,
      // prefer Gemini 3.1 Flash-Lite as primary so dead DeepSeek gateway 502s never
      // burn the 20s WhatsApp webhook deadline.
      if (env.GEMINI_API_KEY && env.FORCE_DEEPSEEK_PRIMARY !== "true") {
        const primary = createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL ?? "gemini-3.1-flash-lite");
        if (key) {
          const fallback = createDeepSeekProvider(key, model);
          return createResilientProvider(primary, fallback);
        }
        return primary;
      }
      if (key) {
        const primary = createDeepSeekProvider(key, model);
        if (env.GEMINI_API_KEY) {
          const fallback = createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
          return createResilientProvider(primary, fallback);
        }
        return primary;
      }
      if (env.GEMINI_API_KEY) {
        // eslint-disable-next-line no-console
        console.warn(`[provider] DEEPSEEK_GATEWAY_KEY not set; falling back to secondary provider Gemini (${env.GEMINI_MODEL ?? "gemini-3.1-flash-lite"})`);
        return createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
      }
      throw new Error("DEEPSEEK_GATEWAY_KEY not set (and no fallback GEMINI_API_KEY found)");
    }
    default:
      throw new Error(`Unknown EXTRACTOR_PROVIDER: "${which}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }
}

