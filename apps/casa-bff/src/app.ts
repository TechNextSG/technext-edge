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
  detectLanguage,
  fallbackReply,
  wantsHuman,
  ASK_LIMIT,
  ExtractionValidationError,
  createProviderFromEnv,
  createProviderByName,
  KNOWN_PROVIDER_NAMES,
  maskForLogging,
  type ConversationTurn,
  type ExtractProvider,
  type GuestLanguage,
} from "../../../packages/extractor/src/index.js";
import { TEST_PAGE_HTML } from "./testPage.js";
import {
  getIndexHtml,
  getBenchmarkHtml,
  getScenariosHtml,
  getStatusHtml,
  getRoadmapHtml,
  getChecklistHtml,
  getTeamGuideHtml,
  getDiagramHtml,
  getDiagramViewerHtml,
  getDiagramViHtml,
} from "./reportsHtml.js";
import { createConversationStoreFromEnv, createInMemoryConversationStore, type ConversationStore } from "./conversationStore.js";
import {
  checkSenderCredentials,
  createWhatsAppSender,
  parseInboundTexts,
  sameSecret,
  verifySignature,
  whatsAppConfig,
  type InboundTextMessage,
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

// How long a parked thread stays quiet after the guest was told a person is on it.
// Long enough that three messages typed in a row get one holding reply instead of
// three, short enough that a guest with something new to say gets "we're on it"
// rather than silence.
const HOLD_REPEAT_MS = 10 * 60 * 1000;

/** How many replies the bot has already taken in this thread. */
function assistantTurns(history: ConversationTurn[]): number {
  return history.filter((turn) => turn.role === "assistant").length;
}

/**
 * The language to hold a guest in when there is no trip to render one from. Read
 * off the guest's own turns only: the assistant's Vietnamese and Chinese wording is
 * full of diacritics, so letting the bot's own replies vote would pin a thread to
 * whatever language it happened to answer in first (normalize.ts says more).
 */
function guestLanguage(history: ConversationTurn[]): GuestLanguage {
  return detectLanguage(
    history
      .filter((turn) => turn.role === "guest")
      .map((turn) => turn.text)
      .join("\n"),
  );
}

function isResetCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return /^(reset|start\s*over|restart|bắt\s*đầu\s*lại|bat\s*dau\s*lai|làm\s*lại|lam\s*lai|xóa|xoa|重置|重新开始)$/i.test(trimmed);
}

