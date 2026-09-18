import { Hono } from "hono";
import { z } from "zod";
// Relative import, not the "@technext-edge/extractor" package name: Vercel's
// Node function bundler traces local files reliably but failed to resolve the
// npm-workspace symlink at runtime (ERR_MODULE_NOT_FOUND for the package even
// though it built and typechecked fine locally). A relative path sidesteps
// that resolution entirely — plain files, nothing symlink-based to trace.
import {
  extract,
  converse,
  ExtractionValidationError,
  createProviderFromEnv,
  createProviderByName,
  KNOWN_PROVIDER_NAMES,
  maskForLogging,
  type ExtractProvider,
} from "../../../packages/extractor/src/index.js";
import { TEST_PAGE_HTML } from "./testPage.js";
import { createInMemoryConversationStore, type ConversationStore } from "./conversationStore.js";
import {
  createWhatsAppSender,
  parseInboundTexts,
  verifySignature,
  whatsAppConfig,
  type WhatsAppSendText,
} from "./whatsapp.js";

// `provider`/`apiKey` are an optional per-request override for the test
// console and the eval harness — bring your own key for a quick bake-off
// comparison without touching Vercel env vars or redeploying. Omit both to
// use the server's configured default (createProviderFromEnv).
const ProviderOverride = {
  provider: z.enum(KNOWN_PROVIDER_NAMES).optional(),
  apiKey: z.string().min(1).max(500).optional(),
};

// Gate G3 (Contract, Playbook Figure B): unknown field = 422, body cap enforced
// upstream at the edge (G1) — this schema is the app-level half of that gate.
const ExtractRequest = z
  .object({ text: z.string().min(1).max(4000), ...ProviderOverride })
  .strict()
  .refine((v) => !v.provider || v.apiKey, { message: "apiKey is required when provider is set" });

// A conversation is still exactly one extraction re-run on the whole
// transcript each turn — see packages/extractor/src/converse.ts. Capped at
// 20 turns and 4000 chars/turn; a real conversation stays far under both.
const ConverseRequest = z
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

// `fallback` is the seam the app is constructed with (see AppOptions): the
// WhatsApp webhook has no request body to carry an override, so without it that
// path could only ever be tested against a real vendor.
function resolveProvider(data: { provider?: string; apiKey?: string }, fallback?: ExtractProvider): ExtractProvider {
  if (data.provider) return createProviderByName(data.provider, data.apiKey!);
  return fallback ?? createProviderFromEnv();
}

// Shared between /v1/extract and /v1/converse — both call into the same
// extract() underneath and can fail in exactly the same two ways: the
// model's output didn't validate (422), or the provider itself failed
// (429 rate-limited, or 502 for anything else). See extract.ts's comment on
// why those two failure modes must not collapse into one generic error.
function handleExtractError(err: unknown): Response {
  if (err instanceof ExtractionValidationError) {
    const cause = err.zodIssues;
    const causeDescription = cause instanceof Error ? { message: cause.message, stack: cause.stack } : cause;
    // eslint-disable-next-line no-console
    console.error("extraction validation failed twice", JSON.stringify(causeDescription), err.sample);
    const debug = process.env.DEBUG_EXTRACT === "1" ? { cause: causeDescription, sample: err.sample } : undefined;
    return Response.json({ error: "extraction_failed", detail: "model output did not match the Trip schema twice", debug }, { status: 422 });
  }
  // eslint-disable-next-line no-console
  console.error("extract failed", err);
  const message = err instanceof Error ? err.message : String(err);
  if (/\b429\b|RESOURCE_EXHAUSTED|rate.?limit/i.test(message)) {
    return Response.json(
      { error: "provider_rate_limited", detail: process.env.DEBUG_EXTRACT === "1" ? message : "the AI provider is rate-limited — try again shortly" },
      { status: 429 },
    );
  }
  return Response.json({ error: "extract_error", detail: process.env.DEBUG_EXTRACT === "1" ? message : undefined }, { status: 502 });
}

/**
 * Construction seams, all optional and all defaulting to the production path in
 * api/index.ts (`createApp()` with no arguments). They exist because the two
 * inbound channels differ in one important way: /v1/extract and /v1/converse
 * take a provider per request from the caller, while the WhatsApp webhook is
 * rung by Meta and has no caller to take one from.
 */
export interface AppOptions {
  provider?: ExtractProvider;
  store?: ConversationStore;
  sendWhatsApp?: WhatsAppSendText;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();
  // Per-app, so a warm serverless instance keeps the thread; see the caveat in
  // conversationStore.ts on why this is a POC store and not the real one.
  const store = options.store ?? createInMemoryConversationStore();

