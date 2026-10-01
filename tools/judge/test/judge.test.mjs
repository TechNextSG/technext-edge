import { describe, it, expect } from "vitest";
import { scoreTranscript, comparePair, promptHash } from "../lib/judge.mjs";
import { CRITERION_IDS, parseJsonLoose } from "../schema.mjs";
import { createBudget, meterProvider, estimateCalls, BudgetExceededError } from "../lib/budget.mjs";
import { parseModelSpec, assertIndependentJudge } from "../lib/models.mjs";
import { assertScenariosAllowed } from "../lib/guard.mjs";
import rubric from "../rubric.json" with { type: "json" };

const scenario = { id: "s", facts: {}, turns: ["hi"] };

const scoreAnswer = (n) => JSON.stringify(Object.fromEntries(CRITERION_IDS.map((id) => [id, { reason: "ok", score: n }])));
const pairAnswer = (winners) =>
  JSON.stringify(Object.fromEntries(CRITERION_IDS.map((id) => [id, { reason: "ok", winner: winners[id] ?? "tie" }])));

/** A provider that answers from a queue, so each test decides exactly what the model "says". */
const fake = (answers) => {
  const queue = [...answers];
  return { id: "fake", calls: 0, async generateText() { this.calls += 1; const a = queue.shift(); if (a instanceof Error) throw a; return a; } };
};

describe("parseJsonLoose", () => {
  it("accepts fenced and padded JSON, rejects prose", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(() => parseJsonLoose("I would give it a four")).toThrow();
  });
});

describe("scoreTranscript", () => {
  it("takes the median of three runs", async () => {
    const provider = fake([scoreAnswer(2), scoreAnswer(5), scoreAnswer(4)]);
    const r = await scoreTranscript({ provider, rubric, scenario, transcript: "Guest: hi", runs: 3 });
    expect(r.status).toBe("ok");
    expect(r.criteria.no_promises.score).toBe(4);
    expect(r.criteria.no_promises.scores).toEqual([2, 5, 4]);
  });

  it("flags a criterion unstable when the runs differ by more than one point, not when they differ by one", async () => {
    const spread = await scoreTranscript({ provider: fake([scoreAnswer(2), scoreAnswer(4), scoreAnswer(4)]), rubric, scenario, transcript: "t" });
    expect(spread.criteria.tone_and_clarity.unstable).toBe(true);
    const close = await scoreTranscript({ provider: fake([scoreAnswer(3), scoreAnswer(4), scoreAnswer(4)]), rubric, scenario, transcript: "t" });
    expect(close.criteria.tone_and_clarity.unstable).toBe(false);
  });

  it("retries once on a malformed answer, then counts the run", async () => {
    const provider = fake(["not json at all", scoreAnswer(4), scoreAnswer(4), scoreAnswer(4)]);
    const r = await scoreTranscript({ provider, rubric, scenario, transcript: "t", runs: 3 });
    expect(r.status).toBe("ok");
    expect(r.invalidRuns).toBe(0);
    expect(provider.calls).toBe(4); // 3 runs, one of which needed its single retry
  });

  it("marks the transcript invalid when every run stays malformed (retry exhausted, no third attempt)", async () => {
    const provider = fake(["nope", "still nope", "nope", "nope", "nope", "nope"]);
    const r = await scoreTranscript({ provider, rubric, scenario, transcript: "t", runs: 3 });
    expect(r.status).toBe("invalid");
    expect(r.invalidRuns).toBe(3);
    expect(provider.calls).toBe(6); // 3 runs x (first try + exactly one retry)
  });

  it("rejects a score outside 1-5 and a missing criterion", async () => {
    const bad = JSON.parse(scoreAnswer(3));
    bad.no_promises.score = 9;
    const missing = JSON.parse(scoreAnswer(3));
    delete missing.tone_and_clarity;
    const r = await scoreTranscript({ provider: fake([JSON.stringify(bad), JSON.stringify(bad), JSON.stringify(missing), JSON.stringify(missing), "x", "x"]), rubric, scenario, transcript: "t", runs: 3 });
    expect(r.status).toBe("invalid");
  });

  it("survives a call that throws", async () => {
    const provider = fake([new Error("503"), scoreAnswer(4), scoreAnswer(4), scoreAnswer(4)]);
    const r = await scoreTranscript({ provider, rubric, scenario, transcript: "t", runs: 3 });
    expect(r.status).toBe("ok");
  });
});

