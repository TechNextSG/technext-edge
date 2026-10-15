import type { ExtractProvider } from "../../ports/provider.ts";
import { DEFAULT_GEMINI_MODEL, createGeminiProvider } from "./gemini.ts";
import { createDeepSeekProvider } from "./deepseek.ts";
import { DEFAULT_ANTHROPIC_MODEL, createAnthropicProvider } from "./anthropic.ts";

export type ProviderKind = "gemini" | "deepseek" | "anthropic";

export const PROVIDER_KINDS: readonly ProviderKind[] = ["gemini", "deepseek", "anthropic"];

export interface ProviderDescriptor {
  kind: ProviderKind;
  label: string;
  defaultModel: string;
  models: readonly string[];
  envKeys: {
    apiKey: "GEMINI_API_KEY" | "DEEPSEEK_GATEWAY_KEY" | "ANTHROPIC_API_KEY";
    model?: string | undefined;
    timeoutMs?: string | undefined;
    baseUrl?: string | undefined;
  };
  create: (params: {
    apiKey: string;
    model?: string | undefined;
    timeoutMs?: number | undefined;
    synthesisTimeoutMs?: number | undefined;
    baseUrl?: string | undefined;
  }) => ExtractProvider;
}

/**
 * Strategy + Registry table for all supported AI providers (Pattern 3).
 * Centralizes provider construction, environment mapping, and model catalog.
 */
export const PROVIDERS: Record<ProviderKind, ProviderDescriptor> = {
  anthropic: {
    kind: "anthropic",
    label: "Anthropic Claude",
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    models: [
      "claude-3-5-haiku-20241022",
      "claude-3-5-haiku-latest",
      "claude-3-5-sonnet-20241022",
      "claude-3-7-sonnet-20250219",
    ],
    envKeys: {
      apiKey: "ANTHROPIC_API_KEY",
      model: "ANTHROPIC_MODEL",
      timeoutMs: "ANTHROPIC_TIMEOUT_MS",
      baseUrl: "ANTHROPIC_BASE_URL",
    },
    create: (params) =>
      createAnthropicProvider(params.apiKey, params.model, {
        timeoutMs: params.timeoutMs,
        baseUrl: params.baseUrl,
      }),
  },
  gemini: {
    kind: "gemini",
    label: "Gemini",
    defaultModel: DEFAULT_GEMINI_MODEL,
    models: [
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.8-flash",
      "gemini-flash-latest",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ],
    envKeys: {
      apiKey: "GEMINI_API_KEY",
      model: "GEMINI_MODEL",
      timeoutMs: "GEMINI_TIMEOUT_MS",
    },
    create: (params) =>
      createGeminiProvider(params.apiKey, params.model, {
        timeoutMs: params.timeoutMs,
        synthesisTimeoutMs: params.synthesisTimeoutMs,
      }),
  },
  deepseek: {
    kind: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-pro"],
    envKeys: {
      apiKey: "DEEPSEEK_GATEWAY_KEY",
      model: "DEEPSEEK_MODEL",
      timeoutMs: "DEEPSEEK_TIMEOUT_MS",
      baseUrl: "DEEPSEEK_BASE_URL",
    },
    create: (params) => {
      if (!params.baseUrl) {
        throw new Error("DeepSeek is not configured: no gateway base URL (DEEPSEEK_BASE_URL)");
      }
      return createDeepSeekProvider(params.apiKey, params.model as "deepseek-flash" | "deepseek-pro", {
        timeoutMs: params.timeoutMs,
        baseUrl: params.baseUrl,
      });
    },
  },
};

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
  "anthropic",
  "claude-3-5-haiku-20241022",
  "claude-3-5-haiku-latest",
] as const;
export type ProviderName = (typeof KNOWN_PROVIDER_NAMES)[number];

