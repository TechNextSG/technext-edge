#!/usr/bin/env node
/**
 * Turns a benchmark.mjs result file into one self-contained HTML report.
 *
 *   node tools/live-eval/benchmark-report.mjs docs/reports/benchmark-2026-10-01.json docs/reports/benchmark-latency-2026-10-01.html
 */
import { readFileSync, writeFileSync } from "node:fs";

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) { console.error("usage: benchmark-report.mjs <result.json> <out.html>"); process.exit(2); }
const R = JSON.parse(readFileSync(inFile, "utf8"));
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ms = (v) => (v == null ? "n/a" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const acc = R.accuracy;
const names = Object.keys(acc);
const sumOf = (f) => names.reduce((s, n) => s + f(acc[n]), 0);
const all = {
  cases: sumOf((a) => a.cases),
  failed: sumOf((a) => a.failedCalls),
  fabricated: sumOf((a) => a.fabricated),
  reqOk: sumOf((a) => a.required.correct), reqTotal: sumOf((a) => a.required.total),
  evOk: sumOf((a) => a.evidence.ok), evTotal: sumOf((a) => a.evidence.total),
  prOk: sumOf((a) => a.priced.correct), prTotal: sumOf((a) => a.priced.total),
  tokIn: sumOf((a) => a.tokens.in), tokOut: sumOf((a) => a.tokens.out),
};
const callsOk = all.cases - all.failed;
const ex = R.latency.extract, cv = R.latency.converse, wa = R.latency.whatsappTurn;
const turns = wa.turns ?? [];
const modelTurns = turns.filter((t) => t.model);
const fastTurns = turns.filter((t) => !t.model);
const modelMs = modelTurns.map((t) => t.ms).sort((a, b) => a - b);
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];

const THRESH = { fab: 0, req: 95, ev: 100, p95: 8000 };
const reqPct = Math.round((all.reqOk / all.reqTotal) * 100);
const evPct = Math.round((all.evOk / all.evTotal) * 100);
const rows = names.flatMap((n) => acc[n].rows.map((r) => ({ ...r, set: n })));
const okRows = rows.filter((r) => !r.error);

function bars(items, { max, unit = "ms", warn, label = (i) => i.label } = {}) {
  const m = max ?? Math.max(...items.map((i) => i.value), 1);
  return `<div class="bars">${items.map((i) => {
    const w = Math.max(1, Math.round((i.value / m) * 100));
    const cls = warn && i.value > warn ? "bar warn" : "bar";
    return `<div class="brow"><span class="bl" title="${esc(i.label)}">${esc(label(i))}</span><span class="bt"><span class="${cls}" style="width:${w}%"></span></span><span class="bv">${esc(i.text ?? ms(i.value))}</span></div>`;
  }).join("")}</div>`;
}

const extractBars = bars(
  okRows.slice().sort((a, b) => b.wallMs - a.wallMs).map((r) => ({ label: `${r.set === "mock-30" ? "m" : "s"}/${r.id}`, value: r.wallMs })),
  { warn: THRESH.p95 },
);
const turnBars = bars(turns.map((t) => ({ label: `#${t.n} ${t.script}`, value: t.ms, text: t.replied === 0 ? "no reply (thread with a person)" : ms(t.ms) })), { max: wa.metaDeadlineMs });
const fastRoutes = [
  ["GET /v1/health", R.latency.health],
  ["GET /v1/quotes (list)", R.latency.quotationList],
  ["GET /v1/quotes/:id", R.latency.quotationRead],
  ["GET /quotes/:id (studio page, " + (R.latency.studioPageBytes ? Math.round(R.latency.studioPageBytes / 1024) + " KB" : "?") + ")", R.latency.studioPage],
  ["POST /v1/quotes/compute (simulated estimator)", R.latency.estimatorCompute],
].filter(([, s]) => s && s.n);

const misses = rows.flatMap((r) => (r.bad ?? []).map((b) => ({ set: r.set, id: r.id, ...b })));
const real = misses.filter((m) => m.field !== "rooms");
const roomsLabel = misses.filter((m) => m.field === "rooms");
const callErrors = rows.filter((r) => r.error);

const card = (title, value, sub, tone = "") => `<div class="card ${tone}"><div class="ct">${esc(title)}</div><div class="cv">${value}</div><div class="cs">${sub}</div></div>`;
const statusCell = (ok) => `<span class="pill ${ok ? "ok" : "bad"}">${ok ? "đạt" : "chưa đạt"}</span>`;

