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
export async function converse(turns: ConversationTurn[], provider: ExtractProvider): Promise<ConverseOutcome> {
  const transcript = turns.map((t) => `${t.role === "guest" ? "Guest" : "Assistant"}: ${t.text}`).join("\n");
  const outcome = await extract(transcript, provider);

  const done = outcome.questions.length === 0;
  const reply = done
    ? "Thanks! I have everything I need — dates, guests, rooms, meals, and transport are all noted. Someone from our team will follow up shortly to confirm."
    : outcome.questions.map((q) => q.question).join(" ");

  return { ...outcome, reply, done };
}
