// The admin-editable AI settings: which model answers, its fallback, its keys, its timeouts.
//
// Until this existed, changing the model meant editing an env var in Vercel and redeploying. Here the values
// live in KV (`settings:ai`), are read through a 30-second in-process cache that every write clears, and sit
// *on top of* the environment: nothing saved means the environment decides, exactly as before, and a saved value
// says so in the dashboard (`source: "kv"`).
//
// Shape of what is stored: only what an admin changed. That is what lets the dashboard say where each value
// comes from, and what keeps a fresh deployment's behaviour identical to the pre-dashboard one.
import { loadEnv, type Env } from "../env.ts";
import {
  DEFAULT_MODELS,
  MODEL_CATALOG,
  PROVIDER_KINDS,
  settingsFromEnv,
  type ModelChoice,
  type ProviderKind,
  type ProviderOutcome,
  type ProviderSettings,
} from "../../../ai/src/index.ts";
import { decryptSecret, encryptionKeyFromEnv, encryptSecret, maskSecret, SecretDecryptError, type EncryptedSecret } from "../auth/secretBox.ts";
import { kvCommand, kvConfigFromEnv, type KvConfig } from "./kv.ts";

export const SETTINGS_KEY = "settings:ai";
export const AUDIT_KEY = "settings:ai:audit";
export const AUDIT_KEEP = 50;
export const STATS_TTL_SECONDS = 14 * 24 * 3600;

/** Bounds an admin cannot step outside: a 100ms timeout or a 30-day breaker is a mistake, not a setting. */
export const LIMITS = {
  timeoutMs: { min: 1_000, max: 30_000 },
  cooldownMs: { min: 1_000, max: 3_600_000 },
  authCooldownMs: { min: 60_000, max: 86_400_000 },
} as const;

export type Source = "kv" | "env" | "default";

export interface StoredAiSettings {
  primary?: ModelChoice;
  fallback?: ModelChoice | null;
  timeoutsMs?: { extract: number; synthesis: number };
  breaker?: { cooldownMs: number; authCooldownMs: number };
  synthesisEnabled?: boolean;
  deepseekBaseUrl?: string | null;
  keys?: Partial<Record<ProviderKind, EncryptedSecret>>;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

/** A change to the non-secret settings. Keys have their own calls. */
export type AiSettingsPatch = Partial<Omit<StoredAiSettings, "keys" | "version" | "updatedAt" | "updatedBy">>;

export interface AuditEntry {
  at: string;
  by: string;
  /** What changed. Never a key: a key is recorded as "added", "replaced" or "removed". */
  diff: Array<{ field: string; from: unknown; to: unknown }>;
}

export interface KeyView {
  present: boolean;
  source: "kv" | "env" | "none";
  /** "••••abcd", or absent. */
  masked?: string;
  /** Set when a saved key cannot be opened (wrong or missing SETTINGS_ENCRYPTION_KEY). */
  problem?: string;
}

export interface AdminAiView {
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  primary: ModelChoice & { source: Source };
  fallback: (ModelChoice & { source: Source }) | null;
  fallbackSource: Source;
  timeoutsMs: ProviderSettings["timeoutsMs"] & { source: Source };
  breaker: ProviderSettings["breaker"] & { source: Source };
  synthesisEnabled: { value: boolean; source: Source };
  deepseekBaseUrl: { value: string | null; source: Source };
  keys: Record<ProviderKind, KeyView>;
  /** False means keys cannot be saved from the dashboard until SETTINGS_ENCRYPTION_KEY is set. */
  encryptionConfigured: boolean;
  catalog: typeof MODEL_CATALOG;
  limits: typeof LIMITS;
}

export interface StatsRow {
  provider: ProviderKind;
  ok: number;
  fail: number;
  fallback: number;
  avgMs: number | null;
}

/** https only, no credentials in the URL, and never an address that is not a public hostname. */
export function validateDeepseekBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a URL";
  }
  if (url.protocol !== "https:") return "must be https";
  if (url.username || url.password) return "must not contain credentials";
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return "must be a public hostname";
  }
  if (/^[0-9.]+$/.test(host) || host.includes(":")) return "must be a hostname, not an IP address";
  return null;
}

export interface SettingsStoreOptions {
  kv?: KvConfig | null;
  env?: Env;
  now?: () => Date;
  cacheMs?: number;
  encryptionKey?: Buffer | null;
}

