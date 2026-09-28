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
import { escapeHtml } from "./html.js";
import { themeCss } from "./theme.js";

const esc = escapeHtml;

function money(currency: string, amount: number): string {
  const symbol = currency === "USD" ? "$" : "₱";
  return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * The guest's page: their stay, the engine's lines, and the total.
 *
 * `replyUrl` is where the "reply on WhatsApp" button goes. It is passed in rather than built here so
 * the page cannot invent a number: the caller knows which WhatsApp the guest already reached us on.
 */
export function renderGuestQuotationCopyHtml(
  draft: HonoQuotationDraft,
  options: { replyUrl: string },
): string {
  const pricing = draft.pricing ?? null;
  const currency = draft.currency;
  const version = draft.estimator?.seq ?? null;

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

  const total = pricing?.kpis.revenue;
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
    .total { font-size: 34px; font-weight: 800; margin: 14px 0 2px; }
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
    @media (max-width: 480px) {
      /* A guest opens this on a phone, from a WhatsApp message. */
      body { padding: 14px 12px 32px; }
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
      ${total != null ? `<div class="total">${money(currency, total)}</div><div class="sub">Total, from the resort's booking engine</div>` : ""}
      ${guestCards}
      ${
        warnings.length > 0
          ? `<div class="note"><strong>Still to sort out</strong><br>${warnings.map((w) => esc(String(w))).join("<br>")}</div>`
          : ""
      }
      <div class="actions">
        <a class="btn btn-primary" href="${esc(options.replyUrl)}" target="_blank" rel="noopener">Reply on WhatsApp</a>
      </div>
      <div class="note">
        This is the quotation the resort sent you, kept here so the link always opens. Your booking is taken by
        the reservations team — nothing is booked yet, and this page does not book anything. If anything here
        looks wrong, reply on WhatsApp and a member of the team will fix it.
      </div>
    </div>
  </div>
</body>
</html>`;
}
