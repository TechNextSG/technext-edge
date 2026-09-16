import { Hono } from "hono";
import { z } from "zod";
import { extract, ExtractionValidationError, createGeminiProvider } from "@technext-edge/extractor";

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return c.json({ error: "server_misconfigured", detail: "GEMINI_API_KEY not set" }, 500);
    }
    const provider = createGeminiProvider(apiKey);

    try {
      const outcome = await extract(parsed.data.text, provider);
      return c.json(outcome);
    } catch (err) {
      if (err instanceof ExtractionValidationError) {
        return c.json({ error: "extraction_failed", detail: "model output did not match the Trip schema twice" }, 422);
      }
      // eslint-disable-next-line no-console
      console.error("extract failed", err);
      return c.json({ error: "extract_error" }, 502);
    }
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  return app;
}