export interface AiEnv {
  EXTRACTOR_PROVIDER?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL?: string | undefined;
  GEMINI_TIMEOUT_MS?: string | number | undefined;
  DEEPSEEK_GATEWAY_KEY?: string | undefined;
  DEEPSEEK_BASE_URL?: string | undefined;
  DEEPSEEK_MODEL?: string | undefined;
  DEEPSEEK_TIMEOUT_MS?: string | number | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  ANTHROPIC_BASE_URL?: string | undefined;
  ANTHROPIC_MODEL?: string | undefined;
  ANTHROPIC_TIMEOUT_MS?: string | number | undefined;
  ALLOW_NON_ANTHROPIC_IN_PRODUCTION?: string | undefined;
  NODE_ENV?: string | undefined;
}

export const DEFAULT_MODELS: Record<ProviderKind, string> = {
  gemini: PROVIDERS.gemini.defaultModel,
  deepseek: PROVIDERS.deepseek.defaultModel,
  anthropic: PROVIDERS.anthropic.defaultModel,
};

export const MODEL_CATALOG: Record<ProviderKind, readonly string[]> = {
  gemini: PROVIDERS.gemini.models,
  deepseek: PROVIDERS.deepseek.models,
  anthropic: PROVIDERS.anthropic.models,
};

export function isKnownModel(provider: ProviderKind, model: string): boolean {
  if (MODEL_CATALOG[provider]?.includes(model)) return true;
  if (provider === "gemini") return /^gemini-[a-z0-9][a-z0-9.\-]{1,60}$/.test(model);
  if (provider === "anthropic") return /^claude-[a-z0-9.\-]{1,60}$/.test(model);
  return false;
}

export interface ModelChoice {
  provider: ProviderKind;
  model: string;
}

export interface ProviderSettings {
  primary: ModelChoice;
  fallback: ModelChoice | null;
  fallbacks?: ModelChoice[] | undefined;
  timeoutsMs: { extract: number; synthesis: number };
  breaker: { cooldownMs: number; authCooldownMs: number };
  synthesisEnabled: boolean;
  keys: Partial<Record<ProviderKind, string>>;
  deepseekBaseUrl?: string | undefined;
  anthropicBaseUrl?: string | undefined;
}

export interface ProviderOutcome {
  provider: ProviderKind;
  kind: "ok" | "fail" | "fallback";
  ms: number;
}

