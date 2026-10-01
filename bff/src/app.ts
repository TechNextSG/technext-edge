import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { loadEnv } from "./env.ts";
import { createDeps, type AppOptions } from "./deps.ts";
import { setSession } from "./auth/session.ts";
import { saveQuotationDraft } from "./store/quotationStore.ts";
import { closeEnquiryQuotation, guestPendingQuotationNote } from "./channels/whatsapp/index.ts";
import { authRoutes } from "./routes/auth.ts";
import { adminRoutes } from "./routes/admin.ts";
import { healthRoutes } from "./routes/health.ts";
import { pageRoutes } from "./routes/pages.ts";
import { extractorRoutes } from "./routes/extractor.ts";
import { handoffRoutes } from "./routes/handoff.ts";
import { whatsAppRoutes } from "./routes/whatsapp.ts";
import { quotesRoutes } from "./routes/quotes/index.ts";

export { guestPendingQuotationNote };
export type { AppOptions };

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

  const d = createDeps(options.env ?? loadEnv(), options);
  const { staffSession, staffWriter, adminGuard, handoffAuthorized } = d.guards;

  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "same-origin",
      contentSecurityPolicy: undefined,
    }),
  );

  app.route("/", authRoutes({ loginLimiter: d.loginLimiter, setSession: (c, role) => setSession(c, role) }));
  app.route("/", adminRoutes({ settings: d.settings, guard: adminGuard }));
  app.route("/", healthRoutes());
  app.route("/", pageRoutes({ staffSession }));
  app.route("/", extractorRoutes({ providerFor: d.providerFor, staffWriter, staffSession, saveQuotationDraft }));
  app.route("/", handoffRoutes({ store: d.store, staffSession, staffWriter, closeEnquiryQuotation }));
  app.route(
    "/",
    whatsAppRoutes({
      store: d.store,
      providerFor: d.providerFor,
      sendWhatsApp: d.sendWhatsApp,
      estimator: d.estimator,
      handoffAuthorized,
    }),
  );
  app.route(
    "/",
    quotesRoutes({
      estimator: d.estimator,
      providerHolder: d.providerHolder,
      optionsProvider: d.injectedProvider,
      staffSession,
      staffWriter,
      sendWhatsApp: d.sendWhatsApp,
    }),
  );

  return app;
}
