import type { TurnContext, TurnOutcome } from "./types.ts";
import { saveQuotationDraft, findOpenQuotationForPhone } from "../../../store/quotationStore.ts";
import type { QuotationStore } from "../../../store/quotationStoreClient.ts";

export async function closeEnquiryQuotation(phone: string, store?: QuotationStore): Promise<string | null> {
  if (!phone) return null;
  const open = await findOpenQuotationForPhone(phone, store);
  if (!open || open.status === "cancelled") return null;
  const closed = await saveQuotationDraft(
    {
      ...open,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
      staffAlerts: [
        ...open.staffAlerts,
        "Closed when the guest restarted the conversation. The next enquiry gets its own quotation.",
      ],
    },
    store,
  );
  return closed.quoteId;
}

/**
 * Single unified outcome executor (Pattern 4).
 * Eliminates duplicated pause/append/send/markTold/markDone blocks across all stop branches.
 */
export async function executeOutcome(
  ctx: TurnContext,
  outcome: TurnOutcome,
  callbacks: {
    sendText: (text: string) => Promise<void>;
    markAllDone: () => Promise<void>;
    isExpired?: () => boolean;
  },
): Promise<{ replied: number; handoffs: number }> {
  if (callbacks.isExpired?.()) {
    return { replied: 0, handoffs: 0 };
  }
  const { deps, phone } = ctx;
  const { store } = deps;
  let replied = 0;
  let handoffs = 0;

  switch (outcome.kind) {
    case "reset": {
      await closeEnquiryQuotation(phone, deps.quotationStore);
      await store.clear(phone);
      await callbacks.sendText(outcome.replyText);
      replied++;
      await callbacks.markAllDone();
      break;
    }
    case "silence": {
      await callbacks.markAllDone();
      break;
    }
    case "handoff": {
      await store.pause(phone, outcome.reason, {
        missingFields: outcome.missingFields,
        context: outcome.context,
      });
      await store.append(phone, { role: "assistant", text: outcome.replyText });
      await callbacks.sendText(outcome.replyText);
      await store.markTold(phone);
      replied++;
      handoffs++;
      await callbacks.markAllDone();
      break;
    }
    case "reply": {
      if (outcome.quotationDraft) {
        await saveQuotationDraft(outcome.quotationDraft, deps.quotationStore);
      }
      await store.append(phone, { role: "assistant", text: outcome.replyText });
      await callbacks.sendText(outcome.replyText);
      replied++;
      await callbacks.markAllDone();
      break;
    }
  }

  return { replied, handoffs };
}
