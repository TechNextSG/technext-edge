// The AI provider the app actually answers with, kept for the life of the process.
//
// Before: `resolveProvider()` built a fresh provider from env vars on every request, which did two things
// nobody meant. It read the model from the environment only (so a change needed a deploy), and it threw away the
// circuit breaker after each request — "primary is down, use the fallback for 60s" only ever held inside one
// request. Now one provider lives here, is rebuilt when the saved settings change (their `version`), and keeps
// its breaker the rest of the time.
import { loadEnv, type Env } from "../env.ts";
import {
  buildProvider,
  createProviderByName,
  createProviderFromEnv,
  createProviderFromSettings,
  keyFor,
  type ExtractProvider,
  type ModelChoice,
  type ProviderOutcome,
  type ProviderSettings,
} from "../../../ai/src/index.ts";
import type { SettingsStore } from "../store/settingsStore.ts";

export interface ProviderHolder {
  get(): Promise<ExtractProvider>;
}

export function createProviderHolder(store: SettingsStore, env: Env = loadEnv()): ProviderHolder {
  let current: { version: number; provider: ExtractProvider } | null = null;

  const onOutcome = (outcome: ProviderOutcome) => {
    // A counter that cannot be written must never fail a guest's message.
    void store.recordOutcome(outcome).catch(() => {});
  };

  return {
    async get() {
      let resolved: Awaited<ReturnType<SettingsStore["resolve"]>>;
      try {
        resolved = await store.resolve();
      } catch (err) {
        // KV unreachable. The guest still gets an answer: the provider we already have, else the environment's.
        // eslint-disable-next-line no-console
        console.warn(`[casa-bff] AI settings unreadable (${err instanceof Error ? err.message : String(err)}); using ${current ? "the running provider" : "the environment"}`);
        if (current) return current.provider;
        return createProviderFromEnv(env);
      }
      if (current && current.version === resolved.version) return current.provider;
      const provider = createProviderFromSettings(resolved.settings, env, { onOutcome });
      current = { version: resolved.version, provider };
      return provider;
    },
  };
}

/**
 * Which provider answers one request: the one named in the request (the test console's own key, staff only), else
 * the injected one (tests), else the process-wide holder.
 */
export function createProviderFor(holder: ProviderHolder, injected?: ExtractProvider, env: () => Env = loadEnv) {
  return async function providerFor(data: { provider?: string; apiKey?: string }): Promise<ExtractProvider> {
    if (data.provider) return createProviderByName(data.provider, data.apiKey!, env());
    return injected ?? (await holder.get());
  };
}

/** Anything a provider's error message might carry that must not reach a browser: the key itself, and Gemini's `?key=`. */
function scrub(message: string, secrets: string[]): string {
  let out = message.replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]").replace(/(bearer\s+)[^\s"']+/gi, "$1[redacted]");
  for (const secret of secrets) if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  return out.slice(0, 300);
}

export interface TestResult {
  role: "primary" | "fallback";
  provider: string;
  model: string;
  ok: boolean;
  ms: number;
  error?: string;
}

/**
 * One cheap, fixed call against one model with one key — the dashboard's "Test". It asks for a single word, so it
 * proves the key, the model id and the timeout without touching anything a guest wrote, and it runs against the
 * settings being *edited*, not the ones in force.
 */
export async function testChoice(
  role: TestResult["role"],
  choice: ModelChoice,
  settings: ProviderSettings,
  env: Env,
): Promise<TestResult> {
  const started = Date.now();
  const key = keyFor(choice.provider, settings, env);
  const base = { role, provider: choice.provider, model: choice.model };
  if (!key) return { ...base, ok: false, ms: 0, error: `no ${choice.provider} key saved or set in the environment` };
  try {
    const provider = buildProvider(choice, key, {
      timeoutsMs: settings.timeoutsMs,
      deepseekBaseUrl: settings.deepseekBaseUrl,
    });
    if (!provider.generateText) throw new Error("this provider cannot answer a test call");
    const text = await provider.generateText("Reply with the single word OK.", "ping");
    if (!text) throw new Error("the provider answered with nothing");
    return { ...base, ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ...base, ok: false, ms: Date.now() - started, error: scrub(err instanceof Error ? err.message : String(err), [key]) };
  }
}
