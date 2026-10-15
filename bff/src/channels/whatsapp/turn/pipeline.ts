import type { TurnContext, TurnResult } from "./types.ts";
import { executeOutcome } from "./executeOutcome.ts";
import { stepReset } from "./steps/stepReset.ts";
import { stepHumanGate } from "./steps/stepHumanGate.ts";
import { stepConverse } from "./steps/stepConverse.ts";
import { stepDoneCheck } from "./steps/stepDoneCheck.ts";
import { stepLimits } from "./steps/stepLimits.ts";
import { stepAskNext } from "./steps/stepAskNext.ts";

export type PipelineStep = (ctx: TurnContext) => Promise<import("./types.ts").StepResult>;

export const DEFAULT_PIPELINE_STEPS: readonly PipelineStep[] = [
  stepReset,
  stepHumanGate,
  stepConverse,
  stepDoneCheck,
  stepLimits,
  stepAskNext,
];

/**
 * Runs the linear turn pipeline (Pattern 4).
 * Each step evaluates `(ctx) => Continue | Stop(outcome)`.
 * Any step returning Stop halts the pipeline and executes the outcome in a single handler.
 */
export async function runTurnPipeline(
  ctx: TurnContext,
  callbacks: {
    sendText: (text: string) => Promise<void>;
    markAllDone: () => Promise<void>;
    isExpired?: () => boolean;
  },
  steps: readonly PipelineStep[] = DEFAULT_PIPELINE_STEPS,
): Promise<{ replied: number; handoffs: number }> {
  let currentCtx = ctx;

  for (const step of steps) {
    if (callbacks.isExpired?.()) {
      return { replied: 0, handoffs: 0 };
    }
    const result = await step(currentCtx);
    if (result.type === "stop") {
      return executeOutcome(currentCtx, result.outcome, callbacks);
    }
    if (result.ctx) {
      currentCtx = { ...currentCtx, ...result.ctx };
    }
  }

  return { replied: 0, handoffs: 0 };
}
