import { themeCss } from "./theme.js";
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
import { DEMO_ROLES, type DemoRole } from "./demoAuth.js";
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
//
// v3: the seed's staff alert was markdown (`**Custom Dive Schedule:**`), and staff alerts render as
// text, so the first quotation anyone opens showed literal asterisks.
//
// v4: the stored fixture had been PUBLISHED, against the customer's fixture deployment, and that
// deployment keeps share tokens in one serverless instance's memory — so its link is dead and cannot
// be repaired (the token is gone from their side). A fixture that opens on "send the message again"
// with a link nobody can open is a bad first impression of a flow that works, so the fixture is
// rebuilt to its pre-publish state: no estimator session, pending review, priced by the sample
// engine. See `docs/upstream-note-bff-vercel-deploy.md` for the measurement.
const SEED_VERSION = 4;

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
      // Plain text, no `**`: this string is rendered as text in the studio, so markdown emphasis
      // reaches staff as literal asterisks. (Found on the seeded fixture, which is the first thing
      // anyone opens.)
      "Custom dive schedule noted — 1 person dives day 1, 5 people dive both days. Our reservation team will prepare the quotation.",
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
 * The duplicate drafts a fixed bug left behind, and the rule that says which are safe to remove.
 *
 * Before `findOpenQuotationForPhone` existed, every message in a thread that had enough information
 * minted a NEW quotation for the same phone: one manual test produced thirteen (`QT-1120-MIGU-*`,
 * four of them inside the same minute). Staff cannot work a queue like that, and every one of them
 * looked current.
 *
 * The rule is deliberately conservative, because this is the only code in the product that deletes
 * a business record:
 *
 *   * one record per phone survives — the **newest** by `updatedAt`;
 *   * anything **published** survives, because a guest may be holding that link;
 *   * anything staff have **corrected** survives, because somebody's work is in it;
 *   * the **seeded** fixture survives, so a cold start still has a quotation to show;
 *   * a record with no phone is not a duplicate of anything, and survives.
 *
 * Everything it does remove is a record nobody published and nobody corrected, which a newer record
 * for the same guest already replaces. It is a pure function of the list, so the route and its test
 * cannot disagree about what would go.
 */
export function duplicateQuotationIds(all: HonoQuotationDraft[]): HonoQuotationDraft[] {
  const newestByPhone = new Map<string, HonoQuotationDraft>();
  for (const q of all) {
    const key = q.phone ? `phone:${q.phone}` : `quote:${q.quoteId}`;
    const incumbent = newestByPhone.get(key);
    // `list()` is newest-first, but this must not depend on that: compare timestamps outright.
    if (!incumbent || q.updatedAt > incumbent.updatedAt) newestByPhone.set(key, q);
  }

  return all.filter((q) => {
    const key = q.phone ? `phone:${q.phone}` : `quote:${q.quoteId}`;
    if (newestByPhone.get(key)?.quoteId === q.quoteId) return false;
    if (q.estimator?.sharedAt) return false;
    if ((q.staffEdits ?? []).length > 0) return false;
    if (typeof q.seedVersion === "number" || q.quoteId === "QT-1010-SKY") return false;
    return true;
  });
}

