// A test page for people, not a production UI — the real estimator page
// belongs to the Edge UI pod. This exists so anyone on the team can try
// POST /v1/extract without curl or Postman. Served at GET /.
// Visual identity matches apps/estimate-tool in casa-escondida-tools (same
// fonts, same token names/values) so this doesn't read as a foreign tool.
export const TEST_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Casa Extractor — test console</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  color-scheme:light;
  --bg:#EFF4F3; --card:#FFFFFF; --card2:#F5FAF8; --ink:#152321; --muted:#5B6C6A;
  --border:#D9E4E2; --hairline:#E6EEEC;
  --head:#0B2E33; --head2:#123C42;
  --teal:#1C7C82; --teal-strong:#145A5F; --teal-tint:#E7F2F0;
  --coral:#DC4B33; --coral-hover:#C8422D; --coral-tint:#FBEAE6; --coral-ink:#B5301C;
  --gold:#C99A3B; --gold-bg:#FBF2E0; --gold-ink:#7E5F14;
  --good:#0ca30c; --good-ink:#0A6E0A; --good-bg:#E7F5E7;
  --warn:#fab219; --warn-ink:#8A6206; --warn-bg:#FBF2DC;
  --crit:#d03b3b; --crit-ink:#B32E2E; --crit-bg:#FAE5E5;
  --shadow:0 4px 16px rgba(11,46,51,.09);
  --font-d:'Space Grotesk',ui-sans-serif,sans-serif;
  --font-b:'Inter',ui-sans-serif,system-ui,sans-serif;
  --font-m:'IBM Plex Mono',ui-monospace,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme:dark;
    --bg:#0A181B; --card:#13292E; --card2:#0F2125; --ink:#E4EFED; --muted:#94AAA7;
    --border:#264845; --hairline:#1C3A3E;
    --teal:#43ACB3; --teal-strong:#63C6CC; --teal-tint:#153A3E;
    --coral:#E86A50; --coral-hover:#F07E66; --coral-tint:#3A211C; --coral-ink:#F0917E;
    --gold:#C99A3B; --gold-bg:#33290F; --gold-ink:#E3C069;
    --good:#0ca30c; --good-ink:#4CC94C; --good-bg:#123212;
    --warn:#fab219; --warn-ink:#F3C14C; --warn-bg:#33290F;
    --crit:#d03b3b; --crit-ink:#E66767; --crit-bg:#3A1A1A;
    --shadow:0 4px 16px rgba(0,0,0,.35);
  }
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0A181B; --card:#13292E; --card2:#0F2125; --ink:#E4EFED; --muted:#94AAA7;
  --border:#264845; --hairline:#1C3A3E;
  --teal:#43ACB3; --teal-strong:#63C6CC; --teal-tint:#153A3E;
  --coral:#E86A50; --coral-hover:#F07E66; --coral-tint:#3A211C; --coral-ink:#F0917E;
  --gold:#C99A3B; --gold-bg:#33290F; --gold-ink:#E3C069;
  --good:#0ca30c; --good-ink:#4CC94C; --good-bg:#123212;
  --warn:#fab219; --warn-ink:#F3C14C; --warn-bg:#33290F;
  --crit:#d03b3b; --crit-ink:#E66767; --crit-bg:#3A1A1A;
  --shadow:0 4px 16px rgba(0,0,0,.35);
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{background:var(--bg);color:var(--ink);font-family:var(--font-b);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;}
button,textarea{font-family:var(--font-b);color:inherit;}
:focus-visible{outline:2px solid var(--coral);outline-offset:2px;}
@media (prefers-reduced-motion: reduce){*{transition:none!important;}}