  app.post("/v1/extract", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ExtractRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.issues }, 422);
    }

    let provider: ExtractProvider;
    try {
      provider = resolveProvider(parsed.data, options.provider);
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

    let provider: ExtractProvider;
    try {
      provider = resolveProvider(parsed.data, options.provider);
    } catch (err) {
      return c.json({ error: "server_misconfigured", detail: err instanceof Error ? err.message : String(err) }, 500);
    }

    try {
      const outcome = parsed.data.message
        ? await converse(
            {
              message: parsed.data.message,
              history: parsed.data.history,
              channel: parsed.data.channel,
              conversationId: parsed.data.conversationId,
            },
            provider,
          )
        : await converse(parsed.data.history!, provider);
      return c.json(outcome);
    } catch (err) {
      return handleExtractError(err);
    }
  });

  // ---- WhatsApp inbound channel (Meta Cloud API) ---------------------------
  // A guest messages the Casa number; this extracts and the answer goes back on
  // the same thread. Meta's shapes are handled in ./whatsapp.ts — the only vendor
  // seam on this path, same as provider.call is for /v1/extract.
  //
  // Meta's subscription handshake, called once when the webhook URL is pointed at
  // Meta and again whenever that URL or the token changes. WHATSAPP_VERIFY_TOKEN
  // is a string we invent and paste into both sides; Meta issues no such token.
  app.get("/v1/channels/whatsapp/webhook", (c) => {
    const config = whatsAppConfig();
    if (!config.verifyToken) {
      return c.json({ error: "server_misconfigured", detail: "WHATSAPP_VERIFY_TOKEN is not set" }, 500);
    }

    const challenge = c.req.query("hub.challenge");
    if (c.req.query("hub.mode") === "subscribe" && c.req.query("hub.verify_token") === config.verifyToken && challenge) {
      // Plain text, not JSON — Meta compares this response body verbatim.
      return c.text(challenge);
    }
    return c.json({ error: "invalid_verify_token" }, 403);
  });

  app.post("/v1/channels/whatsapp/webhook", async (c) => {
    const config = whatsAppConfig();
    if (!config.appSecret) {
      return c.json({ error: "server_misconfigured", detail: "WHATSAPP_APP_SECRET is not set" }, 500);
    }

    // Raw body, not c.req.json(): the signature covers the exact bytes Meta sent
    // and re-serialising the parsed object would not reproduce them.
    const raw = await c.req.text();
    if (!verifySignature(raw, c.req.header("x-hub-signature-256"), config.appSecret)) {
      // Either a misconfigured Meta app or someone who found the URL and hoped we
      // would extract-and-reply on their behalf. Refused before anything expensive.
      return c.json({ error: "invalid_signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const inbound = parseInboundTexts(payload);
    if (inbound.length === 0) {
      // Receipts and non-text messages both land here: nothing to answer, but
      // still a 200 so Meta stops retrying the event.
      return c.json({ received: 0, replied: 0, duplicates: 0, failed: 0 });
    }

    // Resolved after the signature check so an unauthenticated caller can't use
    // the response to probe which vendor keys this deployment holds.
    let provider: ExtractProvider;
    let sendText: WhatsAppSendText;
    try {
      provider = resolveProvider({}, options.provider);
      sendText = options.sendWhatsApp ?? createWhatsAppSender(config);
    } catch (err) {
      return c.json({ error: "server_misconfigured", detail: err instanceof Error ? err.message : String(err) }, 500);
    }

    let replied = 0;
    let duplicates = 0;
    let failed = 0;

    for (const message of inbound) {
      if (!(await store.claimMessage(message.id))) {
        duplicates++;
        continue;
      }

      // Meta waits only a moment for our 200 before it treats a delivery as
      // unanswered and redelivers the same message (measured 2026-09-18:
      // delivered 15:33:38, redelivered 15:34:01). On that first delivery the
      // turn never returned at all, so the redelivery was answered
      // `duplicates: 1` and the guest got nothing, silently. Hence one turn, one
      // deadline: past it the claim goes back, so the redelivery can answer for
      // real instead of being swallowed.
      let expired = false;
      // Set as the reply starts leaving. From then on the claim has to stay
      // taken, because redelivery during an in-flight send would reply twice.
      let sending = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error(`WhatsApp turn exceeded ${config.turnTimeoutMs}ms`));
        }, config.turnTimeoutMs);
      });

      try {
        const turn = (async () => {
          await store.append(message.from, { role: "guest", text: message.text });
          // The same call the test console makes: full history in, one reply out.
          const outcome = await converse(await store.history(message.from), provider);
          // Abandoned while the provider was still thinking: Meta already has its
          // answer for this wamid, so stop here rather than appending and sending
          // behind the redelivery's back. This is what keeps "one guest message,
          // at most one reply" true even when the deadline fires mid-turn.
          if (expired) return;
          await store.append(message.from, { role: "assistant", text: outcome.reply });
          sending = true;
          await sendText({ to: message.from, body: outcome.reply });
        })();

        // Cleared on both paths: a live timer would keep a serverless instance
        // awake (and a test process open) long after the turn is done with.
        await Promise.race([turn, deadline]).finally(() => clearTimeout(timer));
        replied++;
      } catch (err) {
        failed++;
        // Nothing was sent, so the claim can safely go back and Meta's
        // redelivery becomes a retry rather than a duplicate nobody answers.
        // Skipped once a send is in flight, where the only safe assumption left
        // is that the guest may have received it. (A send that fails *after*
        // Meta accepted it still costs the guest a second reply either way; the
        // opposite guess — silence — is the failure this release exists to end.)
        if (!sending) await store.releaseMessage(message.id);
        // eslint-disable-next-line no-console
        console.error("whatsapp turn failed", maskForLogging(message.from), maskForLogging(message.text), err);
      }
    }

    // Always 2xx once the signature checks out. Meta retries a non-2xx for days,
    // and a retry after we already answered would message the guest twice; the
    // counts in this body plus the log line above are the failure surface.
    return c.json({ received: inbound.length, replied, duplicates, failed });
  });

  // Health check endpoints: /v1/health is canonical per Delivery Plan (Figure 3)
  // and Odoo API Guide; /healthz is kept for backward compatibility.
  app.get("/v1/health", (c) => c.json({ ok: true }));
  app.get("/healthz", (c) => c.json({ ok: true }));

  // Not the real estimator UI (Edge UI pod owns that) — a plain test page so
  // anyone can try extraction without curl or Postman.
  app.get("/", (c) => c.html(TEST_PAGE_HTML));

  return app;
}
