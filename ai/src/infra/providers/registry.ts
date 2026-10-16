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
  requiresBaseUrl: boolean;
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
    requiresBaseUrl: false,
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
    requiresBaseUrl: true,
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
      "claude-sonnet-5-5",
    ] as const,
    modelPattern: /^claude-[a-z0-9.\-]{1,60}$/,
    colonPrefixes: ["anthropic", "claude"] as const,
    aliases: ["anthropic", "claude-haiku"] as const,
    aliasModels: {
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
    requiresBaseUrl: false,
    create: (params) =>
      createAnthropicProvider(params.apiKey, params.model, {
        timeoutMs: params.timeoutMs,
        baseUrl: params.baseUrl,
      }),
  },
} as const satisfies Record<string, RegistryEntry>;

export type ProviderKind = keyof typeof PROVIDER_REGISTRY;

export const PROVIDER_KINDS: ProviderKind[] = Object.keys(
  PROVIDER_REGISTRY,
) as ProviderKind[];

export const MODEL_CATALOG: Record<ProviderKind, readonly string[]> = Object.fromEntries(
  PROVIDER_KINDS.map((kind) => [kind, PROVIDER_REGISTRY[kind].models]),
) as unknown as Record<ProviderKind, readonly string[]>;

export const DEFAULT_MODELS: Record<ProviderKind, string> = Object.fromEntries(
  PROVIDER_KINDS.map((kind) => [kind, PROVIDER_REGISTRY[kind].defaultModel]),
) as unknown as Record<ProviderKind, string>;

export const ENV_KEY_NAME: Record<ProviderKind, string> = Object.fromEntries(
  PROVIDER_KINDS.map((kind) => [kind, PROVIDER_REGISTRY[kind].envKeys.apiKey]),
) as unknown as Record<ProviderKind, string>;

export const KNOWN_PROVIDER_NAMES: readonly string[] = Array.from(
  new Set(
    PROVIDER_KINDS.flatMap((kind) => {
      const entry = PROVIDER_REGISTRY[kind];
      return [entry.kind, ...(entry.aliases as readonly string[]), ...(entry.models as readonly string[])];
    }),
  ),
);

export function registerProvider<K extends string>(entry: RegistryEntry<K>): void {
  (PROVIDER_REGISTRY as Record<string, RegistryEntry>)[entry.kind] = entry as unknown as RegistryEntry;
  if (!PROVIDER_KINDS.includes(entry.kind as ProviderKind)) {
    PROVIDER_KINDS.push(entry.kind as ProviderKind);
  }
  MODEL_CATALOG[entry.kind as ProviderKind] = entry.models;
  DEFAULT_MODELS[entry.kind as ProviderKind] = entry.defaultModel;
  ENV_KEY_NAME[entry.kind as ProviderKind] = entry.envKeys.apiKey;
}

export function isKnownModel(provider: ProviderKind, model: string, registry = PROVIDER_REGISTRY): boolean {
  const entry = (registry as Record<string, RegistryEntry | undefined>)[provider];
  if (!entry) return false;
  if ((entry.models as readonly string[]).includes(model)) return true;
  return entry.modelPattern.test(model);
}

type RegistryMap = typeof PROVIDER_REGISTRY;
type RegistryEnvKey = {
  [K in keyof RegistryMap]: NonNullable<RegistryMap[K]["envKeys"][keyof RegistryMap[K]["envKeys"]]>;
}[keyof RegistryMap];

type RegistryProviderEnv = {
  [K in RegistryEnvKey]?: string | undefined;
};

export interface CommonAiEnv {
  EXTRACTOR_PROVIDER?: string | undefined;
  ALLOW_NON_ANTHROPIC_IN_PRODUCTION?: string | undefined;
  NODE_ENV?: string | undefined;
  VERCEL_ENV?: string | undefined;
  GUEST_DATA_MODE?: string | undefined;
  [key: string]: unknown;
}

export type AiEnv = CommonAiEnv & RegistryProviderEnv;

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
  /** @deprecated legacy field in KV */
  deepseekBaseUrl?: string | undefined;
}

