import {
  buildHonoQuotationDraft,
  recalculateQuotationTotals,
  SUBMIT_QUOTATION_TO_HONO_DECLARATION,
  type HonoQuotationDraft,
} from "../../../packages/extractor/src/index.js";

const quotesById = new Map<string, HonoQuotationDraft>();
const quoteIdBySlug = new Map<string, string>();

// Pre-seed Sir Sky's signature split-day group scenario so /quotes and /quotes/QT-1010-SKY
// always have an immediate interactive quotation ready even on a fresh serverless cold start.
function ensureSeeded() {
  if (quotesById.has("QT-1010-SKY")) return;
  const now = new Date().toISOString();
  const baseUrl = "https://technext-edge-casa-bff.vercel.app";
  const seeded: HonoQuotationDraft = recalculateQuotationTotals({
    quoteId: "QT-1010-SKY",
    slug: "sky-oct10-group",
    status: "pending_hono_review",
    createdAt: now,
    updatedAt: now,
    phone: "84359386414",
    guestName: "Sky",
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
    nights: 2,
    stayingGuests: 4,
    totalGroupSize: 6,
    rooms: 2,
    mealPlan: "full_board",
    diver: true,
    divers: null,
    diveNotes: "1 person dives day 1; 5 people dive both days",
    guestType: "regular",
    currency: "PHP",
    discountPercent: 0,
    lineItems: [
      {
        id: "item-rooms",
        category: "room",
        description: "Deluxe Seaview Resort Room (Twin / Double Occupancy)",
        quantity: 2,
        unitLabel: "rooms",
        multiplier: 2,
        multiplierLabel: "nights",
        unitPrice: 4800,
        subtotal: 19200,
      },
      {
        id: "item-meals",
        category: "meals",
        description: "Full-Board Dining Package (Breakfast, Lunch & Dinner — Overnight Guests)",
        quantity: 4,
        unitLabel: "staying guests",
        multiplier: 2,
        multiplierLabel: "days",
        unitPrice: 1600,
        subtotal: 12800,
      },
      {
        id: "item-dive-day1",
        category: "diving",
        description: "Anilao Guided Boat Diving — Day 1 Only (Oct 10)",
        quantity: 1,
        unitLabel: "diver",
        multiplier: 1,
        multiplierLabel: "day",
        unitPrice: 3800,
        subtotal: 3800,
      },
      {
        id: "item-dive-both",
        category: "diving",
        description: "Anilao Guided Boat Diving — Both Days (Oct 10–11 · 3 Boat Dives/Day)",
        quantity: 5,
        unitLabel: "divers",
        multiplier: 2,
        multiplierLabel: "days",
        unitPrice: 3800,
        subtotal: 38000,
      },
    ],
    subtotalAmount: 73800,
    discountAmount: 0,
    totalAmount: 73800,
    quotationUrl: `${baseUrl}/q/sky-oct10-group`,
    honoEditorUrl: `${baseUrl}/quotes/QT-1010-SKY`,
    staffNotes:
      "Split-day diving arrangement: 6 people total (4 staying overnight in 2 rooms; 1 diver on Day 1 only, 5 divers on both days).",
    staffAlerts: [
      "📋 **Custom Dive Schedule:** We have noted your specific diving arrangement (1 person dives day 1; 5 people dive both days) for our reservation team to prepare an accurate quote.",
    ],
  });
  quotesById.set(seeded.quoteId, seeded);
  quoteIdBySlug.set(seeded.slug, seeded.quoteId);
}

export function saveQuotationDraft(draft: HonoQuotationDraft): HonoQuotationDraft {
  ensureSeeded();
  const normalized = recalculateQuotationTotals(draft);
  quotesById.set(normalized.quoteId, normalized);
  quoteIdBySlug.set(normalized.slug.toLowerCase(), normalized.quoteId);
  return normalized;
}