export interface SettingsStore {
  read(): Promise<StoredAiSettings | null>;
  resolve(): Promise<{ settings: ProviderSettings; version: number; keyProblems: ProviderKind[] }>;
  view(): Promise<AdminAiView>;
  apply(patch: AiSettingsPatch, by: string): Promise<StoredAiSettings>;
  setKey(provider: ProviderKind, key: string, by: string): Promise<void>;
  removeKey(provider: ProviderKind, by: string): Promise<void>;
  audit(limit?: number): Promise<AuditEntry[]>;
  recordOutcome(outcome: ProviderOutcome): Promise<void>;
  stats(days: number): Promise<{ days: number; rows: StatsRow[] }>;
  invalidate(): void;
}

function envOrDefaultSettings(env: Env): ProviderSettings {
  try {
    return settingsFromEnv(env);
  } catch {
    // An env var that names no provider must not take the dashboard down with it: show the defaults, and let
    // the admin fix the value from here.
    return {
      primary: { provider: "gemini", model: DEFAULT_MODELS.gemini },
      fallback: null,
      timeoutsMs: { extract: 15_000, synthesis: 8_000 },
      breaker: { cooldownMs: 60_000, authCooldownMs: 3_600_000 },
      synthesisEnabled: true,
      keys: {},
    };
  }
}

const ENV_KEY_NAME: Record<ProviderKind, keyof Env> = {
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_GATEWAY_KEY",
};

