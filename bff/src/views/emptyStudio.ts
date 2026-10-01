/**
 * What `/quotes` shows before the first enquiry exists. The studio used to seed a sample record so this
 * page always had something to open; a fresh studio is now empty, and says what fills it.
 */
import { themeCss } from "./theme.ts";

export function renderEmptyStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotations — Casa Escondida</title>
  <style>
${themeCss()}
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
    h1 { font-size: 24px; font-weight: 800; margin: 0 0 12px; }
    .empty { background: var(--card); border: 2px dashed var(--border); border-radius: 14px; padding: 32px; color: var(--muted); font-weight: 600; max-width: 640px; }
    a { color: var(--primary); font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Quotations</h1>
  <p class="empty">No enquiries yet. A quotation appears here as soon as a guest's WhatsApp message has enough in it to price.
    Messages the assistant could not take on its own wait in the <a href="/handoff">handoff inbox</a>.</p>
</body>
</html>`;
}