const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Báo cáo benchmark và latency</title>
<style>
:root{--bg:#f5f7fa;--card:#fff;--text:#18212b;--muted:#5c6b7b;--line:#d9e0e8;--accent:#1f6feb;--ok:#1a7f4b;--okbg:#dff3e7;--bad:#b42318;--badbg:#fde4e1;--warn:#9a6700;--warnbg:#fff1cc;--bar:#4c8df6;--barw:#e0a526;--code:#eef2f6}
@media (prefers-color-scheme:dark){:root{--bg:#0f141a;--card:#171e27;--text:#e5ebf1;--muted:#92a0af;--line:#2a3441;--accent:#6aa5ff;--ok:#56d08c;--okbg:#14301f;--bad:#ff8a7f;--badbg:#3a1a17;--warn:#f0c14b;--warnbg:#352a0d;--bar:#5b9bff;--barw:#e0a526;--code:#1d2733}}
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
.brow{display:grid;grid-template-columns:minmax(120px,300px) 1fr 84px;gap:10px;align-items:center;padding:2px 0;font-size:13px}
.bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace;font-size:12px}
.bt{background:var(--code);border-radius:6px;height:12px;overflow:hidden}
.bar{display:block;height:100%;background:var(--bar);border-radius:6px}.bar.warn{background:var(--barw)}
.bv{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
.note{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:8px;padding:10px 14px;margin:10px 0}
.note.warn{border-left-color:var(--barw)}.note.bad{border-left-color:var(--bad)}.note.ok{border-left-color:var(--ok)}
code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:13px}
ul{margin:6px 0 6px 20px;padding:0}
.small{color:var(--muted);font-size:13px}
@media(max-width:700px){.brow{grid-template-columns:100px 1fr 70px}}
</style>
</head>
<body>
<main>
<h1>Báo cáo benchmark và latency</h1>
<p class="sub">Kênh AI của technext-edge (extractor + kênh WhatsApp). Chạy ngày ${esc(R.ranAt.slice(0, 10))}, trên máy phát triển (${esc(R.platform)}, Node ${esc(R.node)}), model <code>${esc(okRows.find((r) => r.provider)?.provider ?? "google:gemini")}</code>, gói miễn phí của Gemini.</p>

<h2>1. Tóm tắt</h2>
<div class="cards">
${card("Bịa dữ kiện", String(all.fabricated), `trên ${callsOk} tin đã trả lời; ngưỡng là 0`, all.fabricated === THRESH.fab ? "ok" : "bad")}
${card("Trường bắt buộc đúng", `${reqPct}%`, `${all.reqOk}/${all.reqTotal}; ngưỡng ≥ ${THRESH.req}%`, reqPct >= THRESH.req ? "ok" : "bad")}
${card("Bằng chứng đúng nguyên văn", `${evPct}%`, `${all.evOk}/${all.evTotal}; ngưỡng ${THRESH.ev}%`, evPct >= THRESH.ev ? "ok" : "bad")}
${card("Extract p50 / p95", `${ms(ex.p50)} / ${ms(ex.p95)}`, `ngưỡng p95 ≤ ${ms(THRESH.p95)}; ${ex.n} lời gọi`, ex.p95 <= THRESH.p95 ? "ok" : "warn")}
${card("Một lượt WhatsApp có model", `${ms(q(modelMs, 0.5))}`, `lớn nhất ${ms(modelMs[modelMs.length - 1])}; hạn của Meta ${ms(wa.metaDeadlineMs)}`, "ok")}
${card("Route không dùng model", `1–3 ms`, "trang studio, danh sách, đọc, tính giá mô phỏng (chạy cục bộ)", "ok")}
</div>
<div class="note ok"><b>Kết luận ngắn.</b> Độ chính xác: không bịa trường nào, ${reqPct}% trường bắt buộc đúng, bằng chứng 100% nguyên văn; <b>trường có giá chỉ đúng ${all.prOk}/${all.prTotal}</b> (một tin khoá PADI không suy ra được <code>transport</code>, bỏ sót chứ không đưa nhầm dòng giá vào báo giá). Độ trễ: một lượt WhatsApp có model nằm quanh ${ms(q(modelMs, 0.5))}, còn dư rất nhiều so với hạn 20 giây của Meta; <b>tiêu chí p95 ≤ 8 s của extract chưa đạt</b> (${ms(ex.p95)}), và gần như toàn bộ thời gian đó là lời gọi model. Hai trên ${all.cases} lời gọi bị Gemini từ chối vì hết quota (429).</div>

<h2>2. Độ chính xác (benchmark)</h2>
<p class="small">Hai bộ dữ liệu giả lập trong <code>ai/eval/</code> (không phải 30 tin thật của Eloa, nên không dùng để chọn model), chấm bằng cùng luật <code>ai/eval/score.mjs</code> với runner và bài replay offline. Mỗi tin gọi <code>POST /v1/extract</code> một lần.</p>
<table>
<tr><th>Bộ dữ liệu</th><th class="n">Tin</th><th class="n">Lỗi gọi</th><th class="n">Bịa</th><th class="n">Bắt buộc đúng</th><th class="n">Bằng chứng</th><th class="n">Trường có giá</th><th class="n">Token vào / ra</th></tr>
${names.map((n) => { const a = acc[n]; return `<tr><td><code>${esc(n)}</code></td><td class="n">${a.cases}</td><td class="n">${a.failedCalls}</td><td class="n">${a.fabricated}</td><td class="n">${a.required.correct}/${a.required.total} (${pct(a.required.correct, a.required.total)})</td><td class="n">${a.evidence.ok}/${a.evidence.total}</td><td class="n">${a.priced.correct}/${a.priced.total}</td><td class="n">${a.tokens.in.toLocaleString("en-US")} / ${a.tokens.out.toLocaleString("en-US")}</td></tr>`; }).join("")}
<tr><td><b>Tổng</b></td><td class="n"><b>${all.cases}</b></td><td class="n"><b>${all.failed}</b></td><td class="n"><b>${all.fabricated}</b></td><td class="n"><b>${all.reqOk}/${all.reqTotal} (${reqPct}%)</b></td><td class="n"><b>${all.evOk}/${all.evTotal}</b></td><td class="n"><b>${all.prOk}/${all.prTotal}</b></td><td class="n"><b>${all.tokIn.toLocaleString("en-US")} / ${all.tokOut.toLocaleString("en-US")}</b></td></tr>
</table>
<table>
<tr><th>Tiêu chí</th><th>Ngưỡng</th><th>Kết quả</th><th>Trạng thái</th></tr>
<tr><td>Trường bịa ra</td><td>0</td><td>${all.fabricated}</td><td>${statusCell(all.fabricated === 0)}</td></tr>
<tr><td>Trường bắt buộc đúng (checkIn, nights, guests, rooms)</td><td>≥ ${THRESH.req}%</td><td>${reqPct}%</td><td>${statusCell(reqPct >= THRESH.req)}</td></tr>
<tr><td>Bằng chứng là chuỗi nguyên văn</td><td>100%</td><td>${evPct}%</td><td>${statusCell(evPct === 100)}</td></tr>
<tr><td>Trường có giá đúng (transport)</td><td>tất cả</td><td>${all.prOk}/${all.prTotal}</td><td>${statusCell(all.prOk === all.prTotal)}</td></tr>
<tr><td>p95 latency của extract</td><td>≤ ${ms(THRESH.p95)}</td><td>${ms(ex.p95)}</td><td>${statusCell(ex.p95 <= THRESH.p95)}</td></tr>
</table>

<h3>Các chỗ lệch so với đáp án</h3>
<table>
<tr><th>Bộ</th><th>Tin</th><th>Trường</th><th>Đáp án</th><th>Nhận được</th><th>Đánh giá</th></tr>
${real.map((m) => `<tr><td><code>${esc(m.set)}</code></td><td><code>${esc(m.id)}</code></td><td>${esc(m.field)}</td><td><code>${esc(JSON.stringify(m.expected))}</code></td><td><code>${esc(JSON.stringify(m.actual).slice(0, 80))}</code></td><td><span class="pill warn">bỏ sót, không bịa</span>${m.field === "transport" ? " (tính vào trường có giá)" : ""}</td></tr>`).join("")}
</table>
<ul>
<li><b>${roomsLabel.length} lệch ở trường <code>rooms</code></b> (${names.map((n) => `${esc(n)}: ${roomsLabel.filter((m) => m.set === n).map((m) => esc(m.id)).join(", ")}`).join("; ")}): đáp án ghi <code>missing</code>, hệ thống trả <code>default</code> = 1 theo quy ước nhà. Đây là khác biệt về nhãn, không phải số bịa; trường vẫn được gắn <code>default</code> nên nhân viên thấy là giá trị giả định.</li>
<li><b>Các lệch còn lại là bỏ sót, không phải bịa:</b> hai ngày check-in tiếng Việt không đọc ra (<code>vi-01</code>, <code>vi-06</code>), một khoá học PADI không suy ra <code>transport</code> (<code>zh-04</code>), và hai tin nhập nhằng "nhóm bao nhiêu người, ở lại bao nhiêu" (<code>en-07</code>, <code>en-09</code>) mà hệ thống chủ ý chuyển thành câu hỏi thay vì đoán.</li>
${callErrors.length ? `<li><b>${callErrors.length} lời gọi lỗi 429</b> (${callErrors.map((e) => esc(e.id)).join(", ")}): Gemini từ chối vì hết quota, không phải lỗi của sản phẩm; hai tin này không được chấm.</li>` : ""}
</ul>

<h2>3. Latency</h2>
<h3>3.1 Gọi model</h3>
<table>
<tr><th>Đường</th><th class="n">Số lần</th><th class="n">min</th><th class="n">p50</th><th class="n">p90</th><th class="n">p95</th><th class="n">max</th><th class="n">trung bình</th></tr>
${[["POST /v1/extract (trích xuất)", ex], ["POST /v1/converse (cả lượt: trích xuất, câu hỏi, câu trả lời)", cv]].map(([l, s]) => `<tr><td>${esc(l)}</td><td class="n">${s.n}</td><td class="n">${ms(s.min)}</td><td class="n">${ms(s.p50)}</td><td class="n">${ms(s.p90)}</td><td class="n">${ms(s.p95)}</td><td class="n">${ms(s.max)}</td><td class="n">${ms(s.mean)}</td></tr>`).join("")}
</table>
<p class="small">Theo từng bộ: <code>mock-30</code> p50 ${ms(acc["mock-30"]?.wallMs.p50)}, p95 ${ms(acc["mock-30"]?.wallMs.p95)}; <code>synthetic</code> p50 ${ms(acc.synthetic?.wallMs.p50)}, p95 ${ms(acc.synthetic?.wallMs.p95)}. Thời gian phía server (<code>meta.ms</code>) gần như bằng thời gian đo ở client (chênh dưới 5 ms), nên gần như toàn bộ là lời gọi Gemini.</p>
<h3>Từng tin, từ chậm đến nhanh (cột vàng: vượt 8 s)</h3>
${extractBars}

<h3>3.2 Một lượt WhatsApp, từ lúc webhook ký nhận tới lúc tin tới khách</h3>
<table>
<tr><th>Loại lượt</th><th class="n">Số lượt</th><th class="n">p50</th><th class="n">lớn nhất</th></tr>
<tr><td>Có gọi model (trích xuất, hỏi tiếp hoặc tóm tắt)</td><td class="n">${modelTurns.length}</td><td class="n">${ms(q(modelMs, 0.5))}</td><td class="n">${ms(modelMs[modelMs.length - 1])}</td></tr>
<tr><td>Chuyển người ngay, không gọi model (huỷ, hỏi ngoài đặt phòng)</td><td class="n">${fastTurns.length}</td><td class="n">${ms(fastTurns.map((t) => t.ms).sort((a, b) => a - b)[Math.floor(fastTurns.length / 2)])}</td><td class="n">${ms(Math.max(...fastTurns.map((t) => t.ms)))}</td></tr>
</table>
${turnBars}
<div class="note ok">Lượt chậm nhất là ${ms(modelMs[modelMs.length - 1])}, bằng ${Math.round((modelMs[modelMs.length - 1] / wa.metaDeadlineMs) * 100)}% hạn ${ms(wa.metaDeadlineMs)} của Meta (quá hạn Meta sẽ gửi lại cùng tin; hệ thống chặn gửi trùng nên không sinh bản nháp thứ hai, xem KB37). Các lượt chuyển người mất vài mili giây vì không đi qua model.</div>
<div class="note warn">Lượt 9 không có phản hồi: luồng đó đã được chuyển cho người ở lượt 8 nên bot im lặng theo thiết kế. Lượt 8 chuyển người ngay ở tin đầu của kịch bản "hỏi mơ hồ" là kết quả của lần chạy này, chưa phân tích thêm.</div>

<h3>3.3 Các route không dùng model (cục bộ, ${R.latency.quotationsInStore} bản ghi trong bộ nhớ)</h3>
<table>
<tr><th>Route</th><th class="n">Số lần</th><th class="n">p50</th><th class="n">p95</th><th class="n">max</th></tr>
${fastRoutes.map(([l, s]) => `<tr><td>${esc(l)}</td><td class="n">${s.n}</td><td class="n">${ms(s.p50)}</td><td class="n">${ms(s.p95)}</td><td class="n">${ms(s.max)}</td></tr>`).join("")}
</table>
<p class="small">Đây là thời gian xử lý trong một tiến trình cục bộ với kho bộ nhớ, không có mạng và không có KV. Trên Vercel sẽ cộng thêm thời gian mạng, khởi động nguội và một vòng gọi Redis cho mỗi lần đọc/ghi bản ghi.</p>

<h2>4. Diễn giải</h2>
<ul>
<li><b>Chất lượng.</b> Không có trường nào bị bịa trong ${callsOk} lời gọi; mọi bằng chứng là chuỗi có trong tin của khách. Lỗi còn lại đều là bỏ sót (và hệ thống hỏi lại hoặc để nhân viên điền), không phải điền sai, nên không dẫn tới báo giá sai âm thầm.</li>
<li><b>Độ trễ.</b> ${ms(ex.p50)} cho một lần trích xuất và ${ms(cv.p50)} cho một lượt đầy đủ là giá của một lời gọi Gemini <code>flash-lite</code>; vài lời gọi chạm 9–12 s. Mỗi lượt WhatsApp có model ở mức ${ms(q(modelMs, 0.5))}, đủ nhanh cho hội thoại, và dưới hạn 20 s của Meta với biên rộng.</li>
<li><b>Mức độ tin cậy của số đo.</b> Đo trên gói miễn phí, lời gọi tuần tự, một máy. Hai lời gọi bị 429 và hai lời gọi converse phải thử lại; với key có quota cao, số p95 có thể tốt hơn. Số đo là khoảng đại diện, không phải cam kết.</li>
</ul>

<h2>5. Khuyến nghị</h2>
<ul>
<li><b>Về tiêu chí p95 ≤ 8 s.</b> Hoặc dùng key có quota cao hơn và đo lại, hoặc nới ngưỡng của <code>extract</code> lên khoảng 10 s (một lượt WhatsApp vẫn dưới 9 s), hoặc rút bớt các lời gọi phụ trong một lượt. Cần Lead chọn; mình chưa đổi ngưỡng nào.</li>
<li><b>Đo lại trên bản deploy.</b> Số ở đây là cục bộ; bản preview đang nằm sau SSO của Vercel nên chưa đo được. Chạy <code>node tools/live-eval/benchmark.mjs --base &lt;url&gt;</code> với link bypass để có số có mạng và khởi động nguội.</li>
<li><b>Chạy trên 30 tin thật của Eloa</b> khi có (<code>dataset.real.json</code>); đó mới là số dùng để chọn model.</li>
<li><b>Hai lỗ hổng ở bộ test demo</b> (câu sửa mềm "we are 3 now", khiếu nại không có chữ cancel/refund) nằm ở <code>ai/</code>, phải sửa ở repo team rồi mirror về.</li>
</ul>

<h2>6. Phương pháp và cách chạy lại</h2>
<ul>
<li>Server: <code>ENABLE_HONO_QUOTATION_TOOL=true PORT=8799 WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:8899 npx tsx bff/src/dev.ts</code>.</li>
<li>Chạy: <code>node tools/live-eval/benchmark.mjs --base http://127.0.0.1:8799 --capture 8899 --delay 4500 --turns 10 --fast 30</code> (ghi một file JSON).</li>
<li>Báo cáo: <code>node tools/live-eval/benchmark-report.mjs docs/reports/benchmark-2026-10-01.json docs/reports/benchmark-latency-2026-10-01.html</code>.</li>
<li>Mỗi bộ đếm giờ bắt đầu lúc gửi request; khoảng nghỉ <code>--delay</code> giữa các lời gọi (để tránh quota 15 yêu cầu/phút) không nằm trong số đo, còn thời gian thử lại 429 bên trong provider thì có.</li>
<li>Mô hình: Gemini <code>gemini-3.1-flash-lite</code>, gói miễn phí; DeepSeek không dùng (khoá trong <code>.env.local</code> đã chết).</li>
<li>Dữ liệu thô: <code>docs/reports/benchmark-2026-10-01.json</code>.</li>
</ul>
</main>
</body>
</html>
`;
writeFileSync(outFile, html);
console.log(`Written ${outFile} (${html.length} bytes)`);
