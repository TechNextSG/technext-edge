#!/usr/bin/env node
/**
 * Benchmark + latency run against a running casa-bff, written as one JSON file the report is built from.
 *
 *   # terminal 1 (the dev server; the capture host lets the WhatsApp turn be timed end to end)
 *   ENABLE_HONO_QUOTATION_TOOL=true PORT=8799 WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:8899 npx tsx bff/src/dev.ts
 *   # terminal 2
 *   node tools/live-eval/benchmark.mjs --base http://127.0.0.1:8799 --capture 8899 --delay 4500
 *
 * What it measures
 *   accuracy  : ai/eval datasets scored with ai/eval/score.mjs (the same rules as the eval runner and the offline replay)
 *   latency   : POST /v1/extract, POST /v1/converse, a WhatsApp webhook turn (signed delivery -> reply reaches the capture host),
 *               and the routes that never touch a model (health, quotation list, studio page, quotation read, estimator compute)
 *
 * It paces model calls (`--delay`) because the free Gemini tier allows 15 requests a minute and one turn costs several; the
 * pacing is NOT in the latency numbers (each timer starts when its request is sent). A 429 retry inside the provider IS in them,
 * and is counted separately (`retried`), because that is the honest cost of running on that tier.
 *
 * Env: WHATSAPP_APP_SECRET, STAFF_ACCESS_KEY (or WHATSAPP_VERIFY_TOKEN) — read from .env.local like the other scripts.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { scoreCase, checkEvidence, checkPricedFields } from "../../ai/eval/score.mjs";

try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile("bff/.env.local"); } catch {}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const base = flag("base", "http://127.0.0.1:8799");
const capturePort = Number(flag("capture", "8899"));
const delayMs = Number(flag("delay", "4500"));
const datasets = flag("datasets", "mock-30,synthetic").split(",");
const turns = Number(flag("turns", "10"));
const fast = Number(flag("fast", "30"));
const out = flag("out", "ai/eval/results/benchmark.json");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const secret = process.env.WHATSAPP_APP_SECRET;
const staffKey = process.env.STAFF_ACCESS_KEY || process.env.WHATSAPP_VERIFY_TOKEN;
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  return { n: v.length, min: v[0], p50: q(0.5), p90: q(0.9), p95: q(0.95), max: v[v.length - 1], mean: Math.round(mean) };
}

async function timed(fn) {
  const t = performance.now();
  let result, error = null;
  try { result = await fn(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  return { ms: Math.round(performance.now() - t), result, error };
}

const report = { ranAt: new Date().toISOString(), base, node: process.version, platform: process.platform, accuracy: {}, latency: {} };

// ---- environment, as the server reports it ------------------------------------------------------------------
{
  const health = await fetch(`${base}/v1/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) { console.error(`No casa-bff answering at ${base}`); process.exit(2); }
}

// ---- 1. accuracy + extract latency ---------------------------------------------------------------------------
async function callExtract(text) {
  const res = await fetch(`${base}/v1/extract`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ text }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

const extractWalls = [];
for (const name of datasets) {
  const file = path.join(root, "ai/eval", `dataset.${name}.json`);
  const cases = JSON.parse(await readFile(file, "utf8"));
  console.log(`\n== accuracy: ${name} (${cases.length} messages)`);
  const rows = [];
  for (const c of cases) {
    const t = await timed(() => callExtract(c.text));
    if (t.error) {
      console.log(`  ✗ ${c.id.padEnd(30)} ${t.error.slice(0, 90)}`);
      rows.push({ id: c.id, error: t.error, wallMs: t.ms });
    } else {
      const trip = t.result.trip;
      const s = scoreCase(c, trip);
      const e = checkEvidence(trip, c.text);
      const p = checkPricedFields(c, trip);
      extractWalls.push(t.ms);
      rows.push({
        id: c.id, wallMs: t.ms, serverMs: t.result.meta?.ms, tokensIn: t.result.meta?.tokensIn, tokensOut: t.result.meta?.tokensOut,
        retried: Boolean(t.result.meta?.retried), provider: t.result.meta?.provider,
        fabricated: s.fabricated, requiredTotal: s.requiredTotal, requiredCorrect: s.requiredCorrect,
        evidenceStated: e.stated, evidenceOk: e.evidenceOk, pricedTotal: p.checked, pricedBad: p.mismatches.length,
        bad: s.rows.filter((r) => !r.stateOk || !r.valueOk || r.isFabrication).map((r) => ({ field: r.field, expected: r.expected, actual: r.actual, fabrication: r.isFabrication })),
      });
      const bad = rows[rows.length - 1].bad.length;
      console.log(`  ${s.fabricated ? "✗" : bad ? "~" : "✓"} ${c.id.padEnd(30)} ${s.requiredCorrect}/${s.requiredTotal} · ${t.ms}ms`);
    }
    await sleep(delayMs);
  }
  const ok = rows.filter((r) => !r.error);
  const sum = (k) => ok.reduce((a, r) => a + (r[k] ?? 0), 0);
  report.accuracy[name] = {
    cases: cases.length,
    failedCalls: rows.length - ok.length,
    fabricated: sum("fabricated"),
    required: { correct: sum("requiredCorrect"), total: sum("requiredTotal") },
    evidence: { ok: sum("evidenceOk"), total: sum("evidenceStated") },
    priced: { correct: sum("pricedTotal") - sum("pricedBad"), total: sum("pricedTotal") },
    tokens: { in: sum("tokensIn"), out: sum("tokensOut") },
    retriedCalls: ok.filter((r) => r.retried).length,
    wallMs: stats(ok.map((r) => r.wallMs)),
    serverMs: stats(ok.map((r) => r.serverMs)),
    rows,
  };
}
report.latency.extract = stats(extractWalls);

// ---- 2. /v1/converse ----------------------------------------------------------------------------------------
{
  const messages = [
    "Hi, 2 of us, 1 deluxe room, 2026-12-01 to 2026-12-03, full board, no transfer, no diving, name Ana.",
    "hi we are 4 coming next Saturday for 3 nights",
    "We are 6 guests staying 3 nights from 2026-12-01 in 3 deluxe rooms, full board, no transfer. 1 person dives day 1, 5 dive both days. Name is Ana.",
    "我们4个人，11月20日入住，住2晚，要豪华房，全餐，不需要接送，我的名字是 Miguel。",
    "Hi is Casa Escondida open this weekend? how much per person",
  ];
  console.log(`\n== latency: /v1/converse (${Math.min(turns, messages.length * 2)} calls)`);
  const walls = [], retried = [];
  for (let i = 0; i < Math.min(turns, messages.length * 2); i++) {
    const t = await timed(async () => {
      const res = await fetch(`${base}/v1/converse`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: messages[i % messages.length], channel: "whatsapp" }) });
      return res.json();
    });
    if (!t.error) { walls.push(t.ms); retried.push(Boolean(t.result?.meta?.retried)); }
    console.log(`  ${t.error ? "✗" : "✓"} ${t.ms}ms`);
    await sleep(delayMs);
  }
  report.latency.converse = { ...stats(walls), retriedCalls: retried.filter(Boolean).length };
}

// ---- 3. a WhatsApp turn, end to end ----------------------------------------------------------------------------
{
  const captured = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let text = null;
      try { text = JSON.parse(body)?.text?.body ?? null; } catch {}
      captured.push({ at: performance.now(), text });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.SENT.${randomUUID()}` }] }));
    });
  }).listen(capturePort, "127.0.0.1");

  const from = "639170000099";
  const reset = () => fetch(`${base}/v1/channels/whatsapp/threads/${from}/reset`, { method: "POST", headers: { "x-verify-token": verifyToken } }).catch(() => {});
  const send = async (text) => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { display_phone_number: "15550000000", phone_number_id: "PN" },
      contacts: [{ profile: { name: "Bench" }, wa_id: from }],
      messages: [{ from, id: `wamid.BENCH.${randomUUID()}`, timestamp: `${Math.floor(Date.now() / 1000)}`, type: "text", text: { body: text } }],
    } }] }] });
    const before = captured.length;
    const t0 = performance.now();
    const res = await fetch(`${base}/v1/channels/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` }, body });
    const json = await res.json().catch(() => ({}));
    const t1 = performance.now();
    // the webhook answers once the turn is done; the message is on the capture host by then (a moment later at most)
    for (let i = 0; i < 20 && captured.length === before; i++) await sleep(50);
    const reachedMs = captured.length > before ? captured[captured.length - 1].at - t0 : null;
    return { webhookMs: Math.round(t1 - t0), toGuestMs: reachedMs === null ? null : Math.round(reachedMs), replied: json.replied, handoffs: json.handoffs };
  };

  const scripts = [
    ["Hi, 2 of us, 1 deluxe room, 2026-12-01 to 2026-12-03, full board, no transfer, no diving, name Ana."],
    ["hi we are 4 coming next Saturday for 3 nights", "deluxe, full board, no transfer, no diving, name Lee"],
    ["Please cancel my booking for next week"],
    ["hey what is the wifi password?"],
    ["Hi, 5 of us, standard rooms, 2026-12-01 to 2026-12-03, full board, no transfer, no diving, name Ria."],
  ];
  console.log(`\n== latency: WhatsApp turn end to end (${turns} turns)`);
  const webhook = [], toGuest = [], perTurn = [];
  let n = 0;
  outer: for (let round = 0; ; round++) {
    for (const script of scripts) {
      await reset();
      for (const text of script) {
        if (n >= turns) break outer;
        const r = await send(text);
        n++;
        if (r.webhookMs) webhook.push(r.webhookMs);
        if (r.toGuestMs !== null) toGuest.push(r.toGuestMs);
        perTurn.push({ n, script: text.slice(0, 60), ms: r.webhookMs, handoff: r.handoffs >= 1, model: r.webhookMs > 100, replied: r.replied });
        console.log(`  turn ${n}: webhook ${r.webhookMs}ms, reply at guest ${r.toGuestMs ?? "n/a"}ms (replied ${r.replied}, handoffs ${r.handoffs})`);
        await sleep(delayMs);
      }
    }
  }
  report.latency.whatsappTurn = { webhook: stats(webhook), toGuest: stats(toGuest), metaDeadlineMs: 20000, turns: perTurn };
  server.close();
}

// ---- 4. routes that never touch a model --------------------------------------------------------------------------
{
  const staff = { "x-verify-token": staffKey };
  const lat = async (label, fn, n = fast) => {
    const walls = [];
    for (let i = 0; i < n; i++) { const t = await timed(fn); if (!t.error) walls.push(t.ms); }
    report.latency[label] = stats(walls);
    console.log(`  ${label.padEnd(24)} p50 ${report.latency[label].p50}ms  p95 ${report.latency[label].p95}ms  (${walls.length}/${n})`);
  };
  console.log(`\n== latency: routes without a model (${fast} calls each)`);
  await lat("health", () => fetch(`${base}/v1/health`).then((r) => r.text()));
  const list = await fetch(`${base}/v1/quotes`, { headers: staff }).then((r) => r.json()).catch(() => ({ quotations: [] }));
  const q = (list.quotations ?? []).find((x) => x.bffTrip);
  report.latency.quotationsInStore = (list.quotations ?? []).length;
  await lat("quotationList", () => fetch(`${base}/v1/quotes`, { headers: staff }).then((r) => r.text()));
  if (q) {
    await lat("quotationRead", () => fetch(`${base}/v1/quotes/${q.quoteId}`, { headers: staff }).then((r) => r.text()));
    await lat("studioPage", () => fetch(`${base}/quotes/${q.quoteId}`, { headers: staff }).then((r) => r.text()));
    report.latency.studioPageBytes = (await fetch(`${base}/quotes/${q.quoteId}`, { headers: staff }).then((r) => r.text())).length;
    await lat("estimatorCompute", () =>
      fetch(`${base}/v1/quotes/compute`, { method: "POST", headers: { ...staff, "content-type": "application/json" }, body: JSON.stringify({ trip: q.bffTrip }) }).then((r) => r.text()), Math.min(fast, 20));
  } else {
    console.log("  (no quotation in the store: studio page, read and compute were not timed)");
  }
}

await mkdir(path.dirname(path.resolve(root, out)), { recursive: true });
await writeFile(path.resolve(root, out), JSON.stringify(report, null, 2));
console.log(`\nWritten: ${out}`);
process.exit(0);
