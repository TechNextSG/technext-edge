/**
 * converse() plus the quotation tool call: the AI finishes the conversation, then — when the trip is
 * ready and the tool is switched on — the quotation context builds the editable draft.
 *
 * This used to live inside the AI package's converse(). It moved here so the AI package stops at
 * "message in, Trip and reply out" and never builds a priced draft: the draft, its line items and its
 * totals belong to the quotation context. The behaviour is unchanged — same env switch, same trace.
 */
import {
  converse,
  type ConversationInput,
  type ConversationTurn,
  type ConverseOutcome,
  type ExtractProvider,
} from "../../../ai/src/index.ts";
import { buildHonoQuotationDraft } from "./quotationTool.ts";
import type { HonoQuotationDraft, HonoToolCallTrace } from "../domain/quotationDraft.ts";

export interface QuotationConverseOutcome extends ConverseOutcome {
  toolCall?: HonoToolCallTrace; // AI -> Hono Tool Calling trace when quotation draft is submitted
  quotationDraft?: HonoQuotationDraft; // Editable Hono Quotation Draft (table + link)
}

export async function converseWithQuotation(
  input: ConversationTurn[] | ConversationInput,
  provider: ExtractProvider,
  options: { synthesisBudgetMs?: number } = {},
): Promise<QuotationConverseOutcome> {
  const outcome = await converse(input, provider, options);

  if (outcome.done && process.env.ENABLE_HONO_QUOTATION_TOOL === "true") {
    const quotationDraft = buildHonoQuotationDraft(outcome.trip);
    const toolCall: HonoToolCallTrace = {
      toolName: "submit_quotation_to_hono",
      status: "executed_pending_hono_confirm",
      arguments: {
        guestName: quotationDraft.guestName,
        checkIn: quotationDraft.checkIn,
        checkOut: quotationDraft.checkOut,
        nights: quotationDraft.nights,
        stayingGuests: quotationDraft.stayingGuests,
        totalGroupSize: quotationDraft.totalGroupSize,
        rooms: quotationDraft.rooms,
        mealPlan: quotationDraft.mealPlan,
        diver: quotationDraft.diver,
        divers: quotationDraft.divers,
        diveNotes: quotationDraft.diveNotes,
        guestType: quotationDraft.guestType,
      },
      result: {
        quoteId: quotationDraft.quoteId,
        status: quotationDraft.status,
        quotationUrl: quotationDraft.quotationUrl,
        honoEditorUrl: quotationDraft.honoEditorUrl,
        totalAmount: quotationDraft.totalAmount,
        currency: quotationDraft.currency,
        lineItemCount: quotationDraft.lineItems.length,
      },
    };
    return { ...outcome, toolCall, quotationDraft };
  }

  return outcome;
}
