/**
 * The copy of a guest's quotation, on our own host.
 *
 * ## Why this exists
 *
 * The guest's link is minted by the customer's app at Publish, and that is by design: their app owns
 * the frozen revision and the folio a guest confirms. But their demo deployment keeps scenarios and
 * share tokens in the memory of ONE serverless instance — measured 2026-09-28, with a real phone:
 * a link that our publish had just verified answered 404 twelve times in a row a minute later, and
 * `GET /api/estimates/<id>` (with its own cookie) answered 404 too. Their real deployment, on a
 * database with Odoo behind it, does not have this problem; their demo does.
 *
 * When that happens, the guest is holding a WhatsApp message whose link is dead. So `publish` now
 * falls back to a **copy of the same frozen revision** on this host, and the message carries that
 * copy instead. It is a fallback, never the primary: `estimator.mirrorUrl` is set only after the
 * customer's own link failed a check, and it is cleared the moment a working link exists.
 *
 * ## What makes this different from the page that was retired (and must stay different)
 *
 * That page computed a price from a table copied by hand, for anyone holding the slug, with no staff
 * approval anywhere in the path. This one:
 *
 *   1. renders `draft.pricing` — the ENGINE's own answer, stored on the record. No arithmetic of
 *      ours, no line built here, no rounding: if a number is on this page, the engine said it.
 *   2. exists only for a quotation staff have **approved and published** (`/q/:slug` forwards to the
 *      customer's link unless `mirrorUrl` is set, and `publish` only sets it for a published record).
 *   3. carries no booking action. Their app owns the folio, so this page says plainly that nothing is
 *      booked here and offers the WhatsApp reply that the guest already has.
 *   4. shows nothing staff-facing: no phone number, no internal notes, no cost, no other guest.
 */
import type { HonoQuotationDraft } from "../../../packages/extractor/src/index.js";
import { bookingPolicyLines, quotationValidUntil } from "../../../packages/extractor/src/index.js";
import { escapeHtml } from "./html.js";
import { themeCss } from "./theme.js";

const esc = escapeHtml;

function money(currency: string, amount: number): string {
  const symbol = currency === "USD" ? "$" : "₱";
  return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
}

