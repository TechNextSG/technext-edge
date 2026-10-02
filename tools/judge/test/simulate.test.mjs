import { describe, it, expect } from "vitest";
import { simulateScenario, renderTranscript } from "../lib/simulate.mjs";
import { runCodeChecks, checkNoMoney, checkNoLink, checkReplyLanguage, checkHandoff } from "../lib/codechecks.mjs";
import { buildTemplate, compareToHuman, sampleKeys } from "../calibrate.mjs";
import { calibrationStatus, buildSummary } from "../lib/summary.mjs";
import { CRITERION_IDS } from "../schema.mjs";
import scenarios from "../scenarios.json" with { type: "json" };
import rubric from "../rubric.json" with { type: "json" };

/** The ai package's decision functions, replaced by small stand-ins so no model and no ai/ code runs. */
const makeAi = (overrides = {}) => ({
  converse: async ({ message }) => ({
    reply: `Thanks, noted: ${message}. How many nights will you stay?`,
    questions: [{ field: "nights", question: "?" }],
    trip: { guestType: { value: "guest" } },
    done: false,
    replyKind: "questions",
  }),
  classifyEnquiry: (t) => (/refund|cancel/i.test(t) ? "escalate_now" : /wifi/i.test(t) ? "not_booking" : "booking"),
  wantsHuman: (t) => /real person/i.test(t),
  declinesPartner: () => false,
  fallbackReply: (kind) => `FALLBACK-${kind}: a person will reply to you here shortly.`,
  stalledHandoffReply: () => "STALLED: a person will reply to you here shortly.",
  partnerInvitationReply: (_l, url) => `Please sign in at ${url} for your partner rate.`,
  detectLanguage: () => "en",
  ASK_LIMIT: 8,
  STALL_LIMIT: 3,
  ...overrides,
});

describe("simulateScenario follows the channel's decisions", () => {
  it("hands a cancellation to staff before the model is asked, then stays silent", async () => {
    let asked = 0;
    const ai = makeAi({ converse: async () => { asked += 1; throw new Error("must not be called"); } });
    const run = await simulateScenario({ id: "x", turns: ["I want to cancel", "hello??"] }, {}, ai);
    expect(asked).toBe(0);
    expect(run.turns[0]).toMatchObject({ kind: "handoff", handoff: true });
    expect(run.turns[1]).toMatchObject({ kind: "silent_parked", reply: null });
  });

  it("sends a non-booking question to staff as not_booking", async () => {
    const run = await simulateScenario({ id: "x", turns: ["what's the wifi password"] }, {}, makeAi());
    expect(run.turns[0]).toMatchObject({ kind: "not_booking", handoff: true });
  });

  it("hands over when the same questions stay open for STALL_LIMIT turns", async () => {
    const run = await simulateScenario({ id: "x", turns: ["a", "b", "c", "d", "e"] }, {}, makeAi());
    // turn 1 sets the baseline, turns 2 and 3 repeat it, turn 4 is the third repeat -> stalled
    expect(run.turns.map((t) => t.kind)).toEqual(["converse", "converse", "converse", "stalled", "silent_parked"]);
    expect(run.turns[3].handoff).toBe(true);
  });

  it("does not stall when each turn closes a question", async () => {
    let n = 0;
    const ai = makeAi({
      converse: async () => ({ reply: "ok noted, and what else?", questions: [{ field: `f${n++}` }], trip: {}, done: false, replyKind: "questions" }),
    });
    const run = await simulateScenario({ id: "x", turns: ["a", "b", "c", "d"] }, {}, ai);
    expect(run.turns.every((t) => t.kind === "converse")).toBe(true);
  });

  it("invites a finished partner enquiry to sign in instead of quoting", async () => {
    const ai = makeAi({
      converse: async () => ({ reply: "Done.", questions: [], trip: { guestType: { value: "agent" } }, done: true, replyKind: "summary" }),
    });
    const run = await simulateScenario({ id: "x", turns: ["we are an agency"] }, {}, ai);
    expect(run.turns[0]).toMatchObject({ kind: "partner_invitation", handoff: true });
  });

  it("answers a failed model call with the apology and keeps the thread open", async () => {
    let calls = 0;
    const ai = makeAi({ converse: async (i) => { if (calls++ === 0) throw new Error("503"); return { reply: "back again, thanks for waiting", questions: [{ field: "nights" }], trip: {}, done: false, replyKind: "questions" }; } });
    const run = await simulateScenario({ id: "x", turns: ["hi", "hello again"] }, {}, ai);
    expect(run.turns[0]).toMatchObject({ kind: "apology", handoff: false });
    expect(run.turns[1].kind).toBe("converse");
  });

  it("renders a transcript with silent turns marked", async () => {
    const run = await simulateScenario({ id: "x", turns: ["cancel please", "anyone?"] }, {}, makeAi());
    const text = renderTranscript(run);
    expect(text).toContain("[thread handed to staff]");
    expect(text).toContain("Bot: (silent");
  });
});