export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const env = options.env ?? loadEnv();
  const kv = options.kv === undefined ? kvConfigFromEnv(env) : options.kv;
  const now = options.now ?? (() => new Date());
  const cacheMs = options.cacheMs ?? 30_000;
  const encryptionKey = options.encryptionKey === undefined ? encryptionKeyFromEnv(env) : options.encryptionKey;

  // The in-memory stand-in: correct locally and in tests, and what a deployment with no KV gets.
  let memSettings: StoredAiSettings | null = null;
  const memAudit: AuditEntry[] = [];
  const memCounters = new Map<string, number>();

  let cache: { at: number; value: StoredAiSettings | null } | null = null;

  async function readRaw(): Promise<StoredAiSettings | null> {
    if (!kv) return memSettings;
    const raw = await kvCommand<string | null>(kv, ["GET", SETTINGS_KEY]);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAiSettings;
    } catch {
      return null;
    }
  }

  async function read(): Promise<StoredAiSettings | null> {
    if (cache && now().getTime() - cache.at < cacheMs) return cache.value;
    const value = await readRaw();
    cache = { at: now().getTime(), value };
    return value;
  }

  function invalidate(): void {
    cache = null;
  }

  async function write(next: StoredAiSettings, entry: AuditEntry): Promise<void> {
    if (kv) {
      await kvCommand(kv, ["SET", SETTINGS_KEY, JSON.stringify(next)]);
      await kvCommand(kv, ["LPUSH", AUDIT_KEY, JSON.stringify(entry)]);
      await kvCommand(kv, ["LTRIM", AUDIT_KEY, 0, AUDIT_KEEP - 1]);
    } else {
      memSettings = next;
      memAudit.unshift(entry);
      memAudit.length = Math.min(memAudit.length, AUDIT_KEEP);
    }
    invalidate();
  }

  function bump(previous: StoredAiSettings | null, by: string, changes: Partial<StoredAiSettings>): StoredAiSettings {
    return {
      ...(previous ?? {}),
      ...changes,
      version: (previous?.version ?? 0) + 1,
      updatedAt: now().toISOString(),
      updatedBy: by,
    };
  }

  async function resolve() {
    const stored = await read();
    const base = envOrDefaultSettings(env);
    const keys: ProviderSettings["keys"] = {};
    const keyProblems: ProviderKind[] = [];
    for (const kind of PROVIDER_KINDS) {
      const secret = stored?.keys?.[kind];
      if (!secret) continue;
      try {
        keys[kind] = decryptSecret(secret, encryptionKey);
      } catch (err) {
        // The environment's own key covers for it (`keyFor`), and the dashboard says why.
        if (err instanceof SecretDecryptError) keyProblems.push(kind);
        else throw err;
      }
    }
    const settings: ProviderSettings = {
      primary: stored?.primary ?? base.primary,
      fallback: stored && "fallback" in stored && stored.fallback !== undefined ? stored.fallback : base.fallback,
      timeoutsMs: stored?.timeoutsMs ?? base.timeoutsMs,
      breaker: stored?.breaker ?? base.breaker,
      synthesisEnabled: stored?.synthesisEnabled ?? base.synthesisEnabled,
      keys,
      ...(stored?.deepseekBaseUrl ? { deepseekBaseUrl: stored.deepseekBaseUrl } : {}),
    };
    return { settings, version: stored?.version ?? 0, keyProblems };
  }

  async function view(): Promise<AdminAiView> {
    const stored = await read();
    const { settings, keyProblems } = await resolve();
    const envDescribes = {
      primary: Boolean(env.EXTRACTOR_PROVIDER),
      fallback: Boolean(env.GEMINI_API_KEY || env.DEEPSEEK_GATEWAY_KEY),
      timeouts: Boolean(env.GEMINI_TIMEOUT_MS || env.DEEPSEEK_TIMEOUT_MS),
    };
    const src = (inKv: boolean, inEnv: boolean): Source => (inKv ? "kv" : inEnv ? "env" : "default");

    const keys = {} as Record<ProviderKind, KeyView>;
    for (const kind of PROVIDER_KINDS) {
      const secret = stored?.keys?.[kind];
      const envKey = env[ENV_KEY_NAME[kind]];
      if (secret && !keyProblems.includes(kind)) {
        keys[kind] = { present: true, source: "kv", masked: maskSecret(secret.last4) };
      } else if (envKey) {
        keys[kind] = {
          present: true,
          source: "env",
          masked: maskSecret(envKey.slice(-4)),
          ...(secret ? { problem: "the saved key cannot be opened; the environment key is in use" } : {}),
        };
      } else {
        keys[kind] = {
          present: false,
          source: "none",
          ...(secret ? { problem: "the saved key cannot be opened (SETTINGS_ENCRYPTION_KEY)" } : {}),
        };
      }
    }

    const fallbackInKv = Boolean(stored && "fallback" in stored && stored.fallback !== undefined);
    return {
      version: stored?.version ?? 0,
      updatedAt: stored?.updatedAt ?? null,
      updatedBy: stored?.updatedBy ?? null,
      primary: { ...settings.primary, source: src(Boolean(stored?.primary), envDescribes.primary) },
      fallback: settings.fallback ? { ...settings.fallback, source: src(fallbackInKv, envDescribes.fallback) } : null,
      fallbackSource: src(fallbackInKv, envDescribes.fallback),
      timeoutsMs: { ...settings.timeoutsMs, source: src(Boolean(stored?.timeoutsMs), envDescribes.timeouts) },
      breaker: { ...settings.breaker, source: src(Boolean(stored?.breaker), false) },
      synthesisEnabled: { value: settings.synthesisEnabled, source: src(stored?.synthesisEnabled !== undefined, false) },
      deepseekBaseUrl: {
        value: settings.deepseekBaseUrl ?? null,
        source: src(Boolean(stored?.deepseekBaseUrl), Boolean(env.DEEPSEEK_BASE_URL || env.DEEPSEEK_GATEWAY_URL)),
      },
      keys,
      encryptionConfigured: encryptionKey !== null,
      catalog: MODEL_CATALOG,
      limits: LIMITS,
    };
  }

  async function apply(patch: AiSettingsPatch, by: string): Promise<StoredAiSettings> {
    const previous = await readRaw();
    const before = (await resolve()).settings;
    const changes: Partial<StoredAiSettings> = {};
    const diff: AuditEntry["diff"] = [];
    const note = (field: string, from: unknown, to: unknown) => {
      if (JSON.stringify(from) !== JSON.stringify(to)) diff.push({ field, from, to });
    };
    if (patch.primary) {
      changes.primary = patch.primary;
      note("primary", before.primary, patch.primary);
    }
    if ("fallback" in patch && patch.fallback !== undefined) {
      changes.fallback = patch.fallback;
      note("fallback", before.fallback, patch.fallback);
    }
    if (patch.timeoutsMs) {
      changes.timeoutsMs = patch.timeoutsMs;
      note("timeoutsMs", before.timeoutsMs, patch.timeoutsMs);
    }
    if (patch.breaker) {
      changes.breaker = patch.breaker;
      note("breaker", before.breaker, patch.breaker);
    }
    if (patch.synthesisEnabled !== undefined) {
      changes.synthesisEnabled = patch.synthesisEnabled;
      note("synthesisEnabled", before.synthesisEnabled, patch.synthesisEnabled);
    }
    if ("deepseekBaseUrl" in patch && patch.deepseekBaseUrl !== undefined) {
      changes.deepseekBaseUrl = patch.deepseekBaseUrl;
      note("deepseekBaseUrl", before.deepseekBaseUrl ?? null, patch.deepseekBaseUrl);
    }
    const next = bump(previous, by, changes);
    await write(next, { at: next.updatedAt, by, diff });
    return next;
  }

  async function setKey(provider: ProviderKind, key: string, by: string): Promise<void> {
    if (!encryptionKey) throw new SecretDecryptError();
    const previous = await readRaw();
    const had = Boolean(previous?.keys?.[provider]);
    const next = bump(previous, by, { keys: { ...(previous?.keys ?? {}), [provider]: encryptSecret(key, encryptionKey) } });
    await write(next, {
      at: next.updatedAt,
      by,
      diff: [{ field: `keys.${provider}`, from: had ? "set" : null, to: had ? "replaced" : "added" }],
    });
  }

  async function removeKey(provider: ProviderKind, by: string): Promise<void> {
    const previous = await readRaw();
    if (!previous?.keys?.[provider]) return;
    const { [provider]: _removed, ...rest } = previous.keys;
    const next = bump(previous, by, { keys: rest });
    await write(next, { at: next.updatedAt, by, diff: [{ field: `keys.${provider}`, from: "set", to: "removed" }] });
  }

  async function audit(limit = AUDIT_KEEP): Promise<AuditEntry[]> {
    if (!kv) return memAudit.slice(0, limit);
    const raw = await kvCommand<string[]>(kv, ["LRANGE", AUDIT_KEY, 0, limit - 1]);
    return raw.flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditEntry];
      } catch {
        return [];
      }
    });
  }

  const day = (d: Date) => d.toISOString().slice(0, 10);
  const counterKey = (date: string, provider: ProviderKind, field: string) => `stats:ai:${date}:${provider}:${field}`;

  async function recordOutcome(outcome: ProviderOutcome): Promise<void> {
    const date = day(now());
    const keys = [counterKey(date, outcome.provider, outcome.kind), counterKey(date, outcome.provider, "ms"), counterKey(date, outcome.provider, "n")];
    if (!kv) {
      memCounters.set(keys[0]!, (memCounters.get(keys[0]!) ?? 0) + 1);
      memCounters.set(keys[1]!, (memCounters.get(keys[1]!) ?? 0) + outcome.ms);
      memCounters.set(keys[2]!, (memCounters.get(keys[2]!) ?? 0) + 1);
      return;
    }
    await kvCommand(kv, ["INCR", keys[0]!]);
    await kvCommand(kv, ["INCRBY", keys[1]!, Math.max(0, Math.round(outcome.ms))]);
    await kvCommand(kv, ["INCR", keys[2]!]);
    for (const k of keys) await kvCommand(kv, ["EXPIRE", k, STATS_TTL_SECONDS]);
  }

  async function stats(days: number): Promise<{ days: number; rows: StatsRow[] }> {
    const span = Math.max(1, Math.min(14, Math.round(days)));
    const dates = Array.from({ length: span }, (_, i) => day(new Date(now().getTime() - i * 86_400_000)));
    const names = ["ok", "fail", "fallback", "ms", "n"] as const;
    const rows: StatsRow[] = [];
    for (const provider of PROVIDER_KINDS) {
      const keys = dates.flatMap((d) => names.map((n) => counterKey(d, provider, n)));
      const values = kv
        ? (await kvCommand<Array<string | null>>(kv, ["MGET", ...keys])).map((v) => Number(v ?? 0))
        : keys.map((k) => memCounters.get(k) ?? 0);
      const totals = { ok: 0, fail: 0, fallback: 0, ms: 0, n: 0 };
      values.forEach((v, i) => {
        totals[names[i % names.length]!] += v;
      });
      if (totals.ok + totals.fail + totals.fallback === 0) continue;
      rows.push({
        provider,
        ok: totals.ok,
        fail: totals.fail,
        fallback: totals.fallback,
        avgMs: totals.n > 0 ? Math.round(totals.ms / totals.n) : null,
      });
    }
    return { days: span, rows };
  }

  return { read, resolve, view, apply, setKey, removeKey, audit, recordOutcome, stats, invalidate };
}
