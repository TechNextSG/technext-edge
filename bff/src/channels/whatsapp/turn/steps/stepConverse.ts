import type { Trip } from "../../../../../../ai/src/index.ts";
import { converseWithQuotation } from "../../../../quote/index.ts";
import type { TurnContext, StepResult } from "../types.ts";

export function statedMoneyValues(trip: Trip): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of ["nights", "guests", "rooms", "divers"] as const) {
    const field = trip[key];
    const value = field?.value;
    if (field?.state === "stated" && (typeof value === "number" || typeof value === "string")) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Step 3: Run AI extraction and natural language synthesis.
 */
export async function stepConverse(ctx: TurnContext): Promise<StepResult> {
  const elapsedMs = Date.now() - ctx.turnStartedAt;
  const synthesisBudgetMs = Math.max(1_500, ctx.deps.config.turnTimeoutMs - elapsedMs - 1_000);
  const outcome = await converseWithQuotation(ctx.history, ctx.deps.provider, { synthesisBudgetMs });
  const stated = statedMoneyValues(outcome.trip);

  return {
    type: "continue",
    ctx: {
      converseOutcome: outcome,
      statedMoneyValues: stated,
    },
  };
}
