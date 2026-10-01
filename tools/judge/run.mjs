#!/usr/bin/env node
/**
 * LLM-as-a-judge for the bot's replies (offline; never in the WhatsApp path). See tools/judge/README.md.
 *
 *   npm run judge -- --dry-run --candidate gemini:gemini-3.8-flash --judge deepseek:deepseek-flash
 *   npm run judge -- --candidate gemini:gemini-3.8-flash --judge deepseek:deepseek-flash
 *   npm run judge -- --pairwise gemini:gemini-3.8-flash,gemini:gemini-3.1-flash-lite --judge deepseek:deepseek-flash
 *   npm run judge -- --summarize tools/judge/results/<run>        # rebuild summary.md with the current calibration
 *
 * Keys come from the environment (GEMINI_API_KEY, DEEPSEEK_GATEWAY_KEY, DEEPSEEK_BASE_URL), optionally via .env.local.
 * Nothing here writes a key to disk.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  converse,
  classifyEnquiry,
  wantsHuman,
  declinesPartner,
  fallbackReply,
  stalledHandoffReply,
  partnerInvitationReply,
  detectLanguage,
  maskForLogging,
  verifyGuestFacingText,
  ASK_LIMIT,
  STALL_LIMIT,
  buildProvider,
  choiceFromName,
  isKnownModel,
  keyFor,
} from "../../ai/src/index.ts";
import { parseModelSpec, modelId, assertIndependentJudge } from "./lib/models.mjs";
import { createBudget, meterProvider, estimateCalls, BudgetExceededError } from "./lib/budget.mjs";
import { assertScenariosAllowed } from "./lib/guard.mjs";
import { simulateScenario, renderTranscript } from "./lib/simulate.mjs";
import { runCodeChecks } from "./lib/codechecks.mjs";
import { scoreTranscript, comparePair, promptHash } from "./lib/judge.mjs";
import { buildSummary } from "./lib/summary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, "../../.env.local")); } catch { /* keys may come from the shell */ }

