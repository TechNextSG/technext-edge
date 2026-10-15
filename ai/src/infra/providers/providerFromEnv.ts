import type { ExtractProvider } from "../../ports/provider.ts";
import {
  PROVIDER_REGISTRY,
  PROVIDER_KINDS,
  MODEL_CATALOG,
  DEFAULT_MODELS,
  KNOWN_PROVIDER_NAMES,
  ENV_KEY_NAME,
  isKnownModel,
  choiceFromName,
  keyFor,
  baseUrlFor,
  buildProvider,
  settingsFromEnv,
  registerProvider,
  type ProviderKind,
  type RegistryEntry,
  type AiEnv,
  type ModelChoice,
  type ProviderSettings,
  type BuildTuning,
} from "./registry.ts";

export {
  PROVIDER_REGISTRY,
  PROVIDER_KINDS,
  MODEL_CATALOG,
  DEFAULT_MODELS,
  KNOWN_PROVIDER_NAMES,
  ENV_KEY_NAME,
  isKnownModel,
  choiceFromName,
  keyFor,
  baseUrlFor,
  buildProvider,
  settingsFromEnv,
  registerProvider,
};

export type {
  ProviderKind,
  RegistryEntry,
  AiEnv,
  ModelChoice,
  ProviderSettings,
  BuildTuning,
};

export type ProviderDescriptor = RegistryEntry;
export const PROVIDERS = PROVIDER_REGISTRY as unknown as Record<ProviderKind, RegistryEntry>;

export type ProviderName = (typeof KNOWN_PROVIDER_NAMES)[number];

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
  const baseUrls: Partial<Record<ProviderKind, string>> = {};
  for (const kind of PROVIDER_KINDS) {
    const entry = PROVIDER_REGISTRY[kind];
    const baseUrlKey = entry?.envKeys && "baseUrl" in entry.envKeys ? (entry.envKeys as { baseUrl?: string }).baseUrl : undefined;
    if (baseUrlKey && env[baseUrlKey as keyof AiEnv]) {
      baseUrls[kind] = String(env[baseUrlKey as keyof AiEnv]);
    }
  }
  return buildProvider(choice, apiKey, { baseUrls });
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
  // Production compliance gate (D-129): Production must strictly run on Anthropic Claude across entire fallback chain
  const isProduction =
    env.VERCEL_ENV === "production" ||
    env.GUEST_DATA_MODE === "production" ||
    (env.NODE_ENV === "production" && (!env.VERCEL_ENV || env.VERCEL_ENV === "production") && env.GUEST_DATA_MODE !== "development");

  if (isProduction && env.ALLOW_NON_ANTHROPIC_IN_PRODUCTION !== "true") {
    if (settings.primary.provider !== "anthropic") {
      throw new Error(
        `Production policy gate (D-129) violation: only Anthropic Claude is permitted in production (configured primary is "${settings.primary.provider}")`,
      );
    }
    if (settings.fallback && settings.fallback.provider !== "anthropic") {
      throw new Error(
        `Production policy gate (D-129) violation: only Anthropic Claude is permitted in production (configured fallback is "${settings.fallback.provider}")`,
      );
    }
  }

  const tuning: BuildTuning = {
    timeoutsMs: settings.timeoutsMs,
    baseUrls: settings.baseUrls,
  };

  const usable = (choice: ModelChoice | null): { choice: ModelChoice; key: string } | null => {
    if (!choice) return null;
    const descriptor = PROVIDERS[choice.provider];
    if (descriptor?.requiresBaseUrl && !baseUrlFor(choice.provider, settings, env)) return null;
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
    const primaryDescriptor = PROVIDERS[settings.primary.provider];
    const primaryKey = primaryDescriptor?.envKeys.apiKey ?? "API_KEY";
    const fallbackKind = settings.fallback?.provider ?? (primaryDescriptor?.fallbackOrder as readonly ProviderKind[] | undefined)?.[0];
    const backupKey = fallbackKind
      ? PROVIDERS[fallbackKind]?.envKeys.apiKey
      : "BACKUP_KEY";
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

export function createProviderFromEnv(env: AiEnv): ExtractProvider {
  return createProviderFromSettings(settingsFromEnv(env), env);
}
