import { randomUUID } from "node:crypto";
import {
  buildBffTrip,
  normalizePricing,
  recalculateQuotationTotals,
  type HonoQuotationDraft,
  type Trip,
} from "../../../packages/extractor/src/index.js";
import { buildSimulatedModel } from "./simulatedEstimator.js";
import { createQuotationStoreFromEnv, type QuotationStore } from "./quotationStoreClient.js";
import { DEMO_GAIS_BANNER, DEMO_ROLES, type DemoRole } from "./demoAuth.js";
import { escapeHtml } from "./html.js";

/**
 * Lazily-built, so reading the env happens at first use rather than at import time. That keeps
 * importing this module side-effect free (the contract test can still spin up its own stores
 * without the production env leaking in), and means every caller shares one store for the life
 * of the process — the in-memory one behaves like the old module `Map`s did, while the Redis one
 * is the fix for guest links dying on redeploy.
 */
let storePromise: Promise<QuotationStore> | undefined;
function getStore(): Promise<QuotationStore> {
  storePromise ??= Promise.resolve(createQuotationStoreFromEnv());
  return storePromise;
}

/**
 * The unpredictable part of a guest-facing quotation link.
 *
 * `/q/:slug` is deliberately reachable without a credential — it is the link staff paste
 * into WhatsApp, so the guest must be able to open it — which means the slug itself is the
 * only thing standing between a URL and someone else's booking. A UUID is 122 bits of CSPRNG
 * output.
 *
 * Lowercase, because this store indexes slugs case-insensitively (`quoteIdBySlug` keys are
 * lowercased) while URL paths are case-sensitive. A mixed-case token — base64url, say — would
 * be indexed under one spelling and looked up under another, so a legitimate link would 404.
 * That mistake was made here and caught by the "still serves the real quotation" test; the
 * two slug generators must use the same alphabet.
 *
 * The previous slugs were derived from the guest's own name and dates ("sky-oct10-group"),
 * and are guessable by anyone who knows the guest's name. Treat this value as a credential:
 * never rebuild it from booking data, never shorten it, and never log it next to the PII it
 * protects.
 */
function randomSlug(): string {
  return randomUUID();
}

// A synthetic split-day group scenario, pre-seeded so /quotes always has an immediately
// editable quotation to look at, even on a fresh serverless cold start.
//
// It is a FIXTURE, and it now says so in its own data. It used to carry a real guest's name and
// a real phone number copied out of a live enquiry, which meant PII was sitting in source
// control and rendering on a staff page — and when the old code fell back to this record for any
// unknown slug, that PII was reachable at a public URL. The name and number below are obviously
// not anyone's, so nobody can mistake this for a real booking or leak a real one by extending it.
//
// The guest-facing slug is randomised rather than derived from the name: this record is served by
// `/q/:slug` with no credential, so a guessable slug is a guessable quotation. The quote id stays
// readable because it is only reachable behind the staff token.
// Bump this whenever the seeded fixture's shape or pricing changes. `ensureSeeded()` compares it
// to the stored record and re-seeds when they differ, so a deploy that changes the fixture (e.g.
// the 2026-09-25 real-rate-card migration) does not leave the previous copy stuck in KV forever.
//
// v2: the studio prices from the engine and nothing else, so the fixture carries a real `bffTrip`
// and the engine's own answer for it. Before this it carried a hand-typed line-item table that the
// page no longer renders — a cold-start studio showed "not priced yet" and no trip to review.
const SEED_VERSION = 2;

/**
 * The fixture's trip, as the extractor would have produced it: a split-day diving group, which is
 * the case the guardrail deliberately routes to staff rather than auto-pricing.
 */
function seededTrip(): Trip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  return {
    language: f("en", "default"),
    contactName: f("Sample Group"),
    checkIn: f("2026-10-10"),
    checkOut: f("2026-10-12"),
    nights: f(2),
    guests: f(4),
    rooms: f(2),
    roomType: f("standard"),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none", "derived"),
    diver: f(true),
    divers: f(null, "missing"),
    diveNotes: f("1 person dives day 1; 5 people dive both days"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
  } as Trip;
}

let seedPromise: Promise<void> | undefined;
function ensureSeeded(): Promise<void> {
  seedPromise ??= (async () => {
    const store = await getStore();
    const existing = await store.get("QT-1010-SKY");
    if (existing && existing.seedVersion === SEED_VERSION) return;
    const now = new Date().toISOString();
    const baseUrl = "https://technext-edge-casa-bff.vercel.app";
    const slug = randomSlug();
    const trip = buildBffTrip(seededTrip());
    const seeded: HonoQuotationDraft = recalculateQuotationTotals({
    quoteId: "QT-1010-SKY",
    slug,
    seedVersion: SEED_VERSION,
    status: "pending_hono_review",
    createdAt: now,
    updatedAt: now,
    phone: "639000000000",
    guestName: "Sample Group",
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
    // No hand-typed lines: the studio draws the price from the engine now, and a seeded fixture
    // that carried its own arithmetic is exactly the second source of truth that was removed.
    // `totalAmount` below is the engine's own revenue, so the sidebar and the cards agree.
    lineItems: [],
    subtotalAmount: 0,
    discountAmount: 0,
    totalAmount: buildSimulatedModel(trip).kpis.revenue ?? 0,
    bffTrip: trip,
    pricing: normalizePricing({
      model: buildSimulatedModel(trip),
      source: "simulated",
      sample: true,
      mode: "fixture",
      role: "guest",
      computedAt: now,
    }),
    estimator: null,
    quotationUrl: `${baseUrl}/q/${slug}`,
    honoEditorUrl: `${baseUrl}/quotes/QT-1010-SKY`,
    staffNotes:
      "Split-day diving arrangement: 6 people total (4 staying overnight in 2 rooms; 1 diver on Day 1 only, 5 divers on both days).",
    staffAlerts: [
      "📋 **Custom Dive Schedule:** We have noted your specific diving arrangement (1 person dives day 1; 5 people dive both days) for our reservation team to prepare an accurate quote.",
    ],
  });
    await store.save(seeded);
  })();
  return seedPromise;
}

export async function saveQuotationDraft(draft: HonoQuotationDraft): Promise<HonoQuotationDraft> {
  const store = await getStore();
  await ensureSeeded();
  const normalized = recalculateQuotationTotals(draft);
  return store.save(normalized);
}

/**
 * Looks a quotation up by id or by guest-facing slug.
 *
 * Returns `undefined` for anything unknown, and that is the whole security property: the
 * caller serves `/q/:slug` without a credential, so "not found" has to mean not found.
 *
 * What used to be here instead was a fallback that never let a link 404: any unknown slug
 * returned the most recent quotation, and any id matching `/^QT-/` was cloned from the
 * seeded record. The result was that
 * `GET /q/<anything at all>` returned a real guest's name, dates, party size and total —
 * verified against the live deployment, with no credential.
 */