.topbar{background:linear-gradient(135deg,var(--head) 0%,var(--head2) 100%);color:#fff;padding:14px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.brand-text{font-family:var(--font-d);font-weight:600;font-size:17px;letter-spacing:.2px;}
.brand-sub{font-family:var(--font-m);font-size:10.5px;color:#9FC6C9;letter-spacing:1.1px;text-transform:uppercase;margin-top:2px;}
.pod-chip{font-family:var(--font-m);font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:14px;padding:4px 10px;white-space:nowrap;}

.wrap{max-width:900px;margin:0 auto;padding:24px 20px 64px;}
.lede{color:var(--muted);font-size:13.5px;margin:0 0 22px;max-width:60ch;}

.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px 20px;box-shadow:var(--shadow);}
.card + .card{margin-top:18px;}

textarea{width:100%;box-sizing:border-box;min-height:88px;font-size:14.5px;padding:11px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--card2);color:var(--ink);resize:vertical;}
textarea:focus{border-color:var(--teal);outline:none;}

.examples{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 16px;}
.chip-btn{font-family:var(--font-m);font-size:11.5px;letter-spacing:.3px;padding:5px 11px;border-radius:999px;border:1.5px solid var(--border);background:var(--card2);color:var(--muted);cursor:pointer;transition:border-color .15s,color .15s;}
.chip-btn:hover{border-color:var(--teal);color:var(--teal-strong);}

.actions{display:flex;align-items:center;gap:12px;}
.btn{border:none;border-radius:8px;padding:9px 18px;font-size:13.5px;font-weight:600;font-family:var(--font-b);display:inline-flex;align-items:center;gap:6px;cursor:pointer;transition:background .15s;}
.btn-primary{background:var(--coral);color:#fff;}
.btn-primary:hover{background:var(--coral-hover);}
.btn-primary:disabled{opacity:.5;cursor:default;}
#status{font-family:var(--font-m);font-size:12px;color:var(--muted);}

#error{margin-top:16px;padding:12px 16px;border-radius:8px;background:var(--crit-bg);color:var(--crit-ink);border:1px solid var(--crit);display:none;font-size:13.5px;}

.section-label{font-family:var(--font-m);font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--muted);margin:0 0 12px;}

table{width:100%;border-collapse:collapse;font-size:13.5px;}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--hairline);vertical-align:top;}
th{font-family:var(--font-m);font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);font-weight:600;}
tr:last-child td{border-bottom:none;}
td.field-name{font-family:var(--font-m);font-weight:600;color:var(--teal-strong);white-space:nowrap;}
td.field-value{font-family:var(--font-m);}
.null{color:var(--muted);font-style:italic;}
.evidence{color:var(--muted);font-size:12.5px;}

.state{display:inline-block;padding:2px 9px;border-radius:999px;font-family:var(--font-m);font-size:10.5px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap;}
.state-stated{background:var(--good-bg);color:var(--good-ink);}
.state-inferred{background:var(--teal-tint);color:var(--teal-strong);}
.state-derived{background:var(--teal-tint);color:var(--teal-strong);}
.state-default{background:var(--gold-bg);color:var(--gold-ink);}
.state-missing{background:var(--crit-bg);color:var(--crit-ink);}

#questions ul{margin:0;padding-left:20px;}
#questions li{margin-bottom:5px;}
#questions .qfield{font-family:var(--font-m);color:var(--muted);font-size:12px;}
.no-questions{color:var(--good-ink);font-weight:500;}

#meta{font-family:var(--font-m);font-size:11.5px;color:var(--muted);margin-top:14px;padding-top:12px;border-top:1px solid var(--hairline);}

details summary{cursor:pointer;font-family:var(--font-m);font-size:12px;color:var(--muted);}
details pre{background:var(--card2);border:1px solid var(--hairline);padding:12px;border-radius:8px;overflow-x:auto;font-size:11.5px;margin-top:8px;}

