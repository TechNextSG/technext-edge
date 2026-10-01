#!/usr/bin/env node
/**
 * What a single sequential run cannot show, measured against a deployment: the cold start, how much the numbers move
 * from run to run, and what happens when several guests write at once. Also times a WhatsApp turn and the studio routes
 * with the deployment's own secrets.
 *
 *   EVAL_BYPASS_SECRET=...  node tools/live-eval/load-test.mjs --base https://<host> --secrets-file <file> \
 *       --cold-wait-min 10 --repeat 5 --concurrency 1,3,5,10
 *
 * --secrets-file is a dotenv-style file OUTSIDE git (bff/.env.bench is ignored by `.env*`) holding WHATSAPP_APP_SECRET
 * and STAFF_ACCESS_KEY of the deployment. They are read here and never printed.
 *
 * Side effects on the deployment, all labelled: every simulated guest is a synthetic number 63917999NNNN (no real phone
 * is involved: the webhook is signed here, not sent by Meta). Each turn mints a draft quotation under that number in the
 * deployment's store, the bot then tries to answer through the real Graph API to a number that does not exist (that send
 * fails, and its time is part of the turn), and the model calls spend the deployment's Gemini quota. `--cleanup` removes
 * the drafts of that number range afterwards, by explicit id, through the studio's own cleanup route.
 */
import { createHmac, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const base = flag("base");
if (!base) { console.error("--base <url> is required"); process.exit(2); }
const secretsFile = flag("secrets-file");
if (secretsFile) process.loadEnvFile(secretsFile);
const appSecret = process.env.WHATSAPP_APP_SECRET;
const staffKey = process.env.STAFF_ACCESS_KEY;
const bypass = process.env.EVAL_BYPASS_SECRET;
const guard = bypass ? { "x-vercel-protection-bypass": bypass } : {};
const coldWaitMin = Number(flag("cold-wait-min", "0"));
const repeat = Number(flag("repeat", "0"));
const perRun = Number(flag("per-run", "8"));
const levels = flag("concurrency", "").split(",").filter(Boolean).map(Number);
const delayMs = Number(flag("delay", "3500"));
const out = flag("out", "ai/eval/results/load-prod.json");
const cleanup = argv.includes("--cleanup");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PREFIX = "63917999";
let phoneSeq = Math.floor(Math.random() * 1000) * 5; // start somewhere in the range so two runs do not reuse numbers
const nextPhone = () => `${PREFIX}${String(phoneSeq++ % 10000).padStart(4, "0")}`;

function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, min: v[0], p50: q(0.5), p90: q(0.9), p95: q(0.95), max: v[v.length - 1], mean: Math.round(v.reduce((s, x) => s + x, 0) / v.length) };
}
async function timed(fn) {
  const t = performance.now();
  let result, error = null;
  try { result = await fn(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  return { ms: Math.round(performance.now() - t), result, error };
}

const report = { ranAt: new Date().toISOString(), base, label: "load-test", phonePrefix: PREFIX, phases: {} };

// ---- the calls ------------------------------------------------------------------------------------------------
const MESSAGES = [
  "Hi, 2 of us, 1 deluxe room, 2026-12-01 to 2026-12-03, full board, no transfer, no diving, name Ana.",
  "hi we are 4 coming next Saturday for 3 nights",
  "We are 6 guests staying 3 nights from 2026-12-01 in 3 deluxe rooms, full board, no transfer. 1 person dives day 1, 5 dive both days. Name is Ana.",
  "我们4个人，11月20日入住，住2晚，要豪华房，全餐，不需要接送，我的名字是 Miguel。",
  "Hi is Casa Escondida open this weekend? how much per person",
  "Chào Casa, nhà mình 4 người, check-in 2026-12-10, ở 3 đêm, ăn đủ bữa, phòng standard, không cần đưa đón. Tên mình là Lan.",
  "hi po! kami ni misis, 2 lang po, Dec 5 to Dec 7, full board po. deluxe room sana. Jun nga pala name ko",
  "Hi, 5 of us, standard rooms, 2026-12-01 to 2026-12-03, full board, no transfer, no diving, name Ria.",
];
const extract = (text) =>
  fetch(`${base}/v1/extract`, { method: "POST", headers: { "content-type": "application/json", ...guard }, body: JSON.stringify({ text }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

function webhookDelivery(phone, text) {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "15550000000", phone_number_id: "PN" },
    contacts: [{ profile: { name: "Bench" }, wa_id: phone }],
    messages: [{ from: phone, id: `wamid.BENCH.${randomUUID()}`, timestamp: `${Math.floor(Date.now() / 1000)}`, type: "text", text: { body: text } }],
  } }] }] });
  return fetch(`${base}/v1/channels/whatsapp/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`, ...guard },
    body,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}

// ---- 1. cold start --------------------------------------------------------------------------------------------
if (coldWaitMin > 0) {
  console.log(`\n== cold start: idle for ${coldWaitMin} min, then the first requests`);
  await sleep(coldWaitMin * 60_000);
  const health = await timed(() => fetch(`${base}/v1/health`, { headers: guard }).then((r) => r.text()));
  const ext = await timed(() => extract(MESSAGES[0]));
  const health2 = await timed(() => fetch(`${base}/v1/health`, { headers: guard }).then((r) => r.text()));
  report.phases.cold = { idleMin: coldWaitMin, healthFirstMs: health.ms, extractFirstMs: ext.ms, extractStatus: ext.result?.status, healthSecondMs: health2.ms };
  console.log(`  health (first) ${health.ms}ms, extract (first) ${ext.ms}ms [${ext.result?.status}], health (second) ${health2.ms}ms`);
  if (appSecret) {
    const t = await timed(() => webhookDelivery(nextPhone(), MESSAGES[0]));
    report.phases.cold.webhookTurnMs = t.ms;
    console.log(`  webhook turn right after: ${t.ms}ms`);
  }
}

