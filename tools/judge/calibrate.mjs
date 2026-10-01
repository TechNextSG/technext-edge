#!/usr/bin/env node
/**
 * Does the judge agree with a person? Until it does, its scores are only a guess.
 *
 *   npm run judge:calibrate -- template --run tools/judge/results/<run> [--n 30] [--seed 7]
 *       writes tools/judge/labels.template.json: a sample of transcripts with empty scores for a person to fill in
 *   (fill in the scores, 1-5 per criterion, same rubric, save as tools/judge/labels.human.json)
 *   npm run judge:calibrate -- compare --run tools/judge/results/<run> [--labels tools/judge/labels.human.json]
 *       prints agreement per criterion and writes tools/judge/calibration.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CRITERION_IDS } from "./schema.mjs";
import { exactAgreement, withinOneAgreement, spearman, weightedKappa, seededRandom } from "./lib/stats.mjs";
import { renderTranscript } from "./lib/simulate.mjs";
import { KAPPA_THRESHOLD } from "./lib/summary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const loadJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const keyOf = (candidate, scenarioId) => `${candidate}|${scenarioId}`;

/**
 * A sample spread over the scenarios: round-robin across scenarios (shuffled by a seed) so no scenario is drawn twice
 * before every one has been drawn once.
 */
export function sampleKeys(keysByScenario, n, seed) {
  const rand = seededRandom(seed);
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const queues = shuffle(Object.keys(keysByScenario)).map((s) => shuffle(keysByScenario[s]));
  const out = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= n) break;
      if (q.length) out.push(q.shift());
    }
  }
  return out;
}

export function buildTemplate({ transcripts, meta, n, seed }) {
  const byScenario = {};
  for (const [candidate, runs] of Object.entries(transcripts.results)) {
    for (const scenarioId of Object.keys(runs)) (byScenario[scenarioId] ??= []).push(keyOf(candidate, scenarioId));
  }
  const keys = sampleKeys(byScenario, n, seed);
  const scenarioById = Object.fromEntries(transcripts.scenarios.map((s) => [s.id, s]));
  return {
    rubricVersion: meta.rubricVersion,
    instructions: "Score each criterion 1-5 with tools/judge/rubric.json open. Do not look at summary.md first. Save as labels.human.json.",
    items: keys.map((key) => {
      const [candidate, scenarioId] = key.split("|");
      return {
        key,
        facts: scenarioById[scenarioId].facts,
        expectHandoff: scenarioById[scenarioId].expectHandoff ?? null,
        transcript: renderTranscript(transcripts.results[candidate][scenarioId].run),
        scores: Object.fromEntries(CRITERION_IDS.map((id) => [id, null])),
      };
    }),
  };
}

export function compareToHuman({ labels, scores }) {
  const criteria = {};
  for (const id of CRITERION_IDS) {
    const human = [];
    const judge = [];
    for (const item of labels.items) {
      const [candidate, scenarioId] = item.key.split("|");
      const j = scores.scores?.[candidate]?.[scenarioId];
      const h = item.scores?.[id];
      if (j?.status !== "ok" || typeof h !== "number") continue;
      human.push(h);
      judge.push(Math.round(j.criteria[id].score));
    }
    criteria[id] = {
      n: human.length,
      exact: exactAgreement(human, judge),
      withinOne: withinOneAgreement(human, judge),
      spearman: human.length >= 3 ? spearman(human, judge) : null,
      kappa: human.length >= 3 ? weightedKappa(human, judge) : null,
    };
  }
  return criteria;
}

const f = (x) => (x == null ? "  – " : x.toFixed(2));

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = rest[i + 1];
  if (!opt.run) throw new Error("--run <results dir> is required");
  const dir = path.resolve(opt.run);
  const meta = loadJson(path.join(dir, "meta.json"));
  const transcripts = loadJson(path.join(dir, "transcripts.json"));

  if (mode === "template") {
    const out = path.join(here, "labels.template.json");
    const t = buildTemplate({ transcripts, meta, n: Number(opt.n ?? 30), seed: Number(opt.seed ?? 7) });
    writeFileSync(out, JSON.stringify(t, null, 2));
    console.log(`${t.items.length} transcripts to label -> ${out}`);
    return;
  }

  if (mode === "compare") {
    const labelsFile = path.resolve(opt.labels ?? path.join(here, "labels.human.json"));
    if (!existsSync(labelsFile)) throw new Error(`no labels at ${labelsFile}; run 'template', fill it in and save it there`);
    const labels = loadJson(labelsFile);
    const scores = loadJson(path.join(dir, "scores.json"));
    if (!scores.scores) throw new Error("this run was pairwise; calibrate against an absolute-score run");
    const criteria = compareToHuman({ labels, scores });
    console.log("criterion              n   exact  ±1    spearman  kappa(w)  trusted");
    for (const id of CRITERION_IDS) {
      const c = criteria[id];
      console.log(`${id.padEnd(22)} ${String(c.n).padStart(2)}  ${f(c.exact)}  ${f(c.withinOne)}  ${f(c.spearman)}      ${f(c.kappa)}      ${c.kappa != null && c.kappa >= KAPPA_THRESHOLD ? "yes" : "NO"}`);
    }
    writeFileSync(
      path.join(here, "calibration.json"),
      JSON.stringify({ judge: meta.judge, rubricVersion: meta.rubricVersion, promptHash: meta.promptHash, calibratedAt: new Date().toISOString(), criteria }, null, 2),
    );
    console.log(`\nwritten: tools/judge/calibration.json. Rebuild a run's summary with: npm run judge -- --summarize <run dir>`);
    return;
  }

  throw new Error("usage: calibrate.mjs template|compare --run <dir>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`judge:calibrate: ${error.message}`);
    process.exit(2);
  }
}