#result-card, #questions-card{display:none;}
</style>
</head>
<body>
  <div class="topbar">
    <div>
      <div class="brand-text">Casa Extractor</div>
      <div class="brand-sub">Extractor pod · test console</div>
    </div>
    <div class="pod-chip">POST /v1/extract</div>
  </div>

  <div class="wrap">
    <p class="lede">Wired to the live provider (see the badge in the result meta line below). Not the real estimator UI — that belongs to the Edge UI pod.</p>

    <div class="card">
      <p class="section-label">Guest message</p>
      <textarea id="text">Hi, we are 4 people, want to come next Saturday for 3 nights. Full board please, no need airport transfer.</textarea>
      <div class="examples">
        <button class="chip-btn" data-text="Hi, we are 4 people, want to come next Saturday for 3 nights. Full board please, no need airport transfer.">EN example</button>
        <button class="chip-btn" data-text="3 khách, thứ Bảy này, ở 2 đêm">VI example</button>
        <button class="chip-btn" data-text="我们4个人，下周六来，住3晚">ZH example</button>
        <button class="chip-btn" data-text="hi, muốn đặt phòng">missing fields</button>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="go">Extract</button>
        <span id="status"></span>
      </div>
      <div id="error"></div>
    </div>

    <div class="card" id="result-card">
      <p class="section-label">Trip</p>
      <table>
        <thead><tr><th>Field</th><th>Value</th><th>State</th><th>Evidence</th></tr></thead>
        <tbody id="result-body"></tbody>
      </table>
      <div id="meta"></div>
      <details id="raw"><summary>Raw JSON</summary><pre id="raw-json"></pre></details>
    </div>

    <div class="card" id="questions-card">
      <p class="section-label">Questions to ask the guest</p>
      <div id="questions"></div>
    </div>
  </div>

<script>
const textEl = document.getElementById('text');
const goEl = document.getElementById('go');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const resultCard = document.getElementById('result-card');
const resultBody = document.getElementById('result-body');
const questionsCard = document.getElementById('questions-card');
const questionsEl = document.getElementById('questions');
const metaEl = document.getElementById('meta');
const rawJsonEl = document.getElementById('raw-json');

document.querySelectorAll('.chip-btn').forEach(btn => {
  btn.addEventListener('click', () => { textEl.value = btn.dataset.text; });
});

goEl.addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (!text) return;

  goEl.disabled = true;
  statusEl.textContent = 'Calling provider…';
  errorEl.style.display = 'none';
  resultCard.style.display = 'none';
  questionsCard.style.display = 'none';

  const started = performance.now();
  try {
    const res = await fetch('/v1/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    const elapsed = Math.round(performance.now() - started);

    if (!res.ok) {
      errorEl.textContent = 'HTTP ' + res.status + ': ' + (data.detail || data.error);
      errorEl.style.display = 'block';
      return;
    }

    resultBody.innerHTML = '';
    for (const [field, f] of Object.entries(data.trip)) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="field-name">' + field + '</td>' +
        '<td class="field-value">' + (f.value === null ? '<span class="null">null</span>' : escapeHtml(JSON.stringify(f.value))) + '</td>' +
        '<td><span class="state state-' + f.state + '">' + f.state + '</span></td>' +
        '<td class="evidence">' + (f.evidence ? escapeHtml(f.evidence) : '') + '</td>';
      resultBody.appendChild(tr);
    }
    resultCard.style.display = 'block';

    if (data.questions.length) {
      questionsEl.innerHTML = '<ul>' +
        data.questions.map(q => '<li>' + escapeHtml(q.question) + ' <span class="qfield">(' + q.field + ')</span></li>').join('') +
        '</ul>';
    } else {
      questionsEl.innerHTML = '<p class="no-questions">None — every field is stated, inferred, or has a house-norm default.</p>';
    }
    questionsCard.style.display = 'block';

    metaEl.textContent = data.meta.provider + ' · ' + data.meta.tokensIn + ' in / ' + data.meta.tokensOut + ' out tokens · ' +
      data.meta.ms + 'ms server-side (' + elapsed + 'ms round trip)' + (data.meta.retried ? ' · retried once' : '');
    rawJsonEl.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    errorEl.textContent = 'Request failed: ' + err.message;
    errorEl.style.display = 'block';
  } finally {
    goEl.disabled = false;
    statusEl.textContent = '';
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
</script>
</body>
</html>`;