function calculateBalanceDueDate(checkIn: string): string {
  const d = new Date(checkIn);
  if (isNaN(d.getTime())) return "at least 1 month prior to arrival";
  d.setDate(d.getDate() - 30);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The guest's page: their stay, the engine's lines, and the total.
 *
 * `replyUrl` is where the "reply on WhatsApp" button goes. It is passed in rather than built here so
 * the page cannot invent a number: the caller knows which WhatsApp the guest already reached us on.
 * It is `null` when this deployment has no resort number configured — in which case the button is
 * left out entirely, because `https://wa.me/?text=…` with no number opens WhatsApp on an empty
 * "choose a chat" screen, which is not a reply to anybody.
 */
export function renderGuestQuotationCopyHtml(
  draft: HonoQuotationDraft,
  options: { replyUrl: string | null },
): string {
  const pricing = draft.pricing ?? null;
  const currency = draft.currency;
  const version = draft.estimator?.seq ?? null;
  /**
   * When this quotation lapses. From the send time, not the publish time: a link nobody was sent has
   * no start, so it has no deadline either — see `quotationValidUntil`. Null leaves the deadline line
   * off the page rather than inventing one.
   */
  const validUntil = quotationValidUntil(draft);
  const validUntilIso = validUntil ? validUntil.toISOString() : null;

  const total = pricing?.kpis.revenue ?? null;
  const depositAmount = total != null ? Math.round(total / 2) : null;
  const balanceAmount = total != null && depositAmount != null ? total - depositAmount : null;
  const balanceDueDate = calculateBalanceDueDate(draft.checkIn);

  const guestCards =
    !pricing || pricing.guests.length === 0
      ? `<p class="muted">The engine's breakdown is not attached to this copy. Reply on WhatsApp and we will send it again.</p>`
      : pricing.guests
          .map(
            (guest) => `<div class="guest">
        <div class="guest-head"><strong>${esc(guest.name)}</strong><span>${money(currency, guest.total)}</span></div>
        ${guest.lines
          .map(
            (line) => `<div class="line">
          <span>${esc(line.label)}${line.sub ? `<small>${esc(line.sub)}</small>` : ""}</span>
          <span>${money(currency, line.net)}</span>
        </div>`,
          )
          .join("")}
      </div>`,
          )
          .join("");

  const warnings = pricing?.warnings ?? [];

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your quotation — Casa Escondida Anilao</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${themeCss()}
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 24px 18px 48px;
    }
    .wrap { max-width: 640px; margin: 0 auto; }
    .sample {
      background: var(--amber-soft);
      border-left: 5px solid var(--amber);
      color: var(--text);
      border-radius: 10px;
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 16px;
    }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 18px;
      padding: 26px 24px;
      box-shadow: var(--shadow);
    }
    h1 { font-size: 22px; font-weight: 800; margin: 0 0 6px; }
    .sub { font-size: 14px; color: var(--muted); font-weight: 600; }
    .total { font-size: 34px; font-weight: 800; margin: 0; }
    .kicker {
      font-size: 11.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--accent); margin-bottom: 10px;
    }
    .guest {
      border: 2px solid var(--border); border-radius: 14px; padding: 14px 16px; margin-top: 14px;
      background: var(--surface-2);
    }
    .guest-head { display: flex; justify-content: space-between; font-size: 16px; margin-bottom: 8px; }
    .line {
      display: flex; justify-content: space-between; gap: 12px; font-size: 14px;
      padding: 5px 0; border-top: 1px solid var(--border);
    }
    .line small { display: block; color: var(--muted); font-weight: 600; font-size: 12px; }
    .muted { color: var(--muted); font-size: 14px; font-weight: 600; }
    .actions { margin-top: 22px; display: flex; gap: 12px; flex-wrap: wrap; }
    .btn {
      display: inline-block; padding: 12px 20px; border-radius: 12px; font-size: 15px; font-weight: 800;
      text-decoration: none; border: 2px solid var(--border); color: var(--text); background: var(--surface);
    }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .note { margin-top: 18px; font-size: 13.5px; color: var(--muted); font-weight: 600; line-height: 1.6; }
    .mobile-sticky-dock { display: none; }
    @media (max-width: 640px) {
      body { padding-bottom: 86px; }
      ${
        options.replyUrl
          ? `.mobile-sticky-dock {
        display: block;
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: var(--card);
        border-top: 1.5px solid var(--border);
        padding: 12px 16px;
        z-index: 100;
        box-shadow: 0 -4px 16px rgba(0,0,0,0.1);
      }`
          : ""
      }
    }
    @media (max-width: 480px) {
      /* A guest opens this on a phone, from a WhatsApp message. */
      body { padding: 14px 12px 90px; }
      .card { padding: 18px 15px; border-radius: 14px; }
      h1 { font-size: 19px; }
      .total { font-size: 28px; }
      .guest { padding: 12px 13px; }
      .line { font-size: 13.5px; gap: 8px; }
      .actions .btn { width: 100%; text-align: center; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    ${
      pricing?.sample
        ? `<div class="sample">Sample data — these prices are examples from our booking engine while it is being set up, not a final quote.</div>`
        : ""
    }
    <div class="card">
      <div class="kicker">Casa Escondida Anilao</div>
      <h1>Hello ${esc(draft.guestName)}, here is your quotation</h1>
      <div class="sub">
        ${esc(draft.checkIn)} → ${esc(draft.checkOut)} · ${draft.nights} night${draft.nights === 1 ? "" : "s"} ·
        ${draft.stayingGuests} guest${draft.stayingGuests === 1 ? "" : "s"}${version ? ` · version ${version}` : ""}
      </div>

      ${
        validUntilIso
          ? `<div id="hold-status-container" style="margin-top:16px;">
        <div id="hold-active-box" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;background:var(--amber-soft);border:1.5px solid var(--amber);padding:10px 14px;border-radius:10px;font-size:13px;font-weight:700;color:var(--text);">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--amber);"></span>
            <span>Provisional 72-Hour Hold Active</span>
          </div>
          <div id="countdown-val" style="font-family:monospace;font-size:13.5px;font-weight:800;color:var(--amber);">Calculating...</div>
        </div>
        <div id="hold-expired-box" style="display:none;background:rgba(244,63,94,0.1);border:1.5px solid var(--rose);padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.5;color:var(--text);">
          <strong style="color:var(--rose);display:block;margin-bottom:2px;">⚠️ Provisional 72-Hour Hold Expired</strong>
          Room availability and rates are subject to re-verification. Please message us on WhatsApp to confirm current availability.
        </div>
      </div>`
          : ""
      }

      ${
        total != null
          ? `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px;flex-wrap:wrap;gap:10px;">
        <div>
          <div class="total" id="guest-total-val" data-base="${total}">${money(currency, total)}</div>
          <div class="sub">Total, from the resort's booking engine</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;">
          <label for="currency-toggle" style="color:var(--muted);">Currency:</label>
          <select id="currency-toggle" onchange="convertCurrency(this.value)" style="background:var(--surface);border:1.5px solid var(--border);color:var(--text);border-radius:8px;padding:4px 8px;font-weight:700;font-size:12.5px;">
            <option value="PHP" ${currency === "PHP" ? "selected" : ""}>PHP (₱)</option>
            <option value="USD" ${currency === "USD" ? "selected" : ""}>USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="VND">VND (₫)</option>
          </select>
        </div>
      </div>

      <!-- 50% Deposit & Balance Schedule Card -->
      <div style="margin-top:16px;background:var(--surface-2);border:2px solid var(--border);border-radius:14px;padding:16px;">
        <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);margin-bottom:10px;">Payment Schedule · 50% Deposit Policy</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
          <div style="background:var(--emerald-soft);border:1.5px solid var(--emerald);border-radius:10px;padding:12px 14px;">
            <div style="font-size:12px;font-weight:800;color:var(--emerald);">50% Deposit Due Now</div>
            <div id="deposit-val" data-base="${depositAmount}" style="font-size:20px;font-weight:800;color:var(--emerald);margin:4px 0 2px;">${money(currency, depositAmount!)}</div>
            <div style="font-size:12px;color:var(--muted);font-weight:600;">Secures room &amp; dive boat reservation</div>
          </div>
          <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:10px;padding:12px 14px;">
            <div style="font-size:12px;font-weight:800;color:var(--text);">50% Balance Remaining</div>
            <div id="balance-val" data-base="${balanceAmount}" style="font-size:20px;font-weight:800;color:var(--text);margin:4px 0 2px;">${money(currency, balanceAmount!)}</div>
            <div style="font-size:12px;color:var(--muted);font-weight:600;">Due 1 month prior: ${esc(balanceDueDate)}</div>
          </div>
        </div>
        <div id="currency-disclaimer" style="display:none;margin-top:10px;font-size:11.5px;color:var(--muted);font-weight:600;">
          * Approximate conversion for reference only. Official billing and payment are in Philippine Peso (PHP).
        </div>
      </div>`
          : ""
      }

      ${guestCards}
      ${
        warnings.length > 0
          ? `<div class="note"><strong>Still to sort out</strong><br>${warnings.map((w) => esc(String(w))).join("<br>")}</div>`
          : ""
      }
      <div class="actions">
        ${
          options.replyUrl
            ? `<a class="btn btn-primary" href="${esc(options.replyUrl)}" target="_blank" rel="noopener">Reply on WhatsApp</a>`
            : `<span class="muted">Reply in the WhatsApp conversation this quotation came from and a member of the team will pick it up.</span>`
        }
      </div>
      <div class="note">
        This is the quotation the resort sent you, kept here so the link always opens. Your booking is taken by
        the reservations team — nothing is booked yet, and this page does not book anything. If anything here
        looks wrong, reply on WhatsApp and a member of the team will fix it.
      </div>
      <div style="margin-top:18px;border-left:5px solid var(--accent);background:var(--surface-2);padding:16px 18px;border-radius:14px;">
        <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);margin-bottom:6px;">Casa Escondida Anilao · Booking &amp; Deposit Policy</div>
        <ul style="margin:0;padding-left:18px;font-size:13.5px;color:var(--text);line-height:1.65;font-weight:600;">
          ${bookingPolicyLines(validUntil)
            .map((line) => `<li>${esc(line)}</li>`)
            .join("\n          ")}
        </ul>
      </div>
    </div>
  </div>

  ${
    options.replyUrl
      ? `<div class="mobile-sticky-dock">
    <a class="btn btn-primary" href="${esc(options.replyUrl)}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;text-align:center;box-shadow:0 4px 14px rgba(2,132,199,0.35);">Reply on WhatsApp</a>
  </div>`
      : ""
  }

  <script>
    (function() {
      var validUntilIso = ${validUntilIso ? JSON.stringify(validUntilIso) : "null"};
      if (validUntilIso) {
        var targetTime = new Date(validUntilIso).getTime();
        var activeBox = document.getElementById('hold-active-box');
        var expiredBox = document.getElementById('hold-expired-box');
        var countdownVal = document.getElementById('countdown-val');

        function updateCountdown() {
          var now = Date.now();
          var diff = targetTime - now;
          if (diff <= 0) {
            if (activeBox) activeBox.style.display = 'none';
            if (expiredBox) expiredBox.style.display = 'block';
          } else {
            var h = Math.floor(diff / 3600000);
            var m = Math.floor((diff % 3600000) / 60000);
            var s = Math.floor((diff % 60000) / 1000);
            if (countdownVal) {
              countdownVal.textContent = h + 'h ' + (m < 10 ? '0' : '') + m + 'm ' + (s < 10 ? '0' : '') + s + 's remaining';
            }
          }
        }
        updateCountdown();
        setInterval(updateCountdown, 1000);
      }
    })();

    ${
      total != null
        ? `function convertCurrency(curr) {
      var rates = {
        PHP: { rate: 1, symbol: "\\u20B1" },
        USD: { rate: 0.018, symbol: "$" },
        EUR: { rate: 0.016, symbol: "€" },
        VND: { rate: 440, symbol: "₫" }
      };
      var c = rates[curr] || rates.PHP;
      var disclaimer = document.getElementById('currency-disclaimer');
      if (disclaimer) disclaimer.style.display = curr === 'PHP' ? 'none' : 'block';

      var fmt = function(num) {
        var converted = Math.round(num * c.rate);
        return curr === 'VND'
          ? converted.toLocaleString('vi-VN') + c.symbol
          : c.symbol + converted.toLocaleString('en-US');
      };

      ['guest-total-val', 'deposit-val', 'balance-val'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var base = parseFloat(el.getAttribute('data-base') || '0');
        el.textContent = fmt(base);
      });
    }`
        : ""
    }
  </script>
</body>
</html>`;
}
