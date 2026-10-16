import {
  classifyEnquiry,
  wantsHuman,
  fallbackReply,
} from "../../../../../../ai/src/index.ts";
import type { TurnContext, StepResult } from "../types.ts";

export const HOLD_REPEAT_MS = 10 * 60 * 1000;

/**
 * Step 2: Human gate check.
 * Handles existing parked threads, explicit human requests, complaints/cancellations, and non-booking enquiries.
 */
export async function stepHumanGate(ctx: TurnContext): Promise<StepResult> {
  const { store } = ctx.deps;
  const parked = await store.paused(ctx.phone);
  const intent = classifyEnquiry(ctx.combinedText);
  const askedForHuman = wantsHuman(ctx.combinedText);
  const escalate = askedForHuman || intent === "escalate_now";
  const notBooking = !escalate && intent === "not_booking";

  if (parked?.reason === "partner_self_serve") {
    await store.resume(ctx.phone);
    return { type: "continue" };
  }

  if ((parked && parked.reason !== "partner_self_serve") || escalate || notBooking) {
    if (parked && !(await store.needsTelling(ctx.phone, HOLD_REPEAT_MS))) {
      return { type: "stop", outcome: { kind: "silence" } };
    }

    const reason =
      parked?.reason ??
      (askedForHuman ? "guest_asked_for_human" : escalate ? "complaint_or_cancel" : "not_booking");
    const replyText =
      !parked && notBooking
        ? fallbackReply("not_booking", ctx.language)
        : fallbackReply("handoff", ctx.language);

    return {
      type: "stop",
      outcome: {
        kind: "handoff",
        reason,
        replyText,
        context: ctx.combinedText.slice(0, 200),
      },
    };
  }

  return { type: "continue" };
}
