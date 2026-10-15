import type { ExtractProvider } from "../../ports/provider.ts";
import { DEFAULT_GEMINI_MODEL, createGeminiProvider } from "./gemini.ts";
import { createDeepSeekProvider } from "./deepseek.ts";
import { DEFAULT_ANTHROPIC_MODEL, createAnthropicProvider } from "./anthropic.ts";

export interface RegistryEntry<K extends string = string> {
  kind: K;
  label: string;
  defaultModel: string;
  models: readonly string[];
  modelPattern: RegExp;
  colonPrefixes?: readonly string[];
  aliases: readonly string[];
  aliasModels?: Record<string, string>;
  envKeys: {
    apiKey: string;
    model?: string;
    timeoutMs?: string;
    baseUrl?: string;
  };
  defaultTimeoutMs: {
    extract: number;
    synthesis?: number;
  };
  fallbackOrder: readonly string[];
  supportsBaseUrl?: boolean;
  create: (params: {
    apiKey: string;
    model?: string | undefined;
    timeoutMs?: number | undefined;
    synthesisTimeoutMs?: number | undefined;
    baseUrl?: string | undefined;
  }) => ExtractProvider;
}

export const PROVIDER_REGISTRY = {
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
    ] as const,
    modelPattern: /^gemini-[a-z0-9][a-z0-9.\-]{1,60}$/,
    colonPrefixes: ["gemini"] as const,
    aliases: [
      "gemini",
      "gemini-flash",
      "gemini-flash-lite",
      "gemini-3-flash",
      "gemini-3",
      "gemini-3.1-flash",
      "gemini-pro",
      "gemini-2",
    ] as const,
    aliasModels: {
      "gemini-flash-lite": "gemini-3.1-flash-lite",
      "gemini-3-flash": "gemini-3.1-flash-lite",
      "gemini-3": "gemini-3.1-flash-lite",
      "gemini-3.1-flash": "gemini-3.1-flash-lite",
      "gemini-pro": "gemini-2.5-pro",
      "gemini-2": "gemini-2.0-flash",
    },
    envKeys: {
      apiKey: "GEMINI_API_KEY",
      model: "GEMINI_MODEL",
      timeoutMs: "GEMINI_TIMEOUT_MS",
    },
    defaultTimeoutMs: {
      extract: 15_000,
      synthesis: 8_000,
    },
    fallbackOrder: ["deepseek", "anthropic"] as const,
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
    models: ["deepseek-flash", "deepseek-pro"] as const,
    modelPattern: /^deepseek-[a-z0-9.\-]{1,60}$/,
    colonPrefixes: ["deepseek"] as const,
    aliases: ["deepseek", "deepseek-flash", "deepseek-pro"] as const,
    aliasModels: {
      "deepseek-flash": "deepseek-flash",
      "deepseek-pro": "deepseek-pro",
    },
    envKeys: {
      apiKey: "DEEPSEEK_GATEWAY_KEY",
      model: "DEEPSEEK_MODEL",
      timeoutMs: "DEEPSEEK_TIMEOUT_MS",
      baseUrl: "DEEPSEEK_BASE_URL",
    },
    defaultTimeoutMs: {
      extract: 8_000,
      synthesis: 8_000,
    },
    fallbackOrder: ["anthropic", "gemini"] as const,
    supportsBaseUrl: true,
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
  anthropic: {
    kind: "anthropic",
    label: "Anthropic Claude",
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    models: [
      "claude-haiku-5-5",
      "claude-3-5-haiku-20241022",
      "claude-3-5-haiku-latest",
      "claude-3-5-sonnet-20241022",
      "claude-3-7-sonnet-20250219",
    ] as const,
    modelPattern: /^claude-[a-z0-9.\-]{1,60}$/,
    colonPrefixes: ["anthropic", "claude"] as const,
    aliases: ["anthropic", "claude-3-5-haiku", "claude-haiku"] as const,
    aliasModels: {
      "claude-3-5-haiku": DEFAULT_ANTHROPIC_MODEL,
      "claude-haiku": DEFAULT_ANTHROPIC_MODEL,
    },
    envKeys: {
      apiKey: "ANTHROPIC_API_KEY",
      model: "ANTHROPIC_MODEL",
      timeoutMs: "ANTHROPIC_TIMEOUT_MS",
      baseUrl: "ANTHROPIC_BASE_URL",
    },
    defaultTimeoutMs: {
      extract: 10_000,
      synthesis: 8_000,
    },
    fallbackOrder: ["gemini", "deepseek"] as const,
    supportsBaseUrl: true,
    create: (params) =>
      createAnthropicProvider(params.apiKey, params.model, {
        timeoutMs: params.timeoutMs,
        baseUrl: params.baseUrl,
      }),
  },
} as const satisfies Record<string, RegistryEntry>;