export function createProviderByName(name: string, apiKey: string, env: AiEnv): ExtractProvider {
  const choice = choiceFromName(name, env);
  if (!choice) {
    throw new Error(`Unknown provider: "${name}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }
  return buildProvider(choice, apiKey, {
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL,
  });
}

export function choiceFromName(name: string, env: AiEnv): ModelChoice | null {
  const lower = name.toLowerCase();
  if (lower === "gemini" || lower === "gemini-flash") {
    return { provider: "gemini", model: env.GEMINI_MODEL ?? DEFAULT_MODELS.gemini };
  }
  if (lower === "gemini-flash-lite" || lower === "gemini-3-flash" || lower === "gemini-3" || lower === "gemini-3.1-flash") {
    return { provider: "gemini", model: "gemini-3.1-flash-lite" };
  }
  if (lower === "gemini-pro") return { provider: "gemini", model: "gemini-2.5-pro" };
  if (lower === "gemini-2") return { provider: "gemini", model: "gemini-2.0-flash" };
  if (lower.startsWith("gemini:")) return { provider: "gemini", model: name.slice(7).trim() };
  if (MODEL_CATALOG.gemini.includes(lower)) return { provider: "gemini", model: lower };

  if (lower === "deepseek") {
    return { provider: "deepseek", model: env.DEEPSEEK_MODEL === "deepseek-pro" ? "deepseek-pro" : DEFAULT_MODELS.deepseek };
  }
  if (lower === "deepseek-flash" || lower === "deepseek-pro") return { provider: "deepseek", model: lower };

  if (lower === "anthropic") {
    return { provider: "anthropic", model: env.ANTHROPIC_MODEL ?? DEFAULT_MODELS.anthropic };
  }
  if (lower === "claude-3-5-haiku" || lower === "claude-haiku") {
    return { provider: "anthropic", model: DEFAULT_MODELS.anthropic };
  }
  if (lower.startsWith("anthropic:") || lower.startsWith("claude:")) {
    const colonIdx = name.indexOf(":");
    return { provider: "anthropic", model: name.slice(colonIdx + 1).trim() };
  }
  if (MODEL_CATALOG.anthropic.includes(lower)) return { provider: "anthropic", model: lower };

  return null;
}

interface BuildTuning {
  timeoutsMs?: { extract: number; synthesis: number } | undefined;
  deepseekBaseUrl?: string | undefined;
  anthropicBaseUrl?: string | undefined;
}

export function buildProvider(choice: ModelChoice, apiKey: string, tuning: BuildTuning): ExtractProvider {
  const descriptor = PROVIDERS[choice.provider];
  if (!descriptor) {
    throw new Error(`Unsupported provider kind: ${choice.provider}`);
  }

  const timeoutMs = tuning.timeoutsMs?.extract;
  const synthesisTimeoutMs = tuning.timeoutsMs?.synthesis;
  const baseUrl = choice.provider === "deepseek" ? tuning.deepseekBaseUrl : tuning.anthropicBaseUrl;

  return descriptor.create({
    apiKey,
    model: choice.model,
    timeoutMs,
    synthesisTimeoutMs,
    baseUrl,
  });
}

export function keyFor(kind: ProviderKind, settings: Pick<ProviderSettings, "keys">, env: AiEnv): string | undefined {
  const descriptor = PROVIDERS[kind];
  if (!descriptor) return undefined;
  return settings.keys[kind] || env[descriptor.envKeys.apiKey] || undefined;
}

export interface ResilienceOptions {
  cooldownMs?: number | undefined;
  authCooldownMs?: number | undefined;
  onOutcome?: ((outcome: ProviderOutcome) => void) | undefined;
}

/**
 * Decorator implementing circuit breaker and fallback resilience across providers.
 */
export function createResilientProvider(
  primary: ExtractProvider,
  fallback: ExtractProvider | undefined,
  kinds: { primary: ProviderKind; fallback?: ProviderKind | undefined },
  options: ResilienceOptions = {},
): ExtractProvider {
  const COOLDOWN_MS = options.cooldownMs ?? 60_000;
  const AUTH_COOLDOWN_MS = options.authCooldownMs ?? 3_600_000;
  let primaryCooldownUntil = 0;
  let lastAnswered = primary.id;
  const report = options.onOutcome ?? (() => {});

  async function withFallback<T>(
    run: (p: ExtractProvider) => Promise<T>,
    markAnswered: boolean,
  ): Promise<T> {
    const started = Date.now();
    const answered = (p: ExtractProvider) => {
      if (markAnswered) lastAnswered = p.id;
    };
    if (!fallback) {
      try {
        const out = await run(primary);
        answered(primary);
        report({ provider: kinds.primary, kind: "ok", ms: Date.now() - started });
        return out;
      } catch (err) {
        report({ provider: kinds.primary, kind: "fail", ms: Date.now() - started });
        throw err;
      }
    }
    if (Date.now() < primaryCooldownUntil) {
      return await viaFallback(started);
    }
    try {
      const out = await run(primary);
      answered(primary);
      report({ provider: kinds.primary, kind: "ok", ms: Date.now() - started });
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuthError = msg.includes("401") || msg.includes("Authentication Fails") || msg.includes("invalid");
      primaryCooldownUntil = Date.now() + (isAuthError ? AUTH_COOLDOWN_MS : COOLDOWN_MS);
      report({ provider: kinds.primary, kind: "fail", ms: Date.now() - started });
      // eslint-disable-next-line no-console
      console.warn(
        `[provider] Primary ${primary.id} failed (${msg}); tripping ${isAuthError ? "auth" : "short"} circuit-breaker to fallback ${fallback.id}`,
      );
      return await viaFallback(started);
    }

    async function viaFallback(at: number): Promise<T> {
      const fb = fallback!;
      try {
        const out = await run(fb);
        answered(fb);
        report({ provider: kinds.fallback ?? kinds.primary, kind: "fallback", ms: Date.now() - at });
        return out;
      } catch (err) {
        report({ provider: kinds.fallback ?? kinds.primary, kind: "fail", ms: Date.now() - at });
        throw err;
      }
    }
  }

  const both = <K extends keyof ExtractProvider>(key: K) => Boolean(primary[key] || fallback?.[key]);

  return {
    id: primary.id,
    answeredBy: () => lastAnswered,
    async call(args) {
      return await withFallback((p) => p.call(args), true);
    },
    ...(both("extractGuests")
      ? {
          async extractGuests(text: string) {
            return await withFallback(async (p) => {
              if (!p.extractGuests) throw new Error(`${p.id} has no extractGuests`);
              return p.extractGuests(text);
            }, false);
          },
        }
      : {}),
    ...(both("extractCheckIn")
      ? {
          async extractCheckIn(text: string, today: string) {
            return await withFallback(async (p) => {
              if (!p.extractCheckIn) throw new Error(`${p.id} has no extractCheckIn`);
              return p.extractCheckIn(text, today);
            }, false);
          },
        }
      : {}),
    ...(both("extractDiveWindow")
      ? {
          async extractDiveWindow(text: string, today: string) {
            return await withFallback(async (p) => {
              if (!p.extractDiveWindow) throw new Error(`${p.id} has no extractDiveWindow`);
              return p.extractDiveWindow(text, today);
            }, false);
          },
        }
      : {}),
    ...(both("generateText")
      ? {
          async generateText(systemPrompt: string, userPrompt: string) {
            return await withFallback(async (p) => {
              if (!p.generateText) throw new Error(`${p.id} has no generateText`);
              return p.generateText(systemPrompt, userPrompt);
            }, false);
          },
        }
      : {}),
  };
}

export function createProviderFromSettings(
  settings: ProviderSettings,
  env: AiEnv,
  hooks: { onOutcome?: (outcome: ProviderOutcome) => void } = {},
): ExtractProvider {
  // Production compliance gate (D-129): Production must strictly run on Anthropic Claude
  const isProduction = env.NODE_ENV === "production";
  if (isProduction && settings.primary.provider !== "anthropic" && env.ALLOW_NON_ANTHROPIC_IN_PRODUCTION !== "true") {
    throw new Error(
      `Production policy gate (D-129) violation: only Anthropic Claude is permitted in production (configured primary is "${settings.primary.provider}")`,
    );
  }

  const tuning: BuildTuning = {
    timeoutsMs: settings.timeoutsMs,
    deepseekBaseUrl: settings.deepseekBaseUrl,
    anthropicBaseUrl: settings.anthropicBaseUrl,
  };

  const usable = (choice: ModelChoice | null): { choice: ModelChoice; key: string } | null => {
    if (!choice) return null;
    if (choice.provider === "deepseek" && !settings.deepseekBaseUrl) return null;
    const key = keyFor(choice.provider, settings, env);
    return key ? { choice, key } : null;
  };

  const first = usable(settings.primary);
  const second = usable(settings.fallback);
  const distinctSecond =
    second && first && second.choice.provider === first.choice.provider && second.choice.model === first.choice.model
      ? null
      : second;

  if (!first && !distinctSecond) {
    const primaryKey = PROVIDERS[settings.primary.provider]?.envKeys.apiKey ?? "API_KEY";
    const backupKey = settings.fallback
      ? PROVIDERS[settings.fallback.provider]?.envKeys.apiKey
      : PROVIDERS[settings.primary.provider === "gemini" ? "deepseek" : "gemini"].envKeys.apiKey;
    throw new Error(
      `${primaryKey} not set (and no fallback ${backupKey} found)` +
        ` — set it in the environment or add a key in the admin dashboard`,
    );
  }

  if (!first) {
    // eslint-disable-next-line no-console
    console.warn(
      `[provider] ${PROVIDERS[settings.primary.provider].envKeys.apiKey} not set; falling back to ${PROVIDERS[distinctSecond!.choice.provider].label} (${distinctSecond!.choice.model})`,
    );
    return withSynthesis(
      createResilientProvider(
        buildProvider(distinctSecond!.choice, distinctSecond!.key, tuning),
        undefined,
        { primary: distinctSecond!.choice.provider },
        { ...settings.breaker, onOutcome: hooks.onOutcome },
      ),
      settings,
    );
  }

  const primary = buildProvider(first.choice, first.key, tuning);
  const fallback = distinctSecond ? buildProvider(distinctSecond.choice, distinctSecond.key, tuning) : undefined;
  return withSynthesis(
    createResilientProvider(
      primary,
      fallback,
      { primary: first.choice.provider, fallback: distinctSecond?.choice.provider },
      { cooldownMs: settings.breaker.cooldownMs, authCooldownMs: settings.breaker.authCooldownMs, onOutcome: hooks.onOutcome },
    ),
    settings,
  );
}

function withSynthesis(provider: ExtractProvider, settings: ProviderSettings): ExtractProvider {
  if (settings.synthesisEnabled) return provider;
  const { generateText: _dropped, ...rest } = provider;
  return rest;
}

export function settingsFromEnv(env: AiEnv): ProviderSettings {
  const name = (env.EXTRACTOR_PROVIDER ?? DEFAULT_MODELS.gemini).toLowerCase();
  const primary = choiceFromName(name, env);
  if (!primary) {
    throw new Error(`Unknown EXTRACTOR_PROVIDER: "${name}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }

  const backupKind: ProviderKind | null =
    primary.provider === "anthropic"
      ? env.GEMINI_API_KEY
        ? "gemini"
        : env.DEEPSEEK_GATEWAY_KEY && env.DEEPSEEK_BASE_URL
          ? "deepseek"
          : null
      : primary.provider === "gemini"
        ? env.DEEPSEEK_GATEWAY_KEY && env.DEEPSEEK_BASE_URL
          ? "deepseek"
          : env.ANTHROPIC_API_KEY
            ? "anthropic"
            : null
        : env.ANTHROPIC_API_KEY
          ? "anthropic"
          : env.GEMINI_API_KEY
            ? "gemini"
            : null;

  const fallback: ModelChoice | null = backupKind
    ? {
        provider: backupKind,
        model:
          backupKind === "gemini"
            ? (env.GEMINI_MODEL ?? DEFAULT_MODELS.gemini)
            : backupKind === "anthropic"
              ? (env.ANTHROPIC_MODEL ?? DEFAULT_MODELS.anthropic)
              : DEFAULT_MODELS.deepseek,
      }
    : null;

  return {
    primary,
    fallback,
    timeoutsMs: {
      extract:
        primary.provider === "deepseek"
          ? Number(env.DEEPSEEK_TIMEOUT_MS ?? 8_000)
          : primary.provider === "anthropic"
            ? Number(env.ANTHROPIC_TIMEOUT_MS ?? 10_000)
            : Number(env.GEMINI_TIMEOUT_MS ?? 15_000),
      synthesis: 8_000,
    },
    breaker: { cooldownMs: 60_000, authCooldownMs: 3_600_000 },
    synthesisEnabled: true,
    keys: {},
    ...(env.DEEPSEEK_BASE_URL ? { deepseekBaseUrl: env.DEEPSEEK_BASE_URL } : {}),
    ...(env.ANTHROPIC_BASE_URL ? { anthropicBaseUrl: env.ANTHROPIC_BASE_URL } : {}),
  };
}

export function createProviderFromEnv(env: AiEnv): ExtractProvider {
  return createProviderFromSettings(settingsFromEnv(env), env);
}