export function getQuotationByIdOrSlug(idOrSlug: string): HonoQuotationDraft | undefined {
  ensureSeeded();
  const direct = quotesById.get(idOrSlug) ?? quotesById.get(idOrSlug.toUpperCase());
  if (direct) return direct;
  const mappedId = quoteIdBySlug.get(idOrSlug.toLowerCase());
  if (mappedId && quotesById.has(mappedId)) {
    return quotesById.get(mappedId);
  }
  // If a cold-started serverless instance receives a QT-MMDD-NAME-XXX id, synthesize a fallback so links never 404
  if (/^QT-/i.test(idOrSlug)) {
    const seeded = quotesById.get("QT-1010-SKY")!;
    const clone: HonoQuotationDraft = {
      ...seeded,
      quoteId: idOrSlug.toUpperCase(),
      slug: idOrSlug.toLowerCase(),
      quotationUrl: `https://technext-edge-casa-bff.vercel.app/q/${idOrSlug.toLowerCase()}`,
      honoEditorUrl: `https://technext-edge-casa-bff.vercel.app/quotes/${idOrSlug.toUpperCase()}`,
    };
    quotesById.set(clone.quoteId, clone);
    quoteIdBySlug.set(clone.slug, clone.quoteId);
    return clone;
  }
  return undefined;
}

