/** The staff pages: the studio, one quotation in it, and its ops sheet. */
import type { Hono } from "hono";
import { renderOpsSheetHtml } from "../../views/opsPage.ts";
import { getQuotationByIdOrSlug, listQuotations } from "../../store/quotationStore.ts";
import { renderHonoQuotationEditorHtml } from "../../views/quotationEditorPage.ts";
import { renderEmptyStudioHtml } from "../../views/emptyStudio.ts";
import type { QuotesRouteDeps } from "./shared.ts";

export function registerPagesRoutes(app: Hono, deps: QuotesRouteDeps): void {
  const { estimator, staffSession } = deps;

  app.get("/quotes", async (c) => {
    const auth = staffSession(c);
    if (!auth.ok) return c.redirect("/login");
    const all = await listQuotations();
    const latest = all[0];
    if (!latest) return c.html(renderEmptyStudioHtml());
    return c.html(renderHonoQuotationEditorHtml(latest, all, auth.role ?? "staff", estimator.kind));
  });

  app.get("/quotes/:id", async (c) => {
    const auth = staffSession(c);
    const id = c.req.param("id");
    if (!auth.ok) return c.redirect(`/login?next=${encodeURIComponent(`/quotes/${id}`)}`);
    const found = await getQuotationByIdOrSlug(id);
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.html(renderHonoQuotationEditorHtml(found, await listQuotations(), auth.role ?? "staff", estimator.kind));
  });

  app.get("/quotes/:id/ops", async (c) => {
    const auth = staffSession(c);
    const id = c.req.param("id");
    if (!auth.ok) return c.redirect(`/login?next=${encodeURIComponent(`/quotes/${id}/ops`)}`);
    const found = await getQuotationByIdOrSlug(id);
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.html(renderOpsSheetHtml(found));
  });
}
