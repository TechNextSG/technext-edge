import { randomUUID } from "node:crypto";
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
  buildHonoQuotationDraft,
  recalculateQuotationTotals,
  validateBffTripPrecheck,
  synthesizeConfirmedQuotationReply,
  type ConversationTurn,
  type ExtractProvider,
  type GuestLanguage,
  type HonoQuotationDraft,
  type Trip,
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
  getPlanShowcaseHtml,
  getExtractorShowcaseHtml,
  getConversationFlowHtml,
  getProjectArchitectureHtml,
  getInboundMessageFlowHtml,
  getDemoTheatreHtml,
} from "./reportsHtml.js";
import {
  saveQuotationDraft,
  getQuotationByIdOrSlug,
  listQuotations,
  renderHonoQuotationEditorHtml,
  renderCustomerQuotationViewHtml,
} from "./quotationStore.js";
import {
  buildEstimateRequest,
  createEstimatorClient,
  DEFAULT_ESTIMATOR_BASE_URL,
  ESTIMATE_PATH,
} from "./estimatorClient.js";
import { createConversationStoreFromEnv, type ConversationStore } from "./conversationStore.js";
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
  // English only now — Vietnamese was removed from the product on 2026-09-24 (see
  // packages/extractor/src/normalize.ts), so a Vietnamese "reset" phrase is no longer a
  // command this bot recognises.
  return /^(reset|start\s*over|restart|重置|重新开始)$/i.test(trimmed);
}

