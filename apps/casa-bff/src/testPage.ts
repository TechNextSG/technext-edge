// A test page for people, not a production UI — the real estimator page
// belongs to the Edge UI pod. This exists so anyone on the team can try
// POST /v1/extract without curl or Postman. Served at GET /.
export const TEST_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Extractor pod — test page</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    max-width: 780px;
    margin: 0 auto;
    padding: 24px 16px 64px;
    line-height: 1.5;
  }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color: #888; font-size: 13px; margin-bottom: 24px; }
  textarea {
    width: 100%; box-sizing: border-box; min-height: 90px;
    font-size: 15px; padding: 10px; border-radius: 6px;
    border: 1px solid #999; font-family: inherit;
  }
  .examples { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 18px; }
  .examples button {
    font-size: 12.5px; padding: 4px 10px; border-radius: 999px;
    border: 1px solid #999; background: none; cursor: pointer; color: inherit;
  }
  .examples button:hover { background: #8884; }
  #go {
    padding: 8px 20px; font-size: 15px; border-radius: 6px; border: none;
    background: #2a6; color: white; cursor: pointer;
  }
  #go:disabled { opacity: 0.5; cursor: default; }
  #status { margin-left: 10px; font-size: 13px; color: #888; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #8883; vertical-align: top; }
  th { color: #888; font-weight: 600; font-size: 12px; text-transform: uppercase; }
  .state { padding: 1px 7px; border-radius: 4px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .state-stated   { background: #2a63; color: #2a6; }
  .state-inferred { background: #29a3; color: #29a; }
  .state-derived  { background: #29a3; color: #29a; }
  .state-default  { background: #d903; color: #b80; }
  .state-missing  { background: #d443; color: #d44; }
  .evidence { color: #888; font-size: 12.5px; }
  #questions { margin-top: 18px; }
  #questions li { margin-bottom: 4px; }
  #meta { margin-top: 16px; font-size: 12px; color: #888; }
  #raw { margin-top: 20px; }
  #raw summary { cursor: pointer; font-size: 13px; color: #888; }
  #raw pre { background: #8881; padding: 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  #error { margin-top: 16px; padding: 10px 14px; border-radius: 6px; background: #d443; display: none; }
</style>
</head>
<body>
  <h1>Extractor pod — test page</h1>
  <div class="sub">POST /v1/extract, wired to the live Gemini adapter. Not the real estimator UI (that's the Edge UI pod's).</div>

  <textarea id="text" placeholder="Paste a guest message...">Hi, we are 4 people, want to come next Saturday for 3 nights. Full board please, no need airport transfer.</textarea>

  <div class="examples">
    <button data-text="Hi, we are 4 people, want to come next Saturday for 3 nights. Full board please, no need airport transfer.">EN example</button>
    <button data-text="3 khách, thứ Bảy này, ở 2 đêm">VI example</button>
    <button data-text="我们4个人，下周六来，住3晚">ZH example</button>
    <button data-text="hi, muốn đặt phòng">missing fields</button>
  </div>

  <div>
    <button id="go">Extract</button>
    <span id="status"></span>
  </div>

  <div id="error"></div>
  <table id="result" hidden>
    <thead><tr><th>Field</th><th>Value</th><th>State</th><th>Evidence</th></tr></thead>
    <tbody id="result-body"></tbody>
  </table>
  <div id="questions"></div>
  <div id="meta"></div>
  <details id="raw" hidden><summary>Raw JSON</summary><pre id="raw-json"></pre></details>

<script>
const textEl = document.getElementById('text');
const goEl = document.getElementById('go');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const resultBody = document.getElementById('result-body');
const questionsEl = document.getElementById('questions');
const metaEl = document.getElementById('meta');
const rawEl = document.getElementById('raw');
const rawJsonEl = document.getElementById('raw-json');

document.querySelectorAll('.examples button').forEach(btn => {
  btn.addEventListener('click', () => { textEl.value = btn.dataset.text; });
});

goEl.addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (!text) return;

  goEl.disabled = true;
  statusEl.textContent = 'Calling Gemini…';
  errorEl.style.display = 'none';
  resultEl.hidden = true;
  questionsEl.innerHTML = '';
  metaEl.textContent = '';
  rawEl.hidden = true;

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
      statusEl.textContent = '';
      return;
    }

    resultBody.innerHTML = '';
    for (const [field, f] of Object.entries(data.trip)) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + field + '</td>' +
        '<td>' + (f.value === null ? '<span class="evidence">null</span>' : JSON.stringify(f.value)) + '</td>' +
        '<td><span class="state state-' + f.state + '">' + f.state + '</span></td>' +
        '<td class="evidence">' + (f.evidence ? escapeHtml(f.evidence) : '') + '</td>';
      resultBody.appendChild(tr);
    }
    resultEl.hidden = false;

    if (data.questions.length) {
      questionsEl.innerHTML = '<strong>Questions to ask the guest:</strong><ul>' +
        data.questions.map(q => '<li>' + escapeHtml(q.question) + ' <span class="evidence">(' + q.field + ')</span></li>').join('') +
        '</ul>';
    } else {
      questionsEl.innerHTML = '<strong>No questions</strong> — every field is stated, inferred, or has a house-norm default.';
    }

    metaEl.textContent = data.meta.provider + ' · ' + data.meta.tokensIn + ' in / ' + data.meta.tokensOut + ' out tokens · ' +
      data.meta.ms + 'ms server-side (' + elapsed + 'ms round trip)' + (data.meta.retried ? ' · retried once' : '');

    rawJsonEl.textContent = JSON.stringify(data, null, 2);
    rawEl.hidden = false;
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