export function parseArgs(argv) {
  const flags = new Set(["dry-run", "allow-real", "allow-self-preference"]);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument '${a}'`);
    const key = a.slice(2);
    if (flags.has(key)) out[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`--${key} needs a value`);
      out[key] = v;
    }
  }
  return out;
}

const env = process.env;
const aiEnv = {
  GEMINI_API_KEY: env.GEMINI_API_KEY,
  DEEPSEEK_GATEWAY_KEY: env.DEEPSEEK_GATEWAY_KEY,
  DEEPSEEK_BASE_URL: env.DEEPSEEK_BASE_URL,
  GEMINI_MODEL: env.GEMINI_MODEL,
  DEEPSEEK_MODEL: env.DEEPSEEK_MODEL,
};

function makeProvider(choice, budget, delayMs) {
  const key = keyFor(choice.provider, { keys: {} }, aiEnv);
  if (!key) throw new Error(`no API key for ${choice.provider}: set ${choice.provider === "gemini" ? "GEMINI_API_KEY" : "DEEPSEEK_GATEWAY_KEY"}`);
  const provider = buildProvider(choice, key, {
    timeoutsMs: { extract: 30_000, synthesis: 45_000 },
    deepseekBaseUrl: aiEnv.DEEPSEEK_BASE_URL,
  });
  return meterProvider(provider, budget, { delayMs });
}

const ai = {
  converse, classifyEnquiry, wantsHuman, declinesPartner, fallbackReply, stalledHandoffReply,
  partnerInvitationReply, detectLanguage, ASK_LIMIT, STALL_LIMIT,
};

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function loadCalibration() {
  const file = path.join(here, "calibration.json");
  return existsSync(file) ? loadJson(file) : null;
}

function collectCodeFailures(results, scenarios) {
  const gap = new Set(scenarios.filter((s) => s.knownGap).map((s) => s.id));
  const out = [];
  for (const [candidate, byScenario] of Object.entries(results)) {
    for (const [scenario, r] of Object.entries(byScenario)) {
      for (const [check, v] of Object.entries(r.checks)) {
        if (!v.ok) out.push({ candidate, scenario, check, detail: v.detail ?? "", knownGap: gap.has(scenario) });
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rubric = loadJson(path.join(here, "rubric.json"));

  if (args.summarize) {
    const dir = path.resolve(args.summarize);
    const meta = loadJson(path.join(dir, "meta.json"));
    const transcripts = loadJson(path.join(dir, "transcripts.json"));
    const scores = existsSync(path.join(dir, "scores.json")) ? loadJson(path.join(dir, "scores.json")) : {};
    const results = meta.pairwise ? null : mergeResults(transcripts.results, scores.scores);
    const summary = buildSummary({
      meta,
      results,
      pairwise: meta.pairwise ? { a: meta.pairwise[0], b: meta.pairwise[1], byScenario: scores.pairwise } : null,
      calibration: loadCalibration(),
      codeFailures: results ? collectCodeFailures(results, transcripts.scenarios) : [],
    });
    writeFileSync(path.join(dir, "summary.md"), summary);
    console.log(`summary rewritten: ${path.join(dir, "summary.md")}`);
    return;
  }

  if (!args.judge) throw new Error("--judge <provider:model> is required");
  if (!args.candidate && !args.pairwise) throw new Error("give --candidate <spec[,spec]> or --pairwise <specA,specB>");

  const specParser = { choiceFromName, isKnownModel, env: aiEnv };
  const judgeChoice = parseModelSpec(args.judge, specParser);
  const pairwise = args.pairwise ? args.pairwise.split(",").map((s) => s.trim()) : null;
  if (pairwise && pairwise.length !== 2) throw new Error("--pairwise takes exactly two models: A,B");
  const candidateSpecs = pairwise ?? args.candidate.split(",").map((s) => s.trim());
  const candidates = candidateSpecs.map((s) => parseModelSpec(s, specParser));
  const { selfPreference } = assertIndependentJudge(judgeChoice, candidates, { allowSelfPreference: Boolean(args["allow-self-preference"]) });

  const scenarioFile = path.resolve(args.scenarios ?? path.join(here, "scenarios.json"));
  const file = loadJson(scenarioFile);
  const { masked } = assertScenariosAllowed(file, { allowRealFlag: Boolean(args["allow-real"]), env });
  let scenarios = file.scenarios;
  if (args.only) {
    const wanted = new Set(args.only.split(","));
    scenarios = scenarios.filter((s) => wanted.has(s.id));
  }
  if (scenarios.length === 0) throw new Error("no scenarios selected");

  const runs = Number(args.runs ?? 3);
  const maxCalls = Number(args["max-calls"] ?? 300);
  const estimate = estimateCalls({ scenarios, candidates: candidates.length, judgeRuns: runs, pairwise: Boolean(pairwise) });

  console.log(`scenarios: ${scenarios.length} (${estimate.guestTurns} guest turns) from ${path.relative(process.cwd(), scenarioFile)}`);
  console.log(`candidates: ${candidates.map(modelId).join(", ")}   judge: ${modelId(judgeChoice)}${selfPreference ? "  (SAME VENDOR: biased)" : ""}`);
  console.log(`expected model calls: ${estimate.generate} to write replies (worst case) + ${estimate.judge} to judge = ${estimate.total}; budget ${maxCalls}`);
  if (args["dry-run"]) {
    console.log("dry run: nothing was called.");
    return;
  }
  if (estimate.total > maxCalls) {
    throw new Error(`the run is expected to need ${estimate.total} calls, over --max-calls ${maxCalls}. Narrow it with --only, or raise the cap.`);
  }

  const budget = createBudget(maxCalls);
  const delayMs = Number(args["delay-ms"] ?? 0);
  const startedAt = new Date().toISOString();
  const outDir = path.resolve(args.out ?? path.join(here, "results", startedAt.replace(/[:.]/g, "-")));
  mkdirSync(outDir, { recursive: true });

  const judgeProvider = makeProvider(judgeChoice, budget, delayMs);
  const results = {};
  const maskRun = (r) => (masked ? { ...r, turns: r.turns.map((t) => ({ ...t, guest: maskForLogging(t.guest), reply: t.reply ? maskForLogging(t.reply) : t.reply })) } : r);

  try {
    for (const choice of candidates) {
      const id = modelId(choice);
      const provider = makeProvider(choice, budget, delayMs);
      results[id] = {};
      for (const scenario of scenarios) {
        process.stdout.write(`  ${id} ${scenario.id} ... `);
        const run = await simulateScenario(scenario, provider, ai);
        const checks = runCodeChecks({ scenario, run, verifyGuestFacingText });
        results[id][scenario.id] = { run, checks };
        console.log("replied");
      }
    }

    let scores = { scores: {} };
    if (pairwise) {
      const [a, b] = candidates.map(modelId);
      scores = { pairwise: {} };
      for (const scenario of scenarios) {
        process.stdout.write(`  judge pair ${scenario.id} ... `);
        const verdict = await comparePair({
          provider: judgeProvider,
          rubric,
          scenario,
          transcriptA: renderTranscript(maskRun(results[a][scenario.id].run)),
          transcriptB: renderTranscript(maskRun(results[b][scenario.id].run)),
        });
        scores.pairwise[scenario.id] = verdict;
        console.log(verdict.status);
      }
    } else {
      for (const [id, byScenario] of Object.entries(results)) {
        scores.scores[id] = {};
        for (const scenario of scenarios) {
          process.stdout.write(`  judge ${id} ${scenario.id} ... `);
          const judged = await scoreTranscript({
            provider: judgeProvider,
            rubric,
            scenario,
            transcript: renderTranscript(maskRun(byScenario[scenario.id].run)),
            runs,
          });
          scores.scores[id][scenario.id] = judged;
          console.log(judged.status);
        }
      }
    }

    const meta = {
      startedAt,
      judge: modelId(judgeChoice),
      rubricVersion: rubric.version,
      promptHash: promptHash(rubric),
      candidates: candidates.map(modelId),
      pairwise: pairwise ? candidates.map(modelId) : null,
      scenarioFile: path.relative(process.cwd(), scenarioFile),
      scenarioCount: scenarios.length,
      callsUsed: budget.used,
      maxCalls,
      selfPreference,
      masked,
    };
    writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
    writeFileSync(path.join(outDir, "transcripts.json"), JSON.stringify({ scenarios, results: stripToRuns(results) }, null, 2));
    writeFileSync(path.join(outDir, "scores.json"), JSON.stringify(scores, null, 2));
    const merged = pairwise ? null : mergeResults(stripToRuns(results), scores.scores);
    writeFileSync(
      path.join(outDir, "summary.md"),
      buildSummary({
        meta,
        results: merged,
        pairwise: pairwise ? { a: meta.pairwise[0], b: meta.pairwise[1], byScenario: scores.pairwise } : null,
        calibration: loadCalibration(),
        codeFailures: merged ? collectCodeFailures(merged, scenarios) : [],
      }),
    );
    console.log(`\ndone: ${budget.used} model calls. ${path.join(outDir, "summary.md")}`);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      console.error(`\n${error.message}. Nothing was written for this run.`);
      process.exitCode = 3;
      return;
    }
    throw error;
  }
}

/** transcripts.json keeps the run and the machine checks; scores.json keeps the judge. They are joined for the summary. */
function stripToRuns(results) {
  const out = {};
  for (const [c, byScenario] of Object.entries(results)) {
    out[c] = {};
    for (const [s, r] of Object.entries(byScenario)) out[c][s] = { run: r.run, checks: r.checks };
  }
  return out;
}

function mergeResults(transcripts, scores) {
  const out = {};
  for (const [c, byScenario] of Object.entries(transcripts)) {
    out[c] = {};
    for (const [s, r] of Object.entries(byScenario)) out[c][s] = { ...r, judge: scores?.[c]?.[s] ?? null };
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`judge: ${error.message}`);
    process.exit(2);
  });
}
