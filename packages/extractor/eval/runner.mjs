#!/usr/bin/env node
// Eval harness, run against SIMULATED data — see dataset.synthetic.json's own
// header comment (well, JSON has none, so: see README.md next to this file).
// This is a dry run of the *mechanism*, not the real bake-off. Playbook and
// ADR-005a are explicit: synthetic messages report nothing that decides a
// model. When Eloa's 30 real, name-masked messages arrive, point this same
// script at dataset.real.json instead — nothing else about it should need
// to change.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --provider <name>: per-request override (see providerFromEnv.ts's
// KNOWN_PROVIDER_NAMES) instead of whatever the deployment's env vars
// default to. Requires EVAL_PROVIDER_API_KEY — the runner never has a
// built-in key, and doesn't accept one as a flag (that would put a secret
// in shell history / `ps`).
const args = process.argv.slice(2);
let PROVIDER;
let DATASET_ARG;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--provider") {
    PROVIDER = args[++i];
  } else if (!DATASET_ARG) {
    DATASET_ARG = args[i];
  }
}

const BASE_URL = process.env.EVAL_BASE_URL ?? "https://technext-edge-casa-bff.vercel.app";
const BYPASS = process.env.EVAL_BYPASS_SECRET; // required — no built-in default, see README
const PROVIDER_API_KEY = process.env.EVAL_PROVIDER_API_KEY;
const DATASET_PATH = DATASET_ARG ?? path.join(__dirname, "dataset.synthetic.json");

if (!BYPASS) {
  console.error("Set EVAL_BYPASS_SECRET (the Vercel deployment-protection bypass secret) before running.");
  process.exit(1);
}
if (PROVIDER && !PROVIDER_API_KEY) {
  console.error(`--provider ${PROVIDER} needs EVAL_PROVIDER_API_KEY set to that provider's key.`);
  process.exit(1);
}

const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));