const RESET_REPLY: Record<GuestLanguage, string> = {
  en: "Conversation reset! Welcome to Casa Escondida — our dive-and-stay resort in Anilao, Batangas.\nCould you share your check-in date, how many nights, how many guests, and a name for the booking?",
  vi: "Dạ em đã làm mới cuộc trò chuyện! Casa Escondida xin chào mình.\nĐể đội ngũ kiểm tra phòng và giá, mình cho em biết ngày nhận phòng, số đêm, tổng số khách và tên liên hệ nhé.",
  zh: "对话已重置！欢迎来到 Casa Escondida 潜水度假村。\n请告诉我入住日期、住几晚、几位客人以及预订姓名。",
};

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
  const store = options.store ?? createConversationStoreFromEnv();

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
      return c.json({ received: 0, replied: 0, duplicates: 0, failed: 0, handoffs: 0 });
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

    // Bound once as `const`s: the try above either set both or already returned, and
    // a value the failure path below depends on must not be a `let` that TypeScript
    // can only call "definitely assigned so far" inside a catch block.
    const model = provider;
    const send = sendText;

    let replied = 0;
    let duplicates = 0;
    let failed = 0;
    // Guest messages answered with "a person is taking over" instead of an enquiry
    // reply: a failed turn's apology, a parked thread, or the asking limit. Counted
    // apart from `replied` because `replied: 1, failed: 1` on its own cannot say
    // whether the guest got an answer or a holding message.
    let handoffs = 0;

    const claimedInbound: Array<{ message: InboundTextMessage; fenceToken: string }> = [];

    for (const message of inbound) {
      const claim = await store.claimMessage(message.id);
      if (!claim.claimed) {
        duplicates++;
        continue;
      }
      claimedInbound.push({ message, fenceToken: claim.fenceToken });
    }

    // Group inbound messages by sender phone so multiple rapid messages in the same
    // webhook delivery coalesce into a single turn and a single model call.
    const byPhone = new Map<string, Array<{ message: InboundTextMessage; fenceToken: string }>>();
    for (const item of claimedInbound) {
      const list = byPhone.get(item.message.from) ?? [];
      list.push(item);
      byPhone.set(item.message.from, list);
    }

    for (const [phone, batch] of byPhone) {
      await store.withPhoneLock(phone, async () => {
        const combinedText = batch.map((b) => b.message.text).join("\n");
        const batchIds = batch.map((b) => b.message.id);
        const batchTokens = batch.map((b) => b.fenceToken);

        const markAllDone = async () => {
          for (let i = 0; i < batchIds.length; i++) {
            await store.markDone(batchIds[i], batchTokens[i]);
          }
        };

        const releaseAll = async () => {
          for (let i = 0; i < batchIds.length; i++) {
            await store.releaseMessage(batchIds[i], batchTokens[i]);
          }
        };

        let expired = false;
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
            if (isResetCommand(combinedText)) {
              await store.clear(phone);
              const language = detectLanguage(combinedText);
              const text = RESET_REPLY[language] ?? RESET_REPLY.en;
              sending = true;
              await send({ to: phone, body: text });
              replied++;
              await markAllDone();
              return;
            }

            await store.append(phone, { role: "guest", text: combinedText });
            const history = await store.history(phone);
            const language = guestLanguage(history);

            // Both handoff flags are read *before* anything expensive is spent. A
            // thread a person already owns — or one the guest has just asked a
            // person for — gets a static holding reply and no model call at all: a
            // model answering here would be talking over the human.
            const parked = await store.paused(phone);
            if (parked || wantsHuman(combinedText)) {
              // Parked and told a moment ago (HOLD_REPEAT_MS): nothing is repeated
              // at every "ok" the guest types. Not silence either — they were told
              // a person is on it, and that is still true.
              if (parked && !(await store.needsTelling(phone, HOLD_REPEAT_MS))) {
                await markAllDone();
                return;
              }
              const text = fallbackReply("handoff", language);
              await store.pause(phone, parked?.reason ?? "guest_asked_for_human");
              await store.append(phone, { role: "assistant", text });
              sending = true;
              await send({ to: phone, body: text });
              await store.markTold(phone);
              replied++;
              handoffs++;
              await markAllDone();
              return;
            }

            // The same call the test console makes: full history in, one reply out.
            const outcome = await converse(history, model);
            // Abandoned while the provider was still thinking: Meta already has its
            // answer for this wamid, so stop here rather than appending and sending
            // behind the redelivery's back. This is what keeps "one guest message,
            // at most one reply" true even when the deadline fires mid-turn.
            if (expired) return;

            // Asking has stopped being progress: the guest is stuck, or the
            // extractor is, and one more round of the same questions is where an
            // enquiry dies. A person now is worth more than a ninth question.
            if (!outcome.done && assistantTurns(history) >= ASK_LIMIT) {
              const text = fallbackReply("handoff", language);
              await store.pause(phone, "asking_limit");
              await store.append(phone, { role: "assistant", text });
              sending = true;
              await send({ to: phone, body: text });
              await store.markTold(phone);
              replied++;
              handoffs++;
              await markAllDone();
              return;
            }

            await store.append(phone, { role: "assistant", text: outcome.reply });
            sending = true;
            await send({ to: phone, body: outcome.reply });
            replied++;
            await markAllDone();
          })();

          try {
            await Promise.race([turn, deadline]);
          } finally {
            clearTimeout(timer);
          }
        } catch (err) {
          failed++;
          let apologized = false;
          if (!sending) {
            try {
              const text = fallbackReply("apology", guestLanguage(await store.history(phone)));
              await store.pause(phone, "turn_failed");
              await store.append(phone, { role: "assistant", text });
              await send({ to: phone, body: text });
              await store.markTold(phone);
              apologized = true;
              replied++;
              handoffs++;
              await markAllDone();
            } catch (apologyErr) {
              // eslint-disable-next-line no-console
              console.error("whatsapp apology failed", maskForLogging(phone), apologyErr);
            }
          }
          if (!sending && !apologized) {
            await releaseAll();
          } else {
            await markAllDone();
          }
          // eslint-disable-next-line no-console
          console.error("whatsapp turn failed", maskForLogging(phone), maskForLogging(combinedText), err);
        }
      });
    }

    // Always 2xx once the signature checks out. Meta retries a non-2xx for days,
    // and a retry after we already answered would message the guest twice; the
    // counts in this body plus the log line above are the failure surface.
    // `replied` counts every message that left — answers and holding messages —
    // while `handoffs` counts the subset that told the guest a person is taking it.
    return c.json({ received: inbound.length, replied, duplicates, failed, handoffs });
  });

  // ---- Handoff view --------------------------------------------------------
  // A parked thread is a person's job waiting to happen. Without a way to read
  // that list, "flagged for the Casa team" is where enquiries go to be forgotten,
  // and without a way to hand one back, a single provider hiccup parks a guest for
  // the rest of the day (roadmap L2).
  //
  // Guarded by the verify token rather than a new secret: it is already the one
  // credential everyone working on this channel has to hand, and it is what the
  // Meta handshake already compares against. Read-only routes would be harmless
  // open, but resume() is a write, so the guard covers both — one rule, no cases.
  function handoffAuthorized(header: string | undefined): boolean {
    return sameSecret(header, whatsAppConfig().verifyToken);
  }

  app.get("/v1/channels/whatsapp/threads", async (c) => {
    if (!handoffAuthorized(c.req.header("x-verify-token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json({ paused: await store.pausedThreads() });
  });

  // Whoever answered a parked guest calls this, so the bot can take the thread
  // again instead of staying quiet for the rest of its 24h window. It is also how
  // a test session is unstuck without restarting the process.
  app.post("/v1/channels/whatsapp/threads/:phone/resume", async (c) => {
    if (!handoffAuthorized(c.req.header("x-verify-token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const phone = c.req.param("phone");
    await store.resume(phone);
    return c.json({ ok: true, phone });
  });

  app.post("/v1/channels/whatsapp/threads/:phone/reset", async (c) => {
    if (!handoffAuthorized(c.req.header("x-verify-token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const phone = c.req.param("phone");
    await store.clear(phone);
    return c.json({ ok: true, phone, reset: true });
  });

  // Are the credentials *this deployment* holds actually usable? The laptop
  // pre-flight (scripts/whatsapp-check.mjs) answers that for an env file, not for a
  // deployment — and a value pasted into a dashboard keeps whatever quotes it was
  // copied with, whose only symptom is silence on a real guest's message. Read-only,
  // and it reports what Meta already says publicly about the number.
  app.get("/v1/channels/whatsapp/status", async (c) => {
    if (!handoffAuthorized(c.req.header("x-verify-token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const config = whatsAppConfig();
    return c.json({
      configured: {
        verifyToken: Boolean(config.verifyToken),
        appSecret: Boolean(config.appSecret),
        accessToken: Boolean(config.accessToken),
        phoneNumberId: Boolean(config.phoneNumberId),
      },
      sender: await checkSenderCredentials(config),
    });
  });

  // Health check endpoints: /v1/health is canonical per Delivery Plan (Figure 3)
  // and Odoo API Guide; /healthz is kept for backward compatibility.
  app.get("/v1/health", (c) => c.json({ ok: true }));
  app.get("/healthz", (c) => c.json({ ok: true }));

  // Central documentation & architecture hub
  app.get("/", (c) => c.html(getIndexHtml()));
  app.get("/index.html", (c) => c.html(getIndexHtml()));
  app.get("/hub", (c) => c.html(getIndexHtml()));
  app.get("/docs", (c) => c.html(getIndexHtml()));

  // Interactive AI Extractor Test Console
  app.get("/test", (c) => c.html(TEST_PAGE_HTML));
  app.get("/test-console", (c) => c.html(TEST_PAGE_HTML));
  app.get("/console", (c) => c.html(TEST_PAGE_HTML));

  // Corporate reports, status briefing & test scenario matrix
  app.get("/benchmark-report.html", (c) => c.html(getBenchmarkHtml()));
  app.get("/benchmark", (c) => c.html(getBenchmarkHtml()));
  app.get("/casa-anilao-test-scenarios.html", (c) => c.html(getScenariosHtml()));
  app.get("/scenarios", (c) => c.html(getScenariosHtml()));
  app.get("/extractor-pod-status.html", (c) => c.html(getStatusHtml()));
  app.get("/status", (c) => c.html(getStatusHtml()));
  app.get("/roadmap-next.html", (c) => c.html(getRoadmapHtml()));
  app.get("/roadmap", (c) => c.html(getRoadmapHtml()));
  app.get("/demo-checklist.html", (c) => c.html(getChecklistHtml()));
  app.get("/checklist", (c) => c.html(getChecklistHtml()));
  app.get("/team-guide.html", (c) => c.html(getTeamGuideHtml()));
  app.get("/guide", (c) => c.html(getTeamGuideHtml()));

  // Architecture diagrams (Archify interactive view)
  app.get("/diagrams/extractor-pod.viewer.html", (c) => c.html(getDiagramViewerHtml()));
  app.get("/diagrams/extractor-pod.vi.html", (c) => c.html(getDiagramViHtml()));
  app.get("/diagrams/extractor-pod.html", (c) => c.html(getDiagramHtml()));
  app.get("/diagrams/extractor-pod", (c) => c.html(getDiagramViewerHtml()));
  app.get("/diagrams", (c) => c.html(getDiagramViewerHtml()));
  app.get("/architecture", (c) => c.html(getDiagramViewerHtml()));

  return app;
}
