// A hard cap on model calls. The judge is the only thing in this repo that can spend money by running a loop, so every
// provider it uses is wrapped here and the run stops the moment the budget is gone.

export class BudgetExceededError extends Error {
  constructor(max) {
    super(`call budget of ${max} reached; stopping before spending more (raise it with --max-calls)`);
    this.name = "BudgetExceededError";
  }
}

export function createBudget(max) {
  let used = 0;
  return {
    max,
    get used() {
      return used;
    },
    take() {
      if (used >= max) throw new BudgetExceededError(max);
      used += 1;
    },
  };
}

const CALLED = ["call", "extractGuests", "extractCheckIn", "extractDiveWindow", "generateText"];

/** The same provider, with every model call counted (and optionally spaced out for a rate-limited key). */
export function meterProvider(provider, budget, { delayMs = 0 } = {}) {
  const wrapped = { ...provider };
  for (const name of CALLED) {
    const original = provider[name];
    if (typeof original !== "function") continue;
    wrapped[name] = async (...args) => {
      budget.take();
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return original.apply(provider, args);
    };
  }
  return wrapped;
}

/**
 * What a run is expected to cost, from the scenarios alone. A guest turn is priced at its worst case (the main
 * extraction, three isolated passes, the written reply); the judge costs one call per transcript per repeat, because
 * all five criteria come back in one answer. Retries after bad JSON are not included.
 */
export const CALLS_PER_GUEST_TURN = 5;

export function estimateCalls({ scenarios, candidates, judgeRuns, pairwise }) {
  const guestTurns = scenarios.reduce((n, s) => n + s.turns.length, 0);
  const generate = guestTurns * CALLS_PER_GUEST_TURN * candidates;
  const judge = pairwise ? scenarios.length * 2 : scenarios.length * candidates * judgeRuns;
  return { generate, judge, total: generate + judge, guestTurns };
}
