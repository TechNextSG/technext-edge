import {
  ASK_LIMIT,
  STALL_LIMIT,
  fallbackReply,
  stalledHandoffReply,
} from "../../../../../../ai/src/index.ts";
import type { TurnContext, StepResult } from "../types.ts";

/** How many replies the bot has already taken in this thread. */
export function assistantTurns(history: import("../../../../../../ai/src/index.ts").ConversationTurn[]): number {
  return history.filter((turn) => turn.role === "assistant").length;
}

/**
 * Step 5: Check stall and asking limits (Pattern 4).
 * IMPORTANT: This only evaluates when no draft exists and the enquiry is still incomplete.
 * When the guest is making progress on every turn, they are not prematurely cut off.
 */
export async function stepLimits(ctx: TurnContext): Promise<StepResult> {
  const outcome = ctx.converseOutcome;
  if (!outcome) return { type: "continue" };

  const { store } = ctx.deps;
  const stated = ctx.statedMoneyValues;
  const stall = await store.noteOpenFields(
    ctx.phone,
    [...outcome.questions.map((q) => String(q.field)), ...Object.keys(stated).map((k) => `stated:${k}`)],
    STALL_LIMIT,
  );

  // ASK_LIMIT only restricts when no draft exists yet (Pattern 4).
  const hasDraft = Boolean(ctx.existingDraft || outcome.quotationDraft);
  const turns = assistantTurns(ctx.history);
  const stalled = stall.stalled;
  const askLimitExceeded = !hasDraft && turns >= ASK_LIMIT;

  if (stalled || askLimitExceeded) {
    const missing = outcome.questions.map((q) => q.field);
    const replyText = stalled
      ? stalledHandoffReply(missing, ctx.language)
      : fallbackReply("handoff", ctx.language);

    return {
      type: "stop",
      outcome: {
        kind: "handoff",
        reason: stalled ? "stalled" : "asking_limit",
        replyText,
        missingFields: missing.map(String),
        context: ctx.combinedText.slice(0, 200),
      },
    };
  }

  return { type: "continue" };
}
