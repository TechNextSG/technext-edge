// The judge itself: prompt, parse, repeat, take the median, and the order-swapped pairwise comparison.
// The model is reached only through `provider.generateText(system, user)`, the one free-text call the ai package
// exposes. It has no temperature parameter, so steadiness comes from repeating and taking the median, not from
// asking the model to be calm.
import { createHash } from "node:crypto";
import { median } from "./stats.mjs";
import { CRITERION_IDS, JudgeOutput, PairOutput, parseJsonLoose } from "../schema.mjs";

const SYSTEM = [
  "You grade the replies of a hospitality chatbot for a small dive resort (Casa Escondida, Philippines) on WhatsApp.",
  "You are strict and you use the whole 1-5 scale. A score of 5 is rare.",
  "The bot never quotes prices, never promises a room, and hands complaints, cancellations, refunds, partner rates and",
  "stalled threads to staff. Staff reply to the guest later; that is normal and good.",
  "Machine checks for money, links, dates and counts have already run. Do not repeat them; grade what code cannot.",
  "Answer with one JSON object and nothing else. For each criterion write the reason FIRST, then the score.",
].join(" ");

export const PROMPT_VERSION = 1;

export function promptHash(rubric) {
  return createHash("sha256")
    .update(JSON.stringify({ v: PROMPT_VERSION, system: SYSTEM, rubric }))
    .digest("hex")
    .slice(0, 12);
}

function rubricText(rubric) {
  return rubric.criteria
    .map((c) => {
      const levels = Object.entries(c.levels).map(([k, v]) => `    ${k} = ${v}`).join("\n");
      return `- ${c.id}: ${c.question}\n${levels}`;
    })
    .join("\n");
}

const factsText = (scenario) =>
  JSON.stringify({ facts: scenario.facts ?? {}, expectHandoff: scenario.expectHandoff ?? null, note: scenario.note ?? "" });

const shape = (leaf) =>
  JSON.stringify(Object.fromEntries(CRITERION_IDS.map((id) => [id, leaf])));

export function buildScorePrompt(rubric, scenario, transcript) {
  const user = [
    "RUBRIC (version " + rubric.version + "):",
    rubricText(rubric),
    "",
    "REFERENCE FACTS AND EXPECTATION (ground truth, not shown to the guest):",
    factsText(scenario),
    "",
    "CONVERSATION:",
    transcript,
    "",
    "Return JSON of exactly this shape, scores are integers 1-5:",
    shape({ reason: "<one or two sentences>", score: 3 }),
  ].join("\n");
  return { system: SYSTEM, user };
}

export function buildPairPrompt(rubric, scenario, transcriptA, transcriptB) {
  const user = [
    "RUBRIC (version " + rubric.version + "):",
    rubricText(rubric),
    "",
    "REFERENCE FACTS AND EXPECTATION (ground truth, not shown to the guest):",
    factsText(scenario),
    "",
    "CONVERSATION A:",
    transcriptA,
    "",
    "CONVERSATION B:",
    transcriptB,
    "",
    "For each criterion decide which conversation is better, or tie if you cannot tell. Return JSON of exactly this shape:",
    shape({ reason: "<one or two sentences>", winner: "A" }),
  ].join("\n");
  return { system: SYSTEM, user };
}

/** One model answer, parsed and validated; one retry when the first answer is not usable. */
async function askJson(provider, prompt, schema) {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let text;
    try {
      text = await provider.generateText(prompt.system, attempt === 0 ? prompt.user : `${prompt.user}\n\nYour last answer was not valid (${lastError}). Return only the JSON object.`);
    } catch (error) {
      lastError = `call failed: ${String(error?.message ?? error).slice(0, 120)}`;
      continue;
    }
    try {
      return { ok: true, value: schema.parse(parseJsonLoose(text)) };
    } catch (error) {
      lastError = String(error?.message ?? error).slice(0, 160);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Score one transcript `runs` times. A criterion's score is the median of the valid runs; if the runs spread by more
 * than one point the criterion is flagged unstable and should be read as "the judge is unsure".
 */
export async function scoreTranscript({ provider, rubric, scenario, transcript, runs = 3 }) {
  const prompt = buildScorePrompt(rubric, scenario, transcript);
  const valid = [];
  let invalid = 0;
  let lastError = "";
  for (let i = 0; i < runs; i++) {
    const r = await askJson(provider, prompt, JudgeOutput);
    if (r.ok) valid.push(r.value);
    else {
      invalid += 1;
      lastError = r.error;
    }
  }
  if (valid.length === 0) return { status: "invalid", error: lastError, runs, invalidRuns: invalid, criteria: null };
  const criteria = {};
  for (const id of CRITERION_IDS) {
    const scores = valid.map((v) => v[id].score);
    criteria[id] = {
      score: median(scores),
      scores,
      unstable: Math.max(...scores) - Math.min(...scores) > 1,
      reason: valid[0][id].reason,
    };
  }
  return { status: "ok", runs, invalidRuns: invalid, criteria };
}

/**
 * A against B, asked twice with the order swapped. A criterion counts only when both orders pick the same
 * conversation: if swapping the positions changes the verdict, the verdict was about position, not quality.
 */
export async function comparePair({ provider, rubric, scenario, transcriptA, transcriptB }) {
  const first = await askJson(provider, buildPairPrompt(rubric, scenario, transcriptA, transcriptB), PairOutput);
  const second = await askJson(provider, buildPairPrompt(rubric, scenario, transcriptB, transcriptA), PairOutput);
  if (!first.ok || !second.ok) return { status: "invalid", error: first.error ?? second.error, criteria: null };
  const flip = (w) => (w === "A" ? "B" : w === "B" ? "A" : "tie");
  const criteria = {};
  for (const id of CRITERION_IDS) {
    const one = first.value[id].winner;
    const two = flip(second.value[id].winner); // second run showed B first, so map back to the original labels
    criteria[id] = { winner: one === two ? one : "inconsistent", firstOrder: one, secondOrder: two };
  }
  return { status: "ok", criteria };
}