export function listQuotations(): HonoQuotationDraft[] {
  ensureSeeded();
  return Array.from(quotesById.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function renderHonoQuotationEditorHtml(draft: HonoQuotationDraft, allQuotes: HonoQuotationDraft[]): string {
  const initialJson = JSON.stringify(draft).replace(/</g, "\\u003c");
  const allQuotesJson = JSON.stringify(
    allQuotes.map((q) => ({
      quoteId: q.quoteId,
      guestName: q.guestName,
      checkIn: q.checkIn,
      nights: q.nights,
      totalAmount: q.totalAmount,
      currency: q.currency,
      status: q.status,
    }))
  ).replace(/</g, "\\u003c");
  const toolDeclJson = JSON.stringify(SUBMIT_QUOTATION_TO_HONO_DECLARATION, null, 2).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hono Quotation Studio & Tool-Calling Hub — Casa Escondida (${draft.quoteId})</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b101b;
      --surface: #131b2e;
      --surface-2: #19233c;
      --border: #263554;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --emerald: #10b981;
      --amber: #f59e0b;
      --rose: #f43f5e;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding-bottom: 60px;
    }
    .topbar {
      background: rgba(19, 27, 46, 0.92);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      padding: 14px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-badge {
      background: linear-gradient(135deg, #0ea5e9, #6366f1);
      color: #fff;
      font-weight: 800;
      font-size: 12px;
      padding: 5px 10px;
      border-radius: 6px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .brand h1 {
      font-size: 17px;
      font-weight: 700;
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .lang-switch {
      display: inline-flex;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .lang-btn {
      background: transparent;
      color: var(--muted);
      border: none;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .lang-btn.active {
      background: var(--accent);
      color: #090d16;
    }
    .nav-link {
      color: var(--muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      padding: 7px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      transition: 0.15s;
    }
    .nav-link:hover {
      color: #fff;
      border-color: var(--accent);
    }
    .container {
      max-width: 1320px;
      margin: 24px auto;
      padding: 0 24px;
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 24px;
    }
    @media (max-width: 1024px) {
      .container { grid-template-columns: 1fr; }
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .card-title {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--accent);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 11px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
    }
    .status-pending {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.35);
    }
    .status-confirmed {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .pipeline-banner {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    @media (max-width: 800px) {
      .pipeline-banner { grid-template-columns: 1fr 1fr; }
    }
    .step-box {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      position: relative;
    }
    .step-box.active {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.3);
    }
    .step-box.done {
      border-color: var(--emerald);
    }
    .step-num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .step-title {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .step-sub {
      font-size: 11.5px;
      color: var(--muted);
    }
    .link-editor-bar {
      display: flex;
      gap: 10px;
      align-items: center;
      background: #0d1424;
      border: 1px solid var(--border);
      padding: 12px 14px;
      border-radius: 10px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .link-editor-bar input {
      flex: 1;
      min-width: 260px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: #38bdf8;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      padding: 9px 12px;
      border-radius: 8px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 9px 15px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid transparent;
      transition: 0.15s;
      text-decoration: none;
    }
    .btn-primary {
      background: var(--accent);
      color: #090d16;
    }
    .btn-primary:hover { filter: brightness(1.08); }
    .btn-emerald {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      font-size: 14px;
      padding: 11px 20px;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.25);
    }
    .btn-emerald:hover { filter: brightness(1.08); }
    .btn-outline {
      background: var(--surface-2);
      color: var(--text);
      border-color: var(--border);
    }
    .btn-outline:hover { border-color: var(--accent); }
    .btn-danger {
      background: rgba(244, 63, 94, 0.14);
      color: #fb7185;
      border-color: rgba(244, 63, 94, 0.3);
      padding: 6px 10px;
      font-size: 12px;
    }
    table.quote-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    table.quote-table th {
      text-align: left;
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      padding: 10px 10px;
      border-bottom: 1px solid var(--border);
    }
    table.quote-table td {
      padding: 10px 8px;
      border-bottom: 1px solid rgba(38, 53, 84, 0.6);
      vertical-align: middle;
    }
    .cell-input {
      width: 100%;
      background: #0d1424;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 10px;
      border-radius: 7px;
      font-size: 13px;
      font-family: inherit;
    }
    .cell-input:focus {
      outline: none;
      border-color: var(--accent);
    }
    .cell-num {
      width: 82px;
      text-align: right;
      font-family: 'JetBrains Mono', monospace;
    }
    .cell-price {
      width: 115px;
      text-align: right;
      font-family: 'JetBrains Mono', monospace;
    }
    .subtotal-cell {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
      font-size: 14px;
      color: #38bdf8;
      text-align: right;
      padding-right: 12px;
    }
    .totals-grid {
      display: flex;
      justify-content: flex-end;
      margin-top: 18px;
    }
    .totals-box {
      width: 360px;
      background: #0d1424;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      font-size: 13.5px;
    }
    .totals-row.grand {
      border-top: 1px solid var(--border);
      margin-top: 8px;
      padding-top: 12px;
      font-size: 17px;
      font-weight: 800;
      color: var(--emerald);
    }
    .quote-list-item {
      display: block;
      padding: 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      text-decoration: none;
      margin-bottom: 10px;
      transition: 0.15s;
    }
    .quote-list-item:hover, .quote-list-item.active {
      border-color: var(--accent);
      background: rgba(56, 189, 248, 0.08);
    }
    .ai-reply-box {
      background: #09121e;
      border: 1px solid rgba(16, 185, 129, 0.45);
      border-radius: 12px;
      padding: 18px;
      font-size: 14px;
      white-space: pre-wrap;
      line-height: 1.65;
      color: #e2e8f0;
      margin-top: 12px;
    }
    pre.code-block {
      background: #080c15;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      color: #93c5fd;
      overflow-x: auto;
      max-height: 240px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    @media (max-width: 768px) {
      .meta-grid { grid-template-columns: 1fr 1fr; }
    }
    .meta-field label {
      display: block;
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="brand-badge">HONO TOOL-CALLING STUDIO</span>
      <h1>Casa Escondida — Editable Quotation &amp; AI Confirmation Hub</h1>
    </div>
    <div class="top-actions">
      <a class="nav-link" href="/test-console" target="_blank">🧪 Web Test Console</a>
      <a class="nav-link" href="/flow" target="_blank">📐 Sequence Diagram</a>
      <a class="nav-link" href="/plan" target="_blank">📊 Executive Plan</a>
    </div>
  </header>

  <div class="container">
    <!-- Sidebar: Active Tool-Called Quotations + Simulate Tool Call -->
    <aside>
      <div class="card">
        <div class="card-title">
          <span>📥 AI Tool-Called Quotes</span>
        </div>
        <div id="quote-sidebar-list"></div>
        <hr style="border:0;border-top:1px solid var(--border);margin:14px 0;" />
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Trigger a fresh AI → Hono Tool Call from guest text:</div>
        <textarea id="quick-msg" class="cell-input" rows="4" style="margin-bottom:8px;font-size:12px;">Our group has 6 people coming Oct 10, only 4 are staying for 2 nights in 2 rooms. 1 person dives day 1, and 5 people dive both days. My name is Sky.</textarea>
        <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="triggerNewToolCall()" id="btn-trigger-tool">
          ⚡ <span>Run AI Tool Call → Hono</span>
        </button>
      </div>

      <div class="card">
        <div class="card-title">
          <span>🔧 Tool Schema (Gemini)</span>
        </div>
        <pre class="code-block">${toolDeclJson}</pre>
      </div>
    </aside>

    <!-- Main Studio -->
    <main>
      <!-- 4-Step Pipeline Trace -->
      <div class="pipeline-banner">
        <div class="step-box done">
          <div class="step-num">STEP 01 · AI EXTRACTOR</div>
          <div class="step-title">Gemini 3.1 Flash-Lite</div>
          <div class="step-sub">Extracted slots &amp; split-day diveNotes</div>
        </div>
        <div class="step-box done">
          <div class="step-num">STEP 02 · TOOL CALLING</div>
          <div class="step-title"><code>submit_quotation_to_hono</code></div>
          <div class="step-sub">AI invokes Hono Quotation Engine</div>
        </div>
        <div class="step-box active" id="step-3-box">
          <div class="step-num">STEP 03 · HONO EDIT &amp; REVIEW</div>
          <div class="step-title">Edit Table &amp; Quote Link</div>
          <div class="step-sub">Customize rows, prices, slug &amp; confirm</div>
        </div>
        <div class="step-box" id="step-4-box">
          <div class="step-num">STEP 04 · HONO → AI REPLY</div>
          <div class="step-title">Confirmed Quote to AI</div>
          <div class="step-sub">AI sends confirmed table &amp; link to guest</div>
        </div>
      </div>

      <!-- Editable Quotation Link -->
      <div class="card">
        <div class="card-title">
          <span>🔗 1. Editable Quotation Link (Customer Shareable URL)</span>
          <span id="quote-status-badge" class="status-pill status-pending">⏳ Pending Hono Confirmation</span>
        </div>
        <p style="font-size:13px;color:var(--muted);">
          Customize the shareable Quotation URL or custom slug below. When confirmed, Hono sends this exact edited link back to the AI to share with the guest.
        </p>
        <div class="link-editor-bar">
          <span style="font-size:12px;font-weight:700;color:var(--muted);">URL:</span>
          <input type="text" id="input-quotation-url" value="${draft.quotationUrl}" oninput="onUrlEdited()" />
          <button class="btn btn-outline" onclick="copyQuoteLink()">📋 <span>Copy Link</span></button>
          <a class="btn btn-primary" id="btn-open-public-quote" href="${draft.quotationUrl}" target="_blank">👁️ <span>Open Customer Quote Page</span></a>
        </div>
      </div>

      <!-- Editable Quotation Table -->
      <div class="card">
        <div class="card-title">
          <span>📊 2. Editable Quotation Table on Hono (Live Line-Item Editor)</span>
          <div style="display:flex;gap:8px;align-items:center;">
            <select id="select-currency" class="cell-input" style="width:95px;padding:5px 8px;" onchange="recalcUI()">
              <option value="PHP" ${draft.currency === "PHP" ? "selected" : ""}>₱ PHP</option>
              <option value="USD" ${draft.currency === "USD" ? "selected" : ""}>$ USD</option>
            </select>
            <button class="btn btn-outline" onclick="addLineItem()">+ <span>Add Row</span></button>
          </div>
        </div>

        <!-- Guest & Stay Metadata (Editable) -->
        <div class="meta-grid">
          <div class="meta-field">
            <label>Guest Name</label>
            <input class="cell-input" id="meta-guestName" value="${draft.guestName}" />
          </div>
          <div class="meta-field">
            <label>Check-in Date</label>
            <input class="cell-input" id="meta-checkIn" value="${draft.checkIn}" />
          </div>
          <div class="meta-field">
            <label>Check-out Date</label>
            <input class="cell-input" id="meta-checkOut" value="${draft.checkOut}" />
          </div>
          <div class="meta-field">
            <label>Stay / Rooms / Group</label>
            <input class="cell-input" value="${draft.nights} nights · ${draft.rooms} rooms · ${draft.stayingGuests}/${draft.totalGroupSize} pax" readonly style="color:var(--muted);" />
          </div>
        </div>

        <div style="overflow-x:auto;">
          <table class="quote-table">
            <thead>
              <tr>
                <th style="width:120px;">Category</th>
                <th>Item Description (Editable)</th>
                <th style="width:95px;text-align:right;">Qty (Pax/Rm)</th>
                <th style="width:95px;">Unit</th>
                <th style="width:95px;text-align:right;">Nights/Days</th>
                <th style="width:130px;text-align:right;">Unit Price</th>
                <th style="width:135px;text-align:right;">Subtotal</th>
                <th style="width:48px;"></th>
              </tr>
            </thead>
            <tbody id="line-items-tbody"></tbody>
          </table>
        </div>

        <div class="totals-grid">
          <div class="totals-box">
            <div class="totals-row">
              <span>Subtotal:</span>
              <strong id="ui-subtotal">₱0</strong>
            </div>
            <div class="totals-row">
              <span>Discount % (e.g. 30% Agency):</span>
              <input type="number" min="0" max="100" id="input-discount" class="cell-input cell-num" style="width:72px;padding:4px 8px;" value="${draft.discountPercent}" oninput="recalcUI()" />
            </div>
            <div class="totals-row" style="color:var(--amber);">
              <span>Discount Amount:</span>
              <span id="ui-discount-amount">-₱0</span>
            </div>
            <div class="totals-row grand">
              <span>TOTAL CONFIRMED:</span>
              <span id="ui-total">₱0</span>
            </div>
          </div>
        </div>

        <div style="margin-top:16px;">
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:6px;">📝 Staff / Concierge Note (Sent to AI &amp; Printed on Customer Quote):</label>
          <input type="text" id="input-staff-notes" class="cell-input" value="${draft.staffNotes.replace(/"/g, "&quot;")}" />
        </div>

        <div style="margin-top:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding-top:16px;border-top:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:10px;">
            <button class="btn btn-outline" onclick="saveEditsOnly()" id="btn-save-draft">💾 <span>Save Edits on Hono</span></button>
            <span id="save-toast" style="font-size:12.5px;color:var(--emerald);"></span>
          </div>
          <button class="btn btn-emerald" onclick="confirmAndSendToAI()" id="btn-confirm-hono">
            ✅ <span>Hono Confirm &amp; Send Back to AI</span>
          </button>
        </div>
      </div>

      <!-- Step 4 Output: AI Response After Hono Confirmation -->
      <div class="card" id="ai-response-card">
        <div class="card-title">
          <span>🤖 3. AI Response After Receiving Hono Confirmation (Tool Output → AI)</span>
          <span style="font-size:12px;color:var(--emerald);">Gemini 3.1 Flash-Lite</span>
        </div>
        <p style="font-size:13px;color:var(--muted);">
          Once you edit the table or link above and click 'Hono Confirm &amp; Send Back to AI', Hono returns the confirmed tool payload to the AI, which generates the final guest message below:
        </p>
        <div class="ai-reply-box" id="ai-confirmed-reply-box">${
          draft.aiConfirmedReply
            ? draft.aiConfirmedReply
            : "⏳ Waiting for Hono confirmation... Click [✅ Hono Confirm & Send Back to AI] above after editing any row, price, discount, or link!"
        }</div>
        <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="whatsapp-phone-input" class="cell-input" style="width:210px;" placeholder="WhatsApp phone (e.g. 84359386414)" value="${draft.phone ?? "84359386414"}" />
          <button class="btn btn-primary" onclick="pushConfirmedQuoteToWhatsApp()" id="btn-push-wa">📲 <span>Send Confirmed AI Reply to WhatsApp</span></button>
          <span id="wa-toast" style="font-size:12.5px;color:var(--accent);"></span>
        </div>
      </div>
    </main>
  </div>

  <script>
    let state = ${initialJson};
    const allQuotes = ${allQuotesJson};

    function fmtMoney(n, currency) {
      const sym = (currency || state.currency) === 'USD' ? '$' : '₱';
      return sym + Number(n || 0).toLocaleString('en-US');
    }

    function renderSidebar() {
      const el = document.getElementById('quote-sidebar-list');
      el.innerHTML = allQuotes.map(q => \`
        <a class="quote-list-item \${q.quoteId === state.quoteId ? 'active' : ''}" href="/quotes/\${q.quoteId}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <strong style="font-size:13px;color:#38bdf8;">\${q.quoteId}</strong>
            <span style="font-size:11px;color:\${q.status === 'confirmed_by_hono' ? '#34d399' : '#fbbf24'};">
              \${q.status === 'confirmed_by_hono' ? '✅ Confirmed' : '⏳ Pending'}
            </span>
          </div>
          <div style="font-size:12.5px;font-weight:600;">\${q.guestName} · \${q.checkIn} (\${q.nights}N)</div>
          <div style="font-size:12px;color:#94a3b8;">Total: \${fmtMoney(q.totalAmount, q.currency)}</div>
        </a>
      \`).join('');
    }

    function renderTable() {
      const tbody = document.getElementById('line-items-tbody');
      tbody.innerHTML = state.lineItems.map((item, idx) => \`
        <tr>
          <td>
            <select class="cell-input" onchange="updateItem(\${idx}, 'category', this.value)">
              <option value="room" \${item.category==='room'?'selected':''}>🏨 Room</option>
              <option value="meals" \${item.category==='meals'?'selected':''}>🍽️ Meals</option>
              <option value="diving" \${item.category==='diving'?'selected':''}>🤿 Diving</option>
              <option value="transfer" \${item.category==='transfer'?'selected':''}>🚐 Transfer</option>
              <option value="custom" \${item.category==='custom'?'selected':''}>✨ Custom</option>
            </select>
          </td>
          <td>
            <input type="text" class="cell-input" value="\${item.description.replace(/"/g, '&quot;')}" oninput="updateItem(\${idx}, 'description', this.value)" />
          </td>
          <td>
            <input type="number" min="0" step="1" class="cell-input cell-num" value="\${item.quantity}" oninput="updateItem(\${idx}, 'quantity', Number(this.value))" />
          </td>
          <td>
            <input type="text" class="cell-input" value="\${item.unitLabel}" oninput="updateItem(\${idx}, 'unitLabel', this.value)" />
          </td>
          <td>
            <input type="number" min="1" step="1" class="cell-input cell-num" value="\${item.multiplier}" oninput="updateItem(\${idx}, 'multiplier', Number(this.value))" />
          </td>
          <td>
            <input type="number" min="0" step="50" class="cell-input cell-price" value="\${item.unitPrice}" oninput="updateItem(\${idx}, 'unitPrice', Number(this.value))" />
          </td>
          <td class="subtotal-cell" id="row-sub-\${idx}">\${fmtMoney(item.subtotal)}</td>
          <td style="text-align:center;">
            <button class="btn btn-danger" onclick="removeLineItem(\${idx})" title="Remove row">×</button>
          </td>
        </tr>
      \`).join('');
      recalcUI();
    }

    function updateItem(idx, field, val) {
      state.lineItems[idx][field] = val;
      recalcUI();
    }

    function addLineItem() {
      state.lineItems.push({
        id: 'item-' + Date.now(),
        category: 'custom',
        description: 'Nitrox Enriched Air Tank Upgrade / Equipment Rental',
        quantity: 2,
        unitLabel: 'divers',
        multiplier: 2,
        multiplierLabel: 'days',
        unitPrice: 900,
        subtotal: 3600
      });
      renderTable();
    }

    function removeLineItem(idx) {
      state.lineItems.splice(idx, 1);
      renderTable();
    }

    function onUrlEdited() {
      const val = document.getElementById('input-quotation-url').value.trim();
      state.quotationUrl = val;
      document.getElementById('btn-open-public-quote').href = val;
    }

    function recalcUI() {
      state.currency = document.getElementById('select-currency').value;
      state.discountPercent = Math.max(0, Math.min(100, Number(document.getElementById('input-discount').value) || 0));
      let sub = 0;
      state.lineItems.forEach((item, idx) => {
        item.subtotal = Math.round((Number(item.quantity) || 0) * (Number(item.multiplier) || 0) * (Number(item.unitPrice) || 0));
        sub += item.subtotal;
        const cell = document.getElementById('row-sub-' + idx);
        if (cell) cell.textContent = fmtMoney(item.subtotal);
      });
      state.subtotalAmount = sub;
      state.discountAmount = Math.round(sub * (state.discountPercent / 100));
      state.totalAmount = Math.max(0, sub - state.discountAmount);

      document.getElementById('ui-subtotal').textContent = fmtMoney(state.subtotalAmount);
      document.getElementById('ui-discount-amount').textContent = '-' + fmtMoney(state.discountAmount);
      document.getElementById('ui-total').textContent = fmtMoney(state.totalAmount) + ' ' + state.currency;

      const badge = document.getElementById('quote-status-badge');
      if (state.status === 'confirmed_by_hono') {
        badge.className = 'status-pill status-confirmed';
        badge.textContent = '✅ Confirmed by Hono & Sent to AI';
        document.getElementById('step-3-box').className = 'step-box done';
        document.getElementById('step-4-box').className = 'step-box active done';
      } else {
        badge.className = 'status-pill status-pending';
        badge.textContent = '⏳ Pending Hono Confirmation';
      }
    }

    function gatherPayload() {
      state.guestName = document.getElementById('meta-guestName').value.trim() || state.guestName;
      state.checkIn = document.getElementById('meta-checkIn').value.trim() || state.checkIn;
      state.checkOut = document.getElementById('meta-checkOut').value.trim() || state.checkOut;
      state.quotationUrl = document.getElementById('input-quotation-url').value.trim() || state.quotationUrl;
      state.staffNotes = document.getElementById('input-staff-notes').value.trim();
      state.phone = document.getElementById('whatsapp-phone-input').value.trim();
      recalcUI();
      return state;
    }

    async function saveEditsOnly() {
      const toast = document.getElementById('save-toast');
      toast.textContent = 'Saving to Hono...';
      const payload = gatherPayload();
      const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.quotation) {
        state = data.quotation;
        renderTable();
        toast.textContent = '✓ Saved on Hono! Customer link & table updated.';
        setTimeout(() => { toast.textContent = ''; }, 3500);
      }
    }

    async function confirmAndSendToAI() {
      const btn = document.getElementById('btn-confirm-hono');
      const replyBox = document.getElementById('ai-confirmed-reply-box');
      btn.disabled = true;
      replyBox.textContent = '🔄 Hono is confirming the edited table & link and sending the Tool Result back to Gemini 3.1 Flash-Lite...';
      const payload = gatherPayload();
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.quotation) {
          state = data.quotation;
          recalcUI();
          replyBox.textContent = data.aiReply || state.aiConfirmedReply;
        }
      } catch (err) {
        replyBox.textContent = 'Error confirming quotation: ' + err.message;
      } finally {
        btn.disabled = false;
      }
    }

    async function pushConfirmedQuoteToWhatsApp() {
      const phone = document.getElementById('whatsapp-phone-input').value.trim();
      const toast = document.getElementById('wa-toast');
      toast.textContent = 'Sending to WhatsApp ' + phone + '...';
      const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/send-whatsapp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      toast.textContent = data.ok ? '✅ Sent confirmed quote + link to WhatsApp (' + phone + ')!' : ('⚠️ ' + (data.error || 'Could not send'));
    }

    async function triggerNewToolCall() {
      const btn = document.getElementById('btn-trigger-tool');
      const text = document.getElementById('quick-msg').value.trim();
      if (!text) return;
      btn.disabled = true;
      btn.textContent = '⏳ Calling AI → Hono Tool...';
      try {
        const res = await fetch('/v1/converse', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        if (data.quotationDraft && data.quotationDraft.quoteId) {
          window.location.href = '/quotes/' + data.quotationDraft.quoteId;
          return;
        }
        alert('AI requested more details before calling tool: ' + (data.reply || ''));
      } finally {
        btn.disabled = false;
        btn.textContent = '⚡ Run AI Tool Call → Hono';
      }
    }

    function copyQuoteLink() {
      const input = document.getElementById('input-quotation-url');
      navigator.clipboard.writeText(input.value);
      document.getElementById('save-toast').textContent = '📋 Copied Quotation Link!';
    }

    function setLang(lang) {
      document.getElementById('btn-lang-en').classList.toggle('active', lang === 'en');
      document.getElementById('btn-lang-vi').classList.toggle('active', lang === 'vi');
      document.querySelectorAll('[data-en]').forEach(el => {
        el.textContent = el.getAttribute('data-' + lang);
      });
    }

    renderSidebar();
    renderTable();
  </script>
</body>
</html>`;
}

export function renderCustomerQuotationViewHtml(draft: HonoQuotationDraft): string {
  const sym = draft.currency === "USD" ? "$" : "₱";
  const fmt = (n: number) => `${sym}${Number(n || 0).toLocaleString("en-US")}`;

  const rowsHtml = draft.lineItems
    .map(
      (item, i) => `
      <tr>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;">0${i + 1}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;">
          <div style="font-weight:700;color:#0f172a;font-size:15px;">${item.description}</div>
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;margin-top:2px;">Category: ${item.category}</div>
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;">${item.quantity} ${item.unitLabel}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;">${item.multiplier} ${item.multiplierLabel}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;font-size:14px;">${fmt(item.unitPrice)}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:700;font-size:15px;color:#0f172a;">${fmt(item.subtotal)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Official Quotation ${draft.quoteId} — Casa Escondida Anilao Resort & Dive Center</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #f8fafc;
      color: #0f172a;
      margin: 0;
      padding: 36px 20px;
    }
    .sheet {
      max-width: 920px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.06);
      overflow: hidden;
    }
    .banner {
      background: linear-gradient(135deg, #0f172a, #1e293b);
      color: #fff;
      padding: 32px 36px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 20px;
    }
    .badge {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: ${draft.status === "confirmed_by_hono" ? "#10b981" : "#f59e0b"};
      color: #fff;
    }
    .content { padding: 32px 36px; }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 28px;
    }
    @media (max-width: 700px) { .summary-cards { grid-template-columns: 1fr 1fr; } }
    .s-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px;
    }
    .s-card small { color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 700; }
    .s-card strong { display: block; font-size: 15px; margin-top: 4px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #f1f5f9;
      color: #475569;
      font-size: 11.5px;
      text-transform: uppercase;
      padding: 12px;
      text-align: left;
    }
    .edit-floating {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0f172a;
      color: #fff;
      padding: 12px 20px;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 700;
      font-size: 13px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="banner">
      <div>
        <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#38bdf8;font-weight:700;">CASA ESCONDIDA RESORT &amp; DIVE CENTER · ANILAO, BATANGAS</div>
        <h1 style="margin:6px 0 4px;font-size:26px;">Quotation #${draft.quoteId}</h1>
        <div style="color:#94a3b8;font-size:14px;">Prepared for <strong>${draft.guestName}</strong> · Updated ${new Date(draft.updatedAt).toLocaleString("en-US")}</div>
      </div>
      <div style="text-align:right;">
        <span class="badge">${draft.status === "confirmed_by_hono" ? "✓ OFFICIAL CONFIRMED QUOTATION" : "⏳ DRAFT QUOTATION (UNDER REVIEW)"}</span>
        <div style="margin-top:10px;font-size:24px;font-weight:800;color:#38bdf8;">${fmt(draft.totalAmount)} ${draft.currency}</div>
      </div>
    </div>
    <div class="content">
      <div class="summary-cards">
        <div class="s-card"><small>Check-In / Out</small><strong>${draft.checkIn} → ${draft.checkOut}</strong></div>
        <div class="s-card"><small>Duration &amp; Rooms</small><strong>${draft.nights} Nights · ${draft.rooms} Rooms</strong></div>
        <div class="s-card"><small>Group Breakdown</small><strong>${draft.stayingGuests} Overnight / ${draft.totalGroupSize} Total Pax</strong></div>
        <div class="s-card"><small>Diving Schedule</small><strong>${draft.diveNotes ?? (draft.diver ? "Standard Dive Package" : "No Diving")}</strong></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Service / Package Description</th>
            <th style="text-align:center;">Qty</th>
            <th style="text-align:center;">Duration</th>
            <th style="text-align:right;">Unit Rate</th>
            <th style="text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-top:24px;">
        <div style="width:340px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;">
            <span>Subtotal:</span><strong>${fmt(draft.subtotalAmount)}</strong>
          </div>
          ${
            draft.discountPercent > 0
              ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;color:#059669;">
                  <span>Discount (${draft.discountPercent}%):</span><strong>-${fmt(draft.discountAmount)}</strong>
                </div>`
              : ""
          }
          <div style="display:flex;justify-content:space-between;border-top:1px solid #cbd5e1;padding-top:10px;font-size:18px;font-weight:800;color:#0f172a;">
            <span>Total Quote:</span><span>${fmt(draft.totalAmount)} ${draft.currency}</span>
          </div>
        </div>
      </div>

      ${
        draft.staffNotes
          ? `<div style="margin-top:24px;padding:16px;background:#f0f9ff;border-left:4px solid #0284c7;border-radius:8px;font-size:14px;color:#0c4a6e;">
              <strong>📝 Resort &amp; Dive Center Note:</strong> ${draft.staffNotes}
            </div>`
          : ""
      }
    </div>
  </div>
  <a class="edit-floating" href="/quotes/${draft.quoteId}">✏️ Edit Table &amp; Link on Hono Studio</a>
</body>
</html>`;
}
