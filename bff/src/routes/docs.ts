import { Hono } from "hono";
import type { Context } from "hono";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StaffRole } from "../auth/session.ts";
import { renderDocsIndexHtml, type DocEntry } from "../views/docsPage.ts";

export interface DocsRouteDeps {
  staffSession: (c: Context) => { ok: boolean; role: StaffRole | null };
}

/**
 * The documents staff can read in the browser. A fixed list, on purpose: the URL names an entry in this table, never a
 * path, so nothing outside it can be asked for. Every entry is a self-contained HTML file in `docs/`.
 */
export const DOCUMENTS: readonly DocEntry[] = [
  { slug: "benchmark-latency", file: "reports/benchmark-latency-2026-10-01.html", group: "Reports", title: "Benchmark and latency", about: "Accuracy and speed of the AI channel on production, cold start, run-to-run spread, simultaneous guests." },
  { slug: "manual-test-checklist", file: "guides/manual-test-checklist.html", group: "Testing", title: "Hand-test checklist", about: "51 cases with copyable WhatsApp messages and result boxes." },
  { slug: "advanced-demo-scenarios", file: "guides/advanced-demo-scenarios.html", group: "Testing", title: "Advanced demo scenarios", about: "Six stress and edge-case scenarios for the live demo, with expected replies." },
  { slug: "system-runtime", file: "diagrams/system-runtime.html", group: "Architecture", title: "Runtime architecture", about: "Guest, Meta, the Vercel function, Gemini, KV, the studio and the team estimator." },
  { slug: "whatsapp-turn", file: "diagrams/whatsapp-turn.html", group: "Architecture", title: "One WhatsApp turn", about: "From a signed webhook to a draft quotation and the reply, step by step." },
  { slug: "quotation-lifecycle", file: "diagrams/quotation-lifecycle.html", group: "Architecture", title: "Quotation lifecycle", about: "Enquiry, draft, priced, approved, link sent; re-price and archive." },
  { slug: "repo-structure", file: "diagrams/repo-structure.html", group: "Architecture", title: "Repo map", about: "Packages, folders and the boundaries between them." },
  { slug: "structure-compare", file: "notes/structure-compare.html", group: "Architecture", title: "This repo and the team repo", about: "What is mirrored, what moves to the team estimator, what never does." },
];

/**
 * The `docs/` folder, found by walking up from this module until one that holds `guides/` turns up. Walking up rather than
 * counting `../` because the same code runs from `bff/src/routes/` (tests, dev) and from the bundled `api/index.js`
 * on Vercel, where `docs/` is shipped next to it by `includeFiles` in vercel.json.
 */
function docsRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(dir, "docs");
    if (existsSync(path.join(candidate, "guides"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), "docs");
}

/** `/docs` and `/docs/:slug`: staff only, a signed-out visitor is sent to sign in (as `/test` does). */
export function docsRoutes(deps: DocsRouteDeps): Hono {
  const app = new Hono();

  app.get("/docs", (c) => {
    if (!deps.staffSession(c).ok) return c.redirect("/login");
    return c.html(renderDocsIndexHtml(DOCUMENTS));
  });

  app.get("/docs/:slug", (c) => {
    if (!deps.staffSession(c).ok) return c.redirect("/login");
    const entry = DOCUMENTS.find((d) => d.slug === c.req.param("slug"));
    if (!entry) return c.json({ error: "not_found" }, 404);
    const file = path.join(docsRoot(), entry.file);
    if (!existsSync(file)) return c.json({ error: "not_found", detail: "this document is not part of this deployment" }, 404);
    return c.html(readFileSync(file, "utf8"));
  });

  return app;
}
