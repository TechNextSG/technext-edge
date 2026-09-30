import type { ExtractProvider } from "../../ports/provider.js";
import { createGeminiProvider } from "./gemini.js";
import { createDeepSeekProvider } from "./deepseek.js";
import { ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_MODELS, createAnthropicProvider } from "./anthropic.js";

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
  ...ANTHROPIC_MODELS,
] as const;
export type ProviderName = (typeof KNOWN_PROVIDER_NAMES)[number];

// ---------------------------------------------------------------------------------------------------------------
// One table of defaults. They used to disagree: `gemini.ts` said gemini-2.5-flash, this file said
// gemini-3.1-flash-lite, and the test page said DeepSeek was primary. The model a deployment actually runs is
// whatever this table says, unless a setting (admin dashboard) or an env var names another.
// ---------------------------------------------------------------------------------------------------------------
export type ProviderKind = "gemini" | "deepseek" | "anthropic";

export const DEFAULT_MODELS: Record<ProviderKind, string> = {
  gemini: "gemini-3.1-flash-lite",
  deepseek: "deepseek-flash",
  anthropic: ANTHROPIC_DEFAULT_MODEL,
};

/** What an admin may choose, per provider. Gemini also accepts any `gemini-…` id (see `isKnownModel`). */
export const MODEL_CATALOG: Record<ProviderKind, readonly string[]> = {
  gemini: [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ],
  deepseek: ["deepseek-flash", "deepseek-pro"],
  anthropic: ANTHROPIC_MODELS,
};

export const PROVIDER_KINDS: readonly ProviderKind[] = ["gemini", "deepseek", "anthropic"];

/** Is `model` something this provider can be asked for? A list, plus the `gemini-…` family for new releases. */
export function isKnownModel(provider: ProviderKind, model: string): boolean {
  if (MODEL_CATALOG[provider].includes(model)) return true;
  return provider === "gemini" && /^gemini-[a-z0-9][a-z0-9.\-]{1,60}$/.test(model);
}

export interface ModelChoice {
  provider: ProviderKind;
  model: string;
}

export interface ProviderSettings {
  primary: ModelChoice;
  fallback: ModelChoice | null;
  timeoutsMs: { extract: number; synthesis: number };
  breaker: { cooldownMs: number; authCooldownMs: number };
  /** Off = no written replies from the model; the deterministic reply is used. */
  synthesisEnabled: boolean;
  /** Decrypted keys from the dashboard. Missing ones fall back to the environment. */
  keys: Partial<Record<ProviderKind, string>>;
  deepseekBaseUrl?: string;
}

/** What one call did, for the dashboard's 7-day health table. */
export interface ProviderOutcome {
  provider: ProviderKind;
  /** `ok` = answered as the primary; `fallback` = answered because the primary did not; `fail` = did not answer. */
  kind: "ok" | "fail" | "fallback";
  ms: number;
}

// ---------------------------------------------------------------------------------------------------------------
// By name (the test page's per-request override, and the env var's value)
// ---------------------------------------------------------------------------------------------------------------

