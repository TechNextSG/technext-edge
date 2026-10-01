import { loadEnv, type Env } from "../env.ts";
import {
  detectLanguage,
  fallbackReply,
  stalledHandoffReply,
  partnerInvitationReply,
  changedValueNotice,
  wantsHuman,
  declinesPartner,
  classifyEnquiry,
  ASK_LIMIT,
  STALL_LIMIT,
  maskForLogging,
  pathsRestatedByGuest,
  type ConversationTurn,
  type ExtractProvider,
  type GuestLanguage,
  type Trip,
} from "../../../ai/src/index.ts";
import {
  converseWithQuotation,
  diffBffTrip,
  pricedFactsChanged,
  type HonoQuotationDraft,
} from "../../../quotation/src/index.ts";
import {
  saveQuotationDraft,
  findOpenQuotationForPhone,
} from "../store/quotationStore.ts";
import type { ConversationStore } from "../store/conversationStore.ts";
import type { EstimatorPort } from "./estimatorPort.ts";
import {
  type InboundTextMessage,
  type WhatsAppSendText,
  type WhatsAppConfig,
} from "./whatsapp.ts";

// How long a parked thread stays quiet after the guest was told a person is on it.
export const HOLD_REPEAT_MS = 10 * 60 * 1000;

/** How many replies the bot has already taken in this thread. */
export function assistantTurns(history: ConversationTurn[]): number {
  return history.filter((turn) => turn.role === "assistant").length;
}

/**
 * The language to hold a guest in when there is no trip to render one from. Read
 * off the guest's own turns only.
 */
export function guestLanguage(history: ConversationTurn[]): GuestLanguage {
  return detectLanguage(
    history
      .filter((turn) => turn.role === "guest")
      .map((turn) => turn.text)
      .join("\n"),
  );
}

/**
 * An absolute guest link, from the relative path their API returns plus the host we called.
 */
