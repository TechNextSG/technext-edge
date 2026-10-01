/** `/q/:slug` — the guest-facing quotation link, served without a credential. */
import type { Hono } from "hono";
import { themeCss } from "../../views/theme.ts";
import { renderGuestQuotationCopyHtml } from "../../views/guestQuotationCopy.ts";
import { getQuotationByIdOrSlug } from "../../store/quotationStore.ts";
import { resortWhatsAppNumber } from "../../channels/whatsapp/index.ts";
import type { QuotesRouteDeps } from "./shared.ts";

export function registerGuestPageRoutes(app: Hono, _deps: QuotesRouteDeps): void {
  app.get("/q/:slug", async (c) => {
    const slug = c.req.param("slug");
    const found = await getQuotationByIdOrSlug(slug);
    if (!found) return c.json({ error: "not_found" }, 404);

    const guestUrl = found.estimator?.guestUrl;
    if (found.estimator?.mirrorUrl && found.status !== "cancelled") {
      const resortNumber = resortWhatsAppNumber();
      return c.html(
        renderGuestQuotationCopyHtml(found, {
          replyUrl: resortNumber
            ? `https://wa.me/${resortNumber}?text=${encodeURIComponent(
                "Hello Casa Escondida, I am looking at my quotation and have a question.",
              )}`
            : null,
        }),
      );
    }
    if (found.status === "cancelled") {
      if (c.req.header("accept")?.includes("text/html")) {
        return c.html(
          `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotation Cancelled — Casa Escondida Anilao</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${themeCss()}
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
    }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 20px;
      padding: 44px 36px;
      max-width: 520px;
      width: 100%;
      box-shadow: var(--shadow);
      text-align: center;
    }
    .kicker {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #f43f5e;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 14px;
      color: var(--text);
    }
    p {
      font-size: 15.5px;
      line-height: 1.65;
      color: var(--muted);
      margin: 0 0 20px;
    }
    .footer {
      font-size: 13px;
      color: var(--muted);
      font-weight: 500;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">Casa Escondida Anilao</div>
    <h1>Quotation Cancelled</h1>
    <p>This quotation has expired or was cancelled by the resort reservation team. Please contact us on WhatsApp if you would like an updated quote.</p>
    <div class="footer">Anilao, Batangas, Philippines · Thank you for your understanding</div>
  </div>
</body>
</html>`,
          410
        );
      }
      return c.json({ error: "quotation_cancelled", detail: "this quotation was cancelled" }, 410);
    }
    if (guestUrl) return c.redirect(guestUrl);

    if (c.req.header("accept")?.includes("text/html")) {
      return c.html(
        `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotation In Preparation — Casa Escondida Anilao</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${themeCss()}
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
    }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 20px;
      padding: 44px 36px;
      max-width: 520px;
      width: 100%;
      box-shadow: var(--shadow);
      text-align: center;
    }
    .kicker {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 12px;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 14px;
      color: var(--text);
    }
    p {
      font-size: 15.5px;
      line-height: 1.65;
      color: var(--muted);
      margin: 0 0 20px;
    }
    .box {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
      font-size: 14px;
      color: var(--text);
      margin-bottom: 24px;
      line-height: 1.6;
      text-align: left;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 22px;
    }
    .btn {
      display: block;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      border-radius: 999px;
      padding: 12px 18px;
      border: 2px solid var(--border);
      background: var(--card);
      color: var(--text);
      cursor: pointer;
    }
    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--primary-text);
    }
    .footer {
      font-size: 13px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">CASA ESCONDIDA RESORT &amp; DIVE CENTER</div>
    <h1>Your Quotation Is Being Prepared</h1>
    <p>Our reservations team is currently reviewing your trip details and checking resort availability to ensure the most accurate rates.</p>
    <div class="box">
      <strong>What happens next?</strong><br />
      You do not need to take any action. Once reviewed and confirmed by our team, your official quotation link will be sent directly to your WhatsApp.
    </div>
    <div class="actions">
      <a class="btn btn-primary" href="https://wa.me/?text=${encodeURIComponent(
        "Hello Casa Escondida, I opened my quotation link and it says it is still being prepared.",
      )}" target="_blank" rel="noopener">Reply on WhatsApp instead of waiting</a>
      <a class="btn" href="/login">Staff sign-in — open this quotation in the studio</a>
    </div>
    <div class="footer">Anilao, Batangas, Philippines · Thank you for your patience</div>
  </div>
</body>
</html>`,
        410,
      );
    }

    return c.json(
      {
        error: "not_published",
        detail: "this quotation has no guest link yet — the resort team sends it after reviewing the price",
      },
      410,
    );
  });
}