// Builds a provider from an explicit (name, key) pair. Kept separate so "which provider, which key" is decided
// in exactly one place regardless of whether the answer came from env vars, a setting, or a request body.
export function createProviderByName(name: string, apiKey: string): ExtractProvider {
  const choice = choiceFromName(name);
  if (!choice) {
    throw new Error(`Unknown provider: "${name}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }
  return buildProvider(choice, apiKey, {});
}

/** `gemini-2.5-flash`, `deepseek-pro`, `anthropic`, `claude-sonnet-5-5`, `gemini:<model>` -> a choice, or null. */
export function choiceFromName(name: string, env: NodeJS.ProcessEnv = process.env): ModelChoice | null {
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
  if (lower === "anthropic" || lower === "claude") return { provider: "anthropic", model: DEFAULT_MODELS.anthropic };
  if (lower.startsWith("anthropic:")) return { provider: "anthropic", model: name.slice(10).trim() };
  if ((ANTHROPIC_MODELS as readonly string[]).includes(lower)) return { provider: "anthropic", model: lower };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------------------------

interface BuildTuning {
  timeoutsMs?: { extract: number; synthesis: number };
  deepseekBaseUrl?: string;
  fetch?: typeof fetch;
}

export function buildProvider(choice: ModelChoice, apiKey: string, tuning: BuildTuning): ExtractProvider {
  const timeoutMs = tuning.timeoutsMs?.extract;
  const synthesisTimeoutMs = tuning.timeoutsMs?.synthesis;
  switch (choice.provider) {
    case "gemini":
      return createGeminiProvider(apiKey, choice.model, { timeoutMs, synthesisTimeoutMs });
    case "deepseek":
      return createDeepSeekProvider(apiKey, choice.model as "deepseek-flash" | "deepseek-pro", {
        timeoutMs,
        baseUrl: tuning.deepseekBaseUrl,
      });
    case "anthropic":
      return createAnthropicProvider(apiKey, choice.model, { timeoutMs, synthesisTimeoutMs, fetch: tuning.fetch });
  }
}

const DISPLAY_NAME: Record<ProviderKind, string> = { gemini: "Gemini", deepseek: "DeepSeek", anthropic: "Anthropic" };

const ENV_KEY: Record<ProviderKind, string> = {
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_GATEWAY_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export function keyFor(kind: ProviderKind, settings: Pick<ProviderSettings, "keys">, env: NodeJS.ProcessEnv): string | undefined {
  return settings.keys[kind] || env[ENV_KEY[kind]] || undefined;
}

export interface ResilienceOptions {
  cooldownMs?: number;
  authCooldownMs?: number;
  onOutcome?: (outcome: ProviderOutcome) => void;
}

/**
 * The primary, with a fallback behind a circuit breaker, and a record of who actually answered.
 *
 * Built once per process and kept: the breaker's "the primary is down for the next 60s / 1h" is state, and a
 * provider rebuilt for every request forgets it after one call (which is how it worked before — the cooldown
 * only ever applied inside a single request).
 *
 * `id` is the primary's, as it always was, but `answeredBy()` names the provider that *answered the last
 * extraction call* — with a fallback in play those two differ, and `meta.provider` used to report the wrong one.
 */
export function createResilientProvider(
  primary: ExtractProvider,
  fallback: ExtractProvider | undefined,
  kinds: { primary: ProviderKind; fallback?: ProviderKind },
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

/**
 * The one place that turns settings into a live provider.
 *
 * Primary without a key falls back to the fallback as the primary (and says so), exactly as the env-only path
 * always did; with no usable key at all it throws, so the caller answers with its own "not configured" rather
 * than a provider that fails every call.
 */
export function createProviderFromSettings(
  settings: ProviderSettings,
  env: NodeJS.ProcessEnv = process.env,
  hooks: { onOutcome?: (outcome: ProviderOutcome) => void; fetch?: typeof fetch } = {},
): ExtractProvider {
  const tuning: BuildTuning = {
    timeoutsMs: settings.timeoutsMs,
    deepseekBaseUrl: settings.deepseekBaseUrl,
    fetch: hooks.fetch,
  };
  const usable = (choice: ModelChoice | null): { choice: ModelChoice; key: string } | null => {
    if (!choice) return null;
    const key = keyFor(choice.provider, settings, env);
    return key ? { choice, key } : null;
  };

  const first = usable(settings.primary);
  const second = usable(settings.fallback);
  // A fallback that is the same model as the primary protects nothing.
  const distinctSecond =
    second && first && second.choice.provider === first.choice.provider && second.choice.model === first.choice.model
      ? null
      : second;

  if (!first && !distinctSecond) {
    const backup = settings.fallback?.provider ?? (settings.primary.provider === "gemini" ? "deepseek" : "gemini");
    throw new Error(
      `${ENV_KEY[settings.primary.provider]} not set (and no fallback ${ENV_KEY[backup]} found)` +
        ` — set it in the environment or add a key in the admin dashboard`,
    );
  }
  if (!first) {
    // eslint-disable-next-line no-console
    console.warn(
      `[provider] ${ENV_KEY[settings.primary.provider]} not set; falling back to ${DISPLAY_NAME[distinctSecond!.choice.provider]} (${distinctSecond!.choice.model})`,
    );
    return withSynthesis(
      createResilientProvider(buildProvider(distinctSecond!.choice, distinctSecond!.key, tuning), undefined, {
        primary: distinctSecond!.choice.provider,
      }, { ...settings.breaker, onOutcome: hooks.onOutcome }),
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

/** The settings the environment alone describes — what a deployment runs on before anyone opens the dashboard. */
export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderSettings {
  const name = (env.EXTRACTOR_PROVIDER ?? DEFAULT_MODELS.gemini).toLowerCase();
  const primary = choiceFromName(name, env);
  if (!primary) {
    throw new Error(`Unknown EXTRACTOR_PROVIDER: "${name}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }
  // The other configured provider backs it up: Gemini <-> DeepSeek as before, and either for Anthropic.
  const others: ProviderKind[] = PROVIDER_KINDS.filter((kind) => kind !== primary.provider);
  const backupKind =
    primary.provider === "gemini"
      ? env.DEEPSEEK_GATEWAY_KEY ? "deepseek" : null
      : primary.provider === "deepseek"
        ? env.GEMINI_API_KEY ? "gemini" : null
        : others.find((kind) => env[ENV_KEY[kind]]) ?? null;
  const fallback: ModelChoice | null = backupKind
    ? { provider: backupKind, model: backupKind === "gemini" ? (env.GEMINI_MODEL ?? DEFAULT_MODELS.gemini) : DEFAULT_MODELS[backupKind] }
    : null;
  return {
    primary,
    fallback,
    timeoutsMs: {
      // `GEMINI_TIMEOUT_MS` / `DEEPSEEK_TIMEOUT_MS` are still honoured: they are read where each provider is built.
      extract: primary.provider === "deepseek" ? Number(env.DEEPSEEK_TIMEOUT_MS ?? 8_000) : Number(env.GEMINI_TIMEOUT_MS ?? 15_000),
      synthesis: 8_000,
    },
    breaker: { cooldownMs: 60_000, authCooldownMs: 3_600_000 },
    synthesisEnabled: true,
    keys: {},
  };
}

// Policy: Gemini 3.1 Flash-Lite is the default for sub-4s latency, which keeps a slow gateway from running past
// the 20s WhatsApp deadline.
export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ExtractProvider {
  return createProviderFromSettings(settingsFromEnv(env), env);
}