export function absoluteUrl(url: string, baseUrl: string | undefined): string | null {
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
 */
export function statedMoneyValues(trip: Trip): Record<string, string | number | boolean> {
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
 * The WhatsApp number a guest should reply to, or null when this deployment has not been told one.
 */
export function resortWhatsAppNumber(env: Env = loadEnv()): string | null {
  const raw = (env.RESORT_WHATSAPP_NUMBER ?? "").replace(/[^\d]/g, "");
  return raw.length >= 8 && raw.length <= 15 ? raw : null;
}

/**
 * What the guest is told when their enquiry is complete but no price has been published yet.
 */
export function guestPendingQuotationNote(): string {
  return "\n\nOur reservations team is preparing your quotation now, and will send it to you here shortly.";
}

export function isResetCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return /^(reset|start\s*over|restart|重置|重新开始)$/i.test(trimmed);
}

export const RESET_REPLY: Record<GuestLanguage, string> = {
  en: "Conversation reset! Welcome to Casa Escondida — our dive-and-stay resort in Anilao, Batangas.\nCould you share your check-in date, how many nights, how many guests, and a name for the booking?",
  zh: "对话已重置！欢迎来到 Casa Escondida 潜水度假村。\n请告诉我入住日期、住几晚、几位客人以及预订姓名。",
};

/**
 * Close the quotation an enquiry left open, because the enquiry is over.
 */
export async function closeEnquiryQuotation(phone: string): Promise<string | null> {
  if (!phone) return null;
  const open = await findOpenQuotationForPhone(phone);
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

export interface WhatsAppTurnDeps {
  store: ConversationStore;
  provider: ExtractProvider;
  sendWhatsApp: WhatsAppSendText;
  estimator: EstimatorPort;
  config: WhatsAppConfig;
}

export interface TurnBatchItem {
  message: InboundTextMessage;
  fenceToken: string;
}

export interface TurnResult {
  replied: number;
  failed: number;
  handoffs: number;
}

/**
 * Executes a single inbound turn batch for one phone number under phone lock.
 */
export async function processPhoneTurnBatch(
  phone: string,
  batch: TurnBatchItem[],
  deps: WhatsAppTurnDeps,
): Promise<TurnResult> {
  const { store, provider: model, sendWhatsApp: send, estimator, config } = deps;
  let replied = 0;
  let failed = 0;
  let handoffs = 0;

  await store.withPhoneLock(phone, async () => {
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

        const parked = await store.paused(phone);
        const intent = classifyEnquiry(combinedText);
        const askedForHuman = wantsHuman(combinedText);
        const escalate = askedForHuman || intent === "escalate_now";
        const notBooking = !escalate && intent === "not_booking";

        if (parked?.reason === "partner_self_serve") {
          await store.resume(phone);
        }
        if ((parked && parked.reason !== "partner_self_serve") || escalate || notBooking) {
          if (parked && !(await store.needsTelling(phone, HOLD_REPEAT_MS))) {
            await markAllDone();
            return;
          }
          const reason =
            parked?.reason ??
            (askedForHuman ? "guest_asked_for_human" : escalate ? "complaint_or_cancel" : "not_booking");
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

        const elapsedMs = Date.now() - turnStartedAt;
        const synthesisBudgetMs = Math.max(1_500, config.turnTimeoutMs - elapsedMs - 1_000);
        const outcome = await converseWithQuotation(history, model, { synthesisBudgetMs });

        if (expired) return;

        const stated = statedMoneyValues(outcome.trip);
        const stall = await store.noteOpenFields(
          phone,
          [...outcome.questions.map((q) => String(q.field)), ...Object.keys(stated).map((k) => `stated:${k}`)],
          STALL_LIMIT,
        );
        if (stall.stalled || assistantTurns(history) >= ASK_LIMIT) {
          const missing = outcome.questions.map((q) => q.field);
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

        const valueChanges = await store.noteStatedValues(phone, statedMoneyValues(outcome.trip));
        const changeNotice = changedValueNotice(valueChanges, language);

        let finalReplyText = outcome.reply;
        const partnerType = outcome.trip.guestType?.value;
        const partnerDeclined = history.some((t) => t.role === "guest" && declinesPartner(t.text));
        if (
          outcome.quotationDraft &&
          !partnerDeclined &&
          (partnerType === "agent" || partnerType === "instructor")
        ) {
          const signInUrl = absoluteUrl("/signin", estimator.appBaseUrl ?? estimator.baseUrl);
          if (signInUrl) {
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
          // eslint-disable-next-line no-console
          console.warn(
            "[casa-bff] partner enquiry invited nowhere: no absolute app base URL is configured (ESTIMATOR_APP_BASE_URL / ESTIMATOR_BASE_URL)",
          );
        }

        if (outcome.quotationDraft) {
          const candidate = await findOpenQuotationForPhone(phone);
          const carried = candidate && candidate.status !== "cancelled" ? candidate : undefined;

          const botTrip = outcome.quotationDraft.bffTrip;
          const correctedTrip = carried?.bffTrip;
          const changedPaths = correctedTrip && botTrip ? diffBffTrip(correctedTrip, botTrip) : [];
          const humanCorrected = (carried?.staffEdits ?? []).length > 0;
          const restated = humanCorrected
            ? pathsRestatedByGuest(changedPaths, outcome.trip, combinedText)
            : changedPaths;
          const keepCorrectedTrip = Boolean(
            carried && correctedTrip && humanCorrected && changedPaths.length > 0 && restated.length === 0,
          );
          const keptPricedDifference = keepCorrectedTrip && pricedFactsChanged(correctedTrip, botTrip);
          const pricedFactsMoved =
            !keepCorrectedTrip && Boolean(carried && pricedFactsChanged(correctedTrip, botTrip));

          const draft: HonoQuotationDraft = carried
            ? {
                ...outcome.quotationDraft,
                quoteId: carried.quoteId,
                slug: carried.slug,
                quotationUrl: carried.quotationUrl,
                honoEditorUrl: carried.honoEditorUrl,
                createdAt: carried.createdAt,
                bffTrip: keepCorrectedTrip ? correctedTrip : botTrip,
                status: pricedFactsMoved ? "pending_hono_review" : carried.status,
                confirmedAt: pricedFactsMoved ? undefined : carried.confirmedAt,
                confirmedBy: pricedFactsMoved ? undefined : carried.confirmedBy,
                staffNotes: carried.staffNotes,
                aiConfirmedReply: pricedFactsMoved ? undefined : carried.aiConfirmedReply,
                pricing: pricedFactsMoved ? null : (carried.pricing ?? null),
                staffEdits: carried.staffEdits,
                submission: carried.submission ?? null,
                estimator: carried.estimator ?? null,
                staffAlerts: keepCorrectedTrip
                  ? keptPricedDifference
                    ? [
                        ...outcome.quotationDraft.staffAlerts,
                        `The guest's latest message would change priced facts you corrected (${changedPaths.join(", ")}). The corrected trip and its price were kept — edit the trip if the guest is right.`,
                      ]
                    : outcome.quotationDraft.staffAlerts
                  : pricedFactsMoved
                    ? [
                        ...outcome.quotationDraft.staffAlerts,
                        "The guest changed the trip after it was priced, so the price and the approval were dropped — review it again.",
                      ]
                    : outcome.quotationDraft.staffAlerts,
              }
            : outcome.quotationDraft;
          draft.phone = phone;
          await saveQuotationDraft(draft);
          if (keepCorrectedTrip) {
            // eslint-disable-next-line no-console
            console.log("quotation kept a staff correction", draft.quoteId, changedPaths.join(","));
          }
          if (pricedFactsMoved) {
            // eslint-disable-next-line no-console
            console.log("quotation reopened: priced facts changed", draft.quoteId);
          }
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

  return { replied, failed, handoffs };
}
