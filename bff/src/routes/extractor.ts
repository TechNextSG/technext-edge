import { loadEnv } from "../env.ts";
import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  extract,
  ExtractionValidationError,
  createProviderByName,
  KNOWN_PROVIDER_NAMES,
  type ConversationTurn,
  type ExtractProvider,
} from "../../../ai/src/index.ts";
import {
  converseWithQuotation,
  type HonoQuotationDraft,
} from "../quote/index.ts";
import type { StaffRole } from "../auth/session.ts";

const ProviderOverride = {
  provider: z.enum(KNOWN_PROVIDER_NAMES).optional(),
  apiKey: z.string().min(1).max(500).optional(),
};

// Gate G3 (Contract, Playbook Figure B): unknown field = 422, body cap enforced
// upstream at the edge (G1) — this schema is the app-level half of that gate.
export const ExtractRequest = z
  .object({ text: z.string().min(1).max(4000), ...ProviderOverride })
  .strict()
  .refine((v) => !v.provider || v.apiKey, { message: "apiKey is required when provider is set" });

// A conversation is still exactly one extraction re-run on the whole
// transcript each turn — see ai/src/converse.ts. Capped at
// 20 turns and 4000 chars/turn; a real conversation stays far under both.
export const ConverseRequest = z
  .object({
    history: z
      .array(z.object({ role: z.enum(["guest", "assistant"]), text: z.string().min(1).max(4000) }))
      .min(1)
      .max(20)
      .optional(),
    message: z.string().min(1).max(4000).optional(),
    channel: z.enum(["web", "email", "whatsapp"]).optional(),
    conversationId: z.string().min(1).max(200).optional(),
    ...ProviderOverride,
  })
  .strict()
  .refine((v) => v.message || v.history?.length, { message: "message or history is required" })
  .refine((v) => !v.provider || v.apiKey, { message: "apiKey is required when provider is set" });

// Shared between /v1/extract and /v1/converse — both call into the same
// extract() underneath and can fail in exactly the same two ways: the
// model's output didn't validate (422), or the provider itself failed
// (429 rate-limited, or 502 for anything else).
export function handleExtractError(err: unknown): Response {
  if (err instanceof ExtractionValidationError) {
    const cause = err.zodIssues;
    const causeDescription = cause instanceof Error ? { message: cause.message, stack: cause.stack } : cause;
    // eslint-disable-next-line no-console
    console.error("extraction validation failed twice", JSON.stringify(causeDescription), err.sample);
    const debug = loadEnv().DEBUG_EXTRACT === "1" ? { cause: causeDescription, sample: err.sample } : undefined;
    return Response.json({ error: "extraction_failed", detail: "model output did not match the Trip schema twice", debug }, { status: 422 });
  }
  // eslint-disable-next-line no-console
  console.error("extract failed", err);
  const message = err instanceof Error ? err.message : String(err);
  if (/\b429\b|RESOURCE_EXHAUSTED|rate.?limit/i.test(message)) {
    return Response.json(
      { error: "provider_rate_limited", detail: loadEnv().DEBUG_EXTRACT === "1" ? message : "the AI provider is rate-limited — try again shortly" },
      { status: 429 },
    );
  }
  return Response.json({ error: "extract_error", detail: loadEnv().DEBUG_EXTRACT === "1" ? message : undefined }, { status: 502 });
}

export interface ExtractorRouteDeps {
  providerFor: (data: { provider?: string; apiKey?: string }) => Promise<ExtractProvider>;
  staffWriter: (c: Context) => boolean;
  staffSession: (c: Context) => { ok: boolean; role: StaffRole | null };
  saveQuotationDraft: (draft: HonoQuotationDraft) => Promise<HonoQuotationDraft>;
}

export function registerExtractorRoutes(app: Hono, deps: ExtractorRouteDeps): void {
  const { providerFor, staffWriter, staffSession, saveQuotationDraft } = deps;

  app.post("/v1/extract", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ExtractRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.issues }, 422);
    }
    if (parsed.data.provider && !staffWriter(c)) {
      return c.json({ error: "unauthorized", detail: "choosing a provider or sending an API key needs a staff session" }, 401);
    }

    let provider: ExtractProvider;
    try {
      provider = await providerFor(parsed.data);
    } catch (err) {
      return c.json({ error: "server_misconfigured", detail: err instanceof Error ? err.message : String(err) }, 500);
    }

    try {
      const outcome = await extract(parsed.data.text, provider);
      return c.json(outcome);
    } catch (err) {
      return handleExtractError(err);
    }
  });

  app.post("/v1/converse", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ConverseRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.issues }, 422);
    }
    if (parsed.data.provider && !staffWriter(c)) {
      return c.json({ error: "unauthorized", detail: "choosing a provider or sending an API key needs a staff session" }, 401);
    }

    let provider: ExtractProvider;
    try {
      provider = await providerFor(parsed.data);
    } catch (err) {
      return c.json({ error: "server_misconfigured", detail: err instanceof Error ? err.message : String(err) }, 500);
    }

    try {
      const outcome = parsed.data.message
        ? await converseWithQuotation(
          {
            message: parsed.data.message,
            history: parsed.data.history as ConversationTurn[] | undefined,
            channel: parsed.data.channel,
            conversationId: parsed.data.conversationId,
          },
          provider,
        )
        : await converseWithQuotation(parsed.data.history as ConversationTurn[], provider);
      if (outcome.quotationDraft) {
        if (staffSession(c).ok) {
          await saveQuotationDraft(outcome.quotationDraft);
          return c.json({ ...outcome, quotationSaved: true });
        }
        const { quotationDraft: _withheld, ...rest } = outcome;
        return c.json({
          ...rest,
          quotationSaved: false,
          quotationNote:
            "this enquiry is complete, but a quotation was not created: sign in to the staff studio to open one",
        });
      }
      return c.json(outcome);
    } catch (err) {
      return handleExtractError(err);
    }
  });
}
