/** The staff editor's stylesheet. Pure text apart from the shared colour tokens. */
import { themeCss } from "../theme.ts";

export function editorCss(): string {
  return `${themeCss()}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 16px;
      line-height: 1.6;
      padding-bottom: 72px;
      transition: background 0.2s, color 0.2s;
    }
    .topbar {
      background: var(--surface);
      border-bottom: 2px solid var(--border);
      padding: 16px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
      gap: 16px;
      flex-wrap: wrap;
      box-shadow: var(--shadow);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-badge {
      background: linear-gradient(135deg, #0284c7, #2563eb);
      color: #fff;
      font-weight: 800;
      font-size: 13px;
      padding: 6px 12px;
      border-radius: 8px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .brand h1 {
      font-size: 20px;
      font-weight: 800;
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .theme-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--surface-2);
      border: 2px solid var(--border);
      color: var(--text);
      border-radius: 999px;
      padding: 8px 16px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
    .theme-btn:hover { border-color: var(--accent); }
    .container {
      max-width: 1360px;
      margin: 24px auto;
      padding: 0 24px;
      display: grid;
      grid-template-columns: 310px 1fr;
      gap: 24px;
    }
    /* A grid item's default min-width: auto lets one wide child (the queue's tab row, a table)
       push the whole page wider than the screen. Measured: a 502px phone viewport had a 716px
       document because of it. */
    .container > * { min-width: 0; }
    @media (max-width: 1024px) {
      /* Narrow screen: the wizard is the work, so it comes FIRST and the queue follows. Measured in
         a browser at 630px: the sidebar (AI check + the whole quotation list) filled the viewport and
         the screen somebody is actually working on was below the fold. The bar also stops being
         sticky here — a sticky bar over a short viewport covers the content it belongs to. */
      .container { grid-template-columns: 1fr; }
      .container > main { order: -1; }
      .wizard-nav { position: static; }
      body { padding-bottom: 16px; }
    }
    /* ---- Phones -------------------------------------------------------------
       A phone is a real device for this page: reading a quotation back to a guest on the phone,
       checking a dive grid while standing at the boat. The two things that break first are the tables
       and the wizard bar, so both are restructured rather than shrunk. */
    @media (max-width: 640px) {
      .topbar { padding: 10px 12px; gap: 10px; }
      .brand { gap: 10px; }
      .brand h1 { font-size: 16.5px; line-height: 1.3; }
      .brand-badge { font-size: 10.5px; padding: 4px 8px; letter-spacing: 0.03em; }
      .top-actions { gap: 8px; }
      .theme-btn { padding: 6px 10px; font-size: 12.5px; }
      .container { padding: 0 10px; margin: 12px auto; }
      .card { padding: 16px 13px; border-radius: 14px; }
      .card-title { font-size: 15px; }
      /* One field per row: two 130px inputs on a 360px screen is a coin flip on every keystroke. */
      .meta-grid { grid-template-columns: 1fr; gap: 10px; }
      /* Four steps wrap to two rows, which is fine; the circles shrink so the labels stay legible. */
      .progress { gap: 6px; }
      .pstep { padding: 5px 10px; font-size: 12.5px; gap: 6px; }
      .pstep .pnum { width: 17px; height: 17px; font-size: 11px; }
      .psep { width: 10px; }
      /* The bar becomes three stacked rows: where you are, the action, then Back. The primary action
         is full width and ABOVE Back, because a thumb reaches the middle of the screen rather than
         the bottom-left corner. */
      .wizard-nav {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        margin-top: 14px;
      }
      .wizard-nav .btn { width: 100%; justify-content: center; padding: 14px 16px; font-size: 16px; }
      .wizard-label { order: 1; text-align: center; }
      #btn-next { order: 2; }
      #btn-back { order: 3; }
      /* Tables keep their columns and scroll sideways inside their card, which is honest about the
         data; squeezing a five-column dive grid into 360px would make it unreadable instead. */
      .quote-table { font-size: 13px; }
      .quote-table th, .quote-table td { padding: 6px 8px; }
      .link-editor-bar { padding: 10px; gap: 8px; }
      .link-editor-bar input { min-width: 100%; font-size: 13.5px; padding: 9px 11px; }
      .link-editor-bar .btn { flex: 1; justify-content: center; }
      .ai-reply-box { font-size: 15px; padding: 14px; border-radius: 12px; }
      .btn { padding: 10px 14px; font-size: 14px; }
      .notice { font-size: 13.5px; padding: 10px 12px; }
      input[type="checkbox"] { width: 15px; height: 15px; }
      /* The dive grid is wider than a phone on purpose (five columns of days cannot be squeezed into
         360px and stay readable), so the screen says it scrolls rather than leaving it to be found. */
      .scroll-hint { display: block; }
    }
    .scroll-hint {
      display: none;
      font-size: 12.5px;
      color: var(--muted);
      font-weight: 700;
      margin-top: 6px;
    }
    .card {
      background: var(--surface);
      border: 2px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: var(--shadow);
    }
    .card-title {
      font-size: 17px;
      font-weight: 800;
      color: var(--accent);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 800;
    }
    .status-pending {
      background: var(--amber-soft);
      color: var(--amber);
      border: 2px solid var(--amber);
    }
    .status-confirmed {
      background: var(--emerald-soft);
      color: var(--emerald);
      border: 2px solid var(--emerald);
    }
    .status-amber {
      background: var(--amber-soft);
      color: var(--amber);
      border: 2px solid var(--amber);
    }
    .status-emerald {
      background: var(--emerald-soft);
      color: var(--emerald);
      border: 2px solid var(--emerald);
    }
    .status-rose {
      background: rgba(244,63,94,0.12);
      color: #e11d48;
      border: 2px solid #f43f5e;
    }
    /* The four steps, and the one place a failure is shown. Both are about the same thing: what is
       left to do before a guest hears from us. */
    .progress {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pstep {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      border-radius: 999px;
      border: 2px solid var(--border);
      background: var(--surface-2);
      color: var(--muted);
      font-size: 13.5px;
      font-weight: 800;
    }
    .pstep .pnum {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--border);
      color: var(--text);
      font-size: 12px;
    }
    .pstep.done {
      border-color: var(--emerald);
      color: var(--emerald);
      background: var(--emerald-soft);
    }
    .pstep.done .pnum { background: var(--emerald); color: #fff; }
    .pstep.current {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--accent-soft);
    }
    .pstep.current .pnum { background: var(--accent); color: #fff; }
    .psep {
      width: 18px;
      height: 2px;
      background: var(--border);
    }
    .progress-note {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--muted);
    }
    .notice {
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .notice-error {
      background: rgba(244,63,94,0.1);
      border-left: 5px solid #f43f5e;
      color: #e11d48;
    }
    .notice-info {
      background: var(--emerald-soft);
      border-left: 5px solid var(--emerald);
      color: var(--emerald);
    }
    /* ---- The wizard: one screen per step ------------------------------------
       The page used to be one long column of cards and a person scrolled to find the next thing to
       do. Each step now owns the screen, the nav bar owns the one action that finishes it, and the
       step that is not being worked on is not in the way.

       The initial screen is chosen SERVER-side (the data-step attribute on the main element), so it
       is correct before any script runs — the same reason the status pill is server-rendered. */
    main > [data-step-card] { display: none; }
    main[data-step="1"] > [data-step-card="1"],
    main[data-step="2"] > [data-step-card="2"],
    main[data-step="3"] > [data-step-card="3"],
    main[data-step="4"] > [data-step-card="4"] { display: block; }
    .pstep { cursor: pointer; }
    .pstep:disabled { cursor: default; opacity: 0.55; }
    .wizard-nav {
      position: sticky;
      bottom: 0;
      z-index: 5;
      margin-top: 18px;
      padding: 12px 16px;
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 14px 14px 0 0;
      box-shadow: 0 -6px 18px rgba(0,0,0,0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .wizard-label {
      font-size: 13.5px;
      font-weight: 800;
      color: var(--muted);
    }
    .wizard-label strong { color: var(--text); }
    .link-editor-bar {
      display: flex;
      gap: 10px;
      align-items: center;
      background: var(--surface-2);
      border: 2px solid var(--border);
      padding: 14px;
      border-radius: 12px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .link-editor-bar input {
      flex: 1;
      min-width: 260px;
      background: var(--input-bg);
      border: 2px solid var(--border);
      color: var(--accent);
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      font-weight: 600;
      padding: 10px 14px;
      border-radius: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
      border: 2px solid transparent;
      transition: 0.15s;
      text-decoration: none;
    }
    .btn-primary {
      background: var(--accent);
      color: #ffffff;
    }
    .btn-primary:hover { filter: brightness(1.08); }
    .btn-emerald {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      font-size: 16px;
      padding: 14px 24px;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.28);
    }
    .btn-emerald:hover { filter: brightness(1.08); }
    .btn-outline {
      background: var(--surface-2);
      color: var(--text);
      border-color: var(--border);
    }
    .btn-outline:hover { border-color: var(--accent); }
    .btn-danger {
      background: rgba(244, 63, 94, 0.12);
      color: var(--rose);
      border-color: rgba(244, 63, 94, 0.35);
      padding: 8px 12px;
      font-size: 14px;
    }
    table.quote-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    table.quote-table th {
      text-align: left;
      font-size: 13.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      padding: 12px 10px;
      border-bottom: 2px solid var(--border);
      background: var(--surface-2);
    }
    table.quote-table td {
      padding: 12px 8px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    .cell-input {
      width: 100%;
      background: var(--input-bg);
      border: 2px solid var(--border);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 9px;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
    }
    .cell-input:focus {
      outline: none;
      border-color: var(--accent);
    }
    .cell-num {
      width: 90px;
      text-align: right;
      font-family: 'JetBrains Mono', monospace;
    }
    .cell-price {
      width: 125px;
      text-align: right;
      font-family: 'JetBrains Mono', monospace;
    }
    .subtotal-cell {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 800;
      font-size: 16px;
      color: var(--accent);
      text-align: right;
      padding-right: 12px;
    }
    .totals-grid {
      display: flex;
      justify-content: flex-end;
      margin-top: 20px;
    }
    .totals-box {
      width: 400px;
      max-width: 100%;
      background: var(--surface-2);
      border: 2px solid var(--border);
      border-radius: 14px;
      padding: 20px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .totals-row.grand {
      border-top: 2px solid var(--border);
      margin-top: 10px;
      padding-top: 14px;
      font-size: 21px;
      font-weight: 800;
      color: var(--emerald);
    }
    /* Two lines, not three. A card used to be ~160px tall — the long quotation id and the status label
       wrapped inside a narrow sidebar — so a laptop screen showed barely one and a half quotations
       before the receptionist had to scroll. Name + status on the first line, the trip on the second;
       the id shrinks to its last eight characters (the full id is still the link's title and is still
       what the search box matches). */
    .quote-list-item {
      display: block;
      padding: 9px 12px;
      border-radius: 10px;
      border: 2px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      text-decoration: none;
      margin-bottom: 8px;
      transition: 0.15s;
    }
    .quote-list-item:hover, .quote-list-item.active {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .ql-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .ql-name { font-size: 15px; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ql-status { font-size: 12.5px; font-weight: 800; display: flex; align-items: center; gap: 6px; white-space: nowrap; flex: none; }
    .ql-meta { font-size: 13px; color: var(--muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ql-id { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; opacity: 0.8; }

    /* Sort + filters. The sort box is always visible; the filters fold away behind one button whose
       badge says how many are on. A display:grid rule would override the hidden attribute, so it is
       restated explicitly below. */
    .queue-tools { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; }
    .queue-sort { flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 800; color: var(--muted); }
    /* The sort box has to show its whole current choice: a select that reads "Check-in soo" tells the
       receptionist nothing. Hence the short option labels and the slim Filters button beside it. */
    .queue-sort select, .queue-filters select {
      flex: 1; min-width: 0; width: 100%;
      border: 2px solid var(--border); border-radius: 8px;
      background: var(--input-bg); color: var(--text);
      padding: 6px 6px; font: inherit; font-size: 12.5px; font-weight: 600;
    }
    .queue-sort select:focus, .queue-filters select:focus { outline: none; border-color: var(--accent); }
    .queue-filter-btn { padding: 6px 8px; font-size: 12.5px; white-space: nowrap; flex: none; }
    .queue-filter-btn.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    #queue-filter-count:not(:empty) {
      margin-left: 4px; background: var(--accent); color: var(--surface);
      border-radius: 999px; padding: 0 6px; font-size: 11px; font-weight: 800;
    }
    .queue-filters {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px;
      margin-bottom: 10px; padding: 10px;
      border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2);
    }
    .queue-filters[hidden] { display: none; }
    .queue-filters label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .queue-filters label:nth-of-type(3) { grid-column: 1 / -1; }
    .queue-clear {
      grid-column: 1 / -1; justify-self: start; border: 0; background: none; padding: 2px 0;
      font: inherit; font-size: 12.5px; font-weight: 800; color: var(--accent); cursor: pointer; text-decoration: underline;
    }
    .queue-clear[hidden] { display: none; }
    .queue-empty { padding: 16px; text-align: center; color: var(--muted); font-size: 13px; font-weight: 600; }
    .queue-empty button { border: 0; background: none; font: inherit; font-weight: 800; color: var(--accent); cursor: pointer; text-decoration: underline; }
    .tab-row {
      display: flex;
      gap: 4px;
      /* Wraps rather than forcing the sidebar wider than the screen: four buttons in a row measured
         706px, which is what made the whole page scroll sideways on a phone. */
      flex-wrap: wrap;
      margin-bottom: 12px;
      background: var(--surface-2);
      padding: 4px;
      border-radius: 8px;
    }
    .tab-btn {
      flex: 1 1 auto;
      min-width: 70px;
      padding: 7px 10px;
      font-size: 13px;
      font-weight: 700;
      border: none;
      background: transparent;
      color: var(--muted);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .tab-btn:hover {
      color: var(--text);
    }
    .tab-btn.active {
      background: var(--card);
      color: var(--accent);
      box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    }
    .ai-reply-box {
      background: var(--surface-2);
      border: 2px solid var(--emerald);
      border-radius: 14px;
      padding: 20px;
      font-size: 16px;
      font-weight: 500;
      white-space: pre-wrap;
      line-height: 1.7;
      color: var(--text);
      margin-top: 14px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }
    @media (max-width: 768px) {
      .meta-grid { grid-template-columns: 1fr 1fr; }
    }
    .meta-field label {
      display: block;
      font-size: 13px;
      font-weight: 800;
      color: var(--muted);
      text-transform: uppercase;
      margin-bottom: 6px;
    }`;
}