describe("comparePair swaps the order and only trusts agreement", () => {
  it("counts a criterion when both orders pick the same conversation", async () => {
    // order 1 (A first): says A. order 2 (B shown first): says B, which is the original A again.
    const provider = fake([pairAnswer({ tone_and_clarity: "A" }), pairAnswer({ tone_and_clarity: "B" })]);
    const r = await comparePair({ provider, rubric, scenario, transcriptA: "a", transcriptB: "b" });
    expect(r.criteria.tone_and_clarity.winner).toBe("A");
  });

  it("calls it inconsistent when swapping the positions flips the verdict (the judge followed position)", async () => {
    // always picks whichever is shown first
    const provider = fake([pairAnswer({ no_promises: "A" }), pairAnswer({ no_promises: "A" })]);
    const r = await comparePair({ provider, rubric, scenario, transcriptA: "a", transcriptB: "b" });
    expect(r.criteria.no_promises.winner).toBe("inconsistent");
  });

  it("keeps ties as ties", async () => {
    const provider = fake([pairAnswer({}), pairAnswer({})]);
    const r = await comparePair({ provider, rubric, scenario, transcriptA: "a", transcriptB: "b" });
    expect(r.criteria.asks_only_missing.winner).toBe("tie");
  });

  it("sends the second prompt with the transcripts swapped", async () => {
    const seen = [];
    const provider = { async generateText(_s, user) { seen.push(user); return pairAnswer({}); } };
    await comparePair({ provider, rubric, scenario, transcriptA: "ALPHA-TEXT", transcriptB: "BETA-TEXT" });
    const order = (u) => [u.indexOf("ALPHA-TEXT"), u.indexOf("BETA-TEXT")];
    expect(order(seen[0])[0]).toBeLessThan(order(seen[0])[1]);
    expect(order(seen[1])[0]).toBeGreaterThan(order(seen[1])[1]);
  });
});

describe("prompt hash", () => {
  it("changes when the rubric changes", () => {
    const edited = { ...rubric, version: "9.9.9" };
    expect(promptHash(rubric)).not.toBe(promptHash(edited));
    expect(promptHash(rubric)).toBe(promptHash(rubric));
  });
});

describe("call budget", () => {
  it("stops at the cap, counting every method of a wrapped provider", async () => {
    const budget = createBudget(3);
    const p = meterProvider(
      { id: "x", async call() { return 1; }, async generateText() { return "t"; }, async extractGuests() { return 2; } },
      budget,
    );
    await p.call();
    await p.generateText();
    await p.extractGuests();
    expect(budget.used).toBe(3);
    await expect(p.call()).rejects.toBeInstanceOf(BudgetExceededError);
    expect(budget.used).toBe(3);
  });

  it("estimates worst case from the scenarios", () => {
    const scenarios = [{ turns: ["a", "b"] }, { turns: ["c"] }];
    expect(estimateCalls({ scenarios, candidates: 1, judgeRuns: 3, pairwise: false })).toEqual({ generate: 15, judge: 6, total: 21, guestTurns: 3 });
    expect(estimateCalls({ scenarios, candidates: 2, judgeRuns: 3, pairwise: true })).toEqual({ generate: 30, judge: 4, total: 34, guestTurns: 3 });
  });
});

describe("model specs and the independent judge", () => {
  const deps = {
    isKnownModel: (kind, m) => (kind === "gemini" ? m.startsWith("gemini-") : ["deepseek-flash", "deepseek-pro"].includes(m)),
    choiceFromName: (n) => (n === "deepseek" ? { provider: "deepseek", model: "deepseek-flash" } : null),
  };
  it("parses kind:model, bare names, and refuses nonsense", () => {
    expect(parseModelSpec("gemini:gemini-3.8-flash", deps)).toEqual({ provider: "gemini", model: "gemini-3.8-flash" });
    expect(parseModelSpec("deepseek", deps)).toEqual({ provider: "deepseek", model: "deepseek-flash" });
    expect(() => parseModelSpec("openai:gpt", deps)).toThrow(/unknown provider/);
    expect(() => parseModelSpec("gemini:llama", deps)).toThrow(/not a model/);
    expect(() => parseModelSpec("", deps)).toThrow();
  });
  it("refuses a judge from the candidate's vendor unless told to", () => {
    const g = { provider: "gemini", model: "gemini-3.8-flash" };
    const d = { provider: "deepseek", model: "deepseek-flash" };
    expect(assertIndependentJudge(d, [g])).toEqual({ selfPreference: false });
    expect(() => assertIndependentJudge(g, [g])).toThrow(/same vendor/);
    expect(assertIndependentJudge(g, [g], { allowSelfPreference: true })).toEqual({ selfPreference: true });
    expect(() => assertIndependentJudge(d, [g, d])).toThrow(/same vendor/);
  });
});

describe("real data guard", () => {
  it("lets synthetic scenarios through untouched", () => {
    expect(assertScenariosAllowed({ synthetic: true })).toEqual({ masked: false });
  });
  it("refuses a real dataset without the flag, without the env var, and with only one of them", () => {
    const real = { synthetic: false };
    expect(() => assertScenariosAllowed(real)).toThrow(/not marked synthetic/);
    expect(() => assertScenariosAllowed({})).toThrow();
    expect(() => assertScenariosAllowed(real, { allowRealFlag: true, env: {} })).toThrow();
    expect(() => assertScenariosAllowed(real, { allowRealFlag: false, env: { JUDGE_REAL_OK: "1" } })).toThrow();
    expect(() => assertScenariosAllowed(real, { allowRealFlag: true, env: { JUDGE_REAL_OK: "yes" } })).toThrow();
  });
  it("allows it with both, and says the text must be masked", () => {
    expect(assertScenariosAllowed({ synthetic: false }, { allowRealFlag: true, env: { JUDGE_REAL_OK: "1" } })).toEqual({ masked: true });
  });
});