export function choiceFromName(name: string, env: AiEnv, registry = PROVIDER_REGISTRY): ModelChoice | null {
  const lower = name.toLowerCase().trim();
  const colonIdx = lower.indexOf(":");
  const kinds = Object.keys(registry) as ProviderKind[];
  if (colonIdx > 0) {
    const prefix = lower.slice(0, colonIdx);
    const customModel = name.slice(colonIdx + 1).trim();
    for (const kind of kinds) {
      const entry = (registry as Record<string, RegistryEntry | undefined>)[kind];
      if (!entry) continue;
      if (
        entry.kind === prefix ||
        (entry.colonPrefixes as readonly string[] | undefined)?.includes(prefix) ||
        (entry.aliases as readonly string[] | undefined)?.includes(prefix)
      ) {
        return { provider: kind, model: customModel };
      }
    }
    return null;
  }

  for (const kind of kinds) {
    const entry: RegistryEntry | undefined = (registry as Record<string, RegistryEntry | undefined>)[kind];
    if (!entry) continue;
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

export function keyFor(
  kind: ProviderKind,
  settings: Pick<ProviderSettings, "keys">,
  env: AiEnv,
  registry = PROVIDER_REGISTRY,
): string | undefined {
  const entry: RegistryEntry | undefined = (registry as Record<string, RegistryEntry | undefined>)[kind];
  if (!entry) return undefined;
  const envKey = entry.envKeys.apiKey as keyof AiEnv;
  return settings.keys[kind] || (env[envKey] as string | undefined) || undefined;
}

export function baseUrlFor(
  kind: ProviderKind,
  settings: Pick<ProviderSettings, "baseUrls">,
  env: AiEnv,
  registry = PROVIDER_REGISTRY,
): string | undefined {
  if (settings.baseUrls?.[kind]) return settings.baseUrls[kind];
  const entry: RegistryEntry | undefined = (registry as Record<string, RegistryEntry | undefined>)[kind];
  const baseUrlKey = entry?.envKeys?.baseUrl;
  if (baseUrlKey) {
    return env[baseUrlKey as keyof AiEnv] as string | undefined;
  }
  return undefined;
}

export interface BuildTuning {
  timeoutsMs?: { extract: number; synthesis: number } | undefined;
  baseUrls?: Partial<Record<ProviderKind, string>> | undefined;
}

export function buildProvider(
  choice: ModelChoice,
  apiKey: string,
  tuning: BuildTuning,
  registry = PROVIDER_REGISTRY,
): ExtractProvider {
  const descriptor: RegistryEntry | undefined = (registry as Record<string, RegistryEntry | undefined>)[choice.provider];
  if (!descriptor) {
    throw new Error(`Unsupported provider kind: ${choice.provider}`);
  }

  const baseUrl = tuning.baseUrls?.[choice.provider];
  if (descriptor.requiresBaseUrl && !baseUrl) {
    throw new Error(
      `${descriptor.label} is not configured: no gateway base URL (${descriptor.envKeys.baseUrl ?? "baseUrl"})`,
    );
  }

  return descriptor.create({
    apiKey,
    model: choice.model,
    timeoutMs: tuning.timeoutsMs?.extract,
    synthesisTimeoutMs: tuning.timeoutsMs?.synthesis,
    baseUrl,
  });
}

export function settingsFromEnv(env: AiEnv, registry = PROVIDER_REGISTRY): ProviderSettings {
  const kinds = Object.keys(registry) as ProviderKind[];
  const registryRecords = registry as Record<string, RegistryEntry | undefined>;
  const defaultGeminiModel = registryRecords.gemini?.defaultModel ?? (kinds[0] ? registryRecords[kinds[0]]?.defaultModel : undefined) ?? "";
  const name = (env.EXTRACTOR_PROVIDER ?? defaultGeminiModel).toLowerCase();
  const primary = choiceFromName(name, env, registry);
  if (!primary) {
    throw new Error(`Unknown EXTRACTOR_PROVIDER: "${name}" (expected ${KNOWN_PROVIDER_NAMES.join(", ")})`);
  }

  const hasCredentials = (kind: ProviderKind): boolean => {
    const entry: RegistryEntry | undefined = registryRecords[kind];
    if (!entry) return false;
    const key = env[entry.envKeys.apiKey as keyof AiEnv];
    if (!key) return false;
    if (entry.requiresBaseUrl) {
      const baseUrlKey = entry.envKeys.baseUrl;
      if (!baseUrlKey || !env[baseUrlKey as keyof AiEnv]) return false;
    }
    return true;
  };

  const entry: RegistryEntry | undefined = registryRecords[primary.provider];
  if (!entry) {
    throw new Error(`Unknown provider entry: "${primary.provider}"`);
  }
  const backupKind = (entry.fallbackOrder as readonly ProviderKind[]).find(hasCredentials) ?? null;

  const fallbackEntry = backupKind ? registryRecords[backupKind] : undefined;
  const fallback: ModelChoice | null = backupKind && fallbackEntry
    ? {
        provider: backupKind,
        model:
          (env[fallbackEntry.envKeys.model as keyof AiEnv] as string | undefined) ??
          fallbackEntry.defaultModel,
      }
    : null;

  const baseUrls: Partial<Record<ProviderKind, string>> = {};
  for (const kind of kinds) {
    const kEntry = registryRecords[kind];
    const baseUrlKey = kEntry?.envKeys?.baseUrl;
    if (baseUrlKey && env[baseUrlKey as keyof AiEnv]) {
      baseUrls[kind] = env[baseUrlKey as keyof AiEnv] as string;
    }
  }

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
  };
}
