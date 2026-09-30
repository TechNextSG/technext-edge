import { themeCss } from "./theme.js";

/**
 * `/admin/ai` — where the person who owns the deployment changes which AI model answers, without opening Vercel.
 *
 * The page is a shell: every value comes from `/v1/admin/ai/*` after load, and every value is written into the
 * DOM with `textContent`, never as markup. A saved key is never on this page in any form but "••••abcd"; the
 * field for a new one is a password input that is cleared the moment it is sent.
 *
 * The client script below has no template literals and no `${}` on purpose: it sits inside a template literal of
 * this file, and a stray backtick there is the bug that took the studio's whole script down once.
 */
export function renderAdminAiPage(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI settings — Casa Escondida</title>
  <style>
${themeCss()}
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
    main { max-width: 860px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px; }
    .sub { color: var(--muted); font-size: 14px; font-weight: 600; margin-bottom: 20px; }
    .card { background: var(--card); border: 2px solid var(--border); border-radius: 16px; padding: 20px 22px; margin-bottom: 18px; }
    .card h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 12px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
    label { font-size: 13px; font-weight: 700; color: var(--muted); display: block; margin-bottom: 4px; }
    select, input { font: inherit; font-size: 14px; font-weight: 600; padding: 8px 10px; border: 2px solid var(--border); border-radius: 10px; background: var(--row); color: var(--text); }
    input[type="number"] { width: 110px; }
    input[type="password"] { min-width: 260px; }
    button { font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; background: var(--card); color: var(--text); border: 2px solid var(--border); border-radius: 999px; padding: 8px 16px; }
    button.primary { background: var(--primary); color: #fff; border-color: var(--primary); }
    button.danger { color: var(--rose, #e11d48); border-color: var(--rose, #e11d48); }
    button:disabled { opacity: 0.5; cursor: default; }
    .pill { display: inline-block; font-size: 11px; font-weight: 800; border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; color: var(--muted); margin-left: 6px; }
    .ok { color: var(--emerald, #059669); font-weight: 800; }
    .bad { color: var(--rose, #e11d48); font-weight: 800; }
    .note { color: var(--muted); font-size: 13px; font-weight: 600; }
    .notice { padding: 12px 14px; border-radius: 12px; border: 2px solid var(--border); background: var(--row); font-size: 14px; font-weight: 700; margin-bottom: 14px; display: none; white-space: pre-line; }
    .notice.error { border-color: var(--rose, #e11d48); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); font-weight: 600; }
    th { font-size: 12px; text-transform: uppercase; color: var(--muted); }
    a { color: var(--primary); font-weight: 700; }
  </style>
</head>
<body>
<main>
  <h1>AI settings</h1>
  <div class="sub">Which model answers guests, what backs it up, and the keys it uses. Changes apply to the next message — no deploy.
    <a href="/quotes">Back to the studio</a></div>
  <div id="notice" class="notice" role="status" aria-live="polite"></div>

  <section class="card" id="current">
    <h2>Model in use</h2>
    <div id="current-body" class="note">Loading…</div>
  </section>

  <section class="card">
    <h2>Change model</h2>
    <div class="row">
      <div><label for="primary-provider">Primary provider</label><select id="primary-provider"></select></div>
      <div><label for="primary-model">Primary model</label><select id="primary-model"></select></div>
    </div>
    <div class="row">
      <div><label for="fallback-provider">Fallback provider</label><select id="fallback-provider"></select></div>
      <div><label for="fallback-model">Fallback model</label><select id="fallback-model"></select></div>
    </div>
    <div class="row">
      <button type="button" id="btn-test">Test</button>
      <button type="button" class="primary" id="btn-save">Save</button>
      <button type="button" id="btn-save-anyway" style="display:none">Save anyway</button>
    </div>
    <div id="test-result" class="note"></div>
  </section>

  <section class="card">
    <h2>API keys</h2>
    <div class="note" id="enc-note"></div>
    <div id="keys-body"></div>
  </section>

  <section class="card">
    <h2>Advanced</h2>
    <div class="row">
      <div><label for="t-extract">Extraction timeout (ms)</label><input type="number" id="t-extract" /></div>
      <div><label for="t-synthesis">Reply timeout (ms)</label><input type="number" id="t-synthesis" /></div>
    </div>
    <div class="row">
      <div><label for="b-cooldown">Breaker cooldown (ms)</label><input type="number" id="b-cooldown" /></div>
      <div><label for="b-auth">Breaker cooldown after a key error (ms)</label><input type="number" id="b-auth" /></div>
    </div>
    <div class="row">
      <label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" id="synthesis" /> Let the model write the reply (off = fixed wording)</label>
    </div>
    <div class="row">
      <div><label for="ds-url">DeepSeek gateway URL (https)</label><input type="text" id="ds-url" style="min-width:380px" placeholder="leave empty for the default" /></div>
    </div>
    <div class="row"><button type="button" class="primary" id="btn-save-adv">Save advanced settings</button></div>
  </section>

  <section class="card">
    <h2>Health, last 7 days (UTC)</h2>
    <div id="stats-body" class="note">Loading…</div>
  </section>

  <section class="card">
    <h2>Change history</h2>
    <div id="audit-body" class="note">Loading…</div>
  </section>
</main>
<script>
  var view = null;
  function $(id) { return document.getElementById(id); }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function notice(message, isError) {
    var box = $('notice');
    box.textContent = message;
    box.className = 'notice' + (isError ? ' error' : '');
    box.style.display = message ? 'block' : 'none';
  }
  async function api(method, path, body) {
    var res = await fetch(path, { method: method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    return { status: res.status, data: data };
  }
  function sourceTag(source) { return el('span', source, 'pill'); }

  function fillModels(providerSel, modelSel, selected) {
    clear(modelSel);
    var models = providerSel.value ? (view.catalog[providerSel.value] || []) : [];
    models.forEach(function (m) { var o = el('option', m); o.value = m; modelSel.appendChild(o); });
    if (selected && models.indexOf(selected) === -1 && providerSel.value) { var extra = el('option', selected); extra.value = selected; modelSel.appendChild(extra); }
    if (selected) modelSel.value = selected;
    modelSel.disabled = !providerSel.value;
  }
  function fillProviders(sel, allowNone, selected) {
    clear(sel);
    if (allowNone) { var none = el('option', 'none'); none.value = ''; sel.appendChild(none); }
    Object.keys(view.catalog).forEach(function (p) { var o = el('option', p); o.value = p; sel.appendChild(o); });
    sel.value = selected || '';
  }

  function renderCurrent() {
    var body = $('current-body'); clear(body);
    var p = el('div'); p.appendChild(el('strong', view.primary.provider + ' · ' + view.primary.model)); p.appendChild(el('span', ' primary')); p.appendChild(sourceTag(view.primary.source)); body.appendChild(p);
    var f = el('div');
    if (view.fallback) { f.appendChild(el('strong', view.fallback.provider + ' · ' + view.fallback.model)); f.appendChild(el('span', ' fallback')); f.appendChild(sourceTag(view.fallbackSource)); }
    else { f.appendChild(el('span', 'No fallback')); f.appendChild(sourceTag(view.fallbackSource)); }
    body.appendChild(f);
    body.appendChild(el('div', 'Settings version ' + view.version + (view.updatedAt ? ' · saved ' + view.updatedAt + ' by ' + view.updatedBy : ' · nothing saved yet, the environment decides'), 'note'));
  }

  function renderForm() {
    fillProviders($('primary-provider'), false, view.primary.provider);
    fillModels($('primary-provider'), $('primary-model'), view.primary.model);
    fillProviders($('fallback-provider'), true, view.fallback ? view.fallback.provider : '');
    fillModels($('fallback-provider'), $('fallback-model'), view.fallback ? view.fallback.model : '');
    $('t-extract').value = view.timeoutsMs.extract; $('t-synthesis').value = view.timeoutsMs.synthesis;
    $('b-cooldown').value = view.breaker.cooldownMs; $('b-auth').value = view.breaker.authCooldownMs;
    $('synthesis').checked = view.synthesisEnabled.value;
    $('ds-url').value = view.deepseekBaseUrl.value || '';
  }

  function renderKeys() {
    $('enc-note').textContent = view.encryptionConfigured ? 'Keys are encrypted before they are stored. A saved key is never shown again.' : 'SETTINGS_ENCRYPTION_KEY is not set, so keys cannot be saved here yet. Keys set in the environment still work.';
    var body = $('keys-body'); clear(body);
    Object.keys(view.keys).forEach(function (p) {
      var k = view.keys[p];
      var row = el('div', null, 'row');
      row.appendChild(el('strong', p));
      row.appendChild(el('span', k.present ? (k.masked || 'set') : 'no key', k.present ? 'ok' : 'bad'));
      row.appendChild(sourceTag(k.source));
      if (k.problem) row.appendChild(el('span', k.problem, 'bad'));
      var input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'off'; input.placeholder = k.present ? 'New key to replace it' : 'Paste a key'; input.disabled = !view.encryptionConfigured;
      var save = el('button', k.present ? 'Replace' : 'Save'); save.disabled = !view.encryptionConfigured;
      save.onclick = async function () {
        var value = input.value; input.value = '';
        if (!value) { notice('Paste a key first.', true); return; }
        var r = await api('PUT', '/v1/admin/ai/keys/' + p, { key: value });
        value = '';
        notice(r.status === 200 ? 'Key saved for ' + p + '.' : 'Key not saved: ' + (r.data.detail || r.data.reason || r.status), r.status !== 200);
        await load();
      };
      row.appendChild(input); row.appendChild(save);
      if (k.source === 'kv') {
        var rm = el('button', 'Remove', 'danger');
        rm.onclick = async function () { if (!confirm('Remove the saved ' + p + ' key? The environment key, if any, takes over.')) return; await api('DELETE', '/v1/admin/ai/keys/' + p); notice('Key removed.', false); await load(); };
        row.appendChild(rm);
      }
      body.appendChild(row);
    });
  }

  function renderStats(stats) {
    var body = $('stats-body'); clear(body);
    if (!stats.rows.length) { body.textContent = 'No calls recorded yet.'; return; }
    var t = document.createElement('table');
    var head = document.createElement('tr'); ['Provider', 'Answered', 'Failed', 'Answered as fallback', 'Average ms'].forEach(function (h) { head.appendChild(el('th', h)); }); t.appendChild(head);
    stats.rows.forEach(function (r) {
      var tr = document.createElement('tr');
      [r.provider, r.ok, r.fail, r.fallback, r.avgMs == null ? '—' : r.avgMs].forEach(function (v) { tr.appendChild(el('td', String(v))); });
      t.appendChild(tr);
    });
    body.appendChild(t);
  }

  function renderAudit(entries) {
    var body = $('audit-body'); clear(body);
    if (!entries.length) { body.textContent = 'No changes yet.'; return; }
    entries.forEach(function (e) {
      var line = el('div', null, 'row');
      line.appendChild(el('span', e.at, 'note'));
      line.appendChild(el('span', e.by, 'pill'));
      line.appendChild(el('span', e.diff.map(function (d) { return d.field + ': ' + JSON.stringify(d.from) + ' → ' + JSON.stringify(d.to); }).join(' · ') || 'saved'));
      body.appendChild(line);
    });
  }

  function patchFromForm(includeAdvanced) {
    var patch = {};
    patch.primary = { provider: $('primary-provider').value, model: $('primary-model').value };
    patch.fallback = $('fallback-provider').value ? { provider: $('fallback-provider').value, model: $('fallback-model').value } : null;
    if (includeAdvanced) {
      patch.timeoutsMs = { extract: Number($('t-extract').value), synthesis: Number($('t-synthesis').value) };
      patch.breaker = { cooldownMs: Number($('b-cooldown').value), authCooldownMs: Number($('b-auth').value) };
      patch.synthesisEnabled = $('synthesis').checked;
      patch.deepseekBaseUrl = $('ds-url').value.trim() === '' ? null : $('ds-url').value.trim();
    }
    return patch;
  }
  function showTests(tests) {
    var box = $('test-result'); clear(box);
    (tests || []).forEach(function (t) {
      var line = el('div');
      line.appendChild(el('span', (t.ok ? 'OK' : 'FAILED') + ' ', t.ok ? 'ok' : 'bad'));
      line.appendChild(el('span', t.role + ' ' + t.provider + ' ' + t.model + ' · ' + t.ms + ' ms' + (t.error ? ' · ' + t.error : '')));
      box.appendChild(line);
    });
  }
  async function save(patch, saveAnyway) {
    var body = Object.assign({}, patch); if (saveAnyway) body.saveAnyway = true;
    var r = await api('PUT', '/v1/admin/ai/settings', body);
    $('btn-save-anyway').style.display = 'none';
    if (r.status === 200) { notice('Saved. Version ' + r.data.version + ' applies to the next message.', false); showTests(r.data.tests); await load(); return; }
    if (r.status === 409) { notice('Not saved: the test call failed. ' + (r.data.hint || ''), true); showTests(r.data.tests); $('btn-save-anyway').style.display = 'inline-block'; return; }
    if (r.status === 422) { notice('Not saved: ' + (r.data.issues || []).map(function (i) { return i.message; }).join('; '), true); return; }
    notice('Not saved (' + r.status + ').', true);
  }

  async function load() {
    var s = await api('GET', '/v1/admin/ai/settings');
    if (s.status !== 200) { notice('Could not load the settings (' + s.status + ').', true); return; }
    view = s.data; renderCurrent(); renderForm(); renderKeys();
    var st = await api('GET', '/v1/admin/ai/stats?days=7'); if (st.status === 200) renderStats(st.data);
    var au = await api('GET', '/v1/admin/ai/audit'); if (au.status === 200) renderAudit(au.data.entries);
  }

  $('primary-provider').onchange = function () { fillModels($('primary-provider'), $('primary-model'), null); };
  $('fallback-provider').onchange = function () { fillModels($('fallback-provider'), $('fallback-model'), null); };
  $('btn-test').onclick = async function () {
    $('test-result').textContent = 'Testing…';
    var r = await api('POST', '/v1/admin/ai/test', patchFromForm(false));
    if (r.status === 422) { notice('Cannot test: ' + (r.data.issues || []).map(function (i) { return i.message; }).join('; '), true); return; }
    notice('', false); showTests(r.data.tests);
  };
  $('btn-save').onclick = function () { save(patchFromForm(false), false); };
  $('btn-save-anyway').onclick = function () { save(patchFromForm(false), true); };
  $('btn-save-adv').onclick = function () { var p = patchFromForm(true); delete p.primary; delete p.fallback; save(p, false); };
  load();
</script>
</body>
</html>`;
}
