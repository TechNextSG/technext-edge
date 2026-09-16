import { Hono } from "hono";
import { z } from "zod";
// Relative import, not the "@technext-edge/extractor" package name: Vercel's
// Node function bundler traces local files reliably but failed to resolve the
// npm-workspace symlink at runtime (ERR_MODULE_NOT_FOUND for the package even
// though it built and typechecked fine locally). A relative path sidesteps
// that resolution entirely — plain files, nothing symlink-based to trace.
import { extract, ExtractionValidationError, createProviderFromEnv } from "../../../packages/extractor/src/index.js";
import { TEST_PAGE_HTML } from "./testPage.js";

// Gate G3 (Contract, Playbook Figure B): unknown field = 422, body cap enforced
// upstream at the edge (G1) — this schema is the app-level half of that gate.
const ExtractRequest = z.object({ text: z.string().min(1).max(4000) }).strict();

export function createApp() {
  const app = new Hono();

  app.post("/v1/extract", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ExtractRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.issues }, 422);
    }

    let provider;
    try {
      provider = createProviderFromEnv();
    } catch (err) {
      return c.json({ error: "server_misconfigured", detail: err instanceof Error ? err.message : String(err) }, 500);
    }

    try {
      const outcome = await extract(parsed.data.text, provider);
      return c.json(outcome);
    } catch (err) {
      if (err instanceof ExtractionValidationError) {
        const cause = err.zodIssues;
        const causeDescription =
          cause instanceof Error ? { message: cause.message, stack: cause.stack } : cause;
        // eslint-disable-next-line no-console
        console.error("extraction validation failed twice", JSON.stringify(causeDescription), err.sample);
        const debug = process.env.DEBUG_EXTRACT === "1" ? { cause: causeDescription, sample: err.sample } : undefined;
        return c.json({ error: "extraction_failed", detail: "model output did not match the Trip schema twice", debug }, 422);
      }
      // eslint-disable-next-line no-console
      console.error("extract failed", err);
      const message = err instanceof Error ? err.message : String(err);
      // Distinguishes "the provider is rate-limited/down" from "the model's
      // output was bad" — collapsing both into one generic error is what made
      // a Gemini free-tier 429 read as a model-quality problem during the
      // eval dry run.
      if (/\b429\b|RESOURCE_EXHAUSTED|rate.?limit/i.test(message)) {
        return c.json({ error: "provider_rate_limited", detail: process.env.DEBUG_EXTRACT === "1" ? message : "the AI provider is rate-limited — try again shortly" }, 429);
      }
      return c.json({ error: "extract_error", detail: process.env.DEBUG_EXTRACT === "1" ? message : undefined }, 502);
    }
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Not the real estimator UI (Edge UI pod owns that) — a plain test page so
  // anyone can try extraction without curl or Postman.
  app.get("/", (c) => c.html(TEST_PAGE_HTML));

  return app;
}
