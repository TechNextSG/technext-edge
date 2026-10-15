import { loadEnv, type Env } from "../../env.ts";
import {
  detectLanguage,
  fallbackReply,
  maskForLogging,
  type ConversationTurn,
  type GuestLanguage,
} from "../../../../ai/src/index.ts";
import { findOpenQuotationForPhone } from "../../store/quotationStore.ts";
import {
  type WhatsAppTurnDeps,
  type TurnBatchItem,
  type TurnResult,
  type TurnContext,
} from "./turn/types.ts";
import { runTurnPipeline } from "./turn/pipeline.ts";
import { isResetCommand } from "./turn/steps/stepReset.ts";

export { HOLD_REPEAT_MS } from "./turn/steps/stepHumanGate.ts";
export { assistantTurns } from "./turn/steps/stepLimits.ts";
export { statedMoneyValues } from "./turn/steps/stepConverse.ts";
export { isResetCommand, RESET_REPLY } from "./turn/steps/stepReset.ts";
export { closeEnquiryQuotation } from "./turn/executeOutcome.ts";
export { absoluteUrl, guestPendingQuotationNote } from "./turn/steps/stepDoneCheck.ts";
export type { WhatsAppTurnDeps, TurnBatchItem, TurnResult, TurnContext };

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
 * The WhatsApp number a guest should reply to, or null when this deployment has not been told one.
 */
export function resortWhatsAppNumber(env: Env = loadEnv()): string | null {
  const raw = (env.RESORT_WHATSAPP_NUMBER ?? "").replace(/[^\d]/g, "");
  return raw.length >= 8 && raw.length <= 15 ? raw : null;
}

/**
 * Executes a single inbound turn batch for one phone number under phone lock.
 * Orchestrated through the linear Pattern 4 Turn Pipeline.
 */
export async function processPhoneTurnBatch(
  phone: string,
  batch: TurnBatchItem[],
  deps: WhatsAppTurnDeps,
): Promise<TurnResult> {
  const { store, sendWhatsApp: send, config } = deps;
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
        // Build initial context
        const isReset = isResetCommand(combinedText);
        if (!isReset) {
          await store.append(phone, { role: "guest", text: combinedText });
        }

        const history = await store.history(phone);
        const language = isReset ? detectLanguage(combinedText) : guestLanguage(history);
        const candidate = await findOpenQuotationForPhone(phone, deps.quotationStore);
        const existingDraft = candidate && candidate.status !== "cancelled" ? candidate : undefined;

        const ctx: TurnContext = {
          phone,
          batch,
          combinedText,
          turnStartedAt,
          deps,
          history,
          language,
          existingDraft,
          statedMoneyValues: {},
        };

        const result = await runTurnPipeline(ctx, {
          isExpired: () => expired,
          sendText: async (text) => {
            if (expired) return;
            sending = true;
            await send({ to: phone, body: text });
          },
          markAllDone: async () => {
            if (expired) return;
            await markAllDone();
          },
        });

        replied += result.replied;
        handoffs += result.handoffs;
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
