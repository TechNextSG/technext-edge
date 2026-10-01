/** The quotation list and the estimator's health, for the studio's queue and banner. */
import type { Hono } from "hono";
import { listQuotations, filterQuotations } from "../../store/quotationStore.ts";
import type { QuotesRouteDeps } from "./shared.ts";

export function registerListRoutes(app: Hono, deps: QuotesRouteDeps): void {
  const { estimator, staffSession } = deps;

  app.get("/v1/quotes", async (c) => {
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const limitRaw = Number(c.req.query("limit") ?? "");
    const all = await listQuotations();
    const quotations = filterQuotations(all, {
      status: c.req.query("status"),
      q: c.req.query("q"),
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200,
    });
    return c.json({ quotations, total: all.length, returned: quotations.length });
  });

  app.get("/v1/quotes/estimator-status", async (c) => {
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const baseUrl = estimator.baseUrl ?? null;
    if (estimator.kind === "remote" && !baseUrl) {
      return c.json({
        configured: false,
        kind: estimator.kind,
        baseUrl: null,
        reachable: null,
        mode: null,
        detail: "ESTIMATOR_MODE=remote but ESTIMATOR_BASE_URL is not set, so quotations cannot be priced",
      });
    }
    const health = await estimator.checkHealth();
    return c.json({
      configured: true,
      kind: estimator.kind,
      baseUrl,
      reachable: health.reachable,
      mode: health.mode,
      detail: health.reachable
        ? estimator.kind === "simulated"
          ? "priced by the built-in simulated engine: sample data, not a real quote"
          : health.mode === "fixture"
            ? "connected in FIXTURE mode: prices are captured samples, not real quotes"
            : "connected"
        : `no answer from ${baseUrl}/api/health`,
    });
  });
}
