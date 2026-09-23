import { extract, type ExtractionOutcome } from "./extract.js";
import { renderReply } from "./questions.js";
import type { ReplyKind } from "./questions.js";
import type { ExtractProvider } from "./provider.js";
import { synthesizeHospitalityReply } from "./synthesis.js";
import {
  buildHonoQuotationDraft,
  type HonoQuotationDraft,
  type HonoToolCallTrace,
} from "./quotationTool.js";

export interface ConversationTurn {
  role: "guest" | "assistant";
  text: string;
}

export type ConversationChannel = "web" | "email" | "whatsapp";

export interface ConversationInput {
  message: string;
  history?: ConversationTurn[];
  channel?: ConversationChannel;
  conversationId?: string;
}

export interface ConverseOutcome extends ExtractionOutcome {
  reply: string; // natural-language message ready to send back to the guest
  replyKind: ReplyKind; // which of the three deterministic replies this is
  done: boolean; // true once nothing is missing — the reply is then the summary
  toolCall?: HonoToolCallTrace; // AI -> Hono Tool Calling trace when quotation draft is submitted
  quotationDraft?: HonoQuotationDraft; // Editable Hono Quotation Draft (table + link)
}

const MAX_TRANSCRIPT_CHARS = 60_000;

function toTranscript(turns: ConversationTurn[]): string {
  const lines = turns.map((t) => `${t.role === "guest" ? "Guest" : "Assistant"}: ${t.text}`);
  const transcript = lines.join("\n");
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;

  const marker = "\n[Earlier conversation omitted due to context limit.]\n";
  const available = MAX_TRANSCRIPT_CHARS - marker.length;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return transcript.slice(0, headLength) + marker + transcript.slice(-tailLength);
}

export async function converse(
  input: ConversationTurn[] | ConversationInput,
  provider: ExtractProvider,
): Promise<ConverseOutcome> {
  const turns = Array.isArray(input) ? input : [...(input.history ?? []), { role: "guest" as const, text: input.message }];
  const transcript = toTranscript(turns);
  const outcome = await extract(transcript, provider);

  const done = outcome.questions.length === 0;
  const { kind, text: fallbackText } = renderReply(outcome.trip, outcome.questions);

  const reply = await synthesizeHospitalityReply(
    {
      turns,
      trip: outcome.trip,
      questions: outcome.questions,
      replyKind: kind,
      fallbackText,
    },
    provider,
  );

  if (done) {
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
    return { ...outcome, reply, replyKind: kind, done, toolCall, quotationDraft };
  }

  return { ...outcome, reply, replyKind: kind, done };
}

