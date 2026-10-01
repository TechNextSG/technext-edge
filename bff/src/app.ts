import { loadEnv } from "./env.ts";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createProviderByName, type ExtractProvider } from "../../ai/src/index.ts";
import { saveQuotationDraft } from "./store/quotationStore.ts";
import { createProviderHolder } from "./services/aiProvider.ts";
import { createSettingsStore, type SettingsStore } from "./store/settingsStore.ts";
import { createEstimatorPortFromEnv, type EstimatorPort } from "./services/estimatorPort.ts";
import { createConversationStoreFromEnv, type ConversationStore } from "./store/conversationStore.ts";
import { setSession } from "./auth/session.ts";
import { createLoginAttemptLimiter, type LoginAttemptLimiter } from "./auth/rate-limit.ts";
import { createGuards } from "./auth/guards.ts";
import { ADMIN_ONLY_HTML } from "./views/forbiddenPage.ts";
import type { WhatsAppSendText } from "./services/whatsapp.ts";
import { closeEnquiryQuotation, guestPendingQuotationNote } from "./services/whatsappTurnService.ts";

// Route modules
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerPageRoutes } from "./routes/pages.ts";
import { registerExtractorRoutes } from "./routes/extractor.ts";
import { registerHandoffRoutes } from "./routes/handoff.ts";
import { registerWhatsAppRoutes } from "./routes/whatsapp.ts";
import { registerQuotesRoutes } from "./routes/quotes/index.ts";

export { guestPendingQuotationNote };

export interface AppOptions {
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

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  app.onError((err, c) => {
    // eslint-disable-next-line no-console
    console.error(`[casa-bff] unhandled error on ${c.req.method} ${c.req.url}:`, err);
    return c.json(
      {
        ok: false,
        reason: "internal_error",
        error: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  });

  const store = options.store ?? createConversationStoreFromEnv();
  const estimator = options.estimator ?? createEstimatorPortFromEnv();
  const aiSettings = options.settings ?? createSettingsStore();
  const providerHolder = createProviderHolder(aiSettings);
  const { staffSession, staffWriter, adminGuard, handoffAuthorized } = createGuards({ adminOnlyHtml: ADMIN_ONLY_HTML });
  const loginLimiter = options.loginLimiter ?? createLoginAttemptLimiter();

  async function providerFor(data: { provider?: string; apiKey?: string }): Promise<ExtractProvider> {
    if (data.provider) return createProviderByName(data.provider, data.apiKey!, loadEnv());
    return options.provider ?? (await providerHolder.get());
  }

  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "same-origin",
      contentSecurityPolicy: undefined,
    }),
  );

  registerAuthRoutes(app, { loginLimiter, setSession: (c, role) => setSession(c, role) });
  registerAdminRoutes(app, { settings: aiSettings, guard: adminGuard });
  registerHealthRoutes(app);
  registerPageRoutes(app, { staffSession });
  registerExtractorRoutes(app, {
    providerFor,
    staffWriter,
    staffSession,
    saveQuotationDraft,
  });
  registerHandoffRoutes(app, {
    store,
    staffSession,
    staffWriter,
    closeEnquiryQuotation,
  });
  registerWhatsAppRoutes(app, {
    store,
    providerFor,
    sendWhatsApp: options.sendWhatsApp,
    estimator,
    handoffAuthorized,
  });
  registerQuotesRoutes(app, {
    estimator,
    providerHolder,
    optionsProvider: options.provider,
    staffSession,
    staffWriter,
    sendWhatsApp: options.sendWhatsApp,
  });

  return app;
}
