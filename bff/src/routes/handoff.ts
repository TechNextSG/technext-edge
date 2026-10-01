import type { Context, Hono } from "hono";
import type { ConversationStore } from "../stores/conversationStore.ts";
import { renderHandoffPageHtml } from "../views/handoffPage.ts";
import type { DemoRole } from "../auth/demoAuth.ts";

export interface HandoffRouteDeps {
  store: ConversationStore;
  staffSession: (c: Context) => { ok: boolean; role: DemoRole | null };
  staffWriter: (c: Context) => boolean;
  closeEnquiryQuotation: (phone: string) => Promise<string | null | undefined>;
}

/**
 * Human handoff management for paused WhatsApp threads.
 */
export function registerHandoffRoutes(app: Hono, deps: HandoffRouteDeps): void {
  const { store, staffSession, staffWriter, closeEnquiryQuotation } = deps;

  // Guarded by the same demo session as the studio: whoever can read quotations can read this,
  // because it is the same job.
  app.get("/handoff", async (c) => {
    const auth = staffSession(c);
    if (!auth.ok) return c.redirect("/login?next=%2Fhandoff");
    return c.html(renderHandoffPageHtml(await store.pausedThreads(), auth.role ?? "staff"));
  });

  // Handing a thread back. A write, so it is guard-checked here rather than only hidden in the
  // page: a form post with the right path must not be able to un-park a thread without a session.
  app.post("/handoff/:phone/resume", async (c) => {
    const auth = staffSession(c);
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    if (!staffWriter(c)) return c.json({ error: "forbidden", detail: "only staff may hand a thread back" }, 403);
    await store.resume(c.req.param("phone"));
    return c.redirect("/handoff");
  });

  app.post("/handoff/:phone/reset", async (c) => {
    const auth = staffSession(c);
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    if (!staffWriter(c)) return c.json({ error: "forbidden", detail: "only staff may clear a thread" }, 403);
    await closeEnquiryQuotation(c.req.param("phone"));
    await store.clear(c.req.param("phone"));
    return c.redirect("/handoff");
  });
}
