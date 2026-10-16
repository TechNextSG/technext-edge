import { fallbackReply, changedValueNotice } from "../../../../../../ai/src/index.ts";
import type { TurnContext, StepResult } from "../types.ts";

/**
 * Step 6: Ask next questions (normal conversational turn progression).
 */
export async function stepAskNext(ctx: TurnContext): Promise<StepResult> {
  const outcome = ctx.converseOutcome;
  if (!outcome) {
    return {
      type: "stop",
      outcome: {
        kind: "reply",
        replyText: fallbackReply("apology", ctx.language),
      },
    };
  }

  const valueChanges = await ctx.deps.store.noteStatedValues(ctx.phone, ctx.statedMoneyValues);
  const changeNotice = changedValueNotice(valueChanges, ctx.language);
  const replyText = changeNotice ? `${outcome.reply}\n\n${changeNotice}` : outcome.reply;

  return {
    type: "stop",
    outcome: {
      kind: "reply",
      replyText,
    },
  };
}
