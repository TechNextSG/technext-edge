import { detectLanguage, type GuestLanguage } from "../../../../../../ai/src/index.ts";
import type { TurnContext, StepResult } from "../types.ts";

export function isResetCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return /^(reset|start\s*over|restart|重置|重新开始)$/i.test(trimmed);
}

export const RESET_REPLY: Record<GuestLanguage, string> = {
  en: "Conversation reset! Welcome to Casa Escondida — our dive-and-stay resort in Anilao, Batangas.\nCould you share your check-in date, how many nights, how many guests, and a name for the booking?",
  zh: "对话已重置！欢迎来到 Casa Escondida 潜水度假村。\n请告诉我入住日期、住几晚、几位客人以及预订姓名。",
};

/**
 * Step 1: Check if the inbound message is an explicit reset command.
 */
export async function stepReset(ctx: TurnContext): Promise<StepResult> {
  if (isResetCommand(ctx.combinedText)) {
    const language = detectLanguage(ctx.combinedText);
    const replyText = RESET_REPLY[language] ?? RESET_REPLY.en;
    return {
      type: "stop",
      outcome: {
        kind: "reset",
        replyText,
      },
    };
  }
  return { type: "continue" };
}
