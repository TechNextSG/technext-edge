import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import {
  createProviderByName,
  type ExtractProvider,
} from "../../ai/src/index.js";
import { saveQuotationDraft } from "./stores/quotationStore.js";
import { createProviderHolder } from "./services/aiProvider.js";
import { createSettingsStore, type SettingsStore } from "./stores/settingsStore.js";
import { createEstimatorPortFromEnv, type EstimatorPort } from "./services/estimatorPort.js";
import { createConversationStoreFromEnv, type ConversationStore } from "./stores/conversationStore.js";
import {
  DEMO_SESSION_COOKIE,
  createLoginAttemptLimiter,
  staffAccessKey,
  type LoginAttemptLimiter,
  issueSession,
  verifySession,
  type DemoRole,
  adminAccessKey,
} from "./auth/demoAuth.js";
import {
  sameSecret,
  type WhatsAppSendText,
} from "./services/whatsapp.js";
import {
  closeEnquiryQuotation,
  guestPendingQuotationNote,
} from "./services/whatsappTurnService.js";

// Route modules
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPageRoutes } from "./routes/pages.js";
import { registerExtractorRoutes } from "./routes/extractor.js";
import { registerHandoffRoutes } from "./routes/handoff.js";
import { registerWhatsAppRoutes } from "./routes/whatsapp.js";
import { registerQuotesRoutes } from "./routes/quotes.js";

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

  async function providerFor(data: { provider?: string; apiKey?: string }): Promise<ExtractProvider> {
    if (data.provider) return createProviderByName(data.provider, data.apiKey!, process.env);
    return options.provider ?? (await providerHolder.get());
  }

  function staffAuthorizedWithQuery(header: string | undefined, query: string | undefined): boolean {
    const key = staffAccessKey();
    if (!key) return false;
    if (sameSecret(header, key)) return true;
    return Boolean(query && sameSecret(query, key));
  }

  function staffSession(c: Context): { ok: boolean; role: DemoRole | null } {
    const bearer = c.req.header("authorization");
    if (bearer?.startsWith("Bearer ") && sameSecret(bearer.slice(7).trim(), staffAccessKey())) {
      return { ok: true, role: "staff" };
    }
    if (staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return { ok: true, role: "staff" };
    }
    const role = verifySession(getCookie(c, DEMO_SESSION_COOKIE));
    return role ? { ok: true, role } : { ok: false, role: null };
  }

  function staffWriter(c: Context): boolean {
    const auth = staffSession(c);
    return auth.ok && (auth.role === "staff" || auth.role === "admin");
  }

  function setDemoSession(c: Context, role: DemoRole): void {
    setCookie(c, DEMO_SESSION_COOKIE, issueSession(role), {
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
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

  const loginLimiter = options.loginLimiter ?? createLoginAttemptLimiter();

  function adminGuard(c: Context, kind: "page" | "api"): Response | null {
    const key = adminAccessKey();
    if (!key) return c.json({ error: "not_found" }, 404);
    const header = c.req.header("x-admin-key");
    if (header && sameSecret(header, key)) return null;
    const auth = staffSession(c);
    if (auth.ok && auth.role === "admin") return null;
    if (auth.ok) {
      return kind === "page"
        ? c.html("<!doctype html><title>Admin only</title><p>This page is for the admin account. Sign in with the admin key.</p>", 403)
        : c.json({ error: "forbidden", detail: "the admin dashboard needs the admin key" }, 403);
    }
    return kind === "page" ? c.redirect("/login?next=%2Fadmin%2Fai") : c.json({ error: "unauthorized" }, 401);
  }

  // Register modular route handlers
  registerAuthRoutes(app, { loginLimiter, setSession: setDemoSession });
  registerAdminRoutes(app, { settings: aiSettings, guard: adminGuard });
  registerHealthRoutes(app);
  registerPageRoutes(app);
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
