/**
 * Everything the routes are built from, made once per app: the stores, the estimator, the AI provider, the guards.
 *
 * Each piece can be injected through `AppOptions`, so a test drives the whole app without a server, a KV or a model.
 * `app.ts` only mounts routes on what this returns.
 */
import type { ExtractProvider } from "../../ai/src/index.ts";
import type { Env } from "./env.ts";
import { createLoginAttemptLimiter, type LoginAttemptLimiter } from "./auth/rate-limit.ts";
import { createGuards } from "./auth/guards.ts";
import { createProviderFor, createProviderHolder } from "./ai/providerHolder.ts";
import { createEstimatorPortFromEnv, type EstimatorPort } from "./estimator/index.ts";
import type { WhatsAppSendText } from "./channels/whatsapp/index.ts";
import { createSettingsStore, type SettingsStore } from "./store/settingsStore.ts";
import { createConversationStoreFromEnv, type ConversationStore } from "./store/conversationStore.ts";
import { ADMIN_ONLY_HTML } from "./views/forbiddenPage.ts";

export interface AppOptions {
  /** The environment the app is built from. Defaults to the process's. */
  env?: Env;
  /** Injectable so a test can drive the sign-in brake without waiting out its window. */
  loginLimiter?: LoginAttemptLimiter;
  provider?: ExtractProvider;
  /** The admin-editable AI settings. Injectable so a test can run the dashboard without a KV. */
  settings?: SettingsStore;
  store?: ConversationStore;
  sendWhatsApp?: WhatsAppSendText;
  /**
   * The pricing/booking engine. Injectable so a test can drive every route without a server.
   */
  estimator?: EstimatorPort;
}

export function createDeps(env: Env, options: AppOptions) {
  const store = options.store ?? createConversationStoreFromEnv(env);
  const estimator = options.estimator ?? createEstimatorPortFromEnv(env);
  const settings = options.settings ?? createSettingsStore({ env });
  const providerHolder = createProviderHolder(settings, env);
  const loginLimiter = options.loginLimiter ?? createLoginAttemptLimiter();
  // The guards read the environment on every call, not now: tests set keys per case, and Vercel does not guarantee
  // the variables at import time.
  const guards = createGuards({ adminOnlyHtml: ADMIN_ONLY_HTML });
  const providerFor = createProviderFor(providerHolder, options.provider);

  return {
    store,
    estimator,
    settings,
    providerHolder,
    providerFor,
    loginLimiter,
    guards,
    injectedProvider: options.provider,
    sendWhatsApp: options.sendWhatsApp,
  };
}

export type Deps = ReturnType<typeof createDeps>;
