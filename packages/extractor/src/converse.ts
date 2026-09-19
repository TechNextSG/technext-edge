import { extract, type ExtractionOutcome } from "./extract.js";
import { renderReply } from "./questions.js";
import type { ReplyKind } from "./questions.js";
import type { ExtractProvider } from "./provider.js";

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
}

// Multi-turn wrapper around extract() — still exactly one extraction, not an
// agent that plans or decides anything new. "Remembering" a conversation
// means re-sending the transcript every turn and re-extracting from scratch.
//
// The reply is assembled here from the generateQuestions() list extract() already
// produced — no extra model call, no second agent, per the Playbook's "v1 only
// extracts, no multi-agent" boundary. questions.ts owns the wording: an
// introduction while the guest has said nothing yet, an acknowledgment plus the
// open questions while the enquiry is incomplete, and a summary to hand to a human
// once there is nothing left to ask. No model writes a guest-facing sentence, so no
// model can promise a price or a room.
//
// Keep context by size, not by an arbitrary turn count. The BFF caps each
// turn at 4,000 chars and the history at 20 turns; this second guard also
// protects direct callers such as an email or WhatsApp adapter. In normal
// enquiries the full transcript fits well below this limit, so early guest
// facts are not silently forgotten after the eighth turn.
const MAX_TRANSCRIPT_CHARS = 60_000;

function toTranscript(turns: ConversationTurn[]): string {
  const lines = turns.map((t) => `${t.role === "guest" ? "Guest" : "Assistant"}: ${t.text}`);
  const transcript = lines.join("\n");
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;

  // Preserve the beginning and end when a pathological transcript exceeds the
  // model budget. The marker makes truncation explicit to the model rather than
  // pretending the omitted turns never existed.
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

  // Every open field comes back in one message, not one question per turn (lead,
  // 2026-09-18): asking only the highest-priority field turned a booking into a
  // chat backlog and cost one turn per field. `questions` keeps the same ordered
  // list for form UIs (the BFF test console), and `done` is exactly "that list is
  // empty" — one condition, so the summary can never be sent while a question is
  // still open.
  const done = outcome.questions.length === 0;
  const { kind, text } = renderReply(outcome.trip, outcome.questions);

  return { ...outcome, reply: text, replyKind: kind, done };
}