export async function getQuotationByIdOrSlug(idOrSlug: string): Promise<HonoQuotationDraft | undefined> {
  const store = await getStore();
  await ensureSeeded();
  return store.get(idOrSlug);
}

export async function listQuotations(): Promise<HonoQuotationDraft[]> {
  const store = await getStore();
  await ensureSeeded();
  return store.list();
}

/**
 * The unpublised quotation this phone's enquiry already has, if it has one.
 *
 * Exists because the quotation tool mints a fresh id and slug on every call: a WhatsApp thread that
 * kept talking after its enquiry was complete left a NEW draft in the studio for every turn.
 * Measured on production from one manual test — thirteen quotations for one guest, at one per
 * message. Staff cannot work a queue like that, and every one of them looked current.
 *
 * A quotation that has been published is deliberately NOT reused: their link resolves to the newest
 * saved revision, so editing a published quote would silently change what a guest already holds
 * (their Q-005). That case has to become a new quotation and a new link.
 */
export async function findOpenQuotationForPhone(phone: string): Promise<HonoQuotationDraft | undefined> {
  if (!phone) return undefined;
  const all = await listQuotations();
  return all.find((q) => q.phone === phone && !q.estimator?.sharedAt);
}

export function renderHonoQuotationEditorHtml(
  draft: HonoQuotationDraft,
  allQuotes: HonoQuotationDraft[],
  role: DemoRole = "staff",
): string {  const initialJson = JSON.stringify(draft).replace(/</g, "\\u003c");
  const allQuotesJson = JSON.stringify(
    allQuotes.map((q) => ({
      quoteId: q.quoteId,
      guestName: q.guestName,
      checkIn: q.checkIn,
      nights: q.nights,
      // The engine's figure when the quotation has been priced, because it is the only number that
      // will appear on a guest's link. `totalAmount` is the old hand-typed table's sum, and it is
      // only still here for quotations priced before this page stopped doing its own arithmetic.
      totalAmount: (q.pricing?.kpis.revenue ?? null) ?? q.totalAmount,
      currency: q.currency,
      status: q.status,
    }))
  ).replace(/</g, "\\u003c");
  // The extractor's scorecard, computed from the records. "Unchanged" means the quotation was
  // priced from a trip staff never corrected — every other quotation either needed a fix or was
  // never reviewed, and the two are different things, so an edited one is counted as edited even
  // if the edit was later reverted (the diff is recorded per save).
  const reviewedQuotes = allQuotes.filter((q) => q.bffTrip);
  const fieldCounts = new Map<string, number>();
  for (const q of reviewedQuotes) {
    for (const edit of q.staffEdits ?? []) {
      for (const field of edit.fields) fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    }
  }
  const quotationsNeedingNoEdit = {
    all: reviewedQuotes.length,
    unchanged: reviewedQuotes.filter((q) => (q.staffEdits ?? []).length === 0).length,
    // Most-corrected first, then alphabetically, so equal counts cannot reorder between renders.
    fieldCounts: [...fieldCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };

  // What each demo role is allowed to see, per the field guide's "vai người gọi" table. Only
  // `guest` is real today (Odoo decides the role from the API key); the other two describe what
  // the view becomes once those keys exist. Nothing here fakes cost or profit data.
  const roleNote =
    role === "agent"
      ? "Agent view — partner rate: 30% off rooms (meals and diving are never discounted)."
      : role === "staff"
        ? "Staff view — cost, profit and assumptions appear here once Odoo is connected (estimator is in fixture mode today)."
        : "Guest view — retail pricing only.";

  // ---- The engine's own answer, drawn -------------------------------------
  // Everything below is read from `draft.pricing`, which is the pricing engine's response as it was
  // when the quotation was priced. Nothing here is recomputed: a per-guest card that disagrees with
  // the total above it would be worse than no card at all.
  const pricing = draft.pricing ?? null;
  const money = (n: number) => `${draft.currency === "USD" ? "$" : "₱"}${Math.round(n).toLocaleString("en-US")}`;
  // `esc` is the shared escaper (html.ts). A guest's own words reach this page — their name, their
  // dive notes, a line description staff edited — and none of it is trusted markup.
  const esc = escapeHtml;

  const guestCardsHtml =
    !pricing || pricing.guests.length === 0
      ? ""
      : `<div style="margin-top:22px;">
          <div style="font-size:15px;font-weight:800;margin-bottom:4px;">Per guest</div>
          <div style="font-size:13.5px;color:var(--muted);margin-bottom:12px;">The engine's own lines, one card per guest${pricing.sample ? " · SAMPLE DATA" : ""}.</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px;">
            ${pricing.guests
              .map(
                (guest) => `<div style="background:var(--surface-2);border:2px solid var(--border);border-radius:12px;padding:14px 16px;">
              <div style="font-weight:800;font-size:16px;margin-bottom:6px;">${esc(guest.name)}</div>
              ${guest.lines
                .map(
                  (line) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;padding:6px 0;border-bottom:1px dashed var(--border);">
                <span><strong>${esc(line.label)}</strong>${line.sub ? `<br><span style="color:var(--muted);font-size:12.5px;">${esc(line.sub)}</span>` : ""}</span>
                <strong style="white-space:nowrap;">${money(line.net)}</strong>
              </div>`,
                )
                .join("")}
              ${
                guest.discountTotal > 0
                  ? `<div style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--emerald);padding-top:6px;"><span>Partner discount</span><strong>-${money(guest.discountTotal)}</strong></div>`
                  : ""
              }
              <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;padding-top:8px;"><span>Total</span><span>${money(guest.total)}</span></div>
            </div>`,
              )
              .join("")}
          </div>
          ${
            pricing.warnings.length > 0
              ? `<div style="margin-top:12px;padding:12px 14px;background:var(--surface-2);border-left:4px solid #f59e0b;border-radius:8px;font-size:13.5px;color:var(--text);">
                  <strong>From the booking engine</strong>
                  <ul style="margin:6px 0 0 18px;">${pricing.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
                </div>`
              : ""
          }
        </div>`;

  /**
   * Agent View: the retail value next to the partner rate.
   *
   * Only rendered when the engine returned a retail model — a retail session gets none, so this is
   * absent for a guest rather than showing two identical columns and calling the difference margin.
   * The margin is arithmetic on two numbers the engine produced, and it is left unrounded on
   * purpose so nobody mistakes it for a booked figure.
   */
  const retailKpis = pricing?.retail?.kpis ?? null;
  const agentCompareHtml =
    !pricing?.retail || pricing.retail.guests.length === 0
      ? ""
      : `<div style="margin-top:20px;background:var(--surface-2);border:2px solid var(--border);border-radius:12px;padding:16px;">
          <div style="font-size:15px;font-weight:800;margin-bottom:4px;">Agent view — retail value vs your rate</div>
          <div style="font-size:13.5px;color:var(--muted);margin-bottom:12px;">Both columns are the engine's. The difference is your margin on this trip.</div>
          <table class="quote-table" style="width:100%;">
            <thead><tr><th>Guest</th><th style="text-align:right;">Retail</th><th style="text-align:right;">Your rate</th><th style="text-align:right;">Margin</th></tr></thead>
            <tbody>
              ${pricing.retail.guests
                .map((retailGuest, i) => {
                  const netGuest = pricing.guests[i];
                  const retailTotal = retailGuest.total;
                  const netTotal = netGuest ? netGuest.total : 0;
                  const margin = retailTotal - netTotal;
                  const pct = retailTotal > 0 ? Math.round((margin / retailTotal) * 1000) / 10 : 0;
                  return `<tr>
                    <td>${esc(retailGuest.name)}</td>
                    <td style="text-align:right;">${money(retailTotal)}</td>
                    <td style="text-align:right;">${money(netTotal)}</td>
                    <td style="text-align:right;">${money(margin)}${pct ? ` <span style="color:var(--muted);font-size:12.5px;">(${pct}%)</span>` : ""}</td>
                  </tr>`;
                })
                .join("")}
              ${
                retailKpis && retailKpis.revenue !== null
                  ? `<tr style="font-weight:800;"><td>Total</td><td style="text-align:right;">${money(retailKpis.revenue)}</td><td style="text-align:right;">${money(pricing.kpis.revenue ?? 0)}</td><td style="text-align:right;">${money(retailKpis.revenue - (pricing.kpis.revenue ?? 0))}</td></tr>`
                  : ""
              }
            </tbody>
          </table>
        </div>`;

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Staff Quotation Review (${draft.quoteId}) — Casa Escondida Anilao</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root, [data-theme="light"] {
      --bg: #f8fafc;
      --surface: #ffffff;
      --surface-2: #f1f5f9;
      --input-bg: #ffffff;
      --border: #cbd5e1;
      --text: #0f172a;
      --muted: #475569;
      --accent: #0284c7;
      --accent-soft: #e0f2fe;
      --emerald: #059669;
      --emerald-soft: #ecfdf5;
      --amber: #d97706;
      --amber-soft: #fffbeb;
      --rose: #e11d48;
      --shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
    }
    [data-theme="dark"] {
      --bg: #0b101b;
      --surface: #131b2e;
      --surface-2: #19233c;
      --input-bg: #0d1424;
      --border: #2d3f63;
      --text: #f8fafc;
      --muted: #cbd5e1;
      --accent: #38bdf8;
      --accent-soft: rgba(56, 189, 248, 0.14);
      --emerald: #10b981;
      --emerald-soft: rgba(16, 185, 129, 0.14);
      --amber: #fbbf24;
      --amber-soft: rgba(245, 158, 11, 0.16);
      --rose: #fb7185;
      --shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    }
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
    @media (max-width: 1024px) {
      .container { grid-template-columns: 1fr; }
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
    .quote-list-item {
      display: block;
      padding: 14px;
      border-radius: 12px;
      border: 2px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      text-decoration: none;
      margin-bottom: 12px;
      transition: 0.15s;
    }
    .quote-list-item:hover, .quote-list-item.active {
      border-color: var(--accent);
      background: var(--accent-soft);
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
    }
    /* The demo role the page was opened with decides whether the staff actions are offered at all.
       A guest session sees the quotation, not the machinery that prices it — before this, the role
       changed one line of text and nothing else. */
    body[data-role="guest"] .staff-only { display: none !important; }
  </style>
</head>
<body data-role="${role}">
  <div style="background:var(--accent-soft);border-bottom:1px solid var(--border);color:var(--text);font-size:13.5px;padding:8px 20px;text-align:center;font-weight:600;">
    ${DEMO_GAIS_BANNER} <span style="color:var(--muted);">· ${roleNote}</span>
  </div>
  <header class="topbar">
    <div class="brand">
      <span class="brand-badge">RESORT STAFF DESK</span>
      <h1>Casa Escondida — Quotation Review #${draft.quoteId}</h1>
    </div>
    <div class="top-actions">
      <form method="post" action="/logout" style="display:inline;"><button type="submit" class="theme-btn">Sign out</button></form>
      <button type="button" class="theme-btn" id="theme-toggle-btn" onclick="toggleTheme()">
        <span id="theme-icon">🌙</span>
        <span id="theme-label">Dark Mode</span>
      </button>
      <span style="font-size:14px;color:var(--text);background:var(--surface-2);border:2px solid var(--border);border-radius:999px;padding:6px 14px;font-weight:700;">Staff Role: <strong>${role}</strong></span>
      <select id="role-select" onchange="switchRole(this.value)" title="Switch staff view role" style="background:var(--input-bg);border:2px solid var(--border);color:var(--text);border-radius:10px;padding:8px 12px;font-size:14px;font-weight:700;">
        ${DEMO_ROLES.map((r) => `<option value="${r}"${r === role ? " selected" : ""}>${r}</option>`).join("")}
      </select>
    </div>
  </header>

  <div class="container">
    <!-- Sidebar: the quotations a staff member is reviewing -->
    <aside>
      ${
        // The only real measure of the extractor, and the reason the trip review records a diff.
        // Read from the records rather than counted in a page: a reload, or a different staff
        // member's browser, must show the same numbers.
        quotationsNeedingNoEdit.all > 0
          ? `<div class="card">
        <div class="card-title"><span>🎯 Extractor scorecard</span></div>
        <p style="font-size:14px;color:var(--muted);margin-bottom:10px;">Of the quotations the WhatsApp bot prepared, how many did staff price without correcting the trip?</p>
        <div style="display:flex;align-items:baseline;gap:10px;">
          <strong style="font-size:28px;color:var(--accent);">${quotationsNeedingNoEdit.unchanged}/${quotationsNeedingNoEdit.all}</strong>
          <span style="font-size:14px;font-weight:700;color:var(--muted);">unchanged</span>
        </div>
        ${
          quotationsNeedingNoEdit.fieldCounts.length > 0
            ? `<div style="margin-top:10px;font-size:13px;color:var(--muted);line-height:1.6;">
                 <strong style="color:var(--text);">Most-corrected fields:</strong><br>
                 ${quotationsNeedingNoEdit.fieldCounts
                   .slice(0, 5)
                   .map(([field, n]) => `${esc(field)} × ${n}`)
                   .join("<br>")}
               </div>`
            : ""
        }
        <p style="font-size:12.5px;color:var(--muted);margin-top:10px;">Field names only — no guest data. A correction here means the bot's payload was not already right.</p>
      </div>`
          : ""
      }
      <div class="card">
        <div class="card-title">
          <span>📥 All Quotations</span>
        </div>
        <p style="font-size:14px;color:var(--muted);margin-bottom:12px;">Click any quotation below to review or update:</p>
        <div id="quote-sidebar-list"></div>
      </div>
    </aside>

    <!-- Main Studio -->
    <main>
      <!-- STEP 1: Guest Information & Shareable Quote Link -->
      <div class="card">
        <div class="card-title">
          <span>👤 STEP 1: Guest Details &amp; Customer Quotation Link</span>
          <span id="quote-status-badge" class="status-pill status-pending">⏳ Waiting for Staff Approval</span>
        </div>

        ${
          Array.isArray(draft.staffAlerts) && draft.staffAlerts.length > 0
            ? `<div style="margin-bottom:18px;padding:14px 16px;border-left:5px solid var(--amber);background:var(--amber-soft);border-radius:10px;">
          <div style="font-size:15px;font-weight:800;color:var(--amber);margin-bottom:6px;">⚠️ IMPORTANT STAFF NOTES — Please check before approving:</div>
          <ul style="margin:0;padding-left:22px;font-size:15px;line-height:1.65;font-weight:600;">
            ${draft.staffAlerts.map((a) => `<li>${String(a).replace(/</g, "&lt;")}</li>`).join("")}
          </ul>
        </div>`
            : ""
        }

        <!-- Guest & Stay Metadata (Editable) -->
        <div class="meta-grid">
          <div class="meta-field">
            <label>Guest Full Name</label>
            <input class="cell-input" id="meta-guestName" value="${esc(draft.guestName)}" />
          </div>
          <div class="meta-field">
            <label>Check-in Date</label>
            <input class="cell-input" id="meta-checkIn" value="${esc(draft.checkIn)}" />
          </div>
          <div class="meta-field">
            <label>Check-out Date</label>
            <input class="cell-input" id="meta-checkOut" value="${esc(draft.checkOut)}" />
          </div>
          <div class="meta-field">
            <label>Nights / Rooms / Guests</label>
            <input class="cell-input" value="${draft.nights} nights · ${draft.rooms} rooms · ${draft.stayingGuests}/${draft.totalGroupSize} pax" readonly style="color:var(--muted);background:var(--surface-2);" />
          </div>
        </div>

        <p style="font-size:15px;color:var(--muted);font-weight:600;">
          🔗 Official Customer Quotation Page (Guest clicks this link to view &amp; print their invoice):
        </p>
        <p style="font-size:13.5px;color:var(--muted);font-weight:600;margin:0 0 10px;">
          This page is the <strong>live working copy</strong>. The link below always shows whatever is saved here now — there is no frozen version yet, so a guest who opens an old link sees your latest edit.
        </p>
        <div class="link-editor-bar">
          <span style="font-size:14px;font-weight:800;color:var(--muted);">Customer Link:</span>
          <input type="text" id="input-quotation-url" value="${draft.quotationUrl}" readonly oninput="onUrlEdited()" title="Official customer link" />
          <button class="btn btn-outline" onclick="copyQuoteLink()">📋 <span>Copy Link</span></button>
          <a class="btn btn-primary" id="btn-open-public-quote" href="${draft.quotationUrl}" target="_blank">👁️ <span>Open Customer Quote Page</span></a>
          <a class="btn btn-outline staff-only" id="btn-open-ops-sheet" href="/quotes/${encodeURIComponent(draft.quoteId)}/ops" target="_blank">🧾 <span>Ops Sheet (no prices)</span></a>
        </div>
      </div>

      <!-- STEP 2: the trip the engine prices, and the trip staff can correct -->
      <div class="card">
        <div class="card-title">
          <span>📊 STEP 2: The Trip the Engine Prices</span>
          <span style="font-size:13.5px;font-weight:700;color:var(--muted);">Priced by the resort's engine — never by hand</span>
        </div>

        <!-- Official Estimator BFF Bar moved to TOP of price table so staff price BEFORE editing -->
        <div class="staff-only" style="margin-bottom:18px;padding:14px 16px;background:var(--surface-2);border:2px solid var(--border);border-radius:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--text);">💱 Official Resort Rate Calculator (Estimator BFF)</div>
            <div style="font-size:13.5px;color:var(--muted);">Click to automatically calculate official room, meal, and diving rates from the resort pricing engine.</div>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-outline" onclick="syncEstimate()" id="btn-sync-estimate">💱 <span>Price with the Estimator BFF</span></button>
            <span id="estimator-status-badge" style="font-size:14px;font-weight:700;color:var(--muted);">⏳ checking estimator connection…</span>
          </div>
          <pre id="sync-estimate-out" style="width:100%;margin-top:4px;white-space:pre-wrap;font-size:13.5px;color:var(--muted);display:none;"></pre>
        </div>

        <!-- Reservation bar. The one action on this page that creates something outside our own
             store, so it is the one that has to be explicit about what happened and refuse to be
             pressed twice. State lives on the quotation, not in this page: reloading must not
             offer the button again for a reservation that already exists. -->
        <div class="staff-only" style="margin-bottom:18px;padding:14px 16px;background:var(--surface-2);border:2px solid var(--border);border-radius:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--text);">📅 Send reservation</div>
            <div style="font-size:13.5px;color:var(--muted);">Books this quotation with the resort's booking engine. One reservation per quotation; a send the engine refused can be tried again.</div>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-outline" onclick="submitReservation()" id="btn-submit-reservation">📅 <span>Send reservation</span></button>
            <span id="reservation-status-badge" style="font-size:14px;font-weight:700;color:var(--muted);"></span>
          </div>
          <pre id="reservation-out" style="width:100%;margin-top:4px;white-space:pre-wrap;font-size:13.5px;color:var(--muted);display:none;"></pre>
        </div>

        <!-- Publish bar. The only place a guest link is created, and it is a human decision: the bot
             never mints a link, because a price must not reach a customer before someone at the
             resort has looked at it. -->
        <div class="staff-only" style="margin-bottom:18px;padding:14px 16px;background:var(--surface-2);border:2px solid var(--border);border-radius:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--text);">🔗 Publish guest link</div>
            <div style="font-size:13.5px;color:var(--muted);">Freezes this quotation on the resort's quotation app and mints the link the guest is sent. One link per quotation — to change a price afterwards, publish a new quotation.</div>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            ${
              pricing?.sample
                ? `<label style="font-size:13.5px;font-weight:700;color:var(--accent);display:flex;align-items:center;gap:6px;">
                     <input type="checkbox" id="ack-sample" /> I have checked this SAMPLE price
                   </label>`
                : ""
            }
            <button class="btn btn-outline" onclick="publishQuote()" id="btn-publish-quote">🔗 <span>Publish guest link</span></button>
            <span id="publish-status-badge" style="font-size:14px;font-weight:700;color:var(--muted);"></span>
          </div>
          <pre id="publish-out" style="width:100%;margin-top:4px;white-space:pre-wrap;font-size:13.5px;color:var(--muted);display:none;"></pre>
        </div>

        <!-- The trip itself, which is what the engine is asked to price. Editable, because a
             WhatsApp conversation cannot place every fact a quotation depends on — which room a
             guest is in, what type it is, who dives which day, who still needs a course. The
             correction goes back to the ENGINE rather than into a hand-typed price, so the number
             on the guest's link keeps exactly one source. -->
        <div class="staff-only" style="margin-bottom:18px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:10px;">
            <div>
              <div style="font-size:15px;font-weight:800;color:var(--text);">🧭 Trip review — correct the facts, then re-price</div>
              <div style="font-size:13.5px;color:var(--muted);">Rooms, room type, who is in which room, who dives which day, and who needs a course. Saving sends the corrected trip back to the engine and drops the approval, because the approval was for the old trip.</div>
            </div>
            <button class="btn btn-primary" onclick="saveTripAndReprice()" id="btn-save-trip">💾 <span>Save trip &amp; re-price</span></button>
          </div>
          <pre id="trip-edit-out" style="width:100%;margin:0 0 12px;white-space:pre-wrap;font-size:13.5px;color:var(--muted);display:none;"></pre>
          <div id="trip-review"></div>
        </div>

        <div class="totals-grid">
          <div class="totals-box">
            <div class="totals-row">
              <span>Engine total${pricing?.sample ? " (SAMPLE)" : ""}:</span>
              <strong>${pricing ? money(pricing.kpis.revenue ?? 0) : "not priced yet"}</strong>
            </div>
            <div class="totals-row">
              <span>Guests / nights / rooms:</span>
              <span>${pricing?.kpis.guests ?? "—"} · ${pricing?.kpis.nights ?? "—"} · ${draft.rooms}</span>
            </div>
            <div class="totals-row">
              <span>Revenue per guest-night:</span>
              <span>${pricing?.kpis.rpgn != null ? money(pricing.kpis.rpgn) : "—"}</span>
            </div>
            <div class="totals-row" style="color:var(--muted);font-size:13.5px;font-weight:600;">
              <span>The guest's link shows the engine's figure. There is no discount field here on purpose: the only discount in the resort's model is the partner rate, which the engine applies to rooms by itself.</span>
            </div>
          </div>
        </div>

        ${guestCardsHtml}
        ${agentCompareHtml}

        <div style="margin-top:18px;">
          <label style="display:block;font-size:15px;font-weight:800;color:var(--text);margin-bottom:8px;">📝 Note for Guest (Printed on Customer Quotation Page):</label>
          <input type="text" id="input-staff-notes" class="cell-input" value="${esc(draft.staffNotes)}" />
        </div>

        <div class="staff-only" style="margin-top:24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;padding-top:18px;border-top:2px solid var(--border);">
          <div style="display:flex;align-items:center;gap:12px;">
            <button class="btn btn-outline" onclick="saveEditsOnly()" id="btn-save-draft">💾 <span>Save Draft Changes</span></button>
            <span id="save-toast" style="font-size:15px;font-weight:700;color:var(--emerald);"></span>
          </div>
          <button class="btn btn-emerald" onclick="confirmAndSendToAI()" id="btn-confirm-hono">
            ✅ <span>Approve Quotation &amp; Prepare Guest Message</span>
          </button>
        </div>
      </div>

      <!-- STEP 3: Final Guest Message & Send to WhatsApp -->
      <div class="card staff-only" id="ai-response-card">
        <div class="card-title">
          <span>📲 STEP 3: Send Confirmed Quotation to Guest's WhatsApp</span>
          <span style="font-size:14px;font-weight:800;color:var(--emerald);">Ready to Send</span>
        </div>
        <p style="font-size:15px;color:var(--muted);font-weight:500;">
          After you click <strong>"✅ Approve Quotation &amp; Prepare Guest Message"</strong> in Step 2 above, the message below is prepared with the final price and quotation link. Click the blue WhatsApp button to send it directly to the guest:
        </p>
        <div class="ai-reply-box" id="ai-confirmed-reply-box">${
          draft.aiConfirmedReply
            ? draft.aiConfirmedReply
            : "⏳ Waiting for approval... Please review the prices in Step 2 above and click [✅ Approve Quotation & Prepare Guest Message]."
        }</div>
        <div style="margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:15px;font-weight:800;">Guest WhatsApp Number:</label>
          <input type="text" id="whatsapp-phone-input" class="cell-input" style="width:240px;" placeholder="e.g. 639171234567" value="${draft.phone ?? ""}" />
          <button class="btn btn-primary" onclick="pushConfirmedQuoteToWhatsApp()" id="btn-push-wa">📲 <span>Send Message to Guest's WhatsApp</span></button>
          <span id="wa-toast" style="font-size:15px;font-weight:700;color:var(--accent);"></span>
        </div>
      </div>
    </main>
  </div>

  <script>
    let state = ${initialJson};
    const allQuotes = ${allQuotesJson};

    // The same escaping the server does (html.ts), for the parts of this page the browser draws. A
    // line description and a guest name arrive from WhatsApp, so a less-than sign in either is not
    // markup — it is a guest's own text, and it reaches staff who are signed in.
    function escHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('casa_theme', theme);
      const icon = document.getElementById('theme-icon');
      const label = document.getElementById('theme-label');
      if (icon && label) {
        if (theme === 'dark') {
          icon.textContent = '☀️';
          label.textContent = 'Light Mode';
        } else {
          icon.textContent = '🌙';
          label.textContent = 'Dark Mode';
        }
      }
    }
    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    }
    (function initTheme() {
      const saved = localStorage.getItem('casa_theme') || 'light';
      applyTheme(saved);
    })();

    function fmtMoney(n, currency) {
      const sym = (currency || state.currency) === 'USD' ? '$' : '₱';
      return sym + Number(n || 0).toLocaleString('en-US');
    }

    function renderSidebar() {
      const el = document.getElementById('quote-sidebar-list');
      const tok = staffToken();
      const qs = tok ? '?token=' + encodeURIComponent(tok) : '';
      el.innerHTML = allQuotes.map(q => \`
        <a class="quote-list-item \${q.quoteId === state.quoteId ? 'active' : ''}" href="/quotes/\${q.quoteId}\${qs}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="font-size:15px;color:var(--accent);">\${q.quoteId}</strong>
            <span style="font-size:13px;font-weight:800;color:\${q.status === 'confirmed_by_hono' ? 'var(--emerald)' : 'var(--amber)'};">
              \${q.status === 'confirmed_by_hono' ? '✅ Approved' : '⏳ Needs Review'}
            </span>
          </div>
          <div style="font-size:15px;font-weight:700;">\${escHtml(q.guestName)}</div>
          <div style="font-size:14px;color:var(--muted);">\${q.checkIn} (\${q.nights} nights) · <strong>\${fmtMoney(q.totalAmount, q.currency)}</strong></div>
        </a>
      \`).join('');
    }

    /**
     * The trip review panel: the BffTrip the engine is asked to price, as editable controls.
     *
     * Everything here edits state.bffTrip and nothing prints a price — the number comes from the
     * engine, and a page that also did its own arithmetic would be the second source of truth this
     * whole screen exists to avoid. The room type, the room each guest sleeps in, the per-day dive
     * grid and the courses are the four facts a WhatsApp conversation cannot place reliably, and
     * they are exactly the ones the estimator prices: a deluxe room is ₱11,200 a night against
     * ₱7,600, a third dive and a night dive are their own lines, and a course is ₱5,500 upwards.
     *
     * NOTE for whoever edits this next: every backtick and every dollar-brace below is escaped,
     * because this whole block is itself inside a TypeScript template literal. An unescaped
     * backtick anywhere here — including inside a comment like this one — closes the page's own
     * script tag and breaks the studio silently.
     */
    function renderTripReview() {
      const el = document.getElementById('trip-review');
      if (!el) return; // a guest session has no review panel
      const trip = state.bffTrip;
      if (!trip) {
        el.innerHTML = '<p style="font-size:14px;color:var(--muted);font-weight:600;">This quotation was not built from a validated trip, so there is nothing to review. Price it with the engine first.</p>';
        return;
      }

      const ROOM_TYPES = ['standard', 'deluxe', 'suite'];
      const COURSES = ['', 'dsd', 'ow', 'aow'];
      const COURSE_LABELS = { '': '— none —', dsd: 'DSD (Discover Scuba)', ow: 'Open Water', aow: 'Advanced Open Water' };
      const stayDates = datesInStay(trip.checkIn, trip.checkOut);

      const roomRows = trip.rooms.map((room, i) => \`
        <tr>
          <td><strong>\${escHtml(room.id || '—')}</strong></td>
          <td>
            <select class="cell-input" onchange="setRoomType(\${i}, this.value)">
              \${ROOM_TYPES.map(t => \`<option value="\${t}" \${room.type === t ? 'selected' : ''}>\${t}</option>\`).join('')}
            </select>
          </td>
          <td>\${escHtml(trip.guests.filter(g => g.roomId === room.id).map(g => g.name).join(', ') || '— nobody —')}</td>
        </tr>\`).join('');

      const guestRows = trip.guests.map((guest) => \`
        <tr>
          <td><strong>\${escHtml(guest.name)}</strong></td>
          <td>
            <select class="cell-input" onchange="setGuestRoom('\${escHtml(guest.id)}', this.value)">
              <option value="" \${guest.roomId ? '' : 'selected'}>— unassigned —</option>
              \${trip.rooms.map(r => \`<option value="\${escHtml(r.id)}" \${guest.roomId === r.id ? 'selected' : ''}>\${escHtml(r.id)} (\${escHtml(r.type)})\</option>\`).join('')}
            </select>
          </td>
          <td>
            <select class="cell-input" onchange="setGuestCourse('\${escHtml(guest.id)}', this.value)">
              \${COURSES.map(c => \`<option value="\${c}" \${((guest.courses && guest.courses[0]) || '') === c ? 'selected' : ''}>\${COURSE_LABELS[c]}</option>\`).join('')}
            </select>
          </td>
          \${stayDates.map(d => {
            const day = (guest.days && guest.days[d]) || {};
            return \`<td style="white-space:nowrap;">
              <label title="Boat dives"><input type="checkbox" \${day.dive ? 'checked' : ''} onchange="setGuestDay('\${escHtml(guest.id)}', '\${d}', 'dive', this.checked)" /> D</label>
              <label title="Third dive"><input type="checkbox" \${day.third ? 'checked' : ''} onchange="setGuestDay('\${escHtml(guest.id)}', '\${d}', 'third', this.checked)" /> 3</label>
              <label title="Night dive"><input type="checkbox" \${day.night ? 'checked' : ''} onchange="setGuestDay('\${escHtml(guest.id)}', '\${d}', 'night', this.checked)" /> N</label>
            </td>\`;
          }).join('')}
        </tr>\`).join('');

      el.innerHTML = \`
        <div style="overflow-x:auto;margin-bottom:16px;">
          <table class="quote-table">
            <thead><tr><th style="width:90px;">Room</th><th style="width:150px;">Type</th><th>Guests in this room</th></tr></thead>
            <tbody>\${roomRows}</tbody>
          </table>
        </div>
        <div style="overflow-x:auto;">
          <table class="quote-table">
            <thead><tr>
              <th style="width:150px;">Guest</th>
              <th style="width:170px;">Room</th>
              <th style="width:190px;">Course</th>
              \${stayDates.map(d => \`<th style="text-align:center;">\${escHtml(dayLabel(d))}<br><span style="font-weight:600;color:var(--muted);">D · 3rd · Night</span></th>\`).join('')}
            </tr></thead>
            <tbody>\${guestRows}</tbody>
          </table>
        </div>
        <p style="font-size:13px;color:var(--muted);font-weight:600;margin-top:10px;">
          D = boat dive, 3 = third dive, N = night dive. Anything changed here reaches the engine only after <strong>Save trip &amp; re-price</strong>.
        </p>\`;
    }

    /** The stay's nights, as the engine's own day keys: check-in day through the night before check-out. */
    function datesInStay(checkIn, checkOut) {
      if (!checkIn || !checkOut) return [];
      const out = [];
      const start = new Date(checkIn + 'T00:00:00Z');
      const end = new Date(checkOut + 'T00:00:00Z');
      for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push(d.toISOString().slice(0, 10));
      }
      return out;
    }

    function dayLabel(iso) {
      const d = new Date(iso + 'T00:00:00Z');
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    }

    function setRoomType(index, type) {
      state.bffTrip.rooms[index].type = type;
      renderTripReview();
    }

    function setGuestRoom(guestId, roomId) {
      const guest = state.bffTrip.guests.find((g) => g.id === guestId);
      if (guest) guest.roomId = roomId || null;
      renderTripReview();
    }

    function setGuestCourse(guestId, course) {
      const guest = state.bffTrip.guests.find((g) => g.id === guestId);
      if (guest) guest.courses = course ? [course] : [];
      renderTripReview();
    }

    function setGuestDay(guestId, date, kind, on) {
      const guest = state.bffTrip.guests.find((g) => g.id === guestId);
      if (!guest) return;
      guest.days = guest.days || {};
      const day = Object.assign({ dive: false, third: false, night: false, boatId: null }, guest.days[date] || {});
      day[kind] = Boolean(on);
      guest.days[date] = day;
    }

    async function saveTripAndReprice() {
      const btn = document.getElementById('btn-save-trip');
      const out = document.getElementById('trip-edit-out');
      if (!btn || !out) return;
      btn.disabled = true;
      out.style.display = 'block';
      out.textContent = '⏳ Sending the corrected trip to the pricing engine…';
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/trip?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ trip: state.bffTrip })
        });
        const data = await res.json();
        if (data.ok) {
          const issues = Array.isArray(data.issues) ? data.issues : [];
          out.textContent = '✅ Re-priced'
            + (data.sample ? ' — SAMPLE DATA, not a real quote.' : '.')
            + (issues.length ? '\\n⚠️ ' + issues.length + ' note(s): ' + issues.map(function (i) { return i.code || i.detail || i; }).join(', ') : '')
            + '\\nThe approval was dropped with the old trip, so approve again before publishing. Reloading…';
          window.location.reload();
          return;
        }
        out.textContent = '⚠️ ' + (data.reason || 'failed') + ': ' + (data.detail || data.error || '')
          + (Array.isArray(data.fields) && data.fields.length ? '\\nfields: ' + data.fields.join(', ') : '')
          + (Array.isArray(data.issues) ? '\\n' + data.issues.map(function (i) { return (i.code || '') + ' ' + (i.fields || []).join(', '); }).join('\\n') : '');
      } catch (err) {
        out.textContent = '⚠️ ' + (err && err.message ? err.message : String(err));
      } finally {
        btn.disabled = false;
      }
    }

    function onUrlEdited() {
      const val = document.getElementById('input-quotation-url').value.trim();
      state.quotationUrl = val;
      document.getElementById('btn-open-public-quote').href = val;
    }

    /** The status pill. The price itself is the engine's and is drawn server-side, not here. */
    function renderStatusBadge() {
      const badge = document.getElementById('quote-status-badge');
      if (!badge) return;
      if (state.status === 'confirmed_by_hono') {
        badge.className = 'status-pill status-confirmed';
        badge.textContent = '✅ Confirmed by Hono & Sent to AI';
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
      return state;
    }

    async function saveEditsOnly() {
      const toast = document.getElementById('save-toast');
      toast.textContent = 'Saving to Hono...';
      const payload = gatherPayload();
      const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '?token=' + encodeURIComponent(staffToken()), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.quotation) {
        state = data.quotation;
        toast.textContent = '✓ Saved on Hono!';
        setTimeout(() => { toast.textContent = ''; }, 3500);
      }
    }

    async function confirmAndSendToAI() {
      const btn = document.getElementById('btn-confirm-hono');
      const replyBox = document.getElementById('ai-confirmed-reply-box');
      btn.disabled = true;
      replyBox.textContent = '🔄 Hono is confirming the trip & link and sending the Tool Result back to the model...';
      const payload = gatherPayload();
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/confirm?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.quotation) {
          state = data.quotation;
          renderStatusBadge();
          replyBox.textContent = data.aiReply || state.aiConfirmedReply;
        }
      } catch (err) {
        replyBox.textContent = 'Error confirming quotation: ' + err.message;
      } finally {
        btn.disabled = false;
      }
    }

    /**
     * The staff token, taken from this page's own URL.
     *
     * The studio's routes are guarded (each one lists every quotation with the guest's name and
     * phone number), and staff reach this page by having a link pasted to them — so the token
     * arrives in the query string and every call the page makes carries it on. Without this the
     * guards added on 2026-09-25 turned the studio's own Save/Confirm/Send buttons into 401s:
     * the leak fix broke the tool it was protecting.
     *
     * It is read from the URL on each call rather than cached, so following a fresh link is enough
     * to pick up a rotated token.
     */
    function staffToken() {
      const fromUrl = new URLSearchParams(window.location.search).get('token');
      if (fromUrl) {
        sessionStorage.setItem('casa_staff_token', fromUrl);
        return fromUrl;
      }
      return sessionStorage.getItem('casa_staff_token') || '';
    }

    /**
     * Switch the DEMO role. Cosmetic only: the cookie it re-issues changes what this page says
     * it is viewing as, not what it is allowed to read. Real roles come from the GAIS key.
     */
    async function switchRole(role) {
      await fetch('/login/role', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ role })
      });
      window.location.reload();
    }

    async function pushConfirmedQuoteToWhatsApp() {
      const phone = document.getElementById('whatsapp-phone-input').value.trim();
      const toast = document.getElementById('wa-toast');
      toast.textContent = 'Sending to WhatsApp ' + phone + '...';
      const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/send-whatsapp?token=' + encodeURIComponent(staffToken()), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      toast.textContent = data.ok ? '✅ Sent confirmed quote + link to WhatsApp (' + phone + ')!' : ('⚠️ ' + (data.error || 'Could not send'));
    }

    async function checkEstimatorStatus() {
      const badge = document.getElementById('estimator-status-badge');
      // A guest session has no estimator bar at all, so there is no badge to write to. Reading a
      // missing element here used to be a thrown TypeError that killed the rest of the script.
      if (!badge) return;
      try {
        const res = await fetch('/v1/quotes/estimator-status?token=' + encodeURIComponent(staffToken()));
        const data = await res.json();
        if (!data.configured) {
          badge.textContent = '⚪ not configured — prices unavailable';
          badge.style.color = 'var(--muted)';
        } else if (!data.reachable) {
          badge.textContent = '🔴 pricing engine not answering';
          badge.style.color = 'var(--accent)';
        } else if (data.mode === 'fixture') {
          badge.textContent = data.kind === 'simulated'
            ? '🟡 SIMULATED — sample prices, not a real quote'
            : '🟡 FIXTURE — prices are captured samples';
          badge.style.color = 'var(--accent)';
        } else {
          badge.textContent = '🟢 connected';
          badge.style.color = 'var(--emerald)';
        }
      } catch (err) {
        badge.textContent = '⚪ status unknown';
        badge.style.color = 'var(--muted)';
      }
    }

    async function syncEstimate() {
      const btn = document.getElementById('btn-sync-estimate');
      const out = document.getElementById('sync-estimate-out');
      if (!btn || !out) return; // a guest session has no pricing bar
      btn.disabled = true;
      out.style.display = 'block';
      out.textContent = '⏳ Asking the pricing engine to price this trip...';
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/sync-estimate?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' }
        });
        const data = await res.json();
        if (data.ok) {
          const issues = Array.isArray(data.issues) ? data.issues : [];
          out.textContent =
            '✅ Priced by the ' + (data.endpoint || 'pricing engine') + ' (role=' + (data.role || '?') + ', mode=' + (data.mode || 'unknown') + ')' +
            (data.sample ? '\\n⚠️ SAMPLE DATA — these are NOT real quotes. Do not send to a guest.' : '') +
            (issues.length ? '\\n⚠️ ' + issues.length + ' pricing warning(s): ' + issues.map(function (i) { return i.code || i; }).join(', ') : '') +
            '\\nReloading so the per-guest breakdown and the ops sheet come from the saved price…';
          // The answer is now part of the quotation, so the per-guest cards, the agent comparison
          // and the ops sheet are all rendered from the record. Reloading is what guarantees this
          // page and the record cannot disagree.
          window.location.reload();
          return;
        }
        out.textContent =
          '⚠️ ' + (data.reason || 'failed') + ': ' + (data.detail || '') +
          (Array.isArray(data.fields) && data.fields.length ? '\\nfields: ' + data.fields.join(', ') : '');
      } catch (err) {
        out.textContent = '⚠️ ' + (err && err.message ? err.message : String(err));
      } finally {
        btn.disabled = false;
        checkEstimatorStatus();
      }
    }

    checkEstimatorStatus();
    renderReservationStatus();
    renderPublishStatus();

    /**
     * What the quotation's own record says about its reservation — not what this page remembers.
     * A reload, or a second tab, must agree with it, which is why the state is read back rather
     * than tracked here.
     */
    function renderReservationStatus() {
      const badge = document.getElementById('reservation-status-badge');
      const btn = document.getElementById('btn-submit-reservation');
      if (!badge || !btn) return;
      const s = state.submission;
      if (!s) {
        badge.textContent = '';
        btn.disabled = false;
        return;
      }
      const LABELS = {
        pending: '⏳ Sending… do not press again',
        confirmed: '✅ Reservation sent',
        failed: '⚠️ Not accepted — you may try again',
        unknown: '⚠️ Not confirmed — check with the resort before sending again'
      };
      badge.textContent = LABELS[s.state] || s.state;
      // Only a refusal is retryable. "pending" is in flight; "confirmed" and "unknown" must not
      // be re-sent, because a second send is a second folio.
      btn.disabled = s.state !== 'failed';
    }

    async function submitReservation() {
      const btn = document.getElementById('btn-submit-reservation');
      const out = document.getElementById('reservation-out');
      if (!btn || !out) return; // a guest session has no reservation bar
      // Contact details are asked for rather than assumed: they are what the front desk confirms
      // to, and quietly booking under the studio's own account is how a guest never hears back.
      const name = window.prompt('Name for the reservation:', state.guestName || '');
      if (!name) return;
      const email = window.prompt('Email the front desk should confirm to:', '');
      if (!email) return;
      const phone = window.prompt('Phone (optional):', state.phone || '') || '';
      btn.disabled = true;
      out.style.display = 'block';
      out.textContent = '⏳ Sending the reservation...';
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/submit?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name, email: email, phone: phone || undefined })
        });
        const data = await res.json();
        if (data.submission) state.submission = data.submission;
        if (data.ok) {
          const s = data.submission || {};
          out.textContent = '✅ Reservation sent'
            + (s.sample ? '\\n⚠️ SAMPLE DATA — no folio was created. This is the simulated booking engine.' : '')
            + (s.folioId ? '\\nFolio #' + s.folioId : '');
        } else {
          out.textContent = '⚠️ ' + (data.reason || 'failed') + ': ' + (data.detail || data.error || '')
            + (data.reason === 'unknown' ? '\\nDo not send again — a person has to check whether the folio exists.' : '');
        }
      } catch (err) {
        out.textContent = '⚠️ ' + (err && err.message ? err.message : String(err));
      } finally {
        renderReservationStatus();
      }
    }

    /**
     * Whether this quotation already has a guest link. Read from the record, not from this page:
     * publishing is one-way (their link always resolves to the newest saved revision), so a reload
     * or a second tab has to agree that it is done.
     */
    function renderPublishStatus() {
      const badge = document.getElementById('publish-status-badge');
      const btn = document.getElementById('btn-publish-quote');
      if (!badge || !btn) return;
      if (state.estimator && state.estimator.guestUrl) {
        badge.textContent = '✅ Published';
        btn.disabled = true;
      } else {
        badge.textContent = '';
        btn.disabled = false;
      }
    }

    async function publishQuote() {
      const btn = document.getElementById('btn-publish-quote');
      const out = document.getElementById('publish-out');
      if (!btn || !out) return;
      const ack = document.getElementById('ack-sample');
      out.style.display = 'block';
      // The acknowledgement is a deliberate act, not a speed bump: these are captured prices, and a
      // guest who receives one has been quoted a number nobody has agreed to.
      if (ack && !ack.checked) {
        out.textContent = '⚠️ Tick "I have checked this SAMPLE price" first — these are not real prices.';
        return;
      }
      btn.disabled = true;
      out.textContent = '⏳ Publishing…';
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/publish?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ acknowledgeSample: !!(ack && ack.checked) })
        });
        const data = await res.json();
        if (data.quotation) state = data.quotation;
        if (data.ok) {
          out.textContent = '✅ Published as version ' + data.seq + '\\n'
            + (data.guestUrl || '(their app is not hosted anywhere we can link to — set ESTIMATOR_BASE_URL)');
        } else {
          out.textContent = '⚠️ ' + (data.reason || 'failed') + ': ' + (data.detail || data.error || '');
        }
      } catch (err) {
        out.textContent = '⚠️ ' + (err && err.message ? err.message : String(err));
      } finally {
        renderPublishStatus();
      }
    }

    function copyQuoteLink() {
      const input = document.getElementById('input-quotation-url');
      navigator.clipboard.writeText(input.value);
      document.getElementById('save-toast').textContent = '📋 Copied Quotation Link!';
    }

    renderSidebar();
    renderTripReview();
    renderStatusBadge();
  </script>
</body>
</html>`;
}
