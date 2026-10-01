/** The list of documents staff can open at `/docs`. */
import { themeCss } from "./theme.ts";
import { escapeHtml } from "./html.ts";

export interface DocEntry {
  slug: string;
  /** Path under `docs/`. */
  file: string;
  group: string;
  title: string;
  about: string;
}

export function renderDocsIndexHtml(entries: readonly DocEntry[]): string {
  const groups = [...new Set(entries.map((e) => e.group))];
  const body = groups
    .map(
      (g) => `<h2>${escapeHtml(g)}</h2>
    <ul>${entries
      .filter((e) => e.group === g)
      .map((e) => `<li><a href="/docs/${escapeHtml(e.slug)}">${escapeHtml(e.title)}</a><span>${escapeHtml(e.about)}</span></li>`)
      .join("")}</ul>`,
    )
    .join("\n    ");
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Documents — Casa Escondida</title>
  <style>
${themeCss()}
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
    main { max-width: 760px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 26px 0 8px; }
    .sub { color: var(--muted); font-weight: 600; margin: 0 0 8px; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { background: var(--card); border: 2px solid var(--border); border-radius: 12px; padding: 12px 16px; margin: 8px 0; }
    li a { color: var(--primary); font-weight: 700; text-decoration: none; display: block; }
    li span { color: var(--muted); font-size: 14px; }
    .back { font-weight: 700; color: var(--primary); text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <a class="back" href="/quotes">&larr; Studio</a>
    <h1>Documents</h1>
    <p class="sub">For signed-in staff. Each opens as a standalone page.</p>
    ${body}
  </main>
</body>
</html>`;
}