// ---- 2. the same calls, several times ----------------------------------------------------------------------------
if (repeat > 0) {
  console.log(`\n== repeat: ${repeat} runs x ${perRun} extract calls`);
  const runs = [];
  for (let r = 0; r < repeat; r++) {
    const walls = [];
    let rejected = 0;
    for (let i = 0; i < perRun; i++) {
      const t = await timed(() => extract(MESSAGES[i % MESSAGES.length]));
      if (t.result?.status === 200) walls.push(t.ms); else rejected++;
      await sleep(delayMs);
    }
    const s = stats(walls);
    runs.push({ run: r + 1, rejected, ...s });
    console.log(`  run ${r + 1}: p50 ${s.p50}ms  p95 ${s.p95}ms  max ${s.max}ms  rejected ${rejected}/${perRun}`);
    if (r < repeat - 1) await sleep(20_000);
  }
  const p50s = runs.map((x) => x.p50).filter(Number.isFinite);
  const means = runs.map((x) => x.mean).filter(Number.isFinite);
  const spread = (a) => (a.length ? { min: Math.min(...a), max: Math.max(...a) } : null);
  report.phases.repeat = { runs, perRun, p50Spread: spread(p50s), meanSpread: spread(means), rejectedTotal: runs.reduce((s, x) => s + x.rejected, 0), calls: runs.length * perRun };
}

// ---- 3. several guests at once -----------------------------------------------------------------------------------
if (levels.length && appSecret) {
  console.log(`\n== concurrency: ${levels.join(", ")} guests writing at the same moment`);
  report.phases.concurrency = [];
  for (const c of levels) {
    const phones = Array.from({ length: c }, nextPhone);
    const started = performance.now();
    const results = await Promise.all(phones.map((p, i) => timed(() => webhookDelivery(p, MESSAGES[i % MESSAGES.length]))));
    const wall = Math.round(performance.now() - started);
    const ok = results.filter((r) => r.result?.status === 200);
    const replied = ok.reduce((s, r) => s + (r.result.json.replied ?? 0), 0);
    const failedTurns = ok.reduce((s, r) => s + (r.result.json.failed ?? 0), 0);
    const s = stats(ok.map((r) => r.ms));
    report.phases.concurrency.push({ guests: c, wallMs: wall, http200: ok.length, replied, failedTurns, errors: results.filter((r) => r.error).length, ...s });
    console.log(`  ${String(c).padStart(2)} at once: ${ok.length}/${c} answered 200, replied ${replied}, failed turns ${failedTurns}, p50 ${s.p50}ms  p95 ${s.p95}ms  max ${s.max}ms  (whole burst ${wall}ms)`);
    await sleep(30_000);
  }
}

// ---- 4. studio routes, with the deployment's staff key ---------------------------------------------------------------
if (staffKey) {
  const staff = { "x-verify-token": staffKey, ...guard };
  console.log("\n== studio routes (deployment, staff key)");
  const list = await fetch(`${base}/v1/quotes`, { headers: staff }).then((r) => r.json()).catch(() => ({}));
  const all = list.quotations ?? [];
  report.phases.studio = { quotationsInStore: all.length };
  const lat = async (label, fn, n = 20) => {
    const walls = [];
    for (let i = 0; i < n; i++) { const t = await timed(fn); if (!t.error) walls.push(t.ms); }
    report.phases.studio[label] = stats(walls);
    console.log(`  ${label.padEnd(18)} p50 ${report.phases.studio[label].p50}ms  p95 ${report.phases.studio[label].p95}ms`);
  };
  await lat("list", () => fetch(`${base}/v1/quotes`, { headers: staff }).then((r) => r.text()));
  const mine = all.find((x) => String(x.phone ?? "").startsWith(PREFIX) && x.bffTrip) ?? all.find((x) => x.bffTrip);
  if (mine) {
    report.phases.studio.measuredQuote = String(mine.phone ?? "").startsWith(PREFIX) ? "a benchmark draft" : "an existing record (read only)";
    await lat("read", () => fetch(`${base}/v1/quotes/${mine.quoteId}`, { headers: staff }).then((r) => r.text()));
    await lat("studioPage", () => fetch(`${base}/quotes/${mine.quoteId}`, { headers: staff }).then((r) => r.text()));
  }
}

// ---- 5. clean up what this run created ---------------------------------------------------------------------------------
if (cleanup && staffKey) {
  const staff = { "x-verify-token": staffKey, "content-type": "application/json", ...guard };
  const list = await fetch(`${base}/v1/quotes?limit=500`, { headers: staff }).then((r) => r.json()).catch(() => ({}));
  const mine = (list.quotations ?? []).filter((x) => String(x.phone ?? "").startsWith(PREFIX));
  const ids = mine.map((x) => x.quoteId);
  const res = ids.length
    ? await fetch(`${base}/v1/quotes/cleanup-duplicates`, { method: "POST", headers: staff, body: JSON.stringify({ ids, force: true, confirm: true }) }).then((r) => r.json()).catch(() => null)
    : { removed: [] };
  report.phases.cleanup = { found: ids.length, removed: res?.removed?.length ?? 0 };
  console.log(`\n== cleanup: ${ids.length} benchmark drafts found, ${res?.removed?.length ?? 0} removed`);
}

await mkdir(path.dirname(path.resolve(root, out)), { recursive: true });
await writeFile(path.resolve(root, out), JSON.stringify(report, null, 2));
console.log(`\nWritten: ${out}`);
process.exit(0);
