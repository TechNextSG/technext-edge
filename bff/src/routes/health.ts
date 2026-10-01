import { Hono } from "hono";

/**
 * Health check endpoints.
 *
 * `/v1/health` is canonical per the Delivery Plan (Figure 3) and the Odoo API Guide;
 * `/healthz` is kept because the deployment, the WhatsApp scripts and the team's own
 * checks have called it since before `/v1/health` existed.
 *
 * Registered on their own, deliberately: these have to answer even when the extractor,
 * the estimator or the stores are the thing that is broken, so they must not acquire a
 * dependency on any of them.
 */
export function healthRoutes(): Hono {
  const app = new Hono();
  app.get("/v1/health", (c) => c.json({ ok: true }));
  app.get("/healthz", (c) => c.json({ ok: true }));

  return app;
}
