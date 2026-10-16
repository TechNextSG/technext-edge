import type { ExtractProvider, GuestLanguage, Trip, ConversationTurn } from "../../../../../ai/src/index.ts";
import type { ConversationStore } from "../../../store/conversationStore.ts";
import type { QuotationStore } from "../../../store/quotationStoreClient.ts";
import type { EstimatorPort } from "../../../estimator/index.ts";
import type { EstimatorOutbox } from "../../../estimator/outbox.ts";
import type { InboundTextMessage, WhatsAppSendText, WhatsAppConfig } from "../meta.ts";
import type { HonoQuotationDraft, QuotationConverseOutcome } from "../../../quote/index.ts";

export interface WhatsAppTurnDeps {
  store: ConversationStore;
  quotationStore?: QuotationStore;
  provider: ExtractProvider;
  sendWhatsApp: WhatsAppSendText;
  estimator: EstimatorPort;
  outbox?: EstimatorOutbox;
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

export interface TurnContext {
  phone: string;
  batch: TurnBatchItem[];
  combinedText: string;
  turnStartedAt: number;
  deps: WhatsAppTurnDeps;
  history: ConversationTurn[];
  language: GuestLanguage;
  existingDraft?: HonoQuotationDraft;
  converseOutcome?: QuotationConverseOutcome;
  statedMoneyValues: Record<string, string | number | boolean>;
}

export type TurnOutcome =
  | { kind: "reset"; replyText: string }
  | { kind: "silence" }
  | { kind: "handoff"; reason: string; replyText: string; missingFields?: string[]; context?: string }
  | { kind: "reply"; replyText: string; quotationDraft?: HonoQuotationDraft };

export type StepResult =
  | { type: "continue"; ctx?: Partial<TurnContext> }
  | { type: "stop"; outcome: TurnOutcome };