export type ProviderKind = keyof typeof PROVIDER_REGISTRY;

export const PROVIDER_KINDS: readonly ProviderKind[] = Object.keys(
  PROVIDER_REGISTRY,
) as readonly ProviderKind[];

export const MODEL_CATALOG: Record<ProviderKind, readonly string[]> = {
  gemini: PROVIDER_REGISTRY.gemini.models,
  deepseek: PROVIDER_REGISTRY.deepseek.models,
  anthropic: PROVIDER_REGISTRY.anthropic.models,
};

export const DEFAULT_MODELS: Record<ProviderKind, string> = {
  gemini: PROVIDER_REGISTRY.gemini.defaultModel,
  deepseek: PROVIDER_REGISTRY.deepseek.defaultModel,
  anthropic: PROVIDER_REGISTRY.anthropic.defaultModel,
};

export const KNOWN_PROVIDER_NAMES: readonly string[] = Array.from(
  new Set(
    PROVIDER_KINDS.flatMap((kind) => {
      const entry = PROVIDER_REGISTRY[kind];
      return [entry.kind, ...(entry.aliases as readonly string[]), ...(entry.models as readonly string[])];
    }),
  ),
);

export const ENV_KEY_NAME: Record<ProviderKind, string> = Object.fromEntries(
  PROVIDER_KINDS.map((kind) => [kind, PROVIDER_REGISTRY[kind].envKeys.apiKey]),
) as Record<ProviderKind, string>;

export function isKnownModel(provider: ProviderKind, model: string): boolean {
  const entry = PROVIDER_REGISTRY[provider];
  if (!entry) return false;
  if ((entry.models as readonly string[]).includes(model)) return true;
  return entry.modelPattern.test(model);
}

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
  VERCEL_ENV?: string | undefined;
  GUEST_DATA_MODE?: string | undefined;
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
  baseUrls?: Partial<Record<ProviderKind, string>> | undefined;
  /** @deprecated use baseUrls.deepseek */
  deepseekBaseUrl?: string | undefined;
  /** @deprecated use baseUrls.anthropic */
  anthropicBaseUrl?: string | undefined;
}

export function choiceFromName(name: string, env: AiEnv): ModelChoice | null {
  const lower = name.toLowerCase().trim();
  const colonIdx = lower.indexOf(":");
  if (colonIdx > 0) {
    const prefix = lower.slice(0, colonIdx);
    const customModel = name.slice(colonIdx + 1).trim();
    for (const kind of PROVIDER_KINDS) {
      const entry = PROVIDER_REGISTRY[kind];
      if (entry.kind === prefix || (entry.colonPrefixes as readonly string[] | undefined)?.includes(prefix)) {
        return { provider: kind, model: customModel };
      }
    }
    return null;
  }

  for (const kind of PROVIDER_KINDS) {
    const entry: RegistryEntry = PROVIDER_REGISTRY[kind];
    const aliasMap = entry.aliasModels;
    if (aliasMap && lower in aliasMap) {
      return { provider: kind, model: aliasMap[lower]! };
    }
    if ((entry.aliases as readonly string[]).includes(lower) || entry.kind === lower) {
      const envModelKey = entry.envKeys.model as keyof AiEnv | undefined;
      const envModel = envModelKey ? (env[envModelKey] as string | undefined) : undefined;
      return { provider: kind, model: envModel ?? entry.defaultModel };
    }
    if ((entry.models as readonly string[]).includes(lower)) {
      return { provider: kind, model: lower };
    }
  }

  return null;
}

export function keyFor(kind: ProviderKind, settings: Pick<ProviderSettings, "keys">, env: AiEnv): string | undefined {
  const entry: RegistryEntry | undefined = PROVIDER_REGISTRY[kind];
  if (!entry) return undefined;
  const envKey = entry.envKeys.apiKey as keyof AiEnv;
  return settings.keys[kind] || (env[envKey] as string | undefined) || undefined;
}

