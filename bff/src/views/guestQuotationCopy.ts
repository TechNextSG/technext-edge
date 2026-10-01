/**
 * The copy of a guest's quotation, on our own host.
 *
 * ## Why this exists
 *
 * The guest's link is minted by the team estimator at Publish, and that is by design: their app owns
 * the frozen revision and the folio a guest confirms. But their demo deployment keeps scenarios and
 * share tokens in the memory of ONE serverless instance — measured 2026-09-28, with a real phone:
 * a link that our publish had just verified answered 404 twelve times in a row a minute later, and
 * `GET /api/estimates/<id>` (with its own cookie) answered 404 too. Their real deployment, on a
 * database with Odoo behind it, does not have this problem; their demo does.
 *
 * When that happens, the guest is holding a WhatsApp message whose link is dead. So `publish` now
 * falls back to a **copy of the same frozen revision** on this host, and the message carries that
 * copy instead. It is a fallback, never the primary: `estimator.mirrorUrl` is set only after the
 * the team estimator's own link failed a check, and it is cleared the moment a working link exists.
 *
 * ## What makes this different from the page that was retired (and must stay different)
 *
 * That page computed a price from a table copied by hand, for anyone holding the slug, with no staff
 * approval anywhere in the path. This one:
 *
 *   1. renders `draft.pricing` — the ENGINE's own answer, stored on the record. No arithmetic of
 *      ours, no line built here, no rounding: if a number is on this page, the engine said it.
 *   2. exists only for a quotation staff have **approved and published** (`/q/:slug` forwards to the
 *      the team estimator's link unless `mirrorUrl` is set, and `publish` only sets it for a published record).
 *   3. carries no booking action. Their app owns the folio, so this page says plainly that nothing is
 *      booked here and offers the WhatsApp reply that the guest already has.
 *   4. shows nothing staff-facing: no phone number, no internal notes, no cost, no other guest.
 */
import type { HonoQuotationDraft } from "../quote/index.ts";
import { quotationValidityLines, quotationValidUntil } from "../quote/index.ts";
import { escapeHtml, money } from "./html.ts";
import { themeCss } from "./theme.ts";

const esc = escapeHtml;

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

  const total = pricing?.kpis.revenue ?? null;

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
        // No "hold", no countdown, no claim about inventory.
        //
        // There was a "Provisional 72-Hour Hold Active" box here with a live countdown, and an
        // "Expired" state under it. It is a false statement about the guest's booking: nothing in this
        // service holds a room, rooms live in the team Odoo and are allocated by the front desk.
        // `quotationValidityLines` states the quotation's own deadline instead, which is ours to promise.
        ""
      }

      ${
        total != null
          ? `<div style="display:flex;justify-content:flex-end;align-items:flex-end;margin-top:16px;">
        <div style="text-align:right;">
          <div class="total" id="guest-total-val">${money(currency, total)}</div>
          <div class="sub">Total, from the resort's booking engine</div>
        </div>
      </div>
      <!-- No payment guidance of ours: the team estimator takes no payment here and states no deposit; the front desk
           confirms availability and contacts the guest (the note at the foot of the page). -->`
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
      <div style="margin-top:18px;border-left:5px solid var(--accent);background:var(--surface-2);padding:16px 18px;border-radius:14px;font-size:13.5px;color:var(--text);line-height:1.65;font-weight:600;">
        The front desk will confirm availability and contact you.
        ${quotationValidityLines(validUntil)
          .map((line) => `<br>${esc(line)}`)
          .join("")}
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
    /* This page ships no script: it draws the engine's answer and nothing else. */
  </script>
</body>
</html>`;
}
