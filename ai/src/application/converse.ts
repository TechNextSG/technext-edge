import { extract, type ExtractionOutcome } from "./extract.js";
import { isReadyForHandoff, renderReply } from "./questions.js";
import type { ReplyKind } from "./questions.js";
import type { ExtractProvider } from "../ports/provider.js";
import { synthesizeHospitalityReply } from "./synthesis.js";
import type { ConversationChannel, ConversationTurn } from "../domain/conversation.js";

export type { ConversationChannel, ConversationTurn };

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
  options: { synthesisBudgetMs?: number } = {},
): Promise<ConverseOutcome> {
  const turns = Array.isArray(input) ? input : [...(input.history ?? []), { role: "guest" as const, text: input.message }];
  const transcript = toTranscript(turns);
  const outcome = await extract(transcript, provider);

  // `done` is the HANDOFF contract, not "the question list happens to be empty". The two
  // are kept consistent by isReadyForHandoff checking the same open-question pass that
  // renderReply uses, and by the coverage test that every required field is either asked
  // about or listed in NEVER_ASKED_FIELDS (see questions.ts).
  const done = isReadyForHandoff(outcome.trip);
  const { kind, text: fallbackText } = renderReply(outcome.trip, outcome.questions);

  const reply = await synthesizeHospitalityReply(
    {
      turns,
      trip: outcome.trip,
      questions: outcome.questions,
      replyKind: kind,
      fallbackText,
      // Passed through from the caller, which is the only layer that knows how much of the channel's
      // turn deadline is left. The synthesis call is the last one in the turn.
      ...(options.synthesisBudgetMs !== undefined ? { budgetMs: options.synthesisBudgetMs } : {}),
    },
    provider,
  );

  return { ...outcome, reply, replyKind: kind, done };
}