export function baseUrlFor(
  kind: ProviderKind,
  settings: Pick<ProviderSettings, "baseUrls" | "deepseekBaseUrl" | "anthropicBaseUrl">,
  env: AiEnv,
): string | undefined {
  if (settings.baseUrls?.[kind]) return settings.baseUrls[kind];
  if (kind === "deepseek" && settings.deepseekBaseUrl) return settings.deepseekBaseUrl;
  if (kind === "anthropic" && settings.anthropicBaseUrl) return settings.anthropicBaseUrl;
  const entry: RegistryEntry | undefined = PROVIDER_REGISTRY[kind];
  if (entry?.envKeys.baseUrl) {
    return env[entry.envKeys.baseUrl as keyof AiEnv] as string | undefined;
  }
  return undefined;
}

export interface BuildTuning {
  timeoutsMs?: { extract: number; synthesis: number } | undefined;
  baseUrls?: Partial<Record<ProviderKind, string>> | undefined;
  deepseekBaseUrl?: string | undefined;
  anthropicBaseUrl?: string | undefined;
}

export function buildProvider(choice: ModelChoice, apiKey: string, tuning: BuildTuning): ExtractProvider {
  const descriptor: RegistryEntry | undefined = PROVIDER_REGISTRY[choice.provider];
  if (!descriptor) {
    throw new Error(`Unsupported provider kind: ${choice.provider}`);
  }

  const timeoutMs = tuning.timeoutsMs?.extract;
  const synthesisTimeoutMs = tuning.timeoutsMs?.synthesis;
  const baseUrl =
    tuning.baseUrls?.[choice.provider] ??
    (choice.provider === "deepseek"
      ? tuning.deepseekBaseUrl
      : choice.provider === "anthropic"
        ? tuning.anthropicBaseUrl
        : undefined);

  return descriptor.create({
    apiKey,
    model: choice.model,
    timeoutMs,
    synthesisTimeoutMs,
    baseUrl,
  });
}

export function settingsFromEnv(env: AiEnv): ProviderSettings {
  const name = (env.EXTRACTOR_PROVIDER ?? DEFAULT_MODELS.gemini).toLowerCase();
  const primary = choiceFromName(name, env);
  if (!primary) {
    throw new Error(`Unknown EXTRACTOR_PROVIDER: "${name}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }

  const hasCredentials = (kind: ProviderKind): boolean => {
    const entry: RegistryEntry = PROVIDER_REGISTRY[kind];
    const key = env[entry.envKeys.apiKey as keyof AiEnv];
    if (!key) return false;
    if (entry.supportsBaseUrl && entry.envKeys.baseUrl) {
      if (kind === "deepseek" && !env[entry.envKeys.baseUrl as keyof AiEnv]) return false;
    }
    return true;
  };

  const entry: RegistryEntry = PROVIDER_REGISTRY[primary.provider];
  const backupKind = (entry.fallbackOrder as readonly ProviderKind[]).find(hasCredentials) ?? null;

  const fallback: ModelChoice | null = backupKind
    ? {
        provider: backupKind,
        model:
          (env[PROVIDER_REGISTRY[backupKind].envKeys.model as keyof AiEnv] as string | undefined) ??
          DEFAULT_MODELS[backupKind],
      }
    : null;

  const baseUrls: Partial<Record<ProviderKind, string>> = {};
  if (env.DEEPSEEK_BASE_URL) baseUrls.deepseek = env.DEEPSEEK_BASE_URL;
  if (env.ANTHROPIC_BASE_URL) baseUrls.anthropic = env.ANTHROPIC_BASE_URL;

  return {
    primary,
    fallback,
    timeoutsMs: {
      extract: Number(
        (entry.envKeys.timeoutMs
          ? (env[entry.envKeys.timeoutMs as keyof AiEnv] as string | number | undefined)
          : undefined) ?? entry.defaultTimeoutMs.extract,
      ),
      synthesis: entry.defaultTimeoutMs.synthesis ?? 8_000,
    },
    breaker: { cooldownMs: 60_000, authCooldownMs: 3_600_000 },
    synthesisEnabled: true,
    keys: {},
    baseUrls,
    ...(env.DEEPSEEK_BASE_URL ? { deepseekBaseUrl: env.DEEPSEEK_BASE_URL } : {}),
    ...(env.ANTHROPIC_BASE_URL ? { anthropicBaseUrl: env.ANTHROPIC_BASE_URL } : {}),
  };
}
