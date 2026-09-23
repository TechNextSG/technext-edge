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

#override{margin-top:14px;font-size:12.5px;}
#override summary{cursor:pointer;color:var(--muted);font-family:var(--font-m);font-size:11.5px;}
.override-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
.override-row select,.override-row input{font-family:var(--font-b);font-size:13px;padding:7px 10px;border-radius:7px;border:1.5px solid var(--border);background:var(--card2);color:var(--ink);}
.override-row input{flex:1;min-width:200px;}
.override-row select:focus,.override-row input:focus{border-color:var(--teal);outline:none;}
.override-note{color:var(--muted);font-size:11.5px;margin:8px 0 0;}

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

.tabs{display:flex;gap:6px;margin-bottom:16px;}
.tab-btn{font-family:var(--font-b);font-size:13px;font-weight:600;padding:7px 16px;border-radius:8px;border:1.5px solid var(--border);background:var(--card);color:var(--muted);cursor:pointer;}
.tab-btn[aria-selected="true"]{background:var(--teal);border-color:var(--teal);color:#fff;}
.mode{display:none;}
.mode.active{display:block;}

.chat-log{display:flex;flex-direction:column;gap:10px;max-height:420px;overflow-y:auto;padding:4px 2px 10px;margin-bottom:14px;}
.bubble{max-width:80%;padding:9px 13px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;}
.bubble-guest{align-self:flex-end;background:var(--teal);color:#fff;border-bottom-right-radius:3px;}
.bubble-assistant{align-self:flex-start;background:var(--card2);border:1px solid var(--border);border-bottom-left-radius:3px;}
.bubble-empty{color:var(--muted);font-size:13px;font-style:italic;padding:6px 2px;}
.chat-input-row{display:flex;gap:8px;}
.chat-input-row textarea{min-height:44px;}
.done-banner{margin-top:10px;padding:8px 12px;border-radius:8px;background:var(--good-bg);color:var(--good-ink);font-size:12.5px;font-weight:600;display:none;}
</style>
</head>
<body>
  <div class="topbar">
    <div>
      <div class="brand-text">Casa Extractor</div>
      <div class="brand-sub">Extractor pod · test console</div>
    </div>
    <div class="pod-chip" id="pod-chip">POST /v1/converse</div>
  </div>

  <div class="wrap">
    <p class="lede">Wired to the live provider (see the badge in the result meta line below). Not the real estimator UI — that belongs to the Edge UI pod.</p>

    <div class="tabs" role="tablist">
      <button class="tab-btn" id="tab-chat" role="tab" aria-selected="true">💬 Chat</button>
      <button class="tab-btn" id="tab-single" role="tab" aria-selected="false">📝 Single message</button>
    </div>

    <details id="override">
      <summary>Provider override (bring your own key — sent straight from your browser to this server, never through anything else)</summary>
      <div class="override-row">
        <select id="provider-select">
          <option value="">Server default (DeepSeek Flash — primary)</option>
          <option value="deepseek-flash">DeepSeek Flash (chính / primary)</option>
          <option value="deepseek-pro">DeepSeek Pro</option>
          <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite (Google 2026 - Mới nhất)</option>
          <option value="gemini-3.5-flash">Gemini 3.5 Flash (Extended Reasoning)</option>
          <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
          <option value="gemini">Gemini (Theo biến môi trường GEMINI_MODEL)</option>
        </select>
        <input id="api-key" type="password" placeholder="API key override (optional)" autocomplete="off" spellcheck="false">
      </div>
      <p class="override-note">Kept only in this tab's session storage — cleared when the tab closes, never sent anywhere except this server, never logged.</p>
    </details>

    <!-- ================= CHAT MODE ================= -->
    <div class="card mode active" id="mode-chat">
      <p class="section-label">Conversation — the whole transcript is resent every turn, no server-side memory</p>
      <div class="chat-log" id="chat-log">
        <div class="bubble-empty">Say hello as a guest below to start.</div>
      </div>
      <div class="examples">
        <button class="chip-btn" data-chat="Hi, we'd like to book for next Saturday">EN starter</button>
        <button class="chip-btn" data-chat="Chào shop, nhóm mình 4 người muốn đi lặn biển và ở 3 đêm">VI lặn biển</button>
        <button class="chip-btn" data-chat="Mình bên đại lý du lịch muốn đặt 4 phòng cho đoàn 8 khách">VI đại lý</button>
        <button class="chip-btn" data-chat="你好，我们2个人想来考OW潜水证，住4晚">ZH 考证</button>
        <button class="chip-btn" id="reset-chat">↺ reset conversation</button>
      </div>
      <div class="chat-input-row">
        <textarea id="chat-text" placeholder="Type as the guest…"></textarea>
        <button class="btn btn-primary" id="chat-send">Send</button>
      </div>
      <span id="chat-status" style="font-family:var(--font-m);font-size:12px;color:var(--muted);"></span>
      <div class="done-banner" id="done-banner">✓ Nothing left to ask — every field is stated, inferred, or defaulted.</div>
      <div id="chat-error"></div>
      <div id="chat-meta" style="font-family:var(--font-m);font-size:11.5px;color:var(--muted);margin-top:10px;"></div>
      <details id="chat-trip" hidden style="margin-top:10px;">
        <summary>Trip so far</summary>
        <table style="margin-top:8px;">
          <thead><tr><th>Field</th><th>Value</th><th>State</th><th>Evidence</th></tr></thead>
          <tbody id="chat-result-body"></tbody>
        </table>
      </details>
    </div>

    <!-- ================= SINGLE-MESSAGE MODE (original) ================= -->
    <div class="card mode" id="mode-single">
      <p class="section-label">Guest message (Sample scenarios from 30-case benchmark)</p>
      <textarea id="text">Hi, we are 4 people, want to come next Saturday for 3 nights. Full board please, no need airport transfer.</textarea>
      <div class="examples">
        <button class="chip-btn" data-text="Hi, we are 4 people, want to come next Saturday for 3 nights. Full board please, no need airport transfer.">EN basic</button>
        <button class="chip-btn" data-text="3 certified rescue divers coming for 5 nights starting Nov 2, planning fun diving every day, full board please, we will arrange our own car">EN fun diving</button>
        <button class="chip-btn" data-text="Booking on behalf of a travel agency: 8 guests, need 4 rooms, checking in this Friday, staying 2 nights, half board only, we'll arrange our own transport">EN agency (30% off)</button>
        <button class="chip-btn" data-text="Bên mình có dạy chứng chỉ lặn biển Open Water không? Nhóm mình 4 người muốn học từ ngày 15/10, ở lại 4 đêm, ăn trọn gói và thuê xe đón từ sân bay Manila.">VI khóa học OW</button>
        <button class="chip-btn" data-text="Mình bên công ty du lịch cần đặt 5 phòng cho đoàn 10 khách từ ngày 20/11 đến 23/11 (ở 3 đêm). Đoàn ăn half board, tự túc xe.">VI đại lý đặt đoàn</button>
        <button class="chip-btn" data-text="你好，我们2个人想考OW潜水证，计划11月5号入住，住4晚，需要全包餐和马尼拉机场接送。">ZH 考潜水证+接送</button>
        <button class="chip-btn" data-text="Is the room rate 6500 pesos per night? We are 2 people planning 2 nights on Oct 18.">Trap: hỏi giá (bẫy bịa đặt)</button>
      </div>

      <div class="actions">
        <button class="btn btn-primary" id="go">Extract</button>
        <span id="status"></span>
      </div>

      <div id="error"></div>

      <div class="card" id="result-card" style="margin-top:18px;">
        <p class="section-label">Trip</p>
        <table>
          <thead><tr><th>Field</th><th>Value</th><th>State</th><th>Evidence</th></tr></thead>
          <tbody id="result-body"></tbody>
        </table>
        <div id="meta"></div>
        <details id="raw"><summary>Raw JSON</summary><pre id="raw-json"></pre></details>
      </div>

      <div class="card" id="questions-card" style="margin-top:18px;">
        <p class="section-label">Questions to ask the guest</p>
        <div id="questions"></div>
      </div>
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

const providerSelect = document.getElementById('provider-select');
const apiKeyInput = document.getElementById('api-key');

// Session-only convenience — never written to localStorage or sent anywhere
// but this server, and only for as long as this tab stays open.
function keyStorageKey(provider) { return 'extractor-test-key:' + provider; }
providerSelect.addEventListener('change', () => {
  apiKeyInput.value = providerSelect.value ? (sessionStorage.getItem(keyStorageKey(providerSelect.value)) || '') : '';
});
apiKeyInput.addEventListener('input', () => {
  if (providerSelect.value) {
    try { sessionStorage.setItem(keyStorageKey(providerSelect.value), apiKeyInput.value); } catch {}
  }
});

function currentProviderOverride() {
  const provider = providerSelect.value || undefined;
  const apiKey = provider ? apiKeyInput.value.trim() : undefined;
  return { provider, apiKey };
}

function describeError(data) {
  const base = data.detail || data.error || 'unknown error';
  if (Array.isArray(data.issues) && data.issues.length) {
    const first = data.issues[0];
    const path = Array.isArray(first.path) && first.path.length ? first.path.join('.') + ': ' : '';
    return base + ' — ' + path + first.message;
  }
  return base;
}

function renderTripRows(tbody, trip) {
  tbody.innerHTML = '';
  for (const [field, f] of Object.entries(trip)) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="field-name">' + field + '</td>' +
      '<td class="field-value">' + (f.value === null ? '<span class="null">null</span>' : escapeHtml(JSON.stringify(f.value))) + '</td>' +
      '<td><span class="state state-' + f.state + '">' + f.state + '</span></td>' +
      '<td class="evidence">' + (f.evidence ? escapeHtml(f.evidence) : '') + '</td>';
    tbody.appendChild(tr);
  }
}

// ---------------- Tabs ----------------
const tabChat = document.getElementById('tab-chat');
const tabSingle = document.getElementById('tab-single');
const modeChat = document.getElementById('mode-chat');
const modeSingle = document.getElementById('mode-single');
function selectTab(which) {
  const chatActive = which === 'chat';
  tabChat.setAttribute('aria-selected', String(chatActive));
  tabSingle.setAttribute('aria-selected', String(!chatActive));
  modeChat.classList.toggle('active', chatActive);
  modeSingle.classList.toggle('active', !chatActive);
}
tabChat.addEventListener('click', () => selectTab('chat'));
tabSingle.addEventListener('click', () => selectTab('single'));

// ---------------- Chat mode ----------------
let chatHistory = []; // [{role:'guest'|'assistant', text}] — resent in full every turn, no server memory
const chatLog = document.getElementById('chat-log');
const chatText = document.getElementById('chat-text');
const chatSend = document.getElementById('chat-send');
const chatStatus = document.getElementById('chat-status');
const chatError = document.getElementById('chat-error');
const chatMeta = document.getElementById('chat-meta');
const chatTripDetails = document.getElementById('chat-trip');
const chatResultBody = document.getElementById('chat-result-body');
const doneBanner = document.getElementById('done-banner');

function renderChatLog() {
  chatLog.innerHTML = '';
  if (chatHistory.length === 0) {
    chatLog.innerHTML = '<div class="bubble-empty">Say hello as a guest below to start.</div>';
    return;
  }
  for (const turn of chatHistory) {
    const div = document.createElement('div');
    div.className = 'bubble ' + (turn.role === 'guest' ? 'bubble-guest' : 'bubble-assistant');
    div.textContent = turn.text;
    chatLog.appendChild(div);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

document.querySelectorAll('[data-chat]').forEach(btn => {
  btn.addEventListener('click', () => { chatText.value = btn.dataset.chat; });
});

document.getElementById('reset-chat').addEventListener('click', () => {
  chatHistory = [];
  chatError.style.display = 'none';
  doneBanner.style.display = 'none';
  chatMeta.textContent = '';
  chatTripDetails.hidden = true;
  renderChatLog();
});

async function sendChatTurn() {
  const text = chatText.value.trim();
  if (!text) return;

  const { provider, apiKey } = currentProviderOverride();
  if (provider && !apiKey) {
    chatError.textContent = 'Enter an API key for ' + provider + ', or set "Server default".';
    chatError.style.display = 'block';
    return;
  }

  chatHistory.push({ role: 'guest', text });
  chatText.value = '';
  renderChatLog();

  chatSend.disabled = true;
  chatStatus.textContent = 'Thinking…';
  chatError.style.display = 'none';

  const started = performance.now();
  try {
    const res = await fetch('/v1/converse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ history: chatHistory, provider, apiKey }),
    });
    const data = await res.json();
    const elapsed = Math.round(performance.now() - started);

    if (!res.ok) {
      chatHistory.pop(); // the guest's turn didn't actually get answered — don't leave it dangling
      renderChatLog();
      chatError.textContent = 'HTTP ' + res.status + ': ' + describeError(data);
      chatError.style.display = 'block';
      return;
    }

    chatHistory.push({ role: 'assistant', text: data.reply });
    renderChatLog();

    renderTripRows(chatResultBody, data.trip);
    chatTripDetails.hidden = false;
    doneBanner.style.display = data.done ? 'block' : 'none';
    if (data.done && data.quotationDraft) {
      const q = data.quotationDraft;
      doneBanner.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<div><strong>✅ Enquiry Complete — AI Tool Call Executed:</strong> <code>submit_quotation_to_hono(quoteId="' + escapeHtml(q.quoteId) + '")</code></div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">' +
        '<a href="/quotes/' + encodeURIComponent(q.quoteId) + '" target="_blank" style="background:#0ea5e9;color:#090d16;padding:7px 14px;border-radius:7px;font-weight:700;text-decoration:none;font-size:13px;">✏️ Edit Quotation Table &amp; Link on Hono (' + escapeHtml(q.quoteId) + ')</a>' +
        '<a href="' + escapeHtml(q.quotationUrl) + '" target="_blank" style="background:#1e293b;color:#38bdf8;border:1px solid #38bdf8;padding:7px 14px;border-radius:7px;font-weight:700;text-decoration:none;font-size:13px;">🔗 Open Shareable Quote Link</a>' +
        '</div></div>';
    }
    chatMeta.textContent = data.meta.provider + ' · ' + data.meta.tokensIn + ' in / ' + data.meta.tokensOut + ' out tokens · ' +
      data.meta.ms + 'ms server-side (' + elapsed + 'ms round trip)' + (data.meta.retried ? ' · retried once' : '');
  } catch (err) {
    chatHistory.pop();
    renderChatLog();
    chatError.textContent = 'Request failed: ' + err.message;
    chatError.style.display = 'block';
  } finally {
    chatSend.disabled = false;
    chatStatus.textContent = '';
  }
}

chatSend.addEventListener('click', sendChatTurn);
chatText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatTurn(); }
});

// ---------------- Single-message mode (original) ----------------
goEl.addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (!text) return;

  const { provider, apiKey } = currentProviderOverride();
  if (provider && !apiKey) {
    errorEl.textContent = 'Enter an API key for ' + provider + ', or set "Server default" to use the deployed key.';
    errorEl.style.display = 'block';
    return;
  }

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
      body: JSON.stringify({ text, provider, apiKey }),
    });
    const data = await res.json();
    const elapsed = Math.round(performance.now() - started);

    if (!res.ok) {
      errorEl.textContent = 'HTTP ' + res.status + ': ' + describeError(data);
      errorEl.style.display = 'block';
      return;
    }

    renderTripRows(resultBody, data.trip);
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