async function callExtract(text) {
  const res = await fetch(`${BASE_URL}/v1/extract`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-vercel-protection-bypass": BYPASS,
    },
    body: JSON.stringify(PROVIDER ? { text, provider: PROVIDER, apiKey: PROVIDER_API_KEY } : { text }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function checkEvidence(trip, sourceText) {
  const haystack = sourceText.toLowerCase();
  let stated = 0;
  let evidenceOk = 0;
  for (const f of Object.values(trip)) {
    if (f.state === "stated") {
      stated++;
      if (f.evidence && haystack.includes(f.evidence.toLowerCase())) evidenceOk++;
    }
  }
  return { stated, evidenceOk };
}

function scoreCase(testCase, trip) {
  const rows = [];
  let fabricated = 0;
  let requiredTotal = 0;
  let requiredCorrect = 0;
  const REQUIRED = ["checkIn", "guests", "rooms", "nights"];

  for (const [field, expected] of Object.entries(testCase.expected)) {
    const actual = trip[field];
    const stateOk = actual.state === expected.state;
    const valueOk = expected.value === undefined ? true : actual.value === expected.value;

    // Fabrication per Playbook's own definition: "a value present that the
    // message never said AND NO HOUSE NORM COVERS." "default" is the house
    // norm doing its job on purpose — that is not fabrication, it's the
    // opposite: an honest, labeled guess. Only "stated"/"inferred" claim the
    // message itself as the source, so only those can be dishonest about it.
    const isFabrication =
      expected.state === "missing" && (actual.state === "stated" || actual.state === "inferred") && actual.value !== null;
    if (isFabrication) fabricated++;

    if (REQUIRED.includes(field) && expected.state === "stated") {
      requiredTotal++;
      if (stateOk && valueOk) requiredCorrect++;
    }

    rows.push({ field, expected, actual: { state: actual.state, value: actual.value }, stateOk, valueOk, isFabrication });
  }

  return { rows, fabricated, requiredTotal, requiredCorrect };
}

const results = [];
console.log(`\nRunning ${dataset.length} SIMULATED messages against ${BASE_URL}${PROVIDER ? ` (provider override: ${PROVIDER})` : ""}\n`);

for (const testCase of dataset) {
  const started = Date.now();
  let outcome;
  let error = null;
  try {
    outcome = await callExtract(testCase.text);
  } catch (err) {
    error = err.message;
  }
  const wallMs = Date.now() - started;

  if (error) {
    console.log(`✗ ${testCase.id.padEnd(28)} ERROR: ${error}`);
    results.push({ id: testCase.id, error, wallMs });
    continue;
  }

  const { rows, fabricated, requiredTotal, requiredCorrect } = scoreCase(testCase, outcome.trip);
  const { stated, evidenceOk } = checkEvidence(outcome.trip, testCase.text);
  const requiredPct = requiredTotal ? Math.round((requiredCorrect / requiredTotal) * 100) : 100;
  const badFields = rows.filter((r) => !r.stateOk || !r.valueOk || r.isFabrication);

  const mark = fabricated > 0 ? "✗ FABRICATED" : badFields.length ? "~" : "✓";
  console.log(
    `${mark} ${testCase.id.padEnd(28)} required ${requiredCorrect}/${requiredTotal} (${requiredPct}%) · ` +
      `evidence ${evidenceOk}/${stated} · ${outcome.meta.provider} · ${wallMs}ms`,
  );
  if (badFields.length) {
    for (const r of badFields) {
      console.log(
        `    ${r.isFabrication ? "FABRICATION" : "mismatch"} on "${r.field}": expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`,
      );
    }
  }

  results.push({
    id: testCase.id,
    provider: outcome.meta.provider,
    wallMs,
    serverMs: outcome.meta.ms,
    tokensIn: outcome.meta.tokensIn,
    tokensOut: outcome.meta.tokensOut,
    retried: outcome.meta.retried,
    fabricated,
    requiredTotal,
    requiredCorrect,
    evidenceStated: stated,
    evidenceOk,
    badFields: badFields.map((r) => r.field),
    trip: outcome.trip,
  });
}

const ok = results.filter((r) => !r.error);
const totalFabricated = ok.reduce((s, r) => s + r.fabricated, 0);
const totalRequired = ok.reduce((s, r) => s + r.requiredTotal, 0);
const totalRequiredCorrect = ok.reduce((s, r) => s + r.requiredCorrect, 0);
const totalStated = ok.reduce((s, r) => s + r.evidenceStated, 0);
const totalEvidenceOk = ok.reduce((s, r) => s + r.evidenceOk, 0);
const latencies = ok.map((r) => r.wallMs).sort((a, b) => a - b);
const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null;
const totalTokensIn = ok.reduce((s, r) => s + r.tokensIn, 0);
const totalTokensOut = ok.reduce((s, r) => s + r.tokensOut, 0);

console.log("\n" + "─".repeat(60));
console.log("SUMMARY — simulated data, not Eloa's real messages");
console.log("─".repeat(60));
console.log(`Fabricated fields         : ${totalFabricated}  (threshold: 0)`);
console.log(`Required fields correct   : ${totalRequiredCorrect}/${totalRequired} (${totalRequired ? Math.round((totalRequiredCorrect / totalRequired) * 100) : 0}%, threshold: ≥95%)`);
console.log(`Evidence verbatim         : ${totalEvidenceOk}/${totalStated} (${totalStated ? Math.round((totalEvidenceOk / totalStated) * 100) : 100}%, threshold: 100%)`);
console.log(`p95 latency               : ${p95 ?? "n/a"}ms (threshold: ≤8000ms)`);
console.log(`Question targeting        : not scored — needs a human/judge pass, see README`);
console.log(`Total tokens              : ${totalTokensIn} in / ${totalTokensOut} out`);
console.log(`Failed calls              : ${results.length - ok.length}/${results.length}`);

const outPath = path.join(__dirname, `results.${Date.now()}.json`);
await writeFile(outPath, JSON.stringify({ baseUrl: BASE_URL, dataset: DATASET_PATH, ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\nFull results written to ${outPath}`);
