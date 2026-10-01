import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ExtractProvider } from "../../ai/src/index.ts";
import { saveQuotationDraft } from "./store/quotationStore.ts";
import { createProviderFor, createProviderHolder } from "./ai/providerHolder.ts";
import { createSettingsStore, type SettingsStore } from "./store/settingsStore.ts";
import { createEstimatorPortFromEnv, type EstimatorPort } from "./estimator/index.ts";
import { createConversationStoreFromEnv, type ConversationStore } from "./store/conversationStore.ts";
import { setSession } from "./auth/session.ts";
import { createLoginAttemptLimiter, type LoginAttemptLimiter } from "./auth/rate-limit.ts";
import { createGuards } from "./auth/guards.ts";
import { ADMIN_ONLY_HTML } from "./views/forbiddenPage.ts";
import type { WhatsAppSendText } from "./channels/whatsapp/index.ts";
import { closeEnquiryQuotation, guestPendingQuotationNote } from "./channels/whatsapp/index.ts";

// Route modules
import { authRoutes } from "./routes/auth.ts";
import { adminRoutes } from "./routes/admin.ts";
import { healthRoutes } from "./routes/health.ts";
import { pageRoutes } from "./routes/pages.ts";
import { extractorRoutes } from "./routes/extractor.ts";
import { handoffRoutes } from "./routes/handoff.ts";
import { whatsAppRoutes } from "./routes/whatsapp.ts";
import { quotesRoutes } from "./routes/quotes/index.ts";

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

  const providerFor = createProviderFor(providerHolder, options.provider);

  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "same-origin",
      contentSecurityPolicy: undefined,
    }),
  );

  app.route("/", authRoutes({ loginLimiter, setSession: (c, role) => setSession(c, role) }));
  app.route("/", adminRoutes({ settings: aiSettings, guard: adminGuard }));
  app.route("/", healthRoutes());
  app.route("/", pageRoutes({ staffSession }));
  app.route("/", extractorRoutes({ providerFor, staffWriter, staffSession, saveQuotationDraft }));
  app.route("/", handoffRoutes({ store, staffSession, staffWriter, closeEnquiryQuotation }));
  app.route(
    "/",
    whatsAppRoutes({ store, providerFor, sendWhatsApp: options.sendWhatsApp, estimator, handoffAuthorized }),
  );
  app.route(
    "/",
    quotesRoutes({
      estimator,
      providerHolder,
      optionsProvider: options.provider,
      staffSession,
      staffWriter,
      sendWhatsApp: options.sendWhatsApp,
    }),
  );

  return app;
}