describe("machine checks the judge cannot overrule", () => {
  const replies = (...texts) => texts.map((text, i) => ({ turn: i + 1, text, kind: "converse" }));
  it("money in any reply fails", () => {
    expect(checkNoMoney(replies("Your stay is ₱7,600")).ok).toBe(false);
    expect(checkNoMoney(replies("that would be 3000 pesos")).ok).toBe(false);
    expect(checkNoMoney(replies("USD 120 per night")).ok).toBe(false);
    expect(checkNoMoney(replies("2 guests, 3 nights, full board")).ok).toBe(true);
  });
  it("a link fails except in the partner invitation", () => {
    expect(checkNoLink(replies("see https://example.com/quote")).ok).toBe(false);
    expect(checkNoLink([{ turn: 1, kind: "partner_invitation", text: "sign in at https://app.example/signin" }]).ok).toBe(true);
  });
  it("language: en must have no CJK, zh must have it", () => {
    expect(checkReplyLanguage(replies("Hello there, welcome"), "en").ok).toBe(true);
    expect(checkReplyLanguage(replies("你好，欢迎"), "en").ok).toBe(false);
    expect(checkReplyLanguage(replies("Hello there"), "zh").ok).toBe(false);
    expect(checkReplyLanguage(replies("你好，欢迎"), "zh").ok).toBe(true);
  });
  it("handoff compares what happened with what was expected, and ignores an unset expectation", () => {
    const handed = { turns: [{ handoff: true }] };
    const not = { turns: [{ handoff: false }] };
    expect(checkHandoff(handed, true).ok).toBe(true);
    expect(checkHandoff(not, true).ok).toBe(false);
    expect(checkHandoff(handed, false).ok).toBe(false);
    expect(checkHandoff(handed, null).ok).toBe(true);
  });
  it("the fact gate is passed only the facts the scenario pins", () => {
    const seen = [];
    const gate = (text, facts) => { seen.push(facts); return { ok: true }; };
    runCodeChecks({
      scenario: { facts: { nights: 2, roomType: "deluxe" }, replyLanguage: "en", expectHandoff: false },
      run: { turns: [{ n: 1, reply: "Noted: 2 nights in a deluxe room", kind: "converse", handoff: false }] },
      verifyGuestFacingText: gate,
    });
    expect(seen[0].nights).toBe(2);
    expect(seen[0].guests).toBeUndefined();
    expect([...seen[0].roomTypes]).toEqual(["deluxe"]);
  });
});