const RESET_REPLY: Record<GuestLanguage, string> = {
  en: "Conversation reset! Welcome to Casa Escondida — our dive-and-stay resort in Anilao, Batangas.\nCould you share your check-in date, how many nights, how many guests, and a name for the booking?",
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
  /**
   * The estimator BFF client. Injectable so a test can drive the sync route without a server,
   * and so the base URL can be pointed at a local fixture-mode BFF (`ESTIMATOR_BASE_URL`)
   * rather than being baked in.
   */
  estimator?: ReturnType<typeof createEstimatorClient>;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();
  // Per-app, so a warm serverless instance keeps the thread; see the caveat in
  // conversationStore.ts on why this is a POC store and not the real one.
  const store = options.store ?? createConversationStoreFromEnv();
  const estimator = options.estimator ?? createEstimatorClient();

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
            history: parsed.data.history as ConversationTurn[] | undefined,
            channel: parsed.data.channel,
            conversationId: parsed.data.conversationId,
          },
          provider,
        )
        : await converse(parsed.data.history as ConversationTurn[], provider);
      if (outcome.quotationDraft) {
        saveQuotationDraft(outcome.quotationDraft);
      }
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
    //
    // This is the only coalescing that happens, and the boundary is deliberate: messages
    // arriving in SEPARATE deliveries each get their own turn, so a guest who sends two
    // quick texts may receive two replies. `withPhoneLock` below still makes that safe —
    // the second turn runs after the first has finished writing, so it reads a complete
    // history and never re-asks what the first one answered — but it does not merge them.
    //
    // Merging across deliveries would mean holding the webhook open, and Meta's redelivery
    // deadline (measured at +23s on 2026-09-18) is shared with the turn itself. A window
    // short enough to be worth having (1-2s) is charged to every guest on every message,
    // including the overwhelming majority who send one and wait. The verbosity it prevents
    // is cosmetic; the latency it would add is not, so it is not implemented. A
    // WHATSAPP_DEBOUNCE_MS env var used to be read here and applied to nothing.
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

            let finalReplyText = outcome.reply;
            if (outcome.quotationDraft) {
              outcome.quotationDraft.phone = phone;
              saveQuotationDraft(outcome.quotationDraft);
              finalReplyText = `${outcome.reply}\n\n🔗 **Interactive Quotation Link:**\n${outcome.quotationDraft.quotationUrl}\n✏️ **Edit Table & Confirm on Hono:**\n${outcome.quotationDraft.honoEditorUrl}`;
            }

            await store.append(phone, { role: "assistant", text: finalReplyText });
            sending = true;
            await send({ to: phone, body: finalReplyText });
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

  // Executive Showcase & 2-Slide Plan for Lead
  app.get("/casa-escondida-plan-showcase.html", (c) => c.html(getPlanShowcaseHtml()));
  app.get("/plan", (c) => c.html(getPlanShowcaseHtml()));
  app.get("/extractor-pod-showcase.html", (c) => c.html(getExtractorShowcaseHtml()));
  app.get("/showcase", (c) => c.html(getExtractorShowcaseHtml()));
  app.get("/diagrams/conversation-flow-plain.html", (c) => c.html(getConversationFlowHtml()));
  app.get("/conversation-flow-plain.html", (c) => c.html(getConversationFlowHtml()));
  app.get("/flow", (c) => c.html(getConversationFlowHtml()));
  app.get("/diagrams/casa-project-architecture.html", (c) => c.html(getProjectArchitectureHtml()));
  app.get("/project-architecture", (c) => c.html(getProjectArchitectureHtml()));
  app.get("/diagrams/casa-inbound-message-flow.html", (c) => c.html(getInboundMessageFlowHtml()));
  app.get("/message-flow", (c) => c.html(getInboundMessageFlowHtml()));
  app.get("/demo-theatre.html", (c) => c.html(getDemoTheatreHtml()));
  app.get("/demo", (c) => c.html(getDemoTheatreHtml()));

  // ---- Hono Tool-Calling Quotation Studio & Editable Quotation Links -------
  //
  // Two different audiences, two different rules, and conflating them is what put a real
  // guest's name, phone number and total on a public URL.
  //
  //   /q/:slug        the GUEST's link. No credential by design — staff paste it into
  //                   WhatsApp and the guest has no account. The slug is therefore the
  //                   credential (a CSPRNG token, see quotationStore.ts), and an unknown
  //                   slug is a 404. It used to fall back to the most recent quotation, so
  //                   every URL returned somebody's booking.
  //   everything else STAFF only. `/quotes` and `/v1/quotes` list every quotation with
  //                   guestName and phone; `/v1/quotes/:id` also carries the Odoo/GAIS
  //                   envelope. These were open too.
  //
  // The token is the same shared secret the WhatsApp handoff routes already use, so there
  // is no new env var to forget. It fails closed: with no token configured, staff routes
  // are unreachable rather than open.
  function staffAuthorized(header: string | undefined): boolean {
    return sameSecret(header, whatsAppConfig().verifyToken);
  }

  /**
   * Staff auth that a browser link can carry.
   *
   * The header is the right place for anything scripted, and `staffAuthorized` stays the rule for
   * that. But the quotation studio is a PAGE, and its own `fetch` calls to
   * `/v1/quotes/:id` (save, confirm, send) run from a browser that has no reason to hold a
   * shared secret — so guarding those routes with a header alone 401s the studio's own buttons.
   * That was a real regression: the leak fix added the guard and broke the tool it was protecting.
   *
   * Accepting the token in the query string fixes it the way this app already works: a staff link
   * arrives by being pasted into a browser (the WhatsApp handoff view is guarded the same way),
   * and the page reads its own URL to put the token on every call it makes. A query token is
   * weaker than a header — it lands in browser history and in any referrer — so it is scoped to
   * the studio page and its JSON API, never to the guest-facing `/q/:slug`.
   */
  function staffAuthorizedWithQuery(header: string | undefined, token: string | undefined): boolean {
    if (staffAuthorized(header)) return true;
    return sameSecret(token, whatsAppConfig().verifyToken);
  }

  app.get("/quotes", (c) => {
    if (!staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const all = listQuotations();
    const latest = all[0]!;
    return c.html(renderHonoQuotationEditorHtml(latest, all));
  });

  app.get("/quotes/:id", (c) => {
    if (!staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const found = getQuotationByIdOrSlug(id);
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.html(renderHonoQuotationEditorHtml(found, listQuotations()));
  });

  app.get("/q/:slug", (c) => {
    const slug = c.req.param("slug");
    const found = getQuotationByIdOrSlug(slug);
    // A miss is a miss. This route is unauthenticated, so anything else would be serving
    // one guest's booking to whoever asked.
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.html(renderCustomerQuotationViewHtml(found));
  });

  /**
   * What this service would send to the estimator BFF for a given quotation.
   *
   * Replaces a signed "GAIS" envelope that pointed straight at Odoo. Reading it is safe and
   * costs a round trip nothing: it is the same body `estimator.sendEstimate()` posts, built by
   * the same function, so the preview cannot drift from the send.
   *
   * `validationIssues` is our own mirror (`validateBffTripPrecheck`) and is labelled as such.
   * Their `fillTrip` is the authority; the mirror exists only so staff can see a problem in the
   * editor before spending a round trip on it.
   */
  function buildEstimatePreview(draft: HonoQuotationDraft) {
    const trip = draft.bffTrip ?? null;
    return {
      endpoint: `${estimator.baseUrl ?? DEFAULT_ESTIMATOR_BASE_URL}${ESTIMATE_PATH}`,
      body: trip ? buildEstimateRequest(trip).body : null,
      bffTrip: trip,
      validationIssues: trip ? validateBffTripPrecheck(trip) : [],
      /**
       * Not sent, and deliberately not part of `body`. Amounts are Odoo's to compute — sending
       * our own subtotal/discount/total invites a second source of pricing truth, and the edge
       * spec puts pricing behind the BFF for exactly that reason. Kept local so the studio can
       * show staff what the enquiry comes to while they are looking at it.
       */
      localTotals: {
        currency: draft.currency,
        subtotal: draft.subtotalAmount,
        discount: draft.discountAmount,
        total: draft.totalAmount,
      },
    };
  }

  app.get("/v1/quotes", (c) => {
    // Every quotation, each with the guest's name and phone number. Staff only.
    if (!staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json({ quotations: listQuotations() });
  });

  /**
   * Whether the estimator BFF is reachable at all, and in which mode.
   *
   * Exists so staff see the answer BEFORE clicking "Price with the Estimator BFF": without a
   * configured URL that button returns 503, and finding that out by clicking is the kind of
   * silent failure this repo keeps having to dig out of logs. Read-only and staff-only, like
   * every other quotation route.
   *
   * REGISTERED BEFORE `GET /v1/quotes/:id`, and it has to stay there. Hono matches the first
   * route that fits, so `:id` swallows this literal path and answers 404 — which is what happened
   * the first time it was written, and what the route test now pins.
   */
  app.get("/v1/quotes/estimator-status", async (c) => {
    if (!staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const baseUrl = estimator.baseUrl ?? null;
    if (!baseUrl) {
      return c.json({
        configured: false,
        baseUrl: null,
        reachable: null,
        mode: null,
        detail: "ESTIMATOR_BASE_URL is not set, so quotations cannot be priced",
      });
    }
    const health = await estimator.checkHealth();
    return c.json({
      configured: true,
      baseUrl,
      reachable: health.reachable,
      mode: health.mode,
      detail: health.reachable
        ? health.mode === "fixture"
          ? "connected in FIXTURE mode: prices are captured samples, not real quotes"
          : "connected"
        : `no answer from ${baseUrl}/api/health`,
    });
  });

  // Hop 1A: Deterministic Pricing Compute Endpoint (AI -> Hono Compute)
  //
  // Stateless, and it has to stay that way. `docs/ai-hono-odoo-architecture-spec.md` has the
  // AI tool calling this in production while `GET`/`PUT`/`confirm` are staff-only, so this is
  // the one quotation route that cannot simply take a credential. It used to accept a
  // `draft.quoteId`, look that quotation up in the store and return it — which made the
  // unauthenticated route a way to read any quotation, guest phone number included. It now
  // computes only from what the caller sent: a `trip`, or `lineItems` to price.
  app.post("/v1/quotes/compute", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      trip?: Trip;
      phone?: string;
      discountPercent?: number;
      draft?: Partial<HonoQuotationDraft>;
    };

    if (body.trip) {
      const computed = buildHonoQuotationDraft(body.trip, undefined, body.phone);
      if (typeof body.discountPercent === "number") {
        computed.discountPercent = body.discountPercent;
      }
      const finalComputed = recalculateQuotationTotals(computed);
      return c.json({
        ok: true,
        computed: finalComputed,
        estimatePreview: buildEstimatePreview(finalComputed),
      });
    }

    // No trip and no line items is a caller error, not a reason to reach for stored data.
    if (!Array.isArray(body.draft?.lineItems)) {
      return c.json(
        {
          error: "bad_request",
          message:
            "Provide `trip` to price an enquiry, or `draft.lineItems` to price an edited quotation. " +
            "This endpoint is stateless and never reads stored quotations.",
        },
        400,
      );
    }

    // Price exactly what was sent. Defaults here fill only fields `recalculateQuotationTotals`
    // does not use, so nothing stored or invented can reach the totals or the GAIS preview.
    const now = new Date().toISOString();
    const quoteId = body.draft.quoteId ?? `QT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const baseUrl = "https://technext-edge-casa-bff.vercel.app";
    const recomputed = recalculateQuotationTotals({
      quoteId,
      slug: body.draft.slug ?? randomUUID(),
      status: "pending_hono_review",
      createdAt: now,
      updatedAt: now,
      phone: body.phone,
      guestName: "Priced draft",
      checkIn: "",
      checkOut: "",
      nights: 0,
      stayingGuests: 0,
      totalGroupSize: 0,
      rooms: 0,
      mealPlan: "full_board",
      diver: false,
      divers: null,
      diveNotes: null,
      guestType: null,
      currency: "PHP",
      discountPercent: body.discountPercent ?? body.draft.discountPercent ?? 0,
      subtotalAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
      quotationUrl: `${baseUrl}/q/${body.draft.slug ?? quoteId.toLowerCase()}`,
      honoEditorUrl: `${baseUrl}/quotes/${quoteId}`,
      staffNotes: "",
      staffAlerts: [],
      ...body.draft,
      lineItems: body.draft.lineItems,
    } as HonoQuotationDraft);
    return c.json({
      ok: true,
      computed: recomputed,
      estimatePreview: buildEstimatePreview(recomputed),
    });
  });

  // Hop 1B: AI Tool-Calling Submit Endpoint (AI -> Hono Submit & Stage)
  app.post("/v1/quotes/submit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      trip?: Trip;
      phone?: string;
      discountPercent?: number;
    };
    if (!body.trip) {
      return c.json({ ok: false, error: "trip object is required for submit_quotation_to_hono" }, 400);
    }
    const draft = buildHonoQuotationDraft(body.trip, undefined, body.phone);
    if (typeof body.discountPercent === "number") {
      draft.discountPercent = body.discountPercent;
    }
    const saved = saveQuotationDraft(recalculateQuotationTotals(draft));
    return c.json({
      ok: true,
      quotation: saved,
      estimatePreview: buildEstimatePreview(saved),
    });
  });

  app.get("/v1/quotes/:id", (c) => {
    // Carries the guest's name and phone plus the Odoo/GAIS envelope, so staff only.
    if (!staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const found = getQuotationByIdOrSlug(c.req.param("id"));
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.json({ quotation: found, estimatePreview: buildEstimatePreview(found) });
  });

  app.put("/v1/quotes/:id", async (c) => {
    // A write, and it edits what the guest will be shown. Staff only.
    if (!staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Partial<HonoQuotationDraft>;
    const merged: HonoQuotationDraft = {
      ...existing,
      ...body,
      quoteId: existing.quoteId,
      lineItems: Array.isArray(body.lineItems) ? body.lineItems : existing.lineItems,
      quotationUrl: body.quotationUrl || existing.quotationUrl,
    };
    const saved = saveQuotationDraft(merged);
    return c.json({ ok: true, quotation: saved, estimatePreview: buildEstimatePreview(saved) });
  });

  app.post("/v1/quotes/:id/confirm", async (c) => {
    // Confirming commits the price and can trigger an outbound AI reply, so staff only.
    if (!staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Partial<HonoQuotationDraft>;
    const merged: HonoQuotationDraft = {
      ...existing,
      ...body,
      quoteId: existing.quoteId,
      status: "confirmed_by_hono",
      confirmedAt: new Date().toISOString(),
      confirmedBy: "Hono Reservation Studio",
      lineItems: Array.isArray(body.lineItems) ? body.lineItems : existing.lineItems,
      quotationUrl: body.quotationUrl || existing.quotationUrl,
    };
    const saved = saveQuotationDraft(merged);
    let provider: ExtractProvider | undefined;
    try {
      provider = options.provider ?? createProviderFromEnv();
    } catch {}
    const aiReply = await synthesizeConfirmedQuotationReply(saved, provider);
    saved.aiConfirmedReply = aiReply;
    saveQuotationDraft(saved);
    return c.json({ ok: true, quotation: saved, aiReply, estimatePreview: buildEstimatePreview(saved) });
  });

  /**
   * Send this quotation's validated `Trip` to the estimator BFF for pricing.
   *
   * This is the only outbound path to Odoo, and it goes through the BFF as the edge spec
   * requires. It used to return a signed "GAIS" envelope and never send it — a preview of a
   * direct-to-Odoo request with a hardcoded fallback HMAC secret and bearer token. Nothing
   * consumed it but its own callers, so it was removed rather than kept beside this.
   *
   * Renamed from `/sync-odoo`: this does not sync to Odoo, it asks the BFF to price. The old
   * name described a path that no longer exists, and a route name is the cheapest place to
   * tell the truth.
   *
   * A 422 from their `fillTrip` means WE sent something wrong, so it is surfaced as a failure
   * and not smoothed over — that is the whole reason for wiring this up.
   */
  app.post("/v1/quotes/:id/sync-estimate", async (c) => {
    if (!staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const result = await estimator.sendEstimate(existing.bffTrip);
    if (!result.ok) {
      // 422 maps to 422: the estimator rejected our payload, which is a defect here and not a
      // bad gateway. Everything else is infrastructure and is reported as 502.
      const status = result.reason === "rejected" ? 422 : result.reason === "not_configured" ? 503 : 502;
      return c.json(
        {
          ok: false,
          reason: result.reason,
          detail: result.detail,
          fields: result.fields,
          estimatePreview: buildEstimatePreview(existing),
        },
        status,
      );
    }

    return c.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      endpoint: `${estimator.baseUrl ?? DEFAULT_ESTIMATOR_BASE_URL}${ESTIMATE_PATH}`,
      role: result.role,
      /** Their pricing sanity warnings, if any. Names a category, not a field. */
      issues: result.issues,
      computedAt: result.computedAt,
      /**
       * True when this price came from captured data rather than Odoo — their own flag if they
       * sent it, otherwise our probe of their `/api/health`. Their fixture does not currently
       * set the flag their docs promise, so without the probe a captured price would look real.
       */
      sample: result.sample,
      mode: result.mode,
      model: result.model,
      estimatePreview: buildEstimatePreview(existing),
    });
  });

  app.post("/v1/quotes/:id/send-whatsapp", async (c) => {
    if (!staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { phone?: string };
    const toPhone = (body.phone || existing.phone || "").replace(/\D/g, "");
    if (!toPhone) return c.json({ ok: false, error: "Phone number is required" }, 400);
    const text = existing.aiConfirmedReply || (await synthesizeConfirmedQuotationReply(existing));
    const config = whatsAppConfig();
    const send = options.sendWhatsApp ?? createWhatsAppSender(config);
    try {
      await send({ to: toPhone, body: text });
      return c.json({ ok: true, phone: toPhone });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return app;
}
