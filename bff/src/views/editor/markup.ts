/**
 * The staff editor's markup: the page head and the body. Server-rendered from the model alone, so a quotation
 * that is already approved reads as approved before any script runs.
 */
import { escapeHtml, wholeMoney } from "../html.ts";
import type { EditorModel } from "./model.ts";

export function renderHead(m: EditorModel): string {
  const { draft } = m;
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Staff Quotation Review (${draft.quoteId}) — Casa Escondida Anilao</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">`;
}

export function renderBody(m: EditorModel): string {
  const { draft, role, estimatorKind, guestLink, published, priced, approved, archived, statusLabel, statusTone, followUp, isStale, isDueForNudge, window, followUpText, steps, maxStep, initialStep, nextLabel } = m;

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

  // ---- The engine's own answer, drawn -------------------------------------
  // Everything below is read from `draft.pricing`, which is the pricing engine's response as it was
  // when the quotation was priced. Nothing here is recomputed: a per-guest card that disagrees with
  // the total above it would be worse than no card at all.
  const pricing = draft.pricing ?? null;
  const money = (n: number) => wholeMoney(draft.currency, n);
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

  return `<body data-role="${role}">
  <div style="background:var(--accent-soft);border-bottom:1px solid var(--border);color:var(--text);font-size:13.5px;padding:8px 20px;text-align:center;font-weight:600;">
    Casa Escondida Anilao · Staff Operations Desk
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
    </div>
  </header>

  <div class="container">
    <!-- Sidebar: the quotations a staff member is reviewing -->
    <aside>
      <div class="card">
        <div class="card-title">
          <span>All Quotations</span>
          <span id="queue-count-badge" style="font-size:12px;font-weight:800;background:var(--accent-soft);color:var(--accent);padding:2px 8px;border-radius:999px;"></span>
        </div>
        <input type="text" id="quote-search-input" oninput="filterQuotesList(this.value)" placeholder="Search name, quote ID or date…" class="cell-input" style="margin-bottom:10px;font-size:13.5px;padding:9px 12px;" />
        <div class="tab-row" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">
          <button type="button" class="tab-btn" id="tab-action-needed" onclick="setQuoteFilter('action-needed')">Action Needed</button>
          <button type="button" class="tab-btn" id="tab-waiting" onclick="setQuoteFilter('waiting')">Waiting</button>
          <button type="button" class="tab-btn" id="tab-all" onclick="setQuoteFilter('all')">All</button>
          <button type="button" class="tab-btn" id="tab-cancelled" onclick="setQuoteFilter('cancelled')">Archived</button>
        </div>
        <!-- Sort is always in reach; the three filters fold away, but open themselves whenever one is on,
             so a hidden filter can never be the silent reason a quotation is missing from the list. -->
        <div class="queue-tools">
          <label class="queue-sort"><span>Sort</span>
            <select id="queue-sort" aria-label="Sort quotations" onchange="setQueueView('sort', this.value)">
              <option value="latest">Latest first</option>
              <option value="oldest">Oldest first</option>
              <option value="checkin">Check-in date</option>
              <option value="name">Name A–Z</option>
              <option value="total">Highest total</option>
            </select>
          </label>
          <button type="button" id="queue-filter-toggle" class="btn btn-outline queue-filter-btn" aria-expanded="false" aria-controls="queue-filters" onclick="toggleQueueFilters()">Filters<span id="queue-filter-count"></span></button>
        </div>
        <div id="queue-filters" class="queue-filters" hidden>
          <label>Sent
            <select id="qf-sent" onchange="setQueueView('sent', this.value)">
              <option value="any">Any time</option>
              <option value="unsent">Not sent yet</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
            </select>
          </label>
          <label>Check-in
            <select id="qf-checkin" onchange="setQueueView('checkin', this.value)">
              <option value="any">Any date</option>
              <option value="next7">Next 7 days</option>
              <option value="next30">Next 30 days</option>
              <option value="past">Already past</option>
            </select>
          </label>
          <label>Price
            <select id="qf-price" onchange="setQueueView('price', this.value)">
              <option value="any">Any</option>
              <option value="priced">Priced</option>
              <option value="unpriced">Not priced yet</option>
            </select>
          </label>
          <button type="button" id="queue-clear" class="queue-clear" onclick="clearQueueFilters()">Clear filters</button>
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
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="font-size:15px;font-weight:800;">This quotation</div>
            <span id="quote-status-badge" class="status-pill status-${statusTone}">${statusLabel}</span>
            ${
              isStale
                ? `<span class="status-pill status-amber" title="Sent over ${window.staleHours} hours ago, with no reservation made" style="font-size:12.5px;padding:4px 10px;">⚠️ Stale (&gt;${window.staleHours}h)</span>`
                : isDueForNudge
                  ? `<span class="status-pill status-amber" title="Sent over ${window.nudgeHours} hours ago and no answer yet — a gentle chase is due" style="font-size:12.5px;padding:4px 10px;">⏳ Follow up (&gt;${window.nudgeHours}h)</span>`
                  : ""
            }
          </div>
          <a class="btn btn-outline staff-only" id="workflow-ops-sheet-btn" href="/quotes/${encodeURIComponent(draft.quoteId)}/ops" target="_blank" style="padding:6px 14px;font-size:13px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">Ops Sheet &nearr;</a>
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

        ${draft.specialRequests || draft.dietNotes || draft.transferDirection ? `
        <div style="margin-top:18px;padding:14px 16px;background:var(--surface-2);border:2px solid var(--border);border-radius:12px;font-size:14px;font-weight:600;">
          <div style="font-size:13px;font-weight:800;color:var(--muted);margin-bottom:6px;">From the guest — for the desk, not sent to the engine</div>
          ${draft.specialRequests ? `<div>Special requests: ${esc(draft.specialRequests)}</div>` : ''}
          ${draft.dietNotes ? `<div>Diet / allergies: ${esc(draft.dietNotes)}</div>` : ''}
          ${draft.transferDirection ? `<div>Transfer: ${draft.transferDirection === 'arrival' ? 'arrival only' : 'departure only'}</div>` : ''}
        </div>` : ''}

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
            <span id="estimator-status-badge" style="font-size:13.5px;font-weight:700;color:var(--muted);">Checking the booking engine…</span>
            <span style="font-size:13px;color:var(--muted);font-weight:600;">The button at the bottom of the screen asks the engine${priced ? " again" : ""}.</span>
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

        <!-- Approving is the bar's button: the screen in front of the person holds no second copy of
             the same decision, which is what the first version of this wizard got wrong. -->
        <div style="display:flex;justify-content:flex-start;align-items:center;flex-wrap:wrap;gap:14px;">
          <button class="btn btn-outline" onclick="cancelQuotationAction()" id="btn-cancel-quote" style="color:var(--rose, #f43f5e);border-color:var(--rose, #f43f5e);">Archive quotation</button>
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
          <input type="text" id="input-quotation-url" value="${esc(guestLink ?? "")}" placeholder="No link yet — it appears here when you send" readonly title="The guest's quotation link" />
          <button class="btn btn-outline" onclick="copyQuoteLink()" ${published ? "" : "disabled"}>Copy link</button>
          <a class="btn btn-outline" id="btn-open-public-quote" href="${esc(guestLink ?? "#")}" target="_blank" rel="noopener" style="${published ? "" : "display:none;"}">Open guest page &rarr;</a>
        </div>

        ${
          // When their app could not hold the link it issued, the guest is sent OUR copy of the same
          // frozen revision. Staff are told, because "why is the link not on the team estimator's domain"
          // is a fair question to be asked in a demo — and because it is their deployment's fault,
          // not this quotation's.
          draft.estimator?.mirrorUrl
            ? `<div style="margin-top:12px;padding:12px 14px;border-radius:10px;background:var(--amber-soft);border-left:5px solid var(--amber);font-size:13px;font-weight:600;">
          <strong>The guest's link is a copy on our own page.</strong> ${esc(draft.estimator.mirrorReason ?? "")}
          <br><span style="color:var(--muted);">Their app's link: ${esc(draft.estimator.guestUrl ?? "(none)")}</span>
        </div>`
            : ""
        }

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
          <button class="btn btn-outline" onclick="publishQuote()" id="btn-publish-quote">Create link only</button>
          <span id="publish-status-badge" style="font-size:13px;font-weight:700;color:var(--muted);"></span>
          <span id="wa-toast" style="font-size:14px;font-weight:700;color:var(--accent);"></span>
        </div>
        <p id="send-hint" style="font-size:13px;color:var(--muted);font-weight:600;margin-top:10px;">
          The message carries the guest's own quotation link and no price of ours: the figures they read are the engine's, on their page.
          ${published ? "" : "The button at the bottom of the screen creates the link and sends it."}
        </p>

        ${
          // Only once the guest actually has the quotation. Chasing somebody about a link they were
          // never sent is how a helpful follow-up reads as a mistake, and the box also stated a
          // scarcity nobody has checked: "rooms are filling up quickly" is not something this system
          // knows (availability lives in the team Odoo, and we never ask). What it says instead
          // is what is true: the quotation's own deadline and the link
          // to look at. Whether the resort holds a room, and whether rooms are first-come, are
          // questions for Phillip — see `quotationValidityLines`.
          followUp === "none"
            ? ""
            : `<div style="margin-top:20px;padding:16px 18px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px;">
            <div style="font-size:14px;font-weight:800;color:var(--text);">
              ${isStale ? `⚠️ Past its validity (${window.staleHours}h) — chase or release` : `⏳ Follow-up due (${window.nudgeHours}h, still valid)`}
            </div>
            <button type="button" class="btn btn-outline" onclick="copyFollowupMessage()" style="padding:6px 12px;font-size:12.5px;font-weight:700;">Copy follow-up message</button>
          </div>
          <div id="followup-preview" style="font-size:13px;color:var(--muted);line-height:1.55;white-space:pre-line;">${esc(followUpText)}</div>
        </div>`
        }
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
          ${nextLabel}
        </button>
      </div>
    </main>
  </div>
`;
}