describe("scenario file", () => {
  it("is synthetic, has 25-30 unique scenarios, each with turns and an expectation field", () => {
    expect(scenarios.synthetic).toBe(true);
    expect(scenarios.scenarios.length).toBeGreaterThanOrEqual(25);
    expect(scenarios.scenarios.length).toBeLessThanOrEqual(30);
    const ids = scenarios.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of scenarios.scenarios) {
      expect(s.turns.length).toBeGreaterThan(0);
      expect("expectHandoff" in s).toBe(true);
      expect(["en", "zh"]).toContain(s.replyLanguage);
    }
  });
  it("covers the error paths: handoff cases, languages, injection, vague and ambiguous input", () => {
    const text = scenarios.scenarios.map((s) => s.id).join(" ");
    for (const must of ["cancel", "refund", "person", "chinese", "japanese", "injection", "vague", "ambiguous", "past", "never-commits", "discount", "agent", "instructor", "complaint", "changes-mind"]) {
      expect(text).toContain(must);
    }
  });
  it("contains no email address and no phone number", () => {
    const raw = JSON.stringify(scenarios);
    expect(raw).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(raw).not.toMatch(/\b\+?\d{9,}\b/);
  });
  it("rubric has the five criteria with five levels each", () => {
    expect(rubric.criteria.map((c) => c.id)).toEqual(CRITERION_IDS);
    for (const c of rubric.criteria) expect(Object.keys(c.levels)).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("calibration", () => {
  const judged = (score) => ({ status: "ok", criteria: Object.fromEntries(CRITERION_IDS.map((id) => [id, { score }])) });
  const labelsOf = (rows) => ({ items: rows.map(([key, score]) => ({ key, scores: Object.fromEntries(CRITERION_IDS.map((id) => [id, score])) })) });

  it("computes agreement against human labels from known numbers", () => {
    const scores = { scores: { m: { a: judged(1), b: judged(2), c: judged(3), d: judged(4), e: judged(5) } } };
    const perfect = compareToHuman({ labels: labelsOf([["m|a", 1], ["m|b", 2], ["m|c", 3], ["m|d", 4], ["m|e", 5]]), scores });
    expect(perfect.no_promises).toMatchObject({ n: 5, exact: 1, withinOne: 1 });
    expect(perfect.no_promises.kappa).toBeCloseTo(1, 10);
    expect(perfect.no_promises.spearman).toBeCloseTo(1, 10);
    const off = compareToHuman({ labels: labelsOf([["m|a", 1], ["m|b", 2], ["m|c", 5], ["m|d", 4], ["m|e", 5]]), scores });
    expect(off.no_promises.exact).toBeCloseTo(0.8, 10);
    expect(off.no_promises.withinOne).toBe(0.8);
  });

  it("skips unlabeled items and invalid judge runs", () => {
    const scores = { scores: { m: { a: judged(3), b: { status: "invalid" }, c: judged(4) } } };
    const labels = { items: [
      { key: "m|a", scores: Object.fromEntries(CRITERION_IDS.map((id) => [id, 3])) },
      { key: "m|b", scores: Object.fromEntries(CRITERION_IDS.map((id) => [id, 3])) },
      { key: "m|c", scores: Object.fromEntries(CRITERION_IDS.map((id) => [id, null])) },
    ] };
    expect(compareToHuman({ labels, scores }).tone_and_clarity.n).toBe(1);
  });

  it("samples spread over scenarios and is repeatable", () => {
    const by = { s1: ["a|s1", "b|s1"], s2: ["a|s2", "b|s2"], s3: ["a|s3", "b|s3"] };
    const first3 = sampleKeys(by, 3, 7);
    expect(new Set(first3.map((k) => k.split("|")[1])).size).toBe(3);
    expect(sampleKeys(by, 3, 7)).toEqual(first3);
    expect(sampleKeys(by, 99, 7)).toHaveLength(6);
  });

  it("builds a labelling template with empty scores", () => {
    const transcripts = {
      scenarios: [{ id: "s1", facts: { nights: 2 }, expectHandoff: false }],
      results: { "gemini:x": { s1: { run: { turns: [{ guest: "hi", reply: "hello there", handoff: false }] } } } },
    };
    const t = buildTemplate({ transcripts, meta: { rubricVersion: "1.0.0" }, n: 5, seed: 1 });
    expect(t.items).toHaveLength(1);
    expect(t.items[0].transcript).toContain("Guest: hi");
    expect(Object.values(t.items[0].scores).every((v) => v === null)).toBe(true);
  });

  it("trusts a criterion only for kappa >= 0.6 on the same judge and rubric version", () => {
    const cal = { judge: "deepseek:deepseek-flash", rubricVersion: "1.0.0", criteria: {
      asks_only_missing: { kappa: 0.61 }, no_promises: { kappa: 0.59 }, faithful_to_facts: { kappa: null }, tone_and_clarity: { kappa: 0.9 },
    } };
    const s = calibrationStatus(cal, { judgeId: "deepseek:deepseek-flash", rubricVersion: "1.0.0" });
    expect(s.asks_only_missing.trusted).toBe(true);
    expect(s.no_promises.trusted).toBe(false);
    expect(s.faithful_to_facts.trusted).toBe(false);
    expect(s.tone_and_clarity.trusted).toBe(true);
    expect(s.handoff_judgement.trusted).toBe(false); // never calibrated
    expect(calibrationStatus(cal, { judgeId: "deepseek:deepseek-pro", rubricVersion: "1.0.0" }).tone_and_clarity.trusted).toBe(false);
    expect(calibrationStatus(cal, { judgeId: "deepseek:deepseek-flash", rubricVersion: "1.1.0" }).tone_and_clarity.trusted).toBe(false);
    expect(calibrationStatus(null, { judgeId: "x", rubricVersion: "1" }).tone_and_clarity.trusted).toBe(false);
  });

  it("the summary marks uncalibrated criteria and names the judge, rubric and prompt", () => {
    const meta = { startedAt: "t", judge: "deepseek:deepseek-flash", rubricVersion: "1.0.0", promptHash: "abc123", candidates: ["gemini:x"], scenarioCount: 1, scenarioFile: "f", callsUsed: 4, maxCalls: 300 };
    const md = buildSummary({
      meta,
      results: { "gemini:x": { s1: { run: { turns: [] }, checks: { no_money: { ok: true }, no_link: { ok: true }, reply_language: { ok: true }, fact_gate: { ok: true }, handoff: { ok: true } }, judge: { status: "ok", criteria: Object.fromEntries(CRITERION_IDS.map((id) => [id, { score: 4, unstable: false }])) } } } },
      pairwise: null,
      calibration: null,
      codeFailures: [],
    });
    expect(md).toContain("uncalibrated");
    expect(md).toContain("rubric 1.0.0");
    expect(md).toContain("abc123");
    expect(md).toContain("deepseek:deepseek-flash");
  });
});

describe("pacing between turns", () => {
  it("calls afterTurn before every turn except the first, never inside a model call", async () => {
    const events = [];
    const ai = makeAi({ converse: async () => { events.push("model"); return { reply: "ok thanks, and the next thing?", questions: [{ field: `f${events.length}` }], trip: {}, done: false, replyKind: "questions" }; } });
    await simulateScenario({ id: "x", turns: ["a", "b", "c"] }, {}, ai, { afterTurn: async () => { events.push("pause"); } });
    expect(events).toEqual(["model", "pause", "model", "pause", "model"]);
  });
});
