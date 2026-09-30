/**
 * One set of colour tokens for every page this service renders.
 *
 * Why this exists: `/login`, `/ops`, `/handoff`, `/quotes` and the `/q` 410 page had each grown
 * their own `:root` block. They were *nearly* the same palette — same blues, same greys — which is
 * worse than two different ones, because the drift only shows up when you put the pages side by
 * side: a slightly different page background here, a different dark-mode border there, a
 * `--primary` on one page and a `--accent` on another meaning exactly the same thing. A demo walks
 * through three of these pages in a row, and the seams are what a viewer notices.
 *
 * So: one palette, one place. The two names that the pages had already invented are kept as
 * aliases (`--primary`/`--accent`, `--card`/`--surface`, `--row`/`--surface-2`) rather than renamed
 * everywhere at once, because the point is one source of colour, not one source of churn.
 *
 * Where the pages disagreed, the studio's value wins — it is the page a staff member lives in, and
 * its palette is the one that was designed with the most care. Two values moved as a result:
 *
 *   * light page background `#f1f5f9` → `#f8fafc` (that value was already in every palette as
 *     `--row`/`--input-bg`, so nothing new entered the system);
 *   * dark border `#263554` → `#2d3f63`.
 *
 * Both are deliberately small: unifying tokens is not the moment to redesign a page.
 *
 * The banner colours (`--banner-*`) are the demo notice's own, and they are here for the same
 * reason as the rest — the login page and the studio show the same banner, and it should not change
 * colour between them.
 */

/** The light palette, as CSS custom properties. Exported so a test can assert every page uses it. */
export const THEME_TOKENS: Readonly<Record<string, string>> = {
  "--bg": "#f8fafc",
  "--card": "#ffffff",
  "--surface": "#ffffff",
  "--surface-2": "#f1f5f9",
  "--row": "#f8fafc",
  "--input-bg": "#f8fafc",
  "--border": "#cbd5e1",
  "--text": "#0f172a",
  "--muted": "#475569",
  "--primary": "#0284c7",
  "--accent": "#0284c7",
  "--primary-text": "#ffffff",
  "--accent-soft": "#e0f2fe",
  "--emerald": "#059669",
  "--emerald-soft": "#ecfdf5",
  "--amber": "#d97706",
  "--amber-soft": "#fffbeb",
  // The handoff inbox called the same amber `--warn`; both names point at one value.
  "--warn": "#b45309",
  "--warn-bg": "#fef3c7",
  "--danger": "#b91c1c",
  "--rose": "#e11d48",
  "--shadow": "0 8px 24px rgba(15, 23, 42, 0.06)",
  "--banner-bg": "#f0f9ff",
  "--banner-border": "#bae6fd",
  "--banner-text": "#0369a1",
};

/** The dark palette. Same names, so a page never has to know which theme is on. */
export const THEME_TOKENS_DARK: Readonly<Record<string, string>> = {
  "--bg": "#0b101b",
  "--card": "#131b2e",
  "--surface": "#131b2e",
  "--surface-2": "#19233c",
  "--row": "#0d1424",
  "--input-bg": "#0d1424",
  "--border": "#2d3f63",
  "--text": "#f1f5f9",
  "--muted": "#94a3b8",
  "--primary": "#38bdf8",
  "--accent": "#38bdf8",
  "--primary-text": "#090d16",
  "--accent-soft": "rgba(56, 189, 248, 0.14)",
  "--emerald": "#10b981",
  "--emerald-soft": "rgba(16, 185, 129, 0.14)",
  "--amber": "#fbbf24",
  "--amber-soft": "rgba(245, 158, 11, 0.16)",
  "--warn": "#fcd34d",
  "--warn-bg": "rgba(252,211,77,0.12)",
  "--danger": "#f87171",
  "--rose": "#fb7185",
  "--shadow": "0 12px 30px rgba(0, 0, 0, 0.45)",
  "--banner-bg": "rgba(124,58,237,0.12)",
  "--banner-border": "rgba(124,58,237,0.35)",
  "--banner-text": "#c4b5fd",
};

function block(selector: string, tokens: Readonly<Record<string, string>>): string {
  const lines = Object.entries(tokens).map(([name, value]) => `      ${name}: ${value};`);
  return `    ${selector} {\n${lines.join("\n")}\n    }`;
}

/**
 * The token declarations, ready to drop inside a page's `<style>`.
 *
 * Both themes in one string, because a page that only imports the light half is a page that breaks
 * the moment someone toggles the theme — and the toggle is the first thing a viewer clicks.
 */
export function themeCss(): string {
  return [
    block(":root, [data-theme=\"light\"]", THEME_TOKENS),
    block("[data-theme=\"dark\"]", THEME_TOKENS_DARK),
  ].join("\n");
}
