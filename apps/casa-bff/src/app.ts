import { themeCss } from "./theme.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
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
  stalledHandoffReply,
  partnerInvitationReply,
  changedValueNotice,
  wantsHuman,
  classifyEnquiry,
  ASK_LIMIT,
  STALL_LIMIT,
  ExtractionValidationError,
  createProviderFromEnv,
  createProviderByName,
  KNOWN_PROVIDER_NAMES,
  maskForLogging,
  buildHonoQuotationDraft,
  recalculateQuotationTotals,
  validateBffTripPrecheck,
  normalizePricing,
  diffBffTrip,
  pricedFactsChanged,
  synthesizeConfirmedQuotationReply,
  type ConversationTurn,
  type ExtractProvider,
  type GuestLanguage,
  type HonoQuotationDraft,
  type QuotationSubmission,
  type Trip,
} from "../../../packages/extractor/src/index.js";
import { BffTrip } from "../../../packages/extractor/src/schema.js";
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
  findOpenQuotationForPhone,
  duplicateQuotationIds,
  removeQuotation,
  renderHonoQuotationEditorHtml,
} from "./quotationStore.js";
import {
  buildEstimateRequest,
  DEFAULT_ESTIMATOR_BASE_URL,
  ESTIMATE_PATH,
} from "./estimatorClient.js";
import { createEstimatorPortFromEnv, type EstimatorPort } from "./estimatorPort.js";
import { createConversationStoreFromEnv, type ConversationStore } from "./conversationStore.js";
import { renderHandoffPageHtml } from "./handoffPage.js";
import { renderOpsSheetHtml } from "./opsPage.js";
import {
  DEMO_SESSION_COOKIE,
  createLoginAttemptLimiter,
  isDemoRole,
  staffAccessKey,
  type LoginAttemptLimiter,
  issueSession,
  renderLoginHtml,
  verifySession,
  SAFE_NEXT_PREFIXES,
  type DemoRole,
} from "./demoAuth.js";
import {
  checkSenderCredentials,
  createWhatsAppSender,
  checkRecipient,
  explainMetaError,
  WhatsAppSendError,
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

/**
 * An absolute guest link, from the relative path their API returns plus the host we called.
 *
 * A relative path with no host to resolve it against is not a link: returning the path would put
 * `/quote/abc` in a guest's chat, which is not somewhere they can go. Null is the honest answer,
 * and the studio shows the quotation as published-but-unlinked rather than printing a dead path.
 */
function absoluteUrl(url: string, baseUrl: string | undefined): string | null {
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) return null;
  try {
    return new URL(url, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

/**
 * The values a price is built from, as the guest themselves stated them.
 *
 * Only `stated`: a house-norm default and a code-derived value are not things the guest said, so
 * they cannot be things the guest changed. Without that filter every trip would look like it had
 * "changed" the moment a norm was applied to it.
 */
function statedMoneyValues(trip: Trip): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of ["nights", "guests", "rooms", "divers"] as const) {
    const field = trip[key];
    const value = field?.value;
    if (field?.state === "stated" && (typeof value === "number" || typeof value === "string")) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * What a deletion may never touch, whoever asks for it.
 *
 * The duplicate rule decided this before (`duplicateQuotationIds`), but an explicit list of ids —
 * which is what clearing leftovers from manual tests needs — is a second way in, and the more
 * dangerous one: whoever holds the staff key can name any record at all. So the protections are
 * enforced here, on the way to `removeQuotation`, rather than being a property of how the list was
 * built. Three things are never removable:
 *
 *   * a **published** record, because a guest may be holding its link;
 *   * a **corrected** record, because somebody's work is in it;
 *   * the **seeded** fixture, because that is what a cold start shows.
 */
function deletableByCleanup(q: HonoQuotationDraft): boolean {
  if (q.estimator?.sharedAt) return false;
  if ((q.staffEdits ?? []).length > 0) return false;
  if (q.seedVersion !== undefined) return false;
  return true;
}

/**
 * Close the quotation an enquiry left open, because the enquiry is over.
 *
 * A reset is the guest saying "forget that, start again" — and on a shared office phone the next
 * message is often a different guest entirely. Leaving the open quotation live is how a new enquiry
 * inherited an old one's approval, price, customer-app session and name: found on production, where
 * `QT-1120-MIGU-…` carried one enquiry's approval and price while showing the *next* guest's name
 * beside them. So the record is closed at the boundary, and the next enquiry mints its own.
 *
 * Closed, not deleted: if it was published the guest is still holding that link, and staff may
 * still need to read what was offered. `cancelled` is the state the studio already draws as dead,
 * so a reset quotation leaves the working queue without inventing a state for a page to learn.
 */
async function closeEnquiryQuotation(phone: string): Promise<string | null> {
  if (!phone) return null;
  const open = await findOpenQuotationForPhone(phone);
  // `findOpenQuotationForPhone` never returns a shared record, so this only ever closes something
  // no guest is holding. Idempotent: a record already closed needs nothing.
  if (!open || open.status === "cancelled") return null;
  const closed = await saveQuotationDraft({
    ...open,
    status: "cancelled",
    updatedAt: new Date().toISOString(),
    staffAlerts: [
      ...open.staffAlerts,
      "Closed when the guest restarted the conversation. The next enquiry gets its own quotation.",
    ],
  });
  return closed.quoteId;
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
  /** Injectable so a test can drive the sign-in brake without waiting out its window. */
  loginLimiter?: LoginAttemptLimiter;
  provider?: ExtractProvider;
  store?: ConversationStore;
  sendWhatsApp?: WhatsAppSendText;
  /**
   * The pricing/booking engine. Injectable so a test can drive every route without a server, and
   * so `ESTIMATOR_MODE` can pick the simulated engine (the default) or their BFF. See
   * estimatorPort.ts for why the simulated one answers in the customer's own shape.
   */
  estimator?: EstimatorPort;
}

/**
 * The links appended to a GUEST's reply once a quotation exists.
 *
 * The customer link only. This used to also append `honoEditorUrl` — the staff studio page — which
 * was wrong twice over:
 *
 * - **Wrong audience.** It is internal tooling addressed to whoever is working the quote, and it
 *   was being pasted into the guest's own chat along with the quote id.
 * - **Broken as sent.** `/quotes/:id` is guarded (`x-verify-token`, or `?token=` for a pasted
 *   link), so the URL as written answers 401. Verified against production: the exact link from a
 *   real reply returned 401. Making it work would mean putting the staff secret in a guest's
 *   message, which is worse than a dead link.
 *
 * Staff reach the studio the way they already do — `/quotes?token=<WHATSAPP_VERIFY_TOKEN>`, or
 * from the WhatsApp threads view.
 *
 * Bold is `*single asterisks*`: WhatsApp does not render `**`, so the double form showed up in the
 * guest's chat as literal asterisks.
 */
/**
 * What the guest is told when their enquiry is complete but no price has been published yet.
 *
 * This replaced a function that appended OUR quotation link the moment the bot had enough
 * information. That was wrong in the way that matters most: it quoted a price to a customer before
 * anyone at the resort had looked at it, from a table copied by hand, and (in fixture mode) from
 * sample data with no label. The link a guest is entitled to is the one the customer's own
 * quotation app mints from an Odoo price, and it is minted when a member of staff publishes the
 * quotation from the studio — see `POST /v1/quotes/:id/publish`.
 *
 * So the bot's last message is a promise the resort can keep, and nothing more. It names no figure
 * and no link.
 */
export function guestPendingQuotationNote(): string {
  return "\n\nOur reservations team is preparing your quotation now, and will send it to you here shortly.";
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();
  // Per-app, so a warm serverless instance keeps the thread; see the caveat in
  // conversationStore.ts on why this is a POC store and not the real one.
  const store = options.store ?? createConversationStoreFromEnv();
  const estimator = options.estimator ?? createEstimatorPortFromEnv();

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
        await saveQuotationDraft(outcome.quotationDraft);
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
        // When this turn began, so the synthesis call can be given whatever is left of the deadline
        // rather than a fixed budget that might not fit inside it.
        const turnStartedAt = Date.now();
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
              // The enquiry is over, so its quotation is closed with it — see
              // `closeEnquiryQuotation`. Done before the thread is cleared, because the phone is
              // the only thing that ties the two together.
              await closeEnquiryQuotation(phone);
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
            //
            // `classifyEnquiry` joins them for the same reason. A cancellation, a refund or a
            // complaint needs a person because of what it IS, not because of what could be
            // extracted from it, and a message that is not a booking enquiry at all has no trip in
            // it to find. Both would otherwise spend a model call producing booking questions for
            // a message nobody wanted asked about.
            const parked = await store.paused(phone);
            const intent = classifyEnquiry(combinedText);
            const askedForHuman = wantsHuman(combinedText);
            const escalate = askedForHuman || intent === "escalate_now";
            const notBooking = !escalate && intent === "not_booking";
            // A partner enquiry is parked with an invitation rather than a holding reply, and the
            // guest can answer it: "for ourselves" has to reach the ordinary path. So this one
            // reason resumes instead of staying quiet — the invitation said "just tell me and I'll
            // carry on", and a bot that then says nothing has broken its own promise.
            if (parked?.reason === "partner_self_serve") {
              await store.resume(phone);
            }
            if ((parked && parked.reason !== "partner_self_serve") || escalate || notBooking) {
              // Parked and told a moment ago (HOLD_REPEAT_MS): nothing is repeated
              // at every "ok" the guest types. Not silence either — they were told
              // a person is on it, and that is still true.
              if (parked && !(await store.needsTelling(phone, HOLD_REPEAT_MS))) {
                await markAllDone();
                return;
              }
              // The reason is for the human reading the list, never for the guest, so it can name
              // the real situation. A message that is neither can only be a park that already
              // existed, which keeps its original reason.
              const reason = parked?.reason ?? (askedForHuman ? "guest_asked_for_human" : escalate ? "complaint_or_cancel" : "not_booking");
              const text =
                !parked && notBooking ? fallbackReply("not_booking", language) : fallbackReply("handoff", language);
              await store.pause(phone, reason, { context: combinedText.slice(0, 200) });
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
            //
            // The synthesis budget is what is LEFT of this turn's deadline, minus a second for the
            // send itself. The synthesis call is the last of five to seven in a turn, so it is the
            // one that decides whether the reply arrives at all; without this it could run to the
            // provider's own timeout, which is longer than the whole turn is allowed to be.
            const elapsedMs = Date.now() - turnStartedAt;
            const synthesisBudgetMs = Math.max(1_500, config.turnTimeoutMs - elapsedMs - 1_000);
            const outcome = await converse(history, model, { synthesisBudgetMs });
            // Abandoned while the provider was still thinking: Meta already has its
            // answer for this wamid, so stop here rather than appending and sending
            // behind the redelivery's back. This is what keeps "one guest message,
            // at most one reply" true even when the deadline fires mid-turn.
            if (expired) return;

            // Asking has stopped being progress: the guest is stuck, or the extractor is, and one
            // more round is where an enquiry dies. A person now is worth more than another repeat.
            //
            // The fingerprint is "everything the pipeline currently knows about this enquiry" — the
            // open questions PLUS every money value the guest has stated. A turn that changes none
            // of it accomplished nothing, whether the enquiry is unfinished (the guest is stuck) or
            // already complete (the guest is only chatting). The second case is what a manual test
            // found: a finished enquiry answered "hmm", "not sure yet", "still thinking" and "maybe
            // later" with the same seven-line summary four times, because the old guard skipped
            // complete threads entirely. `ASK_LIMIT` stays as the hard ceiling.
            const stated = statedMoneyValues(outcome.trip);
            const stall = await store.noteOpenFields(
              phone,
              [...outcome.questions.map((q) => String(q.field)), ...Object.keys(stated).map((k) => `stated:${k}`)],
              STALL_LIMIT,
            );
            if (stall.stalled || assistantTurns(history) >= ASK_LIMIT) {
              const missing = outcome.questions.map((q) => q.field);
              // A stalled guest never asked for a person and nothing failed, so they are owed the
              // reason: the same list of open questions the human is about to be handed.
              const text = stall.stalled
                ? stalledHandoffReply(missing, language)
                : fallbackReply("handoff", language);
              await store.pause(phone, stall.stalled ? "stalled" : "asking_limit", {
                missingFields: missing.map(String),
                context: combinedText.slice(0, 200),
              });
              await store.append(phone, { role: "assistant", text });
              sending = true;
              await send({ to: phone, body: text });
              await store.markTold(phone);
              replied++;
              handoffs++;
              await markAllDone();
              return;
            }

            // A count the guest changed between two messages is a different quotation, and because
            // the extractor re-reads the whole transcript each turn the change would otherwise be
            // silent. Read back once, naming both numbers — the store records the new value as it
            // does so, so a guest who says nothing more is not asked again.
            const valueChanges = await store.noteStatedValues(phone, statedMoneyValues(outcome.trip));
            const changeNotice = changedValueNotice(valueChanges, language);

            let finalReplyText = outcome.reply;
            // A partner enquiry is not priced here. Their app takes `guestType` from the SESSION,
            // and a bot session is an anonymous guest, so any quotation built from this turn would
            // be a retail price for an agency — wrong on the number, and it would fill the review
            // queue with work that belongs on their own sign-in page. The guest is invited there
            // instead (see `partnerInvitationReply`), and the thread is parked so staff see it.
            const partnerType = outcome.trip.guestType?.value;
            if (outcome.quotationDraft && (partnerType === "agent" || partnerType === "instructor")) {
              const signInUrl = `${estimator.appBaseUrl ?? estimator.baseUrl ?? ""}/signin`;
              const text = partnerInvitationReply(outcome.trip.language?.value ?? null, signInUrl);
              await store.pause(phone, "partner_self_serve", { context: combinedText.slice(0, 200) });
              await store.append(phone, { role: "assistant", text });
              sending = true;
              await send({ to: phone, body: text });
              await store.markTold(phone);
              replied++;
              handoffs++;
              await markAllDone();
              return;
            }
            if (outcome.quotationDraft) {
              // ONE quotation per enquiry. The tool mints a fresh id and slug on every call, so a
              // thread that kept talking after its enquiry was complete left a new draft in the
              // studio for every turn — measured on production from a single manual test: thirteen
              // quotations for one guest. So the thread's own open quotation is reused, and the
              // state that belongs to it (its price, its customer-app session, its approval, its
              // notes) is carried over rather than reset.
              const candidate = await findOpenQuotationForPhone(phone);
              // A closed record is a *finished* enquiry — the guest restarted, or staff cancelled
              // it — and reusing it is how the next guest's enquiry inherited the previous one's
              // approval and price. The next enquiry mints its own quotation instead.
              const carried = candidate && candidate.status !== "cancelled" ? candidate : undefined;

              // The other half of the same rule: within an enquiry, a change to anything the price
              // is computed from invalidates the price and the approval given for it. The record
              // keeps its id — one enquiry, one quotation, so staff see a correction rather than a
              // second row — but "approved at ₱48,600" cannot survive the guest adding a night.
              const pricedFactsMoved = Boolean(
                carried && pricedFactsChanged(carried.bffTrip, outcome.quotationDraft.bffTrip),
              );

              const draft: HonoQuotationDraft = carried
                ? {
                    ...outcome.quotationDraft,
                    quoteId: carried.quoteId,
                    slug: carried.slug,
                    quotationUrl: carried.quotationUrl,
                    honoEditorUrl: carried.honoEditorUrl,
                    createdAt: carried.createdAt,
                    status: pricedFactsMoved ? "pending_hono_review" : carried.status,
                    confirmedAt: pricedFactsMoved ? undefined : carried.confirmedAt,
                    confirmedBy: pricedFactsMoved ? undefined : carried.confirmedBy,
                    staffNotes: carried.staffNotes,
                    aiConfirmedReply: pricedFactsMoved ? undefined : carried.aiConfirmedReply,
                    // Nulled, not left stale: a price for the previous numbers is worse than no
                    // price, because the studio would show it as this quotation's answer.
                    pricing: pricedFactsMoved ? null : (carried.pricing ?? null),
                    // Corrections accumulate across the enquiry. They are the measure of the
                    // extractor, and a correction does not stop counting because the guest
                    // mentioned one more night afterwards.
                    staffEdits: carried.staffEdits,
                    // The reservation is kept even when the trip moved: a folio that exists is a
                    // fact about the world, and hiding it would be the dangerous kind of tidy.
                    submission: carried.submission ?? null,
                    estimator: carried.estimator ?? null,
                    staffAlerts: pricedFactsMoved
                      ? [
                          ...outcome.quotationDraft.staffAlerts,
                          "The guest changed the trip after it was priced, so the price and the approval were dropped — review it again.",
                        ]
                      : outcome.quotationDraft.staffAlerts,
                  }
                : outcome.quotationDraft;
              draft.phone = phone;
              await saveQuotationDraft(draft);
              if (pricedFactsMoved) {
                // Nothing to say to the guest about this; the studio is where it matters. Logged so
                // a dropped approval is auditable from a deployment log, not only from the record.
                // eslint-disable-next-line no-console
                console.log("quotation reopened: priced facts changed", draft.quoteId);
              }
              // The enquiry is complete, so it becomes a quotation for staff to review — and the
              // guest is told that, not sent a price. See guestPendingQuotationNote.
              finalReplyText = `${outcome.reply}${changeNotice ? `\n\n${changeNotice}` : ""}${guestPendingQuotationNote()}`;
            } else if (changeNotice) {
              finalReplyText = `${outcome.reply}\n\n${changeNotice}`;
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
    await closeEnquiryQuotation(phone);
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

  // ---- Handoff inbox (a page, not JSON) -------------------------------------
  // The JSON routes above are for scripts; this is the one a person on shift actually opens. A
  // parked thread the team never sees is a guest who was told "a person is on it" and then
  // waited — so the list has to be a page reachable from the studio, not a curl command.
  //
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
    if (auth.role !== "staff") return c.json({ error: "forbidden", detail: "only staff may hand a thread back" }, 403);
    await store.resume(c.req.param("phone"));
    return c.redirect("/handoff");
  });

  app.post("/handoff/:phone/reset", async (c) => {
    const auth = staffSession(c);
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    if (auth.role !== "staff") return c.json({ error: "forbidden", detail: "only staff may clear a thread" }, 403);
    await closeEnquiryQuotation(c.req.param("phone"));
    await store.clear(c.req.param("phone"));
    return c.redirect("/handoff");
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

  /**
   * Who is looking, for the studio: the GAIS-shaped `Authorization: Bearer` key, the shared
   * header/query secret, or the demo session cookie set by `POST /login`.
   *
   * The cookie is the demo stand-in for `GAIS_API_KEY` (see demoAuth.ts). The header and query
   * paths are kept so existing scripted callers and pasted handoff links keep working — the
   * cookie is an addition, not a replacement.
   */
  function staffSession(c: Context): { ok: boolean; role: DemoRole | null } {
    const bearer = c.req.header("authorization");
    if (bearer?.startsWith("Bearer ") && sameSecret(bearer.slice(7).trim(), whatsAppConfig().verifyToken)) {
      return { ok: true, role: "staff" };
    }
    if (staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return { ok: true, role: "staff" };
    }
    const role = verifySession(getCookie(c, DEMO_SESSION_COOKIE));
    return role ? { ok: true, role } : { ok: false, role: null };
  }

  function setDemoSession(c: Context, role: DemoRole): void {
    setCookie(c, DEMO_SESSION_COOKIE, issueSession(role), {
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
  }

  // ---- Demo GAIS sign-in ---------------------------------------------------
  // A stand-in for the `Authorization: Bearer <GAIS_API_KEY>` of the edge spec §3.3. One key plus a
  // demo role; no accounts, no Odoo. See demoAuth.ts for why this exists and what it must not grow
  // into.
  //
  // Security headers on every HTML page: the studio and the handoff inbox print a guest's own words
  // (escaped, but escaping is one mistake away from not being), so the browser is told not to frame
  // these pages, not to sniff a type, and not to leak the URL onward. `secureHeaders` is Hono's own
  // middleware rather than a hand-rolled list — one place to read, one place to extend.
  app.use("*", secureHeaders({
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "same-origin",
    // The demo pages load fonts from Google and nothing else; the initial CSP would need tuning for
    // the inline scripts the studio ships, so it is left to the deployment rather than guessed here.
    contentSecurityPolicy: undefined,
  }));

  const loginLimiter = options.loginLimiter ?? createLoginAttemptLimiter();

  app.get("/login", (c) => c.html(renderLoginHtml(false, c.req.query("next") || "/quotes")));

  app.post("/login", async (c) => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const password = typeof body.password === "string" ? body.password : "";
    const rawNext = typeof body.next === "string" ? body.next : "";
    const nextPath = SAFE_NEXT_PREFIXES.some((prefix) => rawNext.startsWith(prefix)) ? rawNext : "/quotes";

    // Checked before the comparison, so a brute force is answered the same way however the key is
    // guessed. The address is the one the platform forwards; without a proxy header there is no
    // useful key and the limiter simply does nothing rather than lumping every caller together.
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "";
    if (ip) {
      const verdict = loginLimiter.check(ip);
      if (!verdict.allowed) {
        return c.html(renderLoginHtml(true, nextPath), 429, {
          "retry-after": String(verdict.retryAfterSeconds),
        });
      }
    }

    if (!sameSecret(password, staffAccessKey())) {
      if (ip) loginLimiter.fail(ip);
      return c.html(renderLoginHtml(true, nextPath), 401);
    }
    if (ip) loginLimiter.reset(ip);
    setDemoSession(c, isDemoRole(body.role) ? body.role : "staff");
    return c.redirect(nextPath);
  });

  // Signing out clears the cookie. There is no server-side session to revoke — the demo session is
  // a signed cookie and nothing else — so this is the whole of it, and saying so here is cheaper
  // than someone later assuming a revocation that does not exist.
  app.post("/logout", (c) => {
    deleteCookie(c, DEMO_SESSION_COOKIE, { path: "/" });
    return c.redirect("/login");
  });

  // Only a signed-in viewer may change their own demo role — otherwise this endpoint would mint
  // a valid session for anyone who found it, which is the entire login bypassed.
  app.post("/login/role", async (c) => {
    if (!verifySession(getCookie(c, DEMO_SESSION_COOKIE))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    setDemoSession(c, isDemoRole(body.role) ? body.role : "staff");
    return c.redirect("/quotes");
  });

  app.get("/quotes", async (c) => {
    const auth = staffSession(c);
    // A page, not an API: send an unauthenticated visitor to the sign-in form rather than a bare
    // 401 they cannot act on.
    if (!auth.ok) return c.redirect("/login");
    const all = await listQuotations();
    const latest = all[0]!;
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

  app.get("/q/:slug", async (c) => {
    const slug = c.req.param("slug");
    const found = await getQuotationByIdOrSlug(slug);
    // A miss is a miss. This route is unauthenticated, so anything else would be serving
    // one guest's booking to whoever asked.
    if (!found) return c.json({ error: "not_found" }, 404);

    // This route used to render OUR guest quotation page: a price computed from a table copied by
    // hand, shown to anyone holding the slug, with no staff approval anywhere in the path. It is
    // the thing the whole Đợt 1 change exists to retire. A published quotation now forwards to the
    // link the customer's own app minted, so there is exactly one place a guest reads a price, and
    // that price is Odoo's.
    const guestUrl = found.estimator?.guestUrl;
    if (found.status === "cancelled") {
      if (c.req.header("accept")?.includes("text/html")) {
        return c.html(
          `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotation Cancelled — Casa Escondida Anilao</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${themeCss()}
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
    }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 20px;
      padding: 44px 36px;
      max-width: 520px;
      width: 100%;
      box-shadow: var(--shadow);
      text-align: center;
    }
    .kicker {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #f43f5e;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 14px;
      color: var(--text);
    }
    p {
      font-size: 15.5px;
      line-height: 1.65;
      color: var(--muted);
      margin: 0 0 20px;
    }
    .footer {
      font-size: 13px;
      color: var(--muted);
      font-weight: 500;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">Casa Escondida Anilao</div>
    <h1>Quotation Cancelled</h1>
    <p>This quotation has expired or was cancelled by the resort reservation team. Please contact us on WhatsApp if you would like an updated quote.</p>
    <div class="footer">Anilao, Batangas, Philippines · Thank you for your understanding</div>
  </div>
</body>
</html>`,
          410
        );
      }
      return c.json({ error: "quotation_cancelled", detail: "this quotation was cancelled" }, 410);
    }
    if (guestUrl) return c.redirect(guestUrl);

    // Not published yet. 410 rather than 404: the record is real, and "there is nothing to show
    // here yet" is the truthful answer to someone who guessed or kept the link.
    if (c.req.header("accept")?.includes("text/html")) {
      return c.html(
        `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotation In Preparation — Casa Escondida Anilao</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${themeCss()}
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
    }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 20px;
      padding: 44px 36px;
      max-width: 520px;
      width: 100%;
      box-shadow: var(--shadow);
      text-align: center;
    }
    .kicker {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 12px;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 14px;
      color: var(--text);
    }
    p {
      font-size: 15.5px;
      line-height: 1.65;
      color: var(--muted);
      margin: 0 0 20px;
    }
    .box {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
      font-size: 14px;
      color: var(--text);
      margin-bottom: 24px;
      line-height: 1.6;
      text-align: left;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 22px;
    }
    .btn {
      display: block;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      border-radius: 999px;
      padding: 12px 18px;
      border: 2px solid var(--border);
      background: var(--card);
      color: var(--text);
      cursor: pointer;
    }
    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--primary-text);
    }
    .footer {
      font-size: 13px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">CASA ESCONDIDA RESORT &amp; DIVE CENTER</div>
    <h1>Your Quotation Is Being Prepared</h1>
    <p>Our reservations team is currently reviewing your trip details and checking resort availability to ensure the most accurate rates.</p>
    <div class="box">
      <strong>What happens next?</strong><br />
      You do not need to take any action. Once reviewed and confirmed by our team, your official quotation link will be sent directly to your WhatsApp.
    </div>
    <!-- Two ways forward, and both are real. A guest who followed an old link has a question that
         this page cannot answer alone, and the honest action is the channel they already reached us
         on — replying to the WhatsApp message — rather than a form or a phone number this service
         does not have. The second is for staff, who do land here from an old link pasted into a
         chat: the studio is where the quotation actually is. -->
    <div class="actions">
      <a class="btn btn-primary" href="https://wa.me/?text=${encodeURIComponent(
        "Hello Casa Escondida, I opened my quotation link and it says it is still being prepared.",
      )}" target="_blank" rel="noopener">Reply on WhatsApp instead of waiting</a>
      <a class="btn" href="/login">Staff sign-in — open this quotation in the studio</a>
    </div>
    <div class="footer">Anilao, Batangas, Philippines · Thank you for your patience</div>
  </div>
</body>
</html>`,
        410,
      );
    }

    return c.json(
      {
        error: "not_published",
        detail: "this quotation has no guest link yet — the resort team sends it after reviewing the price",
      },
      410,
    );
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
      // The simulated engine is in-process, so naming a URL here would be a fiction. Staff read
      // this line to know where a price came from.
      endpoint:
        estimator.kind === "simulated"
          ? "simulated engine (in-process)"
          : `${estimator.baseUrl ?? DEFAULT_ESTIMATOR_BASE_URL}${ESTIMATE_PATH}`,
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

  app.get("/v1/quotes", async (c) => {
    // Every quotation, each with the guest's name and phone number. Staff only.
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json({ quotations: await listQuotations() });
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
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const baseUrl = estimator.baseUrl ?? null;
    // "Cannot be priced" is only true of a REMOTE port with no URL. The simulated port has no URL
    // by design and is always reachable, so short-circuiting on `baseUrl` alone (which is what this
    // did before there were two ports) told staff the demo was misconfigured while it was pricing
    // perfectly well — a badge that lies in the one configuration the demo runs in.
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
  //
  // Staff-only, and until 2026-09-26 it was not: this route CREATES and SAVES a quotation from a
  // `trip` the caller supplies, with no credential at all. `/v1/quotes/compute` is deliberately open
  // because it is stateless — it prices what it was handed and stores nothing — and that argument
  // does not carry over to a route that writes a guest's name, phone and dates into the store for
  // anyone who can reach the URL. Nothing in this repo or its tests calls it (the bot saves its own
  // draft in-process through `/v1/converse`), so locking it costs no caller.
  app.post("/v1/quotes/submit", async (c) => {
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
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
    const saved = await saveQuotationDraft(recalculateQuotationTotals(draft));
    return c.json({
      ok: true,
      quotation: saved,
      estimatePreview: buildEstimatePreview(saved),
    });
  });

  app.get("/v1/quotes/:id", async (c) => {
    // Carries the guest's name and phone plus the Odoo/GAIS envelope, so staff only.
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const found = await getQuotationByIdOrSlug(c.req.param("id"));
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.json({ quotation: found, estimatePreview: buildEstimatePreview(found) });
  });

  app.put("/v1/quotes/:id", async (c) => {
    // A write, and it edits what the guest will be shown. Staff only.
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Partial<HonoQuotationDraft>;
    const merged: HonoQuotationDraft = {
      ...existing,
      ...body,
      quoteId: existing.quoteId,
      lineItems: Array.isArray(body.lineItems) ? body.lineItems : existing.lineItems,
      quotationUrl: body.quotationUrl || existing.quotationUrl,
    };
    const saved = await saveQuotationDraft(merged);
    return c.json({ ok: true, quotation: saved, estimatePreview: buildEstimatePreview(saved) });
  });

  app.post("/v1/quotes/:id/confirm", async (c) => {
    // Confirming commits the price and can trigger an outbound AI reply, so staff only.
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    // Approving is approving a *price*. A quotation with no engine pricing on it has no number to
    // approve, and letting the click through is how a record ends up marked "approved" while the
    // studio shows "not priced yet" beside it — measured on production, on a record whose approval
    // had been inherited from a different enquiry (`QT-1120-MIGU-…`). Refused with a reason the
    // studio can print, not a 500.
    if (!existing.pricing) {
      return c.json(
        {
          ok: false,
          reason: "not_priced",
          detail: "this quotation has no price yet — price the trip on the customer's estimator, then approve it",
        },
        409,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as Partial<HonoQuotationDraft>;

    // The page posts back the whole draft it rendered, `bffTrip` included. So approving is also a
    // claim about a *trip* — and a tab that has been open while an edit was saved elsewhere would
    // otherwise approve one trip against another trip's price. The rule is the same one the channel
    // applies when a guest changes a figure mid-enquiry (`pricedFactsChanged`): a price describes
    // the facts it was computed from, and nothing else.
    const posted = BffTrip.safeParse((body as { bffTrip?: unknown }).bffTrip);
    const correctedFields =
      posted.success && existing.bffTrip ? diffBffTrip(existing.bffTrip, posted.data) : [];
    if (posted.success && existing.bffTrip && pricedFactsChanged(existing.bffTrip, posted.data)) {
      return c.json(
        {
          ok: false,
          reason: "trip_changed",
          detail:
            "the trip changed after it was priced — price it again on the customer's estimator, then approve",
          fields: correctedFields,
        },
        409,
      );
    }

    const merged: HonoQuotationDraft = {
      ...existing,
      ...body,
      quoteId: existing.quoteId,
      status: "confirmed_by_hono",
      confirmedAt: new Date().toISOString(),
      confirmedBy: "Hono Reservation Studio",
      lineItems: Array.isArray(body.lineItems) ? body.lineItems : existing.lineItems,
      quotationUrl: body.quotationUrl || existing.quotationUrl,
      // The stored trip wins: this route decides *whether* the quotation is approved, not what the
      // trip is. `/trip` is the editing path, and it re-prices.
      bffTrip: existing.bffTrip,
    };
    // What the approver's copy said differently, as field paths — the same measurement `/trip`
    // records, so a correction is counted even when it arrives with the approval rather than with a
    // save. Only reached when the priced facts agree, so this is a note (a name, a comment) and not
    // a price-affecting change.
    if (correctedFields.length > 0) {
      merged.staffEdits = [
        ...(existing.staffEdits ?? []),
        { at: new Date().toISOString(), fields: correctedFields, source: "approve" },
      ];
    }
    const saved = await saveQuotationDraft(merged);
    let provider: ExtractProvider | undefined;
    try {
      provider = options.provider ?? createProviderFromEnv();
    } catch {}
    const aiReply = await synthesizeConfirmedQuotationReply(saved, provider);
    saved.aiConfirmedReply = aiReply;
    await saveQuotationDraft(saved);
    return c.json({ ok: true, quotation: saved, aiReply, estimatePreview: buildEstimatePreview(saved) });
  });

  /**
   * Cancel / Archive a quotation. Staff only.
   */
  app.post("/v1/quotes/:id/cancel", async (c) => {
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    existing.status = "cancelled";
    existing.updatedAt = new Date().toISOString();
    const saved = await saveQuotationDraft(existing);
    return c.json({ ok: true, quotation: saved });
  });


  /**
   * Remove the duplicate drafts the pre-`findOpenQuotationForPhone` bug left in the store.
   *
   * One guest, thirteen quotations, four of them inside the same minute: the queue in the studio
   * was unworkable and every row looked current. The bug is fixed; this clears the backlog already
   * sitting in Redis.
   *
   * It is a POST with an explicit `confirm`, and **dry by default**, because this is the only route
   * in the product that deletes a business record. What may go is decided in
   * `duplicateQuotationIds()`, so the dry run and the delete share one code path, and the response
   * names every record it touched — a cleanup nobody can audit is a cleanup nobody should run.
   *
   * It also takes `{ ids: [...] }`, for leftovers that are not duplicates of anything (probes, and
   * the drafts a manual test leaves for a phone nobody will text from again). Naming records
   * explicitly is the more dangerous form, so the same three protections apply — see
   * `deletableByCleanup` — and the answer says which names were refused and why.
   */
  app.post("/v1/quotes/cleanup-duplicates", async (c) => {
    if (!staffSession(c).ok) return c.json({ error: "unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as { confirm?: unknown; ids?: unknown };
    const all = await listQuotations();
    const named = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
    const considered = named ? all.filter((q) => named.has(q.quoteId)) : all;
    const doomed = named ? considered.filter(deletableByCleanup) : duplicateQuotationIds(all);
    const refused = named ? considered.filter((q) => !deletableByCleanup(q)) : [];
    const notFound = named ? [...named].filter((id) => !all.some((q) => q.quoteId === id)) : [];

    if (body.confirm !== true) {
      return c.json({
        ok: true,
        dryRun: true,
        total: all.length,
        wouldRemove: doomed.map((q) => ({
          quoteId: q.quoteId,
          phone: q.phone ?? null,
          guestName: q.guestName,
          createdAt: q.createdAt,
        })),
        refused: refused.map((q) => q.quoteId),
        notFound,
        detail: "nothing was removed — POST {confirm: true} to apply",
      });
    }

    const removed: string[] = [];
    for (const q of doomed) {
      if (await removeQuotation(q.quoteId)) removed.push(q.quoteId);
    }
    return c.json({
      ok: true,
      dryRun: false,
      total: all.length,
      removed,
      refused: refused.map((q) => q.quoteId),
      notFound,
      kept: all.length - removed.length,
    });
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
   *
   * It refuses a quotation that is **already published**, for the same reason the trip-edit route
   * does: the guest is holding a link to a frozen revision, and re-pricing the record underneath it
   * makes the studio and the guest's link disagree about the same quotation. Found while setting up
   * a second, `simulated` deployment for the demo: both deployments share one KV store, so the
   * simulated tab could re-price a quotation the other tab had published — and the same thing
   * happens to anyone who reopens a published quotation and clicks Price.
   */
  app.post("/v1/quotes/:id/sync-estimate", async (c) => {
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (existing.estimator?.sharedAt) {
      return c.json(
        {
          ok: false,
          reason: "already_shared",
          detail:
            "this quotation is already published, so its price is frozen on the guest's link — re-pricing it here would make the studio and the link disagree. Start a new quotation instead.",
          guestUrl: existing.estimator.guestUrl,
        },
        409,
      );
    }

    // Their API is session-scoped, so a re-price has to arrive on the same session the scenario was
    // created in — otherwise their BFF is looking at a different draft and the id it returns is a
    // second one. The id and cookie are replayed from the quotation record.
    const session = { id: existing.estimator?.id ?? null, cookie: existing.estimator?.cookie ?? null };
    const result = await estimator.sendEstimate(existing.bffTrip, session);
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

    const pricing = estimateToRecord(existing, result);
    await saveQuotationDraft({ ...existing, ...pricing });

    return c.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      endpoint:
        estimator.kind === "simulated"
          ? "simulated engine (in-process)"
          : `${estimator.baseUrl ?? DEFAULT_ESTIMATOR_BASE_URL}${ESTIMATE_PATH}`,
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
      /** The same answer in the shape the studio and the Ops Sheet draw from. */
      pricing: pricing.pricing,
      estimatePreview: buildEstimatePreview(existing),
    });
  });

  /**
   * Save the trip staff edited in the studio, then re-price it — on the same engine scenario.
   *
   * Why this route has to exist at all: the estimator's answer is only as right as the `BffTrip` it
   * was given, and that payload is built from a WhatsApp conversation. A guest who says "the kids
   * are in the second room" or "make it a deluxe" gives facts the extractor cannot place, and until
   * this route existed the only way to fix them was to hand-edit the price table — which is how a
   * quotation stops agreeing with the engine that priced it. Here the fix is to correct the trip
   * and let the engine answer again, so there is still exactly one source of the price.
   *
   * Three refusals, all of them safety rather than convenience:
   *
   *   * a trip that fails our own contract mirror is **422**, before anything is asked of the
   *     engine — their `fillTrip` is the authority, and our job is to not send it rubbish;
   *   * an edit **after publish** is refused, because the guest is holding a link to what staff
   *     approved and changing it underneath them is the silent re-quote their Q-005 forbids;
   *   * the edit **drops the approval** (`status`), because approval is a statement about a
   *     specific trip. Keeping it would let a trip nobody has looked at be published by one click
   *     of a button that says "publish", which is precisely the failure the publish gate exists for.
   */
  app.post("/v1/quotes/:id/trip", async (c) => {
    if (!staffSession(c).ok) return c.json({ error: "unauthorized" }, 401);
    const existing = await getQuotationByIdOrSlug(c.req.param("id"));
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (!existing.bffTrip) {
      return c.json({ ok: false, reason: "no_trip", detail: "this quotation has no trip to edit" }, 409);
    }
    if (existing.estimator?.sharedAt) {
      return c.json(
        {
          ok: false,
          reason: "already_shared",
          detail: "this quotation is already published; a published trip must not change — start a new quotation instead",
          guestUrl: existing.estimator.guestUrl,
        },
        409,
      );
    }

    const body = (await c.req.json().catch(() => null)) as { trip?: unknown } | null;
    const parsed = BffTrip.safeParse(body?.trip);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          reason: "invalid_trip",
          detail: "the edited trip does not match the estimator contract",
          fields: parsed.error.issues.map((i) => i.path.join(".") || "(root)"),
        },
        422,
      );
    }

    // Our mirror of their `fillTrip` rules, run here so a bad edit is a message in the studio
    // rather than an Odoo 422 buried in a log. Errors refuse; warnings travel to the caller.
    const precheck = validateBffTripPrecheck(parsed.data);
    if (precheck.some((i) => i.level === "error")) {
      return c.json({ ok: false, reason: "trip_not_priceable", issues: precheck }, 422);
    }

    const session = { id: existing.estimator?.id ?? null, cookie: existing.estimator?.cookie ?? null };
    const result = await estimator.updateEstimate(session, parsed.data);
    if (!result.ok) {
      const status = result.reason === "rejected" ? 422 : result.reason === "not_configured" ? 503 : 502;
      return c.json({ ok: false, reason: result.reason, detail: result.detail, fields: result.fields }, status);
    }

    const recorded = estimateToRecord(existing, result);
    // What staff actually changed, as field paths. This is the measurement of the extractor the
    // pipeline never had: a quotation that was priced and published says the FLOW worked, not that
    // the bot's payload was right. Recorded here rather than in the studio page so a correction is
    // counted even if the tab is closed before anything renders.
    const changedFields = diffBffTrip(existing.bffTrip, parsed.data);
    const staffEdits = [...(existing.staffEdits ?? [])];
    if (changedFields.length > 0) {
      staffEdits.push({ at: new Date().toISOString(), fields: changedFields, source: "trip" });
    }
    // One save, and it is the edited trip that goes in: the price, the scenario id the engine just
    // answered with, and the corrected trip all have to move together, or the quotation ends up
    // holding one scenario's price beside another scenario's id.
    //
    // The approval is dropped with the trip it was given for, and `aiConfirmedReply` goes with it:
    // it is a message written about the old numbers, and sending it after an edit would quote a
    // price the guest is no longer being offered.
    const saved = await saveQuotationDraft({
      ...existing,
      ...recorded,
      bffTrip: parsed.data,
      staffEdits,
      status: "pending_hono_review",
      confirmedAt: undefined,
      confirmedBy: undefined,
      aiConfirmedReply: undefined,
    });

    return c.json({
      ok: true,
      editedAt: new Date().toISOString(),
      /** The field paths this edit changed, so the page can say what it did rather than "done". */
      changedFields,
      issues: [...precheck, ...result.issues.map((i) => ({ level: "warn", source: "estimator", detail: i }))],
      computedAt: result.computedAt,
      sample: result.sample,
      mode: result.mode,
      pricing: recorded.pricing,
      quotation: saved,
    });
  });

  /**
   * Turn an engine answer into the quotation's recorded price.
   *
   * Shared by the first price and by every staff edit, because "what this quotation costs" has to
   * be decided in one place: recording it is what makes the per-guest cards, the Ops Sheet and the
   * agent comparison survive a reload, and what stops a quotation from meaning two different things
   * depending on which staff member has it open.
   *
   * It returns the two fields to write rather than writing them, because an edit has to be ONE
   * save: writing the price here and the edited trip afterwards would take the old `estimator`
   * record from the copy the route read, and silently put back the scenario id the engine just
   * handed over.
   *
   * `status`/`confirmedAt`/`aiConfirmedReply` are deliberately absent. Dropping an approval belongs
   * to the caller that invalidated the trip, not to the act of pricing — a re-price of the same trip
   * (the `/sync-estimate` button) must not silently un-approve a quotation a person already read.
   */
  function estimateToRecord(
    existing: HonoQuotationDraft,
    result: Extract<Awaited<ReturnType<typeof estimator.sendEstimate>>, { ok: true }>,
  ): Pick<HonoQuotationDraft, "pricing" | "estimator"> {
    return {
      pricing: normalizePricing({
        model: result.model,
        retailModel: result.retailModel,
        source: estimator.kind,
        sample: result.sample,
        mode: result.mode,
        role: result.role,
        computedAt: result.computedAt,
      }),
      estimator: {
        id: result.id ?? existing.estimator?.id ?? null,
        cookie: result.sessionCookie ?? existing.estimator?.cookie ?? null,
        // Never reset by a re-price: a committed seq is what their `submit` will be addressed to,
        // and their link always resolves to the newest saved revision (Q-005).
        seq: existing.estimator?.seq ?? null,
        guestUrl: existing.estimator?.guestUrl ?? null,
        sharedAt: existing.estimator?.sharedAt ?? null,
      },
    };
  }

  /**
   * Publish the quotation: freeze it as a revision on the customer's app and mint the guest link.
   *
   * This is the only place a guest link is ever created, and it is a **human** action taken from
   * the studio. The bot never calls it: a price reaches a guest because a person looked at it. That
   * is the whole correction — the bot used to append its own link the moment it had enough
   * information, which is a price quoted to a customer before anyone at the resort saw it.
   *
   * Three things it will not do:
   *
   *   * publish a quotation staff have not approved (`status`), because approval is the decision;
   *   * publish a **sample** price silently. Fixture and simulated prices are captured numbers, and
   *     sending one to a guest is the failure the whole `sample` label exists to prevent — so it
   *     takes an explicit acknowledgement, recorded by the caller;
   *   * publish twice. Their link always resolves to the newest saved revision, so a second publish
   *     would silently change what a guest already holds (their Q-005: don't re-save a shared
   *     quote). A re-price after sharing means a new quotation and a new link.
   */
  app.post("/v1/quotes/:id/publish", async (c) => {
    if (!staffSession(c).ok) return c.json({ error: "unauthorized" }, 401);
    const existing = await getQuotationByIdOrSlug(c.req.param("id"));
    if (!existing) return c.json({ error: "not_found" }, 404);

    if (!existing.bffTrip) {
      return c.json({ ok: false, reason: "no_trip", detail: "this quotation has no trip to send" }, 409);
    }
    if (existing.status !== "confirmed_by_hono") {
      return c.json({ ok: false, reason: "not_approved", detail: "approve the quotation before publishing it" }, 409);
    }
    // Guarded on `sharedAt`, not on the link: a publish that resolved no host (their app is not
    // deployed anywhere we can point at) has still frozen a revision on their side, and a second
    // publish would move what a guest is already holding. Their Q-005.
    if (existing.estimator?.sharedAt) {
      return c.json(
        {
          ok: false,
          reason: "already_shared",
          detail: "this quotation is already published; edit nothing and publish a new quotation instead",
          guestUrl: existing.estimator.guestUrl,
        },
        409,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as { acknowledgeSample?: boolean };
    if (existing.pricing?.sample && body.acknowledgeSample !== true) {
      return c.json(
        {
          ok: false,
          reason: "sample_not_acknowledged",
          detail: "this price came from sample data — acknowledge it before a guest can be sent the link",
        },
        409,
      );
    }

    const session = { id: existing.estimator?.id ?? null, cookie: existing.estimator?.cookie ?? null };
    if (!session.id) {
      return c.json({ ok: false, reason: "not_priced", detail: "price the quotation before publishing it" }, 409);
    }

    const committed = await estimator.commit(session, existing.bffTrip);
    if (!committed.ok) {
      const status = committed.reason === "not_configured" ? 503 : 502;
      return c.json({ ok: false, reason: committed.reason, detail: committed.detail }, status);
    }

    const shared = await estimator.share({ ...session, id: session.id });
    if (!shared.ok) {
      // `no_snapshot` here would mean their commit and their share disagree, which is their bug to
      // hear about rather than something to paper over with a link of our own.
      const status = shared.reason === "not_configured" ? 503 : shared.reason === "no_snapshot" ? 502 : 502;
      return c.json({ ok: false, reason: shared.reason, detail: shared.detail }, status);
    }

    // Their `url` is relative; only we know which host the guest should be sent to. Usually the
    // API host serves the guest pages too; their dev setup splits them, hence `appBaseUrl`.
    const guestUrl = absoluteUrl(shared.url, estimator.appBaseUrl ?? estimator.baseUrl);
    const saved = await saveQuotationDraft({
      ...existing,
      estimator: {
        ...session,
        seq: committed.seq,
        guestUrl,
        sharedAt: new Date().toISOString(),
      },
    });

    return c.json({
      ok: true,
      guestUrl,
      seq: committed.seq,
      expiresAt: shared.expiresAt,
      sample: Boolean(existing.pricing?.sample),
      quotation: saved,
    });
  });

  /**
   * The Ops Sheet for a quotation's stay, one sheet per day.
   *
   * Deliberately a page of its own rather than a tab inside the studio: it is the sheet a person
   * prints and carries, it has to fit on paper, and — the part that matters — it carries **no
   * money at all**. Front desk, housekeeping, dive centre, kitchen and transfers are the five
   * blocks the morning meeting works from (customer's F06), and a price on it would be a price
   * leaked onto a sheet that gets left on a counter.
   */
  app.get("/quotes/:id/ops", async (c) => {
    const auth = staffSession(c);
    const id = c.req.param("id");
    if (!auth.ok) return c.redirect(`/login?next=${encodeURIComponent(`/quotes/${id}/ops`)}`);
    const found = await getQuotationByIdOrSlug(id);
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.html(renderOpsSheetHtml(found));
  });

  /**
   * Ask the booking engine for a reservation.
   *
   * The state machine is the customer's own (`docs/flows/F07-booking.md` D2), and the ordering here
   * is what makes it safe rather than decorative:
   *
   *  1. one live submission per quotation — `pending`, `confirmed` and `unknown` all lock it, and
   *     only `failed` may be retried. Odoo issues no idempotency key, so our own record is the lock.
   *  2. the `pending` row is written BEFORE the engine is called. A crash between the two leaves a
   *     locked quotation, which is the safe direction: a quote nobody can double-book beats one
   *     that books twice.
   *  3. `unknown` is its own state, not a failure. A timeout may have created a folio, and telling
   *     a guest "we could not book it" when they are booked is worse than telling them to wait.
   *
   * What this route does NOT do: decide whether live booking is allowed. That gate belongs to the
   * engine (`closed`), because only it knows whether it is pointed at Odoo at all.
   */
  const ReservationContact = z
    .object({
      name: z.string().min(1).max(120),
      email: z.string().min(3).max(200),
      phone: z.string().max(40).optional(),
    })
    .strict();

  app.post("/v1/quotes/:id/submit", async (c) => {
    if (!staffSession(c).ok) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);

    // Booking belongs to the owner of the quotation, on their app — their Q-004 says an anonymous
    // guest cannot reserve, and Q-014 says the person a link was sent to cannot either. Once the
    // price comes from their engine, the guest books through their link, so this route is for the
    // simulated engine only (local dev and tests), where there is no guest app to book on.
    if (estimator.kind === "remote") {
      return c.json(
        {
          ok: false,
          reason: "wrong_place",
          detail: "reservations are taken on the quotation's own page — publish it and send the guest their link",
        },
        409,
      );
    }

    const parsed = ReservationContact.safeParse(await c.req.json().catch(() => ({})));
    // `fields` carries paths only, never values: a 422 body with the guest's email in it is a
    // guest's email in a log aggregator.
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Check the contact details", fields: parsed.error.issues.map((i) => `contact.${i.path.join(".")}`) },
        422,
      );
    }
    const contact = parsed.data;
    if (!contact.email.includes("@")) {
      return c.json({ ok: false, error: "Check the contact details", fields: ["contact.email"] }, 422);
    }

    const previous = existing.submission ?? null;
    if (previous && previous.state !== "failed") {
      return c.json({ ok: false, error: "A reservation is already recorded for this quote", reason: "already", submission: previous }, 409);
    }
    if (!existing.bffTrip) {
      return c.json({ ok: false, error: "This quotation has no trip to book", reason: "no_trip" }, 409);
    }

    const now = () => new Date().toISOString();
    const pending: QuotationSubmission = {
      state: "pending",
      seq: (previous?.seq ?? 0) + 1,
      contact: { name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone?.trim() || null },
      folioId: null,
      orderIds: null,
      sample: true,
      error: null,
      createdAt: now(),
      updatedAt: now(),
    };
    // Written first, on purpose — see the ordering note above.
    await saveQuotationDraft({ ...existing, submission: pending });

    const result = await estimator.submit({
      trip: existing.bffTrip,
      contact: pending.contact,
      // Addressed to the scenario they priced, on the session that owns it. Both are null for the
      // simulated engine, which needs neither.
      estimatorId: existing.estimator?.id ?? null,
      estimatorCookie: existing.estimator?.cookie ?? null,
      estimatorSeq: existing.estimator?.seq ?? null,
    });
    const settled: QuotationSubmission = result.ok
      ? { ...pending, state: "confirmed", folioId: result.folioId, orderIds: result.orderIds, sample: result.sample, updatedAt: now() }
      : {
          ...pending,
          // `unknown` keeps its own state; everything the engine refused (including "closed")
          // is a failure the caller may retry once the reason is addressed.
          state: result.reason === "unknown" ? "unknown" : "failed",
          error: result.reason,
          updatedAt: now(),
        };
    await saveQuotationDraft({ ...existing, submission: settled });

    if (result.ok) return c.json({ ok: true, submission: settled });
    const status = result.reason === "closed" ? 503 : result.reason === "unknown" ? 502 : 502;
    return c.json({ ok: false, reason: result.reason, detail: result.detail, submission: settled }, status);
  });

  app.get("/v1/quotes/:id/submission", async (c) => {
    if (!staffSession(c).ok) return c.json({ error: "unauthorized" }, 401);
    const found = await getQuotationByIdOrSlug(c.req.param("id"));
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, submission: found.submission ?? null });
  });

  /**
   * Send the prepared quotation to the guest's WhatsApp.
   *
   * Two gates, in this order, because each one is a different mistake:
   *
   *   1. **Approved** — the price a guest receives is a staff decision, not the bot's draft.
   *   2. **Published** — the message carries the link to the guest's own quotation page, and that
   *      link only exists once staff have published. Without this gate the message fell back to our
   *      retired `/q/<slug>` page, which answers 410: a guest would have received a dead link.
   *      Measured on a real quotation (2026-09-28) — the send was only stopped by Meta refusing an
   *      unlisted test number.
   *
   * The number is checked before it is sent (`checkRecipient`), and Meta's refusal is translated
   * (`explainMetaError`) rather than pasted into the studio: a receptionist can act on "this number
   * isn't on the test list" and cannot act on `{"error":{"code":131030,...}}`.
   */
  app.post("/v1/quotes/:id/send-whatsapp", async (c) => {
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);

    if (existing.status !== "confirmed_by_hono") {
      return c.json(
        { ok: false, reason: "not_approved", error: "Approve the quotation before sending it to the guest." },
        409,
      );
    }
    const guestUrl = existing.estimator?.guestUrl ?? null;
    if (!existing.estimator?.sharedAt || !guestUrl) {
      return c.json(
        {
          ok: false,
          reason: "not_published",
          error:
            "Publish the quotation first — the message carries the link to the guest's own quotation page, and that link does not exist yet.",
        },
        409,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as { phone?: string };
    const recipient = checkRecipient(body.phone || existing.phone || "");
    if (!recipient.ok) {
      return c.json({ ok: false, reason: recipient.code, error: recipient.message }, 400);
    }

    // The message is rebuilt from the record every time rather than reusing `aiConfirmedReply`:
    // that field was prepared at Approve time, before Publish, so it still contains the old
    // self-computed table and no link.
    let provider: ExtractProvider | undefined;
    try {
      provider = options.provider ?? createProviderFromEnv();
    } catch {
      // No provider configured: the deterministic message is complete on its own.
    }
    const text = await synthesizeConfirmedQuotationReply(existing, provider);
    const send = options.sendWhatsApp ?? createWhatsAppSender(whatsAppConfig());
    try {
      await send({ to: recipient.phone, body: text });
      return c.json({ ok: true, phone: recipient.phone, body: text });
    } catch (err) {
      const meta = err instanceof WhatsAppSendError ? err : null;
      // eslint-disable-next-line no-console
      console.error(`[casa-bff] whatsapp send failed for ${id}: ${meta?.detail ?? String(err)}`);
      return c.json(
        { ok: false, reason: "send_failed", error: explainMetaError(meta?.code, meta?.detail ?? String(err)) },
        502,
      );
    }
  });

  return app;
}
