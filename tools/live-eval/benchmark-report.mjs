#!/usr/bin/env node
/**
 * Turns benchmark.mjs result files into one self-contained HTML report: the deployment is the headline, the local dev
 * server is the comparison (and the only place the WhatsApp turn and the staff routes can be timed without the
 * deployment's secrets).
 *
 *   node tools/live-eval/benchmark-report.mjs <production.json> <local.json> <load-production.json> <out.html>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [prodFile, localFile, loadFile, outFile] = process.argv.slice(2);
if (!prodFile || !localFile || !loadFile || !outFile) { console.error("usage: benchmark-report.mjs <production.json> <local.json> <load-production.json> <out.html>"); process.exit(2); }
const P = JSON.parse(readFileSync(prodFile, "utf8"));
const LD = JSON.parse(readFileSync(loadFile, "utf8")).phases;
const L = JSON.parse(readFileSync(localFile, "utf8"));

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ms = (v) => (v == null ? "n/a" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];

function totals(R) {
  const names = Object.keys(R.accuracy);
  const sum = (f) => names.reduce((s, n) => s + f(R.accuracy[n]), 0);
  const rows = names.flatMap((n) => R.accuracy[n].rows.map((r) => ({ ...r, set: n })));
  return {
    names, rows,
    cases: sum((a) => a.cases), failed: sum((a) => a.failedCalls), fabricated: sum((a) => a.fabricated),
    reqOk: sum((a) => a.required.correct), reqTotal: sum((a) => a.required.total),
    evOk: sum((a) => a.evidence.ok), evTotal: sum((a) => a.evidence.total),
    prOk: sum((a) => a.priced.correct), prTotal: sum((a) => a.priced.total),
    tokIn: sum((a) => a.tokens.in), tokOut: sum((a) => a.tokens.out),
  };
}
const tp = totals(P), tl = totals(L);
const answeredP = tp.cases - tp.failed;
const errsP = tp.rows.filter((r) => r.error);
const err429 = errsP.filter((r) => /429/.test(r.error)).length;
const errOther = errsP.length - err429;
const exP = P.latency.extract, exL = L.latency.extract, cvP = P.latency.converse, cvL = L.latency.converse;
const wa = L.latency.whatsappTurn;
const turns = wa.turns ?? [];
const modelMs = turns.filter((t) => t.model).map((t) => t.ms).sort((a, b) => a - b);
const THRESH = { req: 95, p95: 8000 };
const reqP = Math.round((tp.reqOk / tp.reqTotal) * 100), reqL = Math.round((tl.reqOk / tl.reqTotal) * 100);
const okRowsP = tp.rows.filter((r) => !r.error);
const overheadMs = Math.round(okRowsP.reduce((s, r) => s + (r.wallMs - (r.serverMs ?? r.wallMs)), 0) / okRowsP.length);

function bars(items, { max, warn } = {}) {
  const m = max ?? Math.max(...items.map((i) => i.value), 1);
  return `<div class="bars">${items.map((i) => {
    const w = Math.max(1, Math.round((i.value / m) * 100));
    const cls = i.fail ? "bar fail" : warn && i.value > warn ? "bar warn" : "bar";
    return `<div class="brow"><span class="bl" title="${esc(i.label)}">${esc(i.label)}</span><span class="bt"><span class="${cls}" style="width:${w}%"></span></span><span class="bv">${esc(i.text ?? ms(i.value))}</span></div>`;
  }).join("")}</div>`;
}
const prodBars = bars(
  tp.rows.slice().sort((a, b) => (b.error ? 0 : b.wallMs) - (a.error ? 0 : a.wallMs)).map((r) => r.error
    ? { label: `${r.set === "mock-30" ? "m" : "s"}/${r.id}`, value: 0.001, fail: true, text: /429/.test(r.error) ? "429 hết quota" : "502 lỗi" }
    : { label: `${r.set === "mock-30" ? "m" : "s"}/${r.id}`, value: r.wallMs }),
  { warn: THRESH.p95, max: 12000 },
);
const turnBars = bars(turns.map((t) => ({ label: `#${t.n} ${t.script}`, value: t.ms, text: t.replied === 0 ? "không trả lời (thread đã giao người)" : ms(t.ms) })), { max: wa.metaDeadlineMs });

const card = (title, value, sub, tone = "") => `<div class="card ${tone}"><div class="ct">${esc(title)}</div><div class="cv">${value}</div><div class="cs">${sub}</div></div>`;
const pill = (ok, yes = "đạt", no = "chưa đạt") => `<span class="pill ${ok ? "ok" : "bad"}">${ok ? yes : no}</span>`;
const lat = (s) => `<td class="n">${s.n}</td><td class="n">${ms(s.min)}</td><td class="n">${ms(s.p50)}</td><td class="n">${ms(s.p90)}</td><td class="n">${ms(s.p95)}</td><td class="n">${ms(s.max)}</td><td class="n">${ms(s.mean)}</td>`;
const misses = (R) => totals(R).rows.flatMap((r) => (r.bad ?? []).map((b) => ({ set: r.set, id: r.id, ...b })));
const realMissesP = misses(P).filter((m) => m.field !== "rooms");

const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Báo cáo benchmark và latency: production</title>
<style>
:root{--bg:#f5f7fa;--card:#fff;--text:#18212b;--muted:#5c6b7b;--line:#d9e0e8;--accent:#1f6feb;--ok:#1a7f4b;--okbg:#dff3e7;--bad:#b42318;--badbg:#fde4e1;--warn:#9a6700;--warnbg:#fff1cc;--bar:#4c8df6;--barw:#e0a526;--barf:#d64545;--code:#eef2f6}
@media (prefers-color-scheme:dark){:root{--bg:#0f141a;--card:#171e27;--text:#e5ebf1;--muted:#92a0af;--line:#2a3441;--accent:#6aa5ff;--ok:#56d08c;--okbg:#14301f;--bad:#ff8a7f;--badbg:#3a1a17;--warn:#f0c14b;--warnbg:#352a0d;--bar:#5b9bff;--barw:#e0a526;--barf:#e0605a;--code:#1d2733}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px 16px 60px}
main{max-width:1080px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}
h2{font-size:19px;margin:34px 0 10px;padding-top:6px;border-top:1px solid var(--line)}
h3{font-size:15px;margin:18px 0 6px}
.sub{color:var(--muted);margin:0 0 20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:14px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card.ok{border-left:5px solid var(--ok)}.card.bad{border-left:5px solid var(--bad)}.card.warn{border-left:5px solid var(--barw)}
.ct{color:var(--muted);font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
.cv{font-size:28px;font-weight:700;margin:2px 0}
.cs{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:8px 0;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--code);font-size:12.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
.pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:12.5px;font-weight:600}
.pill.ok{background:var(--okbg);color:var(--ok)}.pill.bad{background:var(--badbg);color:var(--bad)}.pill.warn{background:var(--warnbg);color:var(--warn)}
.bars{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.brow{display:grid;grid-template-columns:minmax(120px,300px) 1fr 110px;gap:10px;align-items:center;padding:2px 0;font-size:13px}
.bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace;font-size:12px}
.bt{background:var(--code);border-radius:6px;height:12px;overflow:hidden}
.bar{display:block;height:100%;background:var(--bar);border-radius:6px}.bar.warn{background:var(--barw)}.bar.fail{background:var(--barf)}
.bv{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
.note{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:8px;padding:10px 14px;margin:10px 0}
.note.warn{border-left-color:var(--barw)}.note.bad{border-left-color:var(--bad)}.note.ok{border-left-color:var(--ok)}
code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:13px}
ul{margin:6px 0 6px 20px;padding:0}
.small{color:var(--muted);font-size:13px}
@media(max-width:700px){.brow{grid-template-columns:100px 1fr 80px}}
</style>
</head>
<body>
<main>
<h1>Báo cáo benchmark và latency: bản production</h1>
<p class="sub">Kênh AI của technext-edge, đo ngày ${esc(P.ranAt.slice(0, 10))} trên <code>technext-edge-casa-bff.vercel.app</code> (bản production, commit <code>48551f4</code>, đã gồm đợt tái cấu trúc), model <code>${esc(tp.rows.find((r) => r.provider)?.provider ?? "google:gemini")}</code>. Máy đo ở local, gọi qua Internet vào Vercel (<code>iad1</code>) bằng link bypass SSO; phần khởi động nguội, độ dao động, nhiều khách cùng lúc và route studio đo bằng secret của production (xem mục 4). Phần "local" là bản so sánh trên máy phát triển.</p>

<h2>1. Tóm tắt</h2>
<div class="cards">
${card("Bịa dữ kiện", String(tp.fabricated), `trên ${answeredP} tin đã trả lời; ngưỡng 0`, tp.fabricated === 0 ? "ok" : "bad")}
${card("Trường bắt buộc đúng", `${reqP}%`, `${tp.reqOk}/${tp.reqTotal}; ngưỡng ≥ ${THRESH.req}%`, reqP >= THRESH.req ? "ok" : "bad")}
${card("Lời gọi bị từ chối", `${tp.failed}/${tp.cases}`, `${err429} lỗi 429 (hết quota Gemini), ${errOther} lỗi 502; ở tốc độ 1 tin / 3 s`, "bad")}
${card("Extract p50 / p95", `${ms(exP.p50)} / ${ms(exP.p95)}`, `ngưỡng p95 ≤ ${ms(THRESH.p95)}; ${exP.n} lời gọi thành công`, exP.p95 <= THRESH.p95 ? "ok" : "warn")}
${card("Converse (cả lượt) p50", ms(cvP.p50), `p95 ${ms(cvP.p95)}; ${cvP.n} lời gọi`, "ok")}
${card("Độ trễ mạng tới Vercel", ms(P.latency.health.p50), `GET /v1/health, p95 ${ms(P.latency.health.p95)}; lần đầu ${ms(P.latency.healthFirstCall)}`, "ok")}
</div>
<div class="note bad"><b>Phát hiện chính trên production.</b> ${tp.failed} trên ${tp.cases} lời gọi (${pct(tp.failed, tp.cases)}) bị từ chối, ${err429} trong số đó là <b>429 từ Gemini: key của production cũng đang ở mức quota thấp</b> (gói miễn phí cho 15 yêu cầu mỗi phút). Ở nhịp đo này (khoảng 20 tin mỗi phút) khoảng một phần tư tin của khách sẽ nhận câu trả lời lỗi. Lưu lượng thật của một resort thấp hơn nhiều so với nhịp đo, nên rủi ro thấp hơn, nhưng <b>một đợt khách nhắn cùng lúc, hoặc buổi demo chạy cả bộ test, sẽ chạm trần</b>. Cách xử lý đơn giản nhất là dùng key có quota trả phí cho production.</div>
<div class="note ok"><b>Phần trả lời được thì tốt.</b> Không bịa trường nào, ${reqP}% trường bắt buộc đúng, bằng chứng 100% nguyên văn (${tp.evOk}/${tp.evTotal}), trường có giá đúng ${tp.prOk}/${tp.prTotal}. Một lời gọi trích xuất mất khoảng ${ms(exP.p50)}; p95 ${ms(exP.p95)} vẫn <b>chưa đạt ngưỡng 8 s</b>. Mạng chỉ thêm khoảng ${ms(overheadMs)} so với thời gian server tự đo.</div>

<div class="note"><b>Các phép đo thêm trên production (mục 4).</b> Khởi động nguội sau 10 phút chỉ thêm khoảng ${ms(LD.cold.healthFirstMs - LD.cold.healthSecondMs)} (nhưng 10 phút có thể chưa đủ nguội). Qua 5 lượt lặp, p50 của extract chỉ dao động ${ms(LD.repeat.p50Spread.min)}–${ms(LD.repeat.p50Spread.max)}, còn p95 dao động từ 5,4 s đến 10,2 s: <b>một con số p95 đơn lẻ không đáng tin</b>. 10 khách nhắn cùng lúc đều được webhook nhận (200), thời gian không tăng theo số khách, lớn nhất ${ms(Math.max(...LD.concurrency.map((c) => c.max)))} (73% hạn 20 s của Meta, trên số giả). Route studio trên production chậm hơn local hàng trăm lần (trang studio ${ms(LD.studio.studioPage.p50)} với ${LD.studio.quotationsInStore} bản ghi).</div>

<h2>2. Độ chính xác</h2>
<p class="small">Hai bộ giả lập trong <code>ai/eval/</code> (không phải 30 tin thật của Eloa), chấm bằng <code>ai/eval/score.mjs</code>. Chỉ những tin <b>được trả lời</b> mới được chấm, nên các tin bị 429 làm mẫu nhỏ đi.</p>
<table>
<tr><th>Môi trường</th><th>Bộ</th><th class="n">Tin</th><th class="n">Bị từ chối</th><th class="n">Bịa</th><th class="n">Bắt buộc đúng</th><th class="n">Bằng chứng</th><th class="n">Trường có giá</th></tr>
${[["production", P, tp], ["local", L, tl]].flatMap(([env, R, T]) => T.names.map((n) => { const a = R.accuracy[n]; return `<tr><td>${env}</td><td><code>${esc(n)}</code></td><td class="n">${a.cases}</td><td class="n">${a.failedCalls}</td><td class="n">${a.fabricated}</td><td class="n">${a.required.correct}/${a.required.total} (${pct(a.required.correct, a.required.total)})</td><td class="n">${a.evidence.ok}/${a.evidence.total}</td><td class="n">${a.priced.correct}/${a.priced.total}</td></tr>`; })).join("")}
<tr><td><b>production</b></td><td><b>tổng</b></td><td class="n"><b>${tp.cases}</b></td><td class="n"><b>${tp.failed}</b></td><td class="n"><b>${tp.fabricated}</b></td><td class="n"><b>${tp.reqOk}/${tp.reqTotal} (${reqP}%)</b></td><td class="n"><b>${tp.evOk}/${tp.evTotal}</b></td><td class="n"><b>${tp.prOk}/${tp.prTotal}</b></td></tr>
<tr><td><b>local</b></td><td><b>tổng</b></td><td class="n"><b>${tl.cases}</b></td><td class="n"><b>${tl.failed}</b></td><td class="n"><b>${tl.fabricated}</b></td><td class="n"><b>${tl.reqOk}/${tl.reqTotal} (${reqL}%)</b></td><td class="n"><b>${tl.evOk}/${tl.evTotal}</b></td><td class="n"><b>${tl.prOk}/${tl.prTotal}</b></td></tr>
</table>
<table>
<tr><th>Tiêu chí</th><th>Ngưỡng</th><th>Production</th><th>Local</th></tr>
<tr><td>Trường bịa ra</td><td>0</td><td>${tp.fabricated} ${pill(tp.fabricated === 0)}</td><td>${tl.fabricated} ${pill(tl.fabricated === 0)}</td></tr>
<tr><td>Trường bắt buộc đúng</td><td>≥ ${THRESH.req}%</td><td>${reqP}% ${pill(reqP >= THRESH.req)}</td><td>${reqL}% ${pill(reqL >= THRESH.req)}</td></tr>
<tr><td>Bằng chứng nguyên văn</td><td>100%</td><td>${pct(tp.evOk, tp.evTotal)} ${pill(tp.evOk === tp.evTotal)}</td><td>${pct(tl.evOk, tl.evTotal)} ${pill(tl.evOk === tl.evTotal)}</td></tr>
<tr><td>Trường có giá đúng (transport)</td><td>tất cả</td><td>${tp.prOk}/${tp.prTotal} ${pill(tp.prOk === tp.prTotal)}</td><td>${tl.prOk}/${tl.prTotal} ${pill(tl.prOk === tl.prTotal)}</td></tr>
<tr><td>p95 của extract</td><td>≤ ${ms(THRESH.p95)}</td><td>${ms(exP.p95)} ${pill(exP.p95 <= THRESH.p95)}</td><td>${ms(exL.p95)} ${pill(exL.p95 <= THRESH.p95)}</td></tr>
<tr><td>Lời gọi bị từ chối</td><td>0</td><td>${tp.failed}/${tp.cases} ${pill(tp.failed === 0)}</td><td>${tl.failed}/${tl.cases} ${pill(tl.failed === 0)}</td></tr>
</table>
<h3>Các chỗ bỏ sót trên production (không phải bịa)</h3>
<table>
<tr><th>Bộ</th><th>Tin</th><th>Trường</th><th>Đáp án</th><th>Nhận được</th></tr>
${realMissesP.map((m) => `<tr><td><code>${esc(m.set)}</code></td><td><code>${esc(m.id)}</code></td><td>${esc(m.field)}</td><td><code>${esc(JSON.stringify(m.expected))}</code></td><td><code>${esc(JSON.stringify(m.actual).slice(0, 80))}</code></td></tr>`).join("") || "<tr><td colspan=5>không có</td></tr>"}
</table>
<p class="small">Ngoài ra trường <code>rooms</code> luôn trả <code>default</code> = 1 (quy ước nhà) khi khách không nói, trong khi đáp án giả lập ghi <code>missing</code>: khác biệt về nhãn, không phải số bịa. Các ngày check-in tiếng Việt (<code>vi-01</code>, <code>vi-03</code>) là điểm yếu lặp lại ở cả hai môi trường.</p>

<h2>3. Latency (model)</h2>
<table>
<tr><th>Đường</th><th>Môi trường</th><th class="n">Số lần</th><th class="n">min</th><th class="n">p50</th><th class="n">p90</th><th class="n">p95</th><th class="n">max</th><th class="n">trung bình</th></tr>
<tr><td rowspan="2">POST /v1/extract</td><td>production</td>${lat(exP)}</tr>
<tr><td>local</td>${lat(exL)}</tr>
<tr><td rowspan="2">POST /v1/converse (cả lượt)</td><td>production</td>${lat(cvP)}</tr>
<tr><td>local</td>${lat(cvL)}</tr>
</table>
<p class="small">Production: thời gian phía server (<code>meta.ms</code>) trung bình thấp hơn thời gian đo ở client khoảng ${ms(overheadMs)}: đó là mạng và TLS tới Vercel. Số trên production chỉ tính các lời gọi thành công; lời gọi 429 trả lời nhanh nhưng không có kết quả nên không đưa vào.</p>
<h3>Production, từng tin (đỏ: bị từ chối; vàng: vượt 8 s)</h3>
${prodBars}

<h3>Mạng và khởi động nguội</h3>
<table>
<tr><th>Phép đo</th><th class="n">Số lần</th><th class="n">p50</th><th class="n">p95</th><th class="n">max</th></tr>
<tr><td>GET /v1/health tới production</td><td class="n">${P.latency.health.n}</td><td class="n">${ms(P.latency.health.p50)}</td><td class="n">${ms(P.latency.health.p95)}</td><td class="n">${ms(P.latency.health.max)}</td></tr>
<tr><td>Lần gọi đầu tiên của lượt đo</td><td class="n">1</td><td class="n" colspan="3">${ms(P.latency.healthFirstCall)}</td></tr>
</table>
<p class="small">Lần gọi đầu không chậm hơn các lần sau, nghĩa là function đã nóng khi bắt đầu đo (lượt đo chạy ngay sau hơn 40 lời gọi trích xuất). Khởi động nguội thật (sau nhiều phút không có ai gọi) <b>chưa được đo</b>.</p>

<h2>4. Production: khởi động nguội, độ dao động, nhiều khách cùng lúc, route studio</h2>
<p class="small">Đo bằng <code>tools/live-eval/load-test.mjs</code> với <code>WHATSAPP_APP_SECRET</code> và <code>STAFF_ACCESS_KEY</code> của production. Mỗi "khách" là số giả <code>63917999NNNN</code> (không có điện thoại thật); ${LD.cleanup?.removed ?? 0} bản nháp tạo ra đã được xoá theo id sau khi đo.</p>

<h3>4.1 Khởi động nguội (sau ${LD.cold.idleMin} phút không có lời gọi nào)</h3>
<table>
<tr><th>Phép đo</th><th class="n">Lần đầu sau khi nghỉ</th><th>So với bình thường</th></tr>
<tr><td>GET /v1/health</td><td class="n">${ms(LD.cold.healthFirstMs)}</td><td>lần ngay sau: ${ms(LD.cold.healthSecondMs)} (chênh khoảng ${ms(LD.cold.healthFirstMs - LD.cold.healthSecondMs)})</td></tr>
<tr><td>POST /v1/extract</td><td class="n">${ms(LD.cold.extractFirstMs)}</td><td>p50 bình thường ${ms(exP.p50)}: không thấy phạt khởi động</td></tr>
<tr><td>Một lượt WhatsApp (webhook)</td><td class="n">${ms(LD.cold.webhookTurnMs)}</td><td>cùng loại lượt ở mục 4.3 nằm trong khoảng 5–15 s</td></tr>
</table>
<div class="note warn">Khởi động nguội ở đây chỉ thêm khoảng ${ms(LD.cold.healthFirstMs - LD.cold.healthSecondMs)} cho route nhẹ. <b>Nhưng 10 phút có thể chưa đủ để function thật sự bị thu hồi</b>: Vercel có thể giữ instance lâu hơn. Số này là cận dưới của chi phí khởi động nguội; muốn số chắc hơn cần đo sau nhiều giờ không có ai gọi (ví dụ sáng sớm).</div>

<h3>4.2 Độ dao động giữa các lượt (5 lượt giống nhau, mỗi lượt 8 lời gọi extract)</h3>
<table>
<tr><th class="n">Lượt</th><th class="n">Thành công</th><th class="n">Bị từ chối</th><th class="n">p50</th><th class="n">p95</th><th class="n">max</th></tr>
${LD.repeat.runs.map((r) => `<tr><td class="n">${r.run}</td><td class="n">${r.n}/${LD.repeat.perRun}</td><td class="n">${r.rejected}</td><td class="n">${ms(r.p50)}</td><td class="n">${ms(r.p95)}</td><td class="n">${ms(r.max)}</td></tr>`).join("")}
</table>
<ul>
<li><b>p50 dao động từ ${ms(LD.repeat.p50Spread.min)} đến ${ms(LD.repeat.p50Spread.max)}</b> giữa các lượt (chênh ${ms(LD.repeat.p50Spread.max - LD.repeat.p50Spread.min)}): con số "điển hình" khá ổn, quanh 4–5,5 s.</li>
<li><b>p95 dao động mạnh hơn nhiều</b> (từ 5,4 s đến 10,2 s), vì mỗi lượt chỉ có vài lời gọi thành công nên p95 thực chất là lời gọi chậm nhất của lượt đó. Vì vậy một lần đo p95 đơn lẻ (như 9,2 s ở mục 3) có thể lệch gần gấp đôi; chưa đủ để kết luận "đạt" hay "chưa đạt" ngưỡng 8 s chỉ bằng một con số.</li>
<li><b>${LD.repeat.rejectedTotal}/${LD.repeat.calls} lời gọi bị từ chối (${pct(LD.repeat.rejectedTotal, LD.repeat.calls)})</b> ở nhịp 1 lời gọi mỗi 3,5 s: cùng mức với lần đo trước (12/44), nên đây là đặc tính ổn định của key hiện tại chứ không phải một lần xui.</li>
</ul>

<h3>4.3 Nhiều khách nhắn cùng một lúc (webhook ký, từ số giả)</h3>
<table>
<tr><th class="n">Khách cùng lúc</th><th class="n">Webhook trả 200</th><th class="n">Lượt lỗi khi gửi</th><th class="n">p50</th><th class="n">p95</th><th class="n">lớn nhất</th></tr>
${LD.concurrency.map((c) => `<tr><td class="n">${c.guests}</td><td class="n">${c.http200}/${c.guests}</td><td class="n">${c.failedTurns}</td><td class="n">${ms(c.p50)}</td><td class="n">${ms(c.p95)}</td><td class="n">${ms(c.max)}</td></tr>`).join("")}
</table>
<div class="note">Điều đo được: <b>cả ${LD.concurrency.reduce((s, c) => s + c.guests, 0)} lượt đều được webhook nhận (200)</b>, kể cả khi 10 khách gửi cùng lúc; thời gian không tăng theo số khách (10 khách cùng lúc có p50 ${ms(LD.concurrency.find((c) => c.guests === 10).p50)}, không chậm hơn 1 khách đơn lẻ ${ms(LD.concurrency[0].p50)}). Chưa thấy dấu hiệu bị xếp hàng hay đổ vỡ ở mức 10 khách. Thời gian lớn nhất là ${ms(Math.max(...LD.concurrency.map((c) => c.max)))}, bằng ${Math.round(Math.max(...LD.concurrency.map((c) => c.max)) / 20000 * 100)}% hạn 20 s của Meta.</div>
<div class="note warn"><b>Hai điều cần đọc cho đúng.</b> (1) Cột "Lượt lỗi khi gửi" luôn bằng số khách. <b>Nguyên nhân chưa được xác nhận bằng log của Vercel</b>; giả thuyết hợp lý nhất là số giả không tồn tại nên lần gửi tin qua Meta bị lỗi (ở local, khi capture host tắt, cùng hiện tượng xuất hiện). Nếu đúng, đây là hệ quả của cách đo chứ không phải lỗi của bot, và một lượt thật (gửi thành công) có thể nhanh hơn. Thời gian trên production (khoảng 5–15 s) gần gấp đôi ở local (khoảng 7 s), nhưng không tách được phần nào là gọi Meta, phần nào là Redis và mạng. (2) Mỗi mức dùng các tin đầu của cùng một danh sách (có tin hỏi chung "có mở cuối tuần này không", chuyển người ngay), nên các mức không so sánh tuyệt đối với nhau, chỉ cho thấy xu hướng.</div>

<h3>4.4 Route studio trên production (${LD.studio.quotationsInStore} bản ghi trong store)</h3>
<table>
<tr><th>Route</th><th class="n">p50</th><th class="n">p95</th><th class="n">local (p50)</th></tr>
<tr><td>GET /v1/quotes (danh sách)</td><td class="n">${ms(LD.studio.list.p50)}</td><td class="n">${ms(LD.studio.list.p95)}</td><td class="n">${ms(L.latency.quotationList.p50)}</td></tr>
<tr><td>GET /v1/quotes/:id (đọc một bản ghi)</td><td class="n">${ms(LD.studio.read.p50)}</td><td class="n">${ms(LD.studio.read.p95)}</td><td class="n">${ms(L.latency.quotationRead.p50)}</td></tr>
<tr><td>GET /quotes/:id (trang studio)</td><td class="n">${ms(LD.studio.studioPage.p50)}</td><td class="n">${ms(LD.studio.studioPage.p95)}</td><td class="n">${ms(L.latency.studioPage.p50)}</td></tr>
</table>
<div class="note warn">Trên production các route này chậm hơn local <b>hàng trăm lần</b>: khoảng 0,3 s là mạng, phần còn lại là các vòng gọi Redis (KV). Trang studio mất ${ms(LD.studio.studioPage.p50)} với chỉ ${LD.studio.quotationsInStore} bản ghi; trang này tải cả danh sách báo giá nên <b>thời gian có thể tăng theo số bản ghi</b> (chưa đo với nhiều bản ghi hơn, nên đây là rủi ro chứ chưa phải kết quả). Một giây rưỡi mỗi lần mở trang vẫn dùng được, nhưng đáng xem lại cách đọc danh sách (một lệnh đọc nhiều khoá thay vì từng khoá).</div>

<h2>5. Đo ở local để so sánh</h2>
<p class="small">Phần này chạy trên máy phát triển, có capture host nên đo được đến lúc tin tới khách (production gửi qua Meta thật nên không bắt được). Đừng suy ra số production từ đây; xem mục 4 cho số thật.</p>
<h3>5.1 Một lượt WhatsApp đầu–cuối (local)</h3>
<table>
<tr><th>Loại lượt</th><th class="n">Số lượt</th><th class="n">p50</th><th class="n">lớn nhất</th></tr>
<tr><td>Có gọi model</td><td class="n">${modelMs.length}</td><td class="n">${ms(q(modelMs, 0.5))}</td><td class="n">${ms(modelMs[modelMs.length - 1])}</td></tr>
<tr><td>Chuyển người ngay, không gọi model</td><td class="n">${turns.filter((t) => !t.model).length}</td><td class="n">vài ms</td><td class="n">vài ms</td></tr>
</table>
${turnBars}
<p class="small">Lượt WhatsApp có model chậm nhất ở local ${ms(modelMs[modelMs.length - 1])}, so với hạn ${ms(wa.metaDeadlineMs)} của Meta. Trên production sẽ cộng thêm gọi Redis và Meta Graph cho mỗi lượt; chưa đo.</p>
<h3>5.2 Route không dùng model (local, kho bộ nhớ)</h3>
<table>
<tr><th>Route</th><th class="n">p50</th><th class="n">p95</th></tr>
${[["GET /v1/quotes", L.latency.quotationList], ["GET /v1/quotes/:id", L.latency.quotationRead], ["GET /quotes/:id (trang studio)", L.latency.studioPage], ["POST /v1/quotes/compute (mô phỏng)", L.latency.estimatorCompute]].filter(([, s]) => s).map(([l, s]) => `<tr><td>${esc(l)}</td><td class="n">${ms(s.p50)}</td><td class="n">${ms(s.p95)}</td></tr>`).join("")}
</table>

<h2>6. Chưa đo, và vì sao</h2>
<ul>
<li><b>Khởi động nguội thật</b>: mới đo sau 10 phút nghỉ, có thể chưa đủ nguội; cần đo sau nhiều giờ không có ai gọi.</li>
<li><b>Tải cao hơn 10 khách cùng lúc</b>, và tải kéo dài (nhiều đợt liên tiếp): mới thử một đợt cho mỗi mức.</li>
<li><b>Lượt WhatsApp với người nhận thật</b>: số giả làm lần gửi qua Meta bị lỗi, nên chưa biết thời gian khi gửi thành công; và chưa đo trang studio với nhiều bản ghi.</li>
<li><b>30 tin thật của Eloa</b> (<code>dataset.real.json</code>) chưa có; hai bộ giả lập không dùng để chọn model.</li>
<li><b>Độ tự nhiên của câu trả lời</b> và câu hỏi có đúng mục tiêu không: cần người hoặc model chấm.</li>
</ul>

<h2>7. Khuyến nghị</h2>
<ul>
<li><b>Ưu tiên cao: key có quota trả phí cho production</b> (hoặc chạy Gemini qua gói có quota cao). 12/44 lời gọi bị từ chối ở nhịp đo là mức không chấp nhận được cho bất kỳ buổi demo nào có nhiều tin liên tiếp. Trước demo, chạy bộ test ở mức vừa phải hoặc dùng key riêng.</li>
<li><b>Điều tra dự phòng.</b> Production có đặt <code>DEEPSEEK_GATEWAY_KEY</code> và <code>DEEPSEEK_BASE_URL</code> (xem tên biến bằng <code>vercel env ls</code>), tức là có cấu hình dự phòng sang DeepSeek, vậy mà 429 của Gemini vẫn tới được người gọi. Có thể dự phòng cũng lỗi (khoá DeepSeek local đã chết, khoá production chưa kiểm), hoặc đường <code>/v1/extract</code> không đi qua dự phòng khi gặp 429. Chưa điều tra; cần xem log của Vercel.</li>
<li><b>p95 ≤ 8 s của extract</b> chưa đạt (${ms(exP.p95)} trên production, ${ms(exL.p95)} ở local). Hoặc nới ngưỡng, hoặc giảm lời gọi phụ; cần Lead quyết.</li>
<li><b>Xem lại cách đọc danh sách ở studio</b> (mục 4.4): 0,7 s cho danh sách và 1,4 s cho trang studio với 15 bản ghi, trên đường đọc Redis; thử với vài trăm bản ghi trước khi dữ liệu thật tích lại.</li>
<li><b>Giữ nguyên kiến trúc trả lời nhanh cho webhook</b>: ở 10 khách cùng lúc không thấy đổ vỡ, nhưng thời gian lớn nhất đã bằng gần ba phần tư hạn của Meta (trên số giả); nếu Meta gửi lại tin, hệ thống đã chặn trùng (KB37).</li>
<li>Lặp lại phép đo khi có key mới, và đo khởi động nguội sau một đêm không có ai gọi.</li>
</ul>

<h2>8. Phương pháp</h2>
<ul>
<li>Công cụ: <code>tools/live-eval/benchmark.mjs</code> (đo), <code>benchmark-report.mjs</code> (báo cáo). Production: <code>EVAL_BYPASS_SECRET=… node tools/live-eval/benchmark.mjs --base https://technext-edge-casa-bff.vercel.app --delay 3000 --skip whatsapp,staff</code>. Local: server dev ở cổng 8799, gọi trực tiếp.</li>
<li>Tuần tự, một lời gọi mỗi 3–4,5 s; bộ đếm giờ bắt đầu lúc gửi request, khoảng nghỉ không tính.</li>
<li>Mục 4: <code>tools/live-eval/load-test.mjs --base https://technext-edge-casa-bff.vercel.app --secrets-file .env.local --cold-wait-min 10 --repeat 5 --per-run 8 --concurrency 1,3,5,10 --cleanup</code> (secret đọc từ file nằm ngoài git, không in ra).</li>
<li>Dữ liệu thô: <code>${esc(prodFile.replace(/^.*docs[\\/]/, "docs/"))}</code> (production, tuần tự), <code>${esc(loadFile.replace(/^.*docs[\\/]/, "docs/"))}</code> (production, khởi động nguội, lặp, đồng thời, studio), <code>${esc(localFile.replace(/^.*docs[\\/]/, "docs/"))}</code> (local).</li>
</ul>
</main>
</body>
</html>
`;
writeFileSync(outFile, html);
console.log(`Written ${outFile} (${html.length} bytes)`);
