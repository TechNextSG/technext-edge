import { extract, type ExtractionOutcome } from "./extract.js";
import type { ExtractProvider } from "./provider.js";

export interface ConversationTurn {
  role: "guest" | "assistant";
  text: string;
}

export interface ConverseOutcome extends ExtractionOutcome {
  reply: string; // natural-language message ready to send back to the guest
  done: boolean; // true once nothing is missing/default — no more questions to ask
}

// Multi-turn wrapper around extract() — still exactly one extraction, not an
// agent that plans or decides anything new. "Remembering" a conversation
// means re-sending the whole transcript every turn (fits in one context
// window for a guest enquiry) and re-extracting from scratch, never a
// database or incremental merge — the simplest thing that can't drift out of
// sync with what was actually said.
//
// The reply text is assembled from the same generateQuestions() priority
// order extract() already produces — no extra model call, no second agent,
// per the Playbook's "v1 only extracts, no multi-agent" boundary.
//
// A real guest enquiry runs 2-4 turns; this cap only bites on pathological
// input (a replay, a bug, someone testing limits). Independent from the
// BFF's own zod cap (apps/casa-bff/src/app.ts, history.max(20)) — that one
// guards the wire format, this one guards what actually gets sent to the
// model, since converse() can be called directly (tests, future channels)
// without going through the BFF at all.
const MAX_TRANSCRIPT_TURNS = 8;

export async function converse(turns: ConversationTurn[], provider: ExtractProvider): Promise<ConverseOutcome> {
  // Keep the newest turns, not the oldest: a guest's most recent answers are
  // what fills the remaining fields. Dropping an early "stated" fact just
  // means generateQuestions() asks it again — one extra round-trip, not
  // silent data loss.
  const recentTurns = turns.length > MAX_TRANSCRIPT_TURNS ? turns.slice(turns.length - MAX_TRANSCRIPT_TURNS) : turns;
  const transcript = recentTurns.map((t) => `${t.role === "guest" ? "Guest" : "Assistant"}: ${t.text}`).join("\n");
  const outcome = await extract(transcript, provider);

  const done = outcome.questions.length === 0;
  const reply = done
    ? "Thanks! I have everything I need — dates, guests, rooms, meals, and transport are all noted. Someone from our team will follow up shortly to confirm."
    : outcome.questions.map((q) => q.question).join(" ");

  return { ...outcome, reply, done };
}