/** Remove one quotation by id or slug. Returns false when there was nothing to remove. */
export async function removeQuotation(idOrSlug: string): Promise<boolean> {
  const store = await getStore();
  return store.remove(idOrSlug);
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
  /**
   * Which engine prices this deployment. The "Send reservation" bar is hidden when it is `remote`:
   * bookings are taken on the customer's own quotation page (their app owns the folio), and the
   * route refuses with `wrong_place` — offering a button that always refuses is worse than not
   * offering it, because a receptionist reads the refusal as a fault in the quotation.
   */
  estimatorKind: "simulated" | "remote" = "simulated",
): string {  // ---- The one status, and the four steps ---------------------------------
  //
  // The page used to carry three different statements of where a quotation was: a pill on the guest
  // card ("Waiting for Staff Approval"), a second pill on the send card ("Ready to Send" /
  // "Awaiting Approval"), and a section headed "Customer Quotation Link (Official Invoice)" that
  // looked like a state of its own. Staff had to reconcile them, and they disagreed: an approved but
  // unpublished quotation read "Ready to Send" beside a link box that said no link existed.
  //
  // One status now, derived from the record in one place, and a four-step bar that says what is left
  // to do. Everything is SERVER-rendered first: the script can move the bar after an action, but a
  // quotation that is already approved must not read as unapproved because a script did not run.
  const published = Boolean(draft.estimator?.sharedAt && draft.estimator?.guestUrl);
  const priced = Boolean(draft.pricing);
  const approved = draft.status === "confirmed_by_hono";
  const archived = draft.status === "cancelled";

  const statusLabel = archived
    ? "Archived"
    : draft.status !== "confirmed_by_hono" && published
      ? "Published — needs approval"
      : published
        ? "Sent to guest"
        : approved
          ? "Approved — not sent yet"
          : priced
            ? "Priced — needs approval"
            : "Needs review";
  const statusTone = archived ? "rose" : published || approved ? "emerald" : priced ? "amber" : "amber";

  // A step is `done` when it is behind us, `current` when it is the next thing to do. "Get price"
  // counts as done when the record holds a price; "Send" only when the guest link exists.
  const steps: Array<{ label: string; state: "done" | "current" | "todo" }> = [
    { label: "Review trip", state: draft.bffTrip ? "done" : "current" },
    { label: "Get price", state: priced ? "done" : draft.bffTrip ? "current" : "todo" },
    { label: "Approve", state: approved || published ? "done" : priced ? "current" : "todo" },
    { label: "Send", state: published ? "done" : approved ? "current" : "todo" },
  ];
  // Which screen opens. Server-rendered, like the status: the right step must be in front of the
  // person before any script runs, and a guest session has no wizard at all — it opens on the price.
  //
  // The script may move it afterwards (`goStep`), and remembers the choice in `sessionStorage`
  // because the actions that finish a step RELOAD the page (the record is the source of truth for
  // every figure on it).
  const maxStep = published ? 4 : approved ? 4 : priced ? 3 : draft.bffTrip ? 2 : 1;
  const initialStep = role === "guest" ? 2 : approved || published ? 4 : priced ? 3 : 1;

  const progressHtml = archived
    ? `<div class="progress-note">This quotation is archived. Nothing is sent to the guest from here.</div>`
    : `<div class="progress">${steps
        .map((s, i) => {
          const n = i + 1;
          // A step ahead of where the record has got to is not offered: the bar says what is
          // possible, not what the workflow would look like if earlier work had been done.
          const reachable = n <= maxStep;
          return `<button type="button" class="pstep ${s.state}" data-step="${n}" onclick="goStep(${n})"${reachable ? "" : " disabled"} title="${
            reachable ? `Go to step ${n}: ${s.label}` : `Finish the earlier steps first`
          }">${`<span class="pnum">${s.state === "done" ? "✓" : n}</span>${s.label}`}</button>`;
        })
        .join('<div class="psep"></div>')}</div>`;


  const initialJson = JSON.stringify(draft).replace(/</g, "\\u003c");
  const allQuotesJson = JSON.stringify(
    allQuotes.map((q) => ({
      quoteId: q.quoteId,
      guestName: q.guestName,
      checkIn: q.checkIn,
      nights: q.nights,
      // The engine's figure, and ONLY the engine's. `totalAmount` is the draft builder's own
      // hand-computed table (still produced, and still useful as a preview while staff look at an
      // enquiry), but it is not what a guest is quoted — so it must never be what the queue shows
      // next to "checkIn (n nights)". A quotation nobody has priced shows no money rather than a
      // number no engine produced; measured on a real quotation where the two disagreed by 7,200.
      engineRevenue: q.pricing?.kpis.revenue ?? null,
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
        ? "Staff view — quotations, prices and guest messages."
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
${themeCss()}
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
    body[data-role="guest"] .wizard-nav { display: none !important; }
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
    .tab-btn {
      flex: 1;
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
    }
    /* The demo role the page was opened with decides whether the staff actions are offered at all.
       A guest session sees the quotation, not the machinery that prices it — before this, the role
       changed one line of text and nothing else. */
    body[data-role="guest"] .staff-only { display: none !important; }
  </style>
</head>
<body data-role="${role}">
  <div style="background:var(--accent-soft);border-bottom:1px solid var(--border);color:var(--text);font-size:13.5px;padding:8px 20px;text-align:center;font-weight:600;">
    Casa Escondida Anilao · Staff Operations Desk <span style="color:var(--muted);">· ${roleNote}</span>
  </div>
  <header class="topbar">
    <div class="brand">
      <span class="brand-badge">RESORT STAFF DESK · DEMO AUTH</span>
      <h1>Casa Escondida — Quotation Review #${draft.quoteId}</h1>
    </div>
    <div class="top-actions">
      <form method="post" action="/logout" style="display:inline;"><button type="submit" class="theme-btn">Sign out</button></form>
      <button type="button" class="theme-btn" id="theme-toggle-btn" onclick="toggleTheme()">
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
        quotationsNeedingNoEdit.all > 0
          ? `<div class="card" style="padding:12px 14px;margin-bottom:14px;">
        <div style="font-size:13.5px;font-weight:800;">AI reading check</div>
        <div style="font-size:12.5px;color:var(--muted);line-height:1.55;margin-top:2px;">
          ${quotationsNeedingNoEdit.unchanged} of ${quotationsNeedingNoEdit.all} quotations needed no correction after the bot read them${
            quotationsNeedingNoEdit.fieldCounts[0]
              ? ` — most corrected: <strong>${esc(quotationsNeedingNoEdit.fieldCounts[0][0])}</strong>`
              : ""
          }.<br><span style="font-size:11.5px;">Field names only, never guest details.</span>
        </div>
      </div>`
          : ""
      }
      <div class="card">
        <div class="card-title">
          <span>All Quotations</span>
          <span id="queue-count-badge" style="font-size:12px;font-weight:800;background:var(--accent-soft);color:var(--accent);padding:2px 8px;border-radius:999px;"></span>
        </div>
        <input type="text" id="quote-search-input" oninput="filterQuotesList(this.value)" placeholder="Search guest, phone, quote ID..." class="cell-input" style="margin-bottom:10px;font-size:13.5px;padding:9px 12px;" />
        <div style="display:flex;gap:4px;margin-bottom:12px;background:var(--surface-2);padding:4px;border-radius:8px;">
          <button type="button" class="tab-btn active" id="tab-needs-review" onclick="setQuoteFilter('needs-review')">Needs Review</button>
          <button type="button" class="tab-btn" id="tab-approved" onclick="setQuoteFilter('approved')">Approved</button>
          <button type="button" class="tab-btn" id="tab-cancelled" onclick="setQuoteFilter('cancelled')">Archived</button>
          <button type="button" class="tab-btn" id="tab-all" onclick="setQuoteFilter('all')">All</button>
        </div>
        <div id="quote-sidebar-list"></div>
        <div id="quote-pagination" style="display:flex;justify-content:space-between;align-items:center;padding:12px 4px 4px;margin-top:10px;border-top:1px solid var(--border);font-size:12.5px;font-weight:700;">
          <button type="button" class="btn btn-outline" onclick="changeQuotePage(-1)" id="btn-prev-page" style="padding:4px 10px;font-size:12px;">&larr; Prev</button>
          <span id="quote-page-info" style="color:var(--muted);font-size:12px;">Page 1 of 1</span>
          <button type="button" class="btn btn-outline" onclick="changeQuotePage(1)" id="btn-next-page" style="padding:4px 10px;font-size:12px;">Next &rarr;</button>
        </div>
      </div>
    </aside>

    <!-- Main Studio -->
    <main data-step="${initialStep}">
      ${
        archived
          ? `<div style="margin-bottom:18px;padding:14px 18px;border-radius:12px;background:rgba(244,63,94,0.1);border:2px solid #f43f5e;color:#e11d48;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
        <span>This quotation is archived.</span>
        <span style="font-size:13px;font-weight:600;color:var(--muted);">Excluded from the working queue</span>
      </div>`
          : ""
      }

      <!-- Where the quotation is, and what is left to do. One status, one bar. -->
      <div class="card staff-only" id="workflow-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="font-size:15px;font-weight:800;">This quotation</div>
          <span id="quote-status-badge" class="status-pill status-${statusTone}">${statusLabel}</span>
        </div>
        ${progressHtml}
        <!-- The one action that finishes a step lives in the wizard bar at the bottom of the screen,
             so the card in front of the person holds no competing primary button. -->
        <div id="save-hint" class="staff-only" style="margin-top:12px;font-size:13px;color:var(--muted);font-weight:600;">
          ${published ? "Published: the trip and its price are frozen. Change them by starting a new quotation." : "One save for the guest's details and the priced trip."}
        </div>
        <!-- One place for anything that goes wrong. Every action writes here instead of into its own
             corner of the page, so a refusal is never missed because it appeared somewhere the eye
             was not. -->
        <div id="studio-notice" class="notice" style="display:none;" role="status" aria-live="polite"></div>
      </div>

      <!-- STEP 1 — the guest's details and the trip the engine will be asked to price -->
      <div class="card" data-step-card="1">
        <div class="card-title">
          <span>Step 1 · Guest &amp; stay details</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">From the guest's message — correct anything that is wrong</span>
        </div>

        ${
          Array.isArray(draft.staffAlerts) && draft.staffAlerts.length > 0
            ? `<div style="margin-bottom:18px;padding:14px 16px;border-left:5px solid var(--amber);background:var(--amber-soft);border-radius:10px;">
          <div style="font-size:15px;font-weight:800;color:var(--amber);margin-bottom:6px;">Check before approving</div>
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

        <!-- Tour Operations Checklist Link -->
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;margin-top:6px;">
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--text);">Tour Operations Checklist</div>
            <div style="font-size:12.5px;color:var(--muted);">Boat manifest, room allocation &amp; diver schedule without rates.</div>
          </div>
          <a class="btn btn-outline staff-only" id="btn-open-ops-sheet" href="/quotes/${encodeURIComponent(draft.quoteId)}/ops" target="_blank" style="padding:6px 14px;font-size:13px;font-weight:700;">Ops Sheet</a>
        </div>

        <div style="margin-top:18px;">
          <label style="display:block;font-size:15px;font-weight:800;color:var(--text);margin-bottom:8px;">Note for the guest (printed on their quotation page)</label>
          <input type="text" id="input-staff-notes" class="cell-input" value="${esc(draft.staffNotes)}" />
        </div>

        <!-- The save for the whole review step lives at the bottom of the screen (the wizard bar):
             the guest's details and the trip go together. -->
        <div class="staff-only" style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span style="font-size:13px;color:var(--muted);font-weight:600;">Saved by <strong>Save &amp; get price</strong> at the bottom of this screen.</span>
        </div>
      </div>

      <!-- STEP 1, continued: the trip itself -->
      <div class="card" data-step-card="1">
        <div class="card-title">
          <span>Step 1 · Rooms &amp; diving</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">What the resort's engine prices</span>
        </div>

        <!-- The trip review block FIRST: verify rooms & divers before calculating price -->
        <div class="staff-only" style="margin-bottom:18px;">
          <div style="margin-bottom:10px;">
            <div style="font-size:15px;font-weight:800;color:var(--text);">Trip review</div>
            <div style="font-size:13.5px;color:var(--muted);">Add or remove rooms, set each room's type, move guests between rooms, and tick the dives and courses. The button at the bottom of the screen saves this and asks the engine to price it.</div>
          </div>
          <div id="trip-review"></div>
        </div>
      </div>

      <!-- STEP 2 — what the engine answered. Nothing to edit here: the figures are the engine's, and
           the only action is to ask it again or to move on. -->
      <div class="card" data-step-card="2">
        <div class="card-title">
          <span>Step 2 · The price</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">From the resort's booking engine — the only source of a figure</span>
        </div>

        <!-- The engine bar. One button that always works: it prices a new scenario, and re-prices an
             existing one. -->
        <div class="staff-only" style="margin-bottom:18px;padding:14px 16px;background:var(--surface-2);border:2px solid var(--border);border-radius:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--text);">Price</div>
            <div style="font-size:13.5px;color:var(--muted);">
              ${
                priced
                  ? `Priced ${esc(String(draft.pricing?.computedAt ?? "").slice(0, 16).replace("T", " "))} — saving the trip again replaces this figure.`
                  : "Not priced yet. The resort's booking engine calculates every figure on this screen."
              }
            </div>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <button class="btn ${priced ? "btn-outline" : "btn-primary"}" onclick="syncEstimate()" id="btn-sync-estimate">Get price</button>
            <span id="estimator-status-badge" style="font-size:13.5px;font-weight:700;color:var(--muted);">Checking the booking engine…</span>
          </div>
        </div>

        <!-- Booking the reservation (simulated engine only). Kept off the guest's path and away from
             the two things this screen is for: reading the price and moving on. -->
        ${
          estimatorKind === "simulated"
            ? `<details class="staff-only" style="margin-bottom:18px;padding:12px 16px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;">
          <summary style="font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;user-select:none;">Book this as a reservation</summary>
          <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div style="font-size:12.5px;color:var(--muted);">Creates the booking in the resort's engine. Only available with the built-in sample engine.</div>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
              <button class="btn btn-outline" onclick="submitReservation()" id="btn-submit-reservation">Create booking</button>
              <span id="reservation-status-badge" style="font-size:13px;font-weight:700;color:var(--muted);"></span>
            </div>
          </div>
        </details>`
            : ""
        }

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
              <span>No discount field: the only discount this resort has is the partner rate, and the engine applies it by itself.</span>
            </div>
          </div>
        </div>

        ${guestCardsHtml}
        ${agentCompareHtml}

        ${
          // The honest note about a sample engine, which is the one thing that confuses a demo:
          // editing the trip changes the payload and the frozen revision, while a captured price
          // does not move. Better said here than discovered by whoever is being shown.
          pricing?.sample
            ? `<div style="margin-top:16px;padding:12px 14px;border-radius:10px;background:var(--amber-soft);border-left:5px solid var(--amber);font-size:13.5px;font-weight:600;">
          <strong>Sample price.</strong> This figure is not from the resort's live books — this deployment is pointed at a sample engine. A correction still changes what the engine is asked to price and what the guest's frozen page shows; the figure here may not move until the live engine is connected.
        </div>`
            : ""
        }
      </div>

      <!-- STEP 3 — one decision, and the message it prepares -->
      <div class="card staff-only" data-step-card="3">
        <div class="card-title">
          <span>Step 3 · Approve</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">
            ${approved ? "Approved" : priced ? "Waiting for your approval" : "Get the price first"}
          </span>
        </div>

        <p style="font-size:13.5px;color:var(--muted);font-weight:600;margin:0 0 14px;">
          Approving locks in the price for this trip. The guest's link is created when you send, on the next screen.
        </p>

        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;">
          <button class="btn btn-outline" onclick="cancelQuotationAction()" id="btn-cancel-quote" style="color:var(--rose, #f43f5e);border-color:var(--rose, #f43f5e);">Archive quotation</button>
          <button class="btn btn-emerald" onclick="confirmAndSendToAI()" id="btn-confirm-hono" style="padding:12px 24px;font-size:15px;">
            Approve quotation
          </button>
        </div>

        <div class="ai-reply-box" id="ai-confirmed-reply-box" style="${draft.status === "confirmed_by_hono" ? "" : "color:var(--muted);font-style:italic;"}">${
          draft.status === "confirmed_by_hono" && draft.aiConfirmedReply
            ? draft.aiConfirmedReply
            : "The message to the guest is prepared once the quotation is approved."
        }</div>
      </div>

      <!-- STEP 4 — the link, the number, and one button that does both -->
      <div class="card staff-only" data-step-card="4" id="ai-response-card">
        <div class="card-title">
          <span>Step 4 · Send to the guest</span>
          <span style="font-size:13px;font-weight:700;color:var(--muted);">
            ${
              published
                ? `Link created ${esc(String(draft.estimator?.sharedAt ?? "").slice(0, 16).replace("T", " "))}`
                : "The link is created when you send"

            }
          </span>
        </div>

        <div class="link-editor-bar">
          <input type="text" id="input-quotation-url" value="${esc(draft.estimator?.guestUrl || "")}" placeholder="No link yet — it appears here when you send" readonly title="The guest's quotation link" />
          <button class="btn btn-outline" onclick="copyQuoteLink()" ${published ? "" : "disabled"}>Copy link</button>
          <a class="btn btn-outline" id="btn-open-public-quote" href="${esc(draft.estimator?.guestUrl || "#")}" target="_blank" rel="noopener" style="${published ? "" : "display:none;"}">Open guest page &rarr;</a>
        </div>

        <div style="margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:14px;font-weight:800;">Guest's WhatsApp number</label>
          <input type="text" id="whatsapp-phone-input" class="cell-input" style="width:220px;" placeholder="e.g. 639171234567" value="${draft.phone ?? ""}" />
          ${
            // The acknowledgement sits beside BOTH actions that publish, and until it is ticked the
            // primary button is disabled with the reason on screen — a button that is refused only
            // after the click teaches nothing, and this is the one place a sample price can reach a
            // guest.
            pricing?.sample
              ? `<label style="font-size:13px;font-weight:700;color:var(--accent);display:flex;align-items:center;gap:6px;">
                   <input type="checkbox" id="ack-sample" onchange="updateSendControls()" /> I have checked this sample price
                 </label>`
              : ""
          }
          <button class="btn btn-primary" onclick="sendToGuest()" id="btn-send-guest" ${approved ? "" : 'disabled style="opacity:0.5;cursor:not-allowed;"'}>
            ${published ? "Send the message again" : "Create link &amp; send"}
          </button>
          <button class="btn btn-outline" onclick="publishQuote()" id="btn-publish-quote">Create link only</button>
          <span id="publish-status-badge" style="font-size:13px;font-weight:700;color:var(--muted);"></span>
          <span id="wa-toast" style="font-size:14px;font-weight:700;color:var(--accent);"></span>
        </div>
        <p id="send-hint" style="font-size:13px;color:var(--muted);font-weight:600;margin-top:10px;">
          The message carries the guest's own quotation link and no price of ours: the figures they read are the engine's, on their page.
          ${published ? "" : "Sending creates the link first."}
        </p>
      </div>

      <!-- The wizard bar. One action finishes the screen it belongs to, and Back is always there:
           a person who is unsure of a figure goes back and looks, which is what the long column of
           cards made awkward. Server-rendered state, like the progress bar, so the right button is
           in front of the person before any script runs. -->
      <div class="wizard-nav staff-only">
        <button type="button" class="btn btn-outline" onclick="goStep(stepNumber() - 1)" id="btn-back" ${initialStep <= 1 ? "disabled" : ""}>&larr; Back</button>
        <div class="wizard-label">
          Step <strong id="wizard-step-num">${initialStep}</strong> of 4 · <span id="wizard-step-name">${steps[initialStep - 1]?.label ?? ""}</span>
        </div>
        <button type="button" class="btn btn-primary" onclick="wizardNext()" id="btn-next">
          ${
            published
              ? "Send the message again"
              : approved
                ? "Create link &amp; send"
                : priced
                  ? "Approve quotation"
                  : "Save &amp; get price"
          }
        </button>
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

    /**
     * One place for anything that goes wrong, and one for anything that went right.
     *
     * Every action used to write into its own corner of the page — four separate <pre> blocks, two
     * toasts and two window.alert()s — so a refusal could appear somewhere the person was not
     * looking, and a refusal from Meta arrived as a sentence in one place and as raw JSON in
     * another. Now: failures go to the box at the top of the page, successes to a short green line.
     *
     * The server sends '{ok:false, reason, detail}'. The reason is the stable part; 'help' turns the
     * ones a receptionist will actually meet into the next thing to do, and whatever sentence the
     * server wrote is printed underneath. Nothing raw is ever rendered.
     */
    const ERROR_HELP = {
      not_priced: 'Get the price first, then approve.',
      trip_changed: 'The trip changed after it was priced. Save the trip again to get a new price, then approve.',
      not_approved: 'Approve the quotation first.',
      not_published: 'The guest link does not exist yet — sending creates it.',
      already_shared: 'This quotation is already published, and a published link cannot change. Start a new quotation instead.',
      sample_not_acknowledged: 'Tick the sample-price box before sending.',
      no_trip: 'This quotation has no trip to price.',
      trip_not_priceable: 'The engine cannot price this trip yet — check the fields it named.',
      invalid_trip: 'The trip is not in the shape the engine accepts.',
      phone_missing: "Enter the guest's WhatsApp number, including the country code.",
      phone_invalid: "That number does not look right. Include the country code, for example 639171234567.",
      send_failed: 'WhatsApp refused the message. The sentence below says what to fix.',
      link_unverified: 'The guest link did not open, so nothing was sent. Create the link again (Send section), then send.',
      not_configured: 'The pricing engine is not configured on this deployment.',
      unauthorized: 'Your session expired. Sign in again.',
      not_found: 'That quotation no longer exists.'
    };

    function showError(source, data) {
      const box = document.getElementById('studio-notice');
      const d = data || {};
      const reason = d.reason || d.error || 'failed';
      const help = ERROR_HELP[reason] || '';
      const lines = [source + ': ' + (help || reason)];
      if (typeof d.detail === 'string' && d.detail && d.detail !== help) lines.push(d.detail);
      else if (typeof d.error === 'string' && d.error && d.error !== help) lines.push(d.error);
      if (Array.isArray(d.fields) && d.fields.length) lines.push('Fields: ' + d.fields.join(', '));
      if (Array.isArray(d.issues) && d.issues.length) {
        lines.push('Notes: ' + d.issues.map(function (i) { return (i && (i.code || i.detail)) || String(i); }).join(', '));
      }
      if (!box) return lines.join('\\n');
      box.className = 'notice notice-error';
      box.textContent = lines.join('\\n');
      box.style.display = 'block';
      if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
      return box.textContent;
    }

    function showInfo(message) {
      const box = document.getElementById('studio-notice');
      if (!box) return;
      box.className = 'notice notice-info';
      box.textContent = message;
      box.style.display = 'block';
    }

    function clearNotice() {
      const box = document.getElementById('studio-notice');
      if (box) {
        box.style.display = 'none';
        box.textContent = '';
      }
    }

    /**
     * The wizard: which screen is in front, and what the button at the bottom does.
     *
     * The four screens are in the page at once and CSS shows one of them (the data-step attribute on main), so a
     * step change is an attribute write and never a re-render. The step is remembered in
     * sessionStorage because finishing a step RELOADS the page — every figure on screen comes from
     * the record, so the record is what the next screen is drawn from — and coming back to step 1
     * after saving the trip would make the person walk the wizard again.
     */
    const STEP_NAMES = ['Review trip', 'Get price', 'Approve', 'Send'];
    const STEP_KEY = 'casa_studio_step';

    function stepNumber() {
      const main = document.querySelector('main');
      return Number(main && main.getAttribute('data-step')) || 1;
    }

    /** The furthest step the record has earned. A step after it is not offered at all. */
    function maxStep() {
      const published = Boolean(state.estimator && state.estimator.sharedAt);
      const approved = state.status === 'confirmed_by_hono';
      if (published || approved) return 4;
      if (state.pricing) return 3;
      if (state.bffTrip) return 2;
      return 1;
    }

    function goStep(n) {
      const target = Math.max(1, Math.min(4, Math.min(n, maxStep())));
      const main = document.querySelector('main');
      if (main) main.setAttribute('data-step', String(target));
      rememberStep(target);
      updateWizard();
      const box = document.getElementById('studio-notice');
      if (box) box.scrollIntoView({ block: 'nearest' });
    }

    /**
     * Where to open next time. The actions that finish a step reload the page — every figure on it
     * comes from the record — so the step has to survive the reload, or saving the trip would put the
     * person back on step 1 to walk the wizard again.
     */
    function rememberStep(n) {
      try { sessionStorage.setItem(STEP_KEY, String(n)); } catch (err) {}
    }

    /** The nav: where we are, what Back does, and the one action that finishes this screen. */
    function updateWizard() {
      const step = stepNumber();
      const num = document.getElementById('wizard-step-num');
      const name = document.getElementById('wizard-step-name');
      if (num) num.textContent = String(step);
      if (name) name.textContent = STEP_NAMES[step - 1] || '';

      const back = document.getElementById('btn-back');
      if (back) back.disabled = step <= 1;

      const next = document.getElementById('btn-next');
      if (next) {
        const published = Boolean(state.estimator && state.estimator.sharedAt);
        const approved = state.status === 'confirmed_by_hono';
        const priced = Boolean(state.pricing);
        // The label is the ACTION, not "next": on screen 1 the button saves and prices, on screen 3
        // it approves, on screen 4 it sends. A wizard whose button only says "Next" hides what the
        // person is about to do.
        next.textContent = published
          ? 'Send the message again'
          : step === 1
            ? 'Save & get price'
            : step === 2
              ? (priced ? 'Approve quotation' : 'Get price')
              : step === 3
                ? (approved ? 'Create link & send' : 'Approve quotation')
                : 'Create link & send';
        // Step 4's send also needs the sample acknowledgement; updateSendControls owns that and is
        // called from here so the two gates cannot drift.
        if (step === 4) updateSendControls();
      }

      // The bar is clickable for the steps the record allows, so a person can jump back to a figure
      // without walking the wizard.
      document.querySelectorAll('.pstep').forEach(function (btn) {
        const n = Number(btn.getAttribute('data-step'));
        btn.disabled = n > maxStep();
        btn.classList.toggle('current', n === step);
        btn.classList.toggle('done', n < step);
      });
    }

    /** The one action that finishes the screen in front of the person. */
    async function wizardNext() {
      const step = stepNumber();
      if (step === 1) return saveStudio();          // save the details AND price the trip, then reload
      if (step === 2) {
        if (!state.pricing) return syncEstimate();  // nothing priced yet: ask for the price
        return goStep(3);
      }
      if (step === 3) {
        if (state.status !== 'confirmed_by_hono') return confirmAndSendToAI();
        return goStep(4);
      }
      return sendToGuest();
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

    let quoteFilter = (state && state.status === 'confirmed_by_hono') ? 'approved' : ((state && state.status === 'cancelled') ? 'cancelled' : 'needs-review');
    let quoteSearch = '';

    const PAGE_SIZE = 10;
    let quotePage = 1;

    function setQuoteFilter(tab) {
      quoteFilter = tab;
      quotePage = 1;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const activeBtn = document.getElementById('tab-' + tab);
      if (activeBtn) activeBtn.classList.add('active');
      renderSidebar();
    }

    function filterQuotesList(val) {
      quoteSearch = (val || '').toLowerCase().trim();
      quotePage = 1;
      renderSidebar();
    }

    function changeQuotePage(delta) {
      quotePage += delta;
      renderSidebar();
    }

    function renderSidebar() {
      const el = document.getElementById('quote-sidebar-list');
      if (!el) return;
      const tok = staffToken();
      const qs = tok ? '?token=' + encodeURIComponent(tok) : '';
      
      const filtered = allQuotes.filter(q => {
        const isApproved = q.status === 'confirmed_by_hono';
        const isCancelled = q.status === 'cancelled';
        if (quoteFilter === 'needs-review' && (isApproved || isCancelled)) return false;
        if (quoteFilter === 'approved' && (!isApproved || isCancelled)) return false;
        if (quoteFilter === 'cancelled' && !isCancelled) return false;
        if (quoteSearch) {
          const matchName = (q.guestName || '').toLowerCase().includes(quoteSearch);
          const matchId = (q.quoteId || '').toLowerCase().includes(quoteSearch);
          const matchDate = (q.checkIn || '').toLowerCase().includes(quoteSearch);
          if (!matchName && !matchId && !matchDate) return false;
        }
        return true;
      });

      const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
      if (quotePage > totalPages) quotePage = totalPages;
      if (quotePage < 1) quotePage = 1;

      const badge = document.getElementById('queue-count-badge');
      if (badge) badge.textContent = filtered.length + ' / ' + allQuotes.length;

      const pagEl = document.getElementById('quote-pagination');
      const pageInfo = document.getElementById('quote-page-info');
      const btnPrev = document.getElementById('btn-prev-page');
      const btnNext = document.getElementById('btn-next-page');
      if (pagEl && pageInfo && btnPrev && btnNext) {
        if (filtered.length <= PAGE_SIZE) {
          pagEl.style.display = 'none';
        } else {
          pagEl.style.display = 'flex';
          pageInfo.textContent = 'Page ' + quotePage + ' of ' + totalPages;
          btnPrev.disabled = quotePage <= 1;
          btnNext.disabled = quotePage >= totalPages;
        }
      }

      if (filtered.length === 0) {
        el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px;font-weight:600;">No quotations match this filter.</div>';
        return;
      }

      const startIdx = (quotePage - 1) * PAGE_SIZE;
      const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

      el.innerHTML = pageItems.map(q => {
        const isApproved = q.status === 'confirmed_by_hono';
        const isCancelled = q.status === 'cancelled';
        const statusLabel = isCancelled ? 'Archived' : (isApproved ? 'Approved' : 'Needs Review');
        const statusColor = isCancelled ? 'var(--rose, #f43f5e)' : (isApproved ? 'var(--emerald)' : 'var(--amber)');
        return \`
        <a class="quote-list-item \${q.quoteId === state.quoteId ? 'active' : ''}" href="/quotes/\${q.quoteId}\${qs}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="font-size:15px;color:var(--accent);">\${q.quoteId}</strong>
            <span style="font-size:12.5px;font-weight:800;color:\${statusColor};">
              \${statusLabel}
            </span>
          </div>
          <div style="font-size:15px;font-weight:700;">\${escHtml(q.guestName)}</div>
          <div style="font-size:14px;color:var(--muted);">\${q.checkIn} (\${q.nights} nights) · <strong>\${q.engineRevenue == null ? 'not priced yet' : fmtMoney(q.engineRevenue, q.currency)}</strong></div>
        </a>
      \`;
      }).join('');
    }

    (function initQuotePagination() {
      const isApproved = state && state.status === 'confirmed_by_hono';
      const isCancelled = state && state.status === 'cancelled';
      const initialFiltered = allQuotes.filter(q => {
        if (quoteFilter === 'needs-review' && (q.status === 'confirmed_by_hono' || q.status === 'cancelled')) return false;
        if (quoteFilter === 'approved' && q.status !== 'confirmed_by_hono') return false;
        if (quoteFilter === 'cancelled' && q.status !== 'cancelled') return false;
        return true;
      });
      const idx = initialFiltered.findIndex(q => q.quoteId === state.quoteId);
      if (idx !== -1) {
        quotePage = Math.floor(idx / PAGE_SIZE) + 1;
      }
    })();

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
      // Frozen once the guest is holding the link: their page resolves to the newest saved revision,
      // so a "correction" here would silently change what they were sent (their Q-005). The controls
      // are drawn read-only rather than left editable and refused later.
      const frozen = Boolean(state.estimator && state.estimator.sharedAt);
      const ro = frozen ? ' disabled' : '';

      const roomRows = trip.rooms.map((room, i) => \`
        <tr>
          <td><strong>\${escHtml(room.id || '—')}</strong></td>
          <td>
            <select class="cell-input" onchange="setRoomType(\${i}, this.value)"\${ro}>
              \${ROOM_TYPES.map(t => \`<option value="\${t}" \${room.type === t ? 'selected' : ''}>\${t}</option>\`).join('')}
            </select>
          </td>
          <td>\${escHtml(trip.guests.filter(g => g.roomId === room.id).map(g => g.name).join(', ') || '— nobody —')}</td>
          <td style="white-space:nowrap;">
            \${frozen ? '' : \`<button class="btn btn-outline" style="padding:4px 10px;font-size:12.5px;" onclick="removeRoom(\${i})">Remove</button>\`}
          </td>
        </tr>\`).join('');

      const guestRows = trip.guests.map((guest) => \`
        <tr>
          <td><strong>\${escHtml(guest.name)}</strong></td>
          <td>
            <select class="cell-input" onchange="setGuestRoom('\${escHtml(guest.id)}', this.value)"\${ro}>
              <option value="" \${guest.roomId ? '' : 'selected'}>— unassigned —</option>
              \${trip.rooms.map(r => \`<option value="\${escHtml(r.id)}" \${guest.roomId === r.id ? 'selected' : ''}>\${escHtml(r.id)} (\${escHtml(r.type)})\</option>\`).join('')}
            </select>
          </td>
          <td>
            <select class="cell-input" onchange="setGuestCourse('\${escHtml(guest.id)}', this.value)"\${ro}>
              \${COURSES.map(c => \`<option value="\${c}" \${((guest.courses && guest.courses[0]) || '') === c ? 'selected' : ''}>\${COURSE_LABELS[c]}</option>\`).join('')}
            </select>
          </td>
          \${stayDates.map(d => {
            const day = (guest.days && guest.days[d]) || {};
            return \`<td style="white-space:nowrap;">
              <label title="Boat dives"><input type="checkbox" \${day.dive ? 'checked' : ''} onchange="setGuestDay('\${escHtml(guest.id)}', '\${d}', 'dive', this.checked)"\${ro} /> D</label>
              <label title="Third dive"><input type="checkbox" \${day.third ? 'checked' : ''} onchange="setGuestDay('\${escHtml(guest.id)}', '\${d}', 'third', this.checked)"\${ro} /> 3</label>
              <label title="Night dive"><input type="checkbox" \${day.night ? 'checked' : ''} onchange="setGuestDay('\${escHtml(guest.id)}', '\${d}', 'night', this.checked)"\${ro} /> N</label>
            </td>\`;
          }).join('')}
        </tr>\`).join('');

      el.innerHTML = \`
        \${frozen ? \`<div style="margin-bottom:14px;padding:12px 14px;border-radius:10px;background:var(--amber-soft);border-left:5px solid var(--amber);font-size:13.5px;font-weight:600;">
          Published: this trip and its price are frozen on the guest's link. Start a new quotation to change either.
        </div>\` : ''}
        <div style="overflow-x:auto;margin-bottom:10px;">
          <table class="quote-table">
            <thead><tr><th style="width:90px;">Room</th><th style="width:150px;">Type</th><th>Guests in this room</th><th style="width:110px;"></th></tr></thead>
            <tbody>\${roomRows}</tbody>
          </table>
        </div>
        \${frozen ? '' : \`<div style="margin-bottom:18px;">
          <button class="btn btn-outline" style="padding:6px 14px;font-size:13px;" onclick="addRoom()">+ Add a room</button>
        </div>\`}
        <div style="overflow-x:auto;">
          <table class="quote-table">
            <thead><tr>
              <th style="width:150px;">Guest</th>
              <th style="width:170px;">Room</th>
              <th style="width:190px;">Course</th>
              \${stayDates.map(d => \`<th style="text-align:center;">\${escHtml(dayLabel(d))}<br><span style="font-weight:600;color:var(--muted);">D · 3rd · Night</span></th>\`).join('')}
            </tr></thead>
            <tbody>\${guestRows}</tbody>
            \${stayDates.length && !frozen ? \`<tfoot><tr>
              <td colspan="3" style="font-weight:800;">Everyone on this day</td>
              \${stayDates.map(d => \`<td style="white-space:nowrap;font-size:12.5px;">
                <button class="btn btn-outline" style="padding:2px 8px;font-size:12px;" onclick="setDayForAll('\${d}','dive',true)">D all</button>
                <button class="btn btn-outline" style="padding:2px 8px;font-size:12px;" onclick="setDayForAll('\${d}','third',true)">3 all</button>
                <button class="btn btn-outline" style="padding:2px 8px;font-size:12px;" onclick="setDayForAll('\${d}','night',true)">N all</button>
                <button class="btn btn-outline" style="padding:2px 8px;font-size:12px;" onclick="setDayForAll('\${d}','dive',false);setDayForAll('\${d}','third',false);setDayForAll('\${d}','night',false)">clear</button>
              </td>\`).join('')}
            </tr></tfoot>\` : ''}
          </table>
        </div>
        <p style="font-size:13px;color:var(--muted);font-weight:600;margin-top:10px;">
          D = boat dive, 3 = third dive, N = night dive. \${frozen ? 'Read-only while the guest holds the link.' : 'Nothing here reaches the engine until you press the button at the bottom of the screen.'}
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
      markTripDirty();
    }

    function setGuestRoom(guestId, roomId) {
      const guest = state.bffTrip.guests.find((g) => g.id === guestId);
      if (guest) guest.roomId = roomId || null;
      renderTripReview();
      markTripDirty();
    }

    function setGuestCourse(guestId, course) {
      const guest = state.bffTrip.guests.find((g) => g.id === guestId);
      if (guest) guest.courses = course ? [course] : [];
      renderTripReview();
      markTripDirty();
    }

    function setGuestDay(guestId, date, kind, on) {
      const guest = state.bffTrip.guests.find((g) => g.id === guestId);
      if (!guest) return;
      guest.days = guest.days || {};
      const day = Object.assign({ dive: false, third: false, night: false, boatId: null }, guest.days[date] || {});
      day[kind] = Boolean(on);
      guest.days[date] = day;
      renderTripReview();
      markTripDirty();
    }

    /** A whole day at once, for a group where everyone dives the same schedule. */
    function setDayForAll(date, kind, on) {
      state.bffTrip.guests.forEach(function (guest) {
        guest.days = guest.days || {};
        const day = Object.assign({ dive: false, third: false, night: false, boatId: null }, guest.days[date] || {});
        day[kind] = Boolean(on);
        guest.days[date] = day;
      });
      renderTripReview();
      markTripDirty();
    }

    /**
     * Add a room. The id has to be unique and has to keep the rN shape, because the engine refers
     * to rooms by id: a duplicate id would silently move a guest into the wrong room, and an id the
     * contract does not accept is a 422 from their fillTrip.
     */
    function addRoom() {
      const rooms = state.bffTrip.rooms;
      let n = rooms.length + 1;
      const taken = {};
      rooms.forEach(function (r) { taken[r.id] = true; });
      while (taken['r' + n]) n += 1;
      rooms.push({ id: 'r' + n, type: 'standard', name: null });
      renderTripReview();
      markTripDirty();
    }

    /**
     * Remove a room — refused while somebody is still in it.
     *
     * The alternative (unassign the guests and let staff notice later) produces a trip the engine
     * rejects, which reads as "the engine is broken" rather than "move these two people first". One
     * clear sentence is better than a silent half-edit.
     */
    function removeRoom(index) {
      const rooms = state.bffTrip.rooms;
      if (rooms.length <= 1) {
        showError('Trip review', { reason: 'room_in_use', detail: 'A booking needs at least one room. Change its type instead of removing it.' });
        return;
      }
      const room = rooms[index];
      const occupants = state.bffTrip.guests.filter(function (g) { return g.roomId === room.id; });
      if (occupants.length > 0) {
        showError('Trip review', {
          reason: 'room_in_use',
          detail: 'Move ' + occupants.map(function (g) { return g.name; }).join(', ') + ' out of room ' + room.id + ' first, then remove it.'
        });
        return;
      }
      rooms.splice(index, 1);
      renderTripReview();
      markTripDirty();
    }


    /** Copy the guest's link. Only present once the quotation is published. */
    function copyQuoteLink() {
      const input = document.getElementById('input-quotation-url');
      if (!input || !input.value) return;
      navigator.clipboard.writeText(input.value);
      showInfo('Guest link copied.');
    }

    /**
     * The status, and the four steps — both read from 'state', both re-drawn after any action.
     *
     * One status for the whole page (see the note above 'statusLabel' on the server side): what
     * changed here is only how the same record is described once the page has acted on it.
     */
    function renderStatus() {
      const badge = document.getElementById('quote-status-badge');
      const published = Boolean(state.estimator && state.estimator.sharedAt && state.estimator.guestUrl);
      const approved = state.status === 'confirmed_by_hono';
      const archived = state.status === 'cancelled';
      const priced = Boolean(state.pricing);
      if (badge) {
        badge.className = 'status-pill ' + (
          archived ? 'status-rose' : (published || approved) ? 'status-emerald' : 'status-amber'
        );
        badge.textContent = archived
          ? 'Archived'
          : state.status !== 'confirmed_by_hono' && published
            ? 'Published — needs approval'
            : published
              ? 'Sent to guest'
              : approved
                ? 'Approved — not sent yet'
                : priced
                  ? 'Priced — needs approval'
                  : 'Needs review';
      }

      const steps = [
        { label: 'Review trip', state: state.bffTrip ? 'done' : 'current' },
        { label: 'Get price', state: priced ? 'done' : (state.bffTrip ? 'current' : 'todo') },
        { label: 'Approve', state: (approved || published) ? 'done' : (priced ? 'current' : 'todo') },
        { label: 'Send', state: published ? 'done' : (approved ? 'current' : 'todo') }
      ];
      // The bar itself is NOT re-drawn here: it is server-rendered as buttons that can be clicked to
      // jump to a step, and rewriting its markup would take those with it. updateWizard moves its
      // classes and its disabled state instead.
      void steps;

      const sendBtn = document.getElementById('btn-send-guest');
      if (sendBtn) {
        sendBtn.disabled = !approved;
        sendBtn.style.opacity = approved ? '1' : '0.5';
        sendBtn.style.cursor = approved ? 'pointer' : 'not-allowed';
        sendBtn.textContent = published ? 'Send the message again' : 'Create link & send';
      }
      const approveBtn = document.getElementById('btn-confirm-hono');
      if (approveBtn && approved) approveBtn.textContent = 'Approved';
      updateSendControls();
      updateWizard();
    }

    /**
     * The sample-price acknowledgement, applied to every action that publishes.
     *
     * Both buttons that create the guest's link live in one card beside this checkbox, and until it
     * is ticked they are disabled with the reason on screen. The first version ticked it in one card
     * while a second publish button sat in "More actions" without it, so that button answered "Tick
     * the sample-price box before sending" — true, unhelpful, and about a box the person had not
     * seen.
     */
    function updateSendControls() {
      const ack = document.getElementById('ack-sample');
      const needsAck = Boolean(ack) && !ack.checked;
      const hint = document.getElementById('send-hint');
      for (const id of ['btn-send-guest', 'btn-publish-quote']) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        if (needsAck) {
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
        } else {
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
          // The send button is ALSO gated on approval; read that from the record rather than calling
          // renderStatus, which calls this function.
          btn.disabled = id === 'btn-send-guest' ? state.status !== 'confirmed_by_hono' : false;
        }
      }
      if (hint) {
        // Double-quoted, because the sentence contains apostrophes: inside this page's template
        // literal an escaped quote is consumed by the OUTER string and leaves the page's own JS
        // unbalanced.
        hint.textContent = needsAck
          ? 'Tick "I have checked this sample price" to create the guest link. These are sample prices, not a real quote.'
          : "The message carries the guest's own quotation link and no price of ours: the figures they read are the engine's, on their page.";
        hint.style.color = needsAck ? 'var(--accent)' : 'var(--muted)';
      }
    }

    /**
     * Unsaved trip corrections. Editing a room type or a dive day changes what the ENGINE would be
     * asked to price, so the price on screen is no longer this trip's — the page says so until the
     * trip is saved. Without it, a receptionist edits a room type, reads the old total as the new
     * one, and approves; that is the bug this page exists to prevent.
     */
    let tripDirty = false;

    function markTripDirty() {
      tripDirty = true;
      renderStatus();
      const btn = document.getElementById('btn-save-all');
      if (btn) btn.textContent = 'Save & get price';
      const hint = document.getElementById('save-hint');
      if (hint) {
        hint.textContent = 'Unsaved changes. The price below still belongs to the previous trip.';
        hint.style.color = 'var(--accent)';
      }
    }

    /** The contact fields, and only those: the trip has its own route, the one that prices it. */
    function gatherDetails() {
      return {
        guestName: (document.getElementById('meta-guestName').value || '').trim() || state.guestName,
        checkIn: (document.getElementById('meta-checkIn').value || '').trim() || state.checkIn,
        checkOut: (document.getElementById('meta-checkOut').value || '').trim() || state.checkOut,
        staffNotes: (document.getElementById('input-staff-notes').value || '').trim(),
        phone: (document.getElementById('whatsapp-phone-input').value || '').trim()
      };
    }

    /**
     * THE save. One button for the whole review step, in the order the data needs.
     *
     * 1. The guest's details go to the record (PUT). That route only accepts contact fields — it
     *    will not take a trip, a price or an approval, because those arrive through the routes that
     *    produce them (see EDITABLE_FIELDS in app.ts).
     * 2. The trip goes to the trip route, which re-prices it, or to sync-estimate when the engine has no
     *    scenario for this quotation yet. Both end with the price describing the trip on screen.
     *
     * It steps over the trip when nothing about the trip changed and a price already exists: the
     * figure the guest reads should not move because somebody fixed a spelling.
     */
    async function saveStudio() {
      const btn = document.getElementById('btn-save-all');
      const hint = document.getElementById('save-hint');
      clearNotice();
      if (btn) btn.disabled = true;
      try {
        const details = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '?token=' + encodeURIComponent(staffToken()), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(gatherDetails())
        });
        const detailsData = await details.json();
        if (!detailsData.quotation) {
          showError('Could not save', detailsData);
          return;
        }
        state = detailsData.quotation;

        const published = Boolean(state.estimator && state.estimator.sharedAt);
        const needsPrice = tripDirty || !state.pricing;
        if (published || !needsPrice) {
          // Nothing about the trip is pending: a published quotation must not change its trip at
          // all, and an unchanged unpriced one has nothing new to send.
          showInfo(published
            ? 'Saved. This quotation is published, so its trip and price are frozen — start a new quotation for a different trip.'
            : 'Saved.');
          rememberStep(published ? 4 : 2);
          window.location.reload();
          return;
        }

        const hasScenario = Boolean(state.estimator && state.estimator.id);
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + (hasScenario ? '/trip' : '/sync-estimate') + '?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: hasScenario ? JSON.stringify({ trip: state.bffTrip }) : undefined
        });
        const data = await res.json();
        if (!data.ok) {
          // The details ARE saved at this point, and the page says which half failed.
          showError('Saved the guest details, but not the trip', data);
          return;
        }
        const issues = Array.isArray(data.issues) ? data.issues : [];
        showInfo('Saved and priced'
          + (data.sample ? ' — sample prices, not a real quote.' : '.')
          + (issues.length ? ' ' + issues.length + ' note(s) from the engine.' : '')
          + ' Reloading…');
        rememberStep(2);
        window.location.reload();
      } catch (err) {
        showError('Could not save', { detail: err && err.message ? err.message : String(err) });
      } finally {
        if (btn) btn.disabled = false;
        if (hint) hint.style.color = 'var(--muted)';
      }
    }

    function copyQuoteLink() {
      const input = document.getElementById('input-quotation-url');
      if (!input || !input.value) return;
      navigator.clipboard.writeText(input.value);
      showInfo('Guest link copied.');
    }

    async function cancelQuotationAction() {
      if (!confirm('Archive quotation ' + state.quoteId + '? It leaves the working queue; the record and any published link stay readable.')) {
        return;
      }
      const btn = document.getElementById('btn-cancel-quote');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/cancel?token=' + encodeURIComponent(staffToken()), {
          method: 'POST'
        });
        const data = await res.json();
        if (data.ok) {
          window.location.reload();
          return;
        }
        showError('Could not archive', data);
      } catch (err) {
        showError('Could not archive', { detail: err && err.message ? err.message : String(err) });
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function confirmAndSendToAI() {
      const btn = document.getElementById('btn-confirm-hono');
      const replyBox = document.getElementById('ai-confirmed-reply-box');
      clearNotice();
      if (btn) btn.disabled = true;
      const payload = gatherDetails();
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/confirm?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.quotation) {
          // A refusal leaves the quotation exactly as it was, so the page keeps showing the truth.
          showError('Could not approve', data);
          return;
        }
        state = data.quotation;
        renderStatus();
        renderSidebar();
        if (replyBox) {
          replyBox.style.color = 'var(--text)';
          replyBox.style.fontStyle = 'normal';
          replyBox.textContent = data.aiReply || state.aiConfirmedReply || '';
        }
        showInfo('Approved. The guest link is created when you send.');
      } catch (err) {
        showError('Could not approve', { detail: err && err.message ? err.message : String(err) });
      } finally {
        if (btn) btn.disabled = false;
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

    /**
     * One action for "the guest should get this": create the link if it does not exist, then send.
     *
     * These were two buttons (Publish Link, then Send WhatsApp) with a rule between them that the
     * page did not explain: the message carries the link, so sending before publishing is refused.
     * A receptionist had to know the order. Now the order is the button's job.
     */
    async function sendToGuest() {
      const phone = document.getElementById('whatsapp-phone-input').value.trim();
      const toast = document.getElementById('wa-toast');
      const sendBtn = document.getElementById('btn-send-guest');
      clearNotice();
      if (!state.estimator || !state.estimator.sharedAt) {
        const published = await publishQuote();
        if (!published) return; // publishQuote() has already said why
      }
      if (sendBtn) sendBtn.disabled = true;
      if (toast) toast.textContent = 'Sending…';
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/send-whatsapp?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (!data.ok) {
          showError('Could not send to the guest', data);
          if (toast) toast.textContent = '';
          return;
        }
        if (toast) toast.textContent = 'Sent to ' + phone;
        showInfo('Sent to ' + phone + '. The message carries the guest link and no price of ours.');
      } catch (err) {
        showError('Could not send to the guest', { detail: err && err.message ? err.message : String(err) });
        if (toast) toast.textContent = '';
      } finally {
        if (sendBtn) sendBtn.disabled = false;
      }
    }

    async function pushConfirmedQuoteToWhatsApp() {
      // Kept as the name that used to be on the button, so an old bookmarklet or a copied snippet
      // that calls it still does the right thing. The button itself now calls sendToGuest().
      return sendToGuest();
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
          badge.textContent = 'Not configured — no prices available';
          badge.style.color = 'var(--muted)';
        } else if (!data.reachable) {
          badge.textContent = 'Not answering';
          badge.style.color = 'var(--accent)';
        } else if (data.mode === 'fixture') {
          badge.textContent = data.kind === 'simulated'
            ? 'Sample engine (built in) — not a real quote'
            : 'Sample engine (captured prices) — not a real quote';
          badge.style.color = 'var(--accent)';
        } else {
          badge.textContent = 'Connected — live prices';
          badge.style.color = 'var(--emerald)';
        }
      } catch (err) {
        badge.textContent = 'Status unknown';
        badge.style.color = 'var(--muted)';
      }
    }

    async function syncEstimate() {
      const btn = document.getElementById('btn-sync-estimate');
      if (!btn) return; // a guest session has no pricing bar
      clearNotice();
      btn.disabled = true;
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/sync-estimate?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' }
        });
        const data = await res.json();
        if (!data.ok) {
          showError('Could not get a price', data);
          return;
        }
        const issues = Array.isArray(data.issues) ? data.issues : [];
        showInfo('Priced by the booking engine'
          + (data.sample ? ' — sample data, not a real quote.' : '.')
          + (issues.length ? ' ' + issues.length + ' note(s) from the engine.' : '')
          + ' Reloading…');
        window.location.reload();
      } catch (err) {
        showError('Could not get a price', { detail: err && err.message ? err.message : String(err) });
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
        pending: 'Sending — do not press again',
        confirmed: 'Booking created',
        failed: 'Not accepted — you may try again',
        unknown: 'Not confirmed — check with the resort before trying again'
      };
      badge.textContent = LABELS[s.state] || s.state;
      // Only a refusal is retryable. "pending" is in flight; "confirmed" and "unknown" must not
      // be re-sent, because a second send is a second folio.
      btn.disabled = s.state !== 'failed';
    }

    async function submitReservation() {
      const btn = document.getElementById('btn-submit-reservation');
      if (!btn) return; // a guest session has no reservation bar
      clearNotice();
      // Contact details are asked for rather than assumed: they are what the front desk confirms
      // to, and quietly booking under the studio's own account is how a guest never hears back.
      const name = window.prompt('Name for the reservation:', state.guestName || '');
      if (!name) return;
      const email = window.prompt('Email the front desk should confirm to:', '');
      if (!email) return;
      const phone = window.prompt('Phone (optional):', state.phone || '') || '';
      btn.disabled = true;
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/submit?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name, email: email, phone: phone || undefined })
        });
        const data = await res.json();
        if (data.submission) state.submission = data.submission;
        if (!data.ok) {
          showError('Could not create the booking', data);
          return;
        }
        const s = data.submission || {};
        showInfo('Booking created'
          + (s.sample ? ' — sample data, no folio was created.' : '.')
          + (s.folioId ? ' Folio #' + s.folioId : ''));
      } catch (err) {
        showError('Could not create the booking', { detail: err && err.message ? err.message : String(err) });
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
        badge.textContent = 'Link created';
        btn.disabled = true;
      } else {
        badge.textContent = '';
        btn.disabled = false;
      }
    }

    /** Create the guest link. Returns true when there is a link afterwards. */
    async function publishQuote() {
      const btn = document.getElementById('btn-publish-quote');
      clearNotice();
      const ack = document.getElementById('ack-sample');
      // The acknowledgement is a deliberate act, not a speed bump: these are captured prices, and a
      // guest who receives one has been quoted a number nobody has agreed to.
      if (ack && !ack.checked) {
        showError('Could not create the guest link', {
          reason: 'sample_not_acknowledged',
          detail: 'These are sample prices. Tick "I have checked this sample price" in the Send section, then try again.'
        });
        return false;
      }
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/v1/quotes/' + encodeURIComponent(state.quoteId) + '/publish?token=' + encodeURIComponent(staffToken()), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ acknowledgeSample: !!(ack && ack.checked) })
        });
        const data = await res.json();
        if (data.quotation) state = data.quotation;
        renderStatus();
        if (!data.ok) {
          showError('Could not create the guest link', data);
          return false;
        }
        showInfo('Guest link created (version ' + data.seq + ').'
          + (data.guestUrl ? '' : ' Their app is not hosted anywhere we can link to — set ESTIMATOR_BASE_URL.'));
        return true;
      } catch (err) {
        showError('Could not create the guest link', { detail: err && err.message ? err.message : String(err) });
        return false;
      } finally {
        renderPublishStatus();
      }
    }

    renderSidebar();
    renderTripReview();
    // Which screen to open on: the step remembered before a reload (see rememberStep), clamped to
    // what the record has actually earned. A remembered step 4 on a quotation that was never
    // approved would otherwise be a screen with nothing to send from.
    (function openRememberedStep() {
      let remembered = 0;
      try { remembered = Number(sessionStorage.getItem(STEP_KEY) || 0); } catch (err) {}
      const main = document.querySelector('main');
      const serverStep = Number((main && main.getAttribute('data-step')) || 1);
      if (remembered > serverStep) goStep(remembered);
      else if (remembered > 0 && remembered < serverStep) goStep(remembered);
      else updateWizard();
    })();
    renderStatus();
  </script>
</body>
</html>`;
}
