/**
 * DEMO auth for the quotation studio — a stand-in for GAIS, not the real thing.
 *
 * The studio used to be opened by pasting the shared `WHATSAPP_VERIFY_TOKEN` into the URL. That
 * is workable for a demo but wrong as a product: the secret lands in browser history and in any
 * screenshot, and there is no notion of who is looking. The real target is documented in
 * `docs/ai-hono-odoo-architecture-spec.md` §3.3 ("Auth GAIS"): the studio accepts
 * `Authorization: Bearer <GAIS_API_KEY>`, and Odoo decides which of the three roles
 * (guest / agent / staff) the caller is — staff additionally see cost, profit and assumptions.
 *
 * Until Phillip issues those keys, this module fakes exactly that shape so the swap is one file:
 *
 *   * `issueSession(role)` / `verifySession(token)` — an HMAC-signed session, the demo equivalent
 *     of a GAIS bearer key. Signed with `GAIS_API_KEY` when it exists, otherwise the verify token
 *     we already have, so the demo needs no new secret.
 *   * `DemoRole` — the same three roles the field guide names. In this demo a role only changes
 *     what the studio *shows*; it is not an access-control boundary.
 *
 * What this deliberately is NOT: a user database, rate limiting, or Odoo authentication. Do not
 * grow it into one — when the real keys arrive, `verifySession` becomes a GAIS key check and
 * everything else stays.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type DemoRole = "guest" | "agent" | "staff";

export const DEMO_ROLES: readonly DemoRole[] = ["guest", "agent", "staff"];

/** Cookie the demo session rides in. HttpOnly: script on the page never reads it. */
export const DEMO_SESSION_COOKIE = "casa_gais_session";

/** A demo shift, not a real session policy. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Where a sign-in may send you afterwards. Same-origin paths only, by prefix, and a fixed list —
 * anything not on it falls back to the studio. The single source of truth for both the page's
 * hidden field and the POST handler, so the two cannot disagree about what is allowed.
 */
export const SAFE_NEXT_PREFIXES = ["/quotes", "/handoff"] as const;

export const DEMO_GAIS_BANNER =
  "DEMO AUTH — staff sign-in here is a stand-in for GAIS. Real GAIS_API_KEY + Odoo roles land when Phillip issues keys.";

export function isDemoRole(value: unknown): value is DemoRole {
  return typeof value === "string" && (DEMO_ROLES as readonly string[]).includes(value);
}

/**
 * The demo's signing key. Prefers a real `GAIS_API_KEY` if one is ever configured, so pointing
 * the demo at the real gateway is a config change rather than a code change.
 */
function sessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.GAIS_API_KEY || env.WHATSAPP_VERIFY_TOKEN || "";
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

/** `<payload>.<hmac>` — payload is base64url JSON `{ role, exp }`. */
export function issueSession(role: DemoRole, env: NodeJS.ProcessEnv = process.env): string {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + SESSION_TTL_MS }), "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload, sessionSecret(env))}`;
}

/** The role on a valid, unexpired session — or null. Fails closed when no secret is configured. */
export function verifySession(token: string | undefined, env: NodeJS.ProcessEnv = process.env): DemoRole | null {
  if (!token) return null;
  const key = sessionSecret(env);
  if (!key) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const received = token.slice(dot + 1);
  const expected = sign(payload, key);
  // timingSafeEqual throws on a length mismatch, so guard first (same reasoning as sameSecret).
  if (received.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(received, "utf8"), Buffer.from(expected, "utf8"))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      role?: unknown;
      exp?: unknown;
    };
    if (!isDemoRole(data.role)) return null;
    if (typeof data.exp !== "number" || data.exp <= Date.now()) return null;
    return data.role;
  } catch {
    return null;
  }
}

/** The demo sign-in page. One password field and a role picker — no accounts, by design. */
export function renderLoginHtml(error = false, nextPath = "/quotes"): string {
  // An allow-list of prefixes, never a passthrough: `next` arrives from the query string, so
  // echoing it back unchecked is an open redirect. `/handoff` is here because the handoff inbox
  // deep-links itself ("/login?next=%2Fhandoff") and the earlier check only knew about `/quotes`,
  // so a person sent to sign in from the inbox landed in the studio instead.
  const safeNext = SAFE_NEXT_PREFIXES.some((prefix) => nextPath.startsWith(prefix)) ? nextPath : "/quotes";
  const options = DEMO_ROLES.map(
    (role) => `<option value="${role}"${role === "staff" ? " selected" : ""}>${role === "staff" ? "Staff (Full Review & Pricing)" : role === "agent" ? "Partner Agency (30% Room Rate)" : "Guest (Retail View)"}</option>`,
  ).join("");
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Staff Sign-In — Casa Escondida Quotation Studio</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root, [data-theme="light"] {
      --bg: #f1f5f9;
      --card: #ffffff;
      --border: #cbd5e1;
      --text: #0f172a;
      --muted: #475569;
      --input-bg: #f8fafc;
      --primary: #0284c7;
      --primary-text: #ffffff;
      --banner-bg: #f0f9ff;
      --banner-border: #bae6fd;
      --banner-text: #0369a1;
    }
    [data-theme="dark"] {
      --bg: #0b101b;
      --card: #131b2e;
      --border: #263554;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --input-bg: #0d1424;
      --primary: #38bdf8;
      --primary-text: #090d16;
      --banner-bg: rgba(124,58,237,0.12);
      --banner-border: rgba(124,58,237,0.35);
      --banner-text: #c4b5fd;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      transition: background 0.2s, color 0.2s;
    }
    .theme-bar {
      margin-bottom: 16px;
    }
    .theme-btn {
      background: var(--card);
      color: var(--text);
      border: 2px solid var(--border);
      border-radius: 999px;
      padding: 10px 18px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 18px;
      padding: 36px 32px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
    }
    h1 { font-size: 24px; font-weight: 800; margin: 0 0 6px; }
    p.sub { color: var(--muted); font-size: 16px; margin: 0 0 24px; font-weight: 500; }
    label { display: block; font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
    input, select {
      width: 100%;
      box-sizing: border-box;
      background: var(--input-bg);
      border: 2px solid var(--border);
      color: var(--text);
      padding: 13px 14px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    input:focus, select:focus { outline: none; border-color: var(--primary); }
    button[type="submit"] {
      width: 100%;
      background: var(--primary);
      color: var(--primary-text);
      border: none;
      padding: 15px;
      border-radius: 12px;
      font-size: 17px;
      font-weight: 800;
      cursor: pointer;
    }
    .err {
      background: rgba(244, 63, 94, 0.12);
      border: 2px solid #f43f5e;
      color: #e11d48;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      margin: 0 0 18px;
    }
    .banner {
      font-size: 13px;
      color: var(--banner-text);
      background: var(--banner-bg);
      border: 1px solid var(--banner-border);
      border-radius: 10px;
      padding: 12px 14px;
      margin-top: 22px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="theme-bar">
    <button type="button" class="theme-btn" id="theme-toggle-btn" onclick="toggleTheme()">Dark Mode</button>
  </div>
  <form class="card" method="post" action="/login">
    <input type="hidden" name="next" value="${safeNext.replace(/"/g, "&quot;")}" />
    <h1>Quotation Studio</h1>
    <p class="sub">Casa Escondida — Staff Review Access</p>
    ${error ? `<p class="err">Incorrect access password. Please try again.</p>` : ""}
    <label for="role">1. Choose View Mode</label>
    <select id="role" name="role">${options}</select>
    <label for="password">2. Staff Access Key (Verify Token)</label>
    <input id="password" name="password" type="password" placeholder="Paste your Staff Access Key here..." autocomplete="current-password" autofocus />
    <button type="submit">Sign In to Quotation Studio</button>
    <div class="banner">${DEMO_GAIS_BANNER}</div>
  </form>
  <script>
    (function initTheme() {
      const saved = localStorage.getItem('casa_theme') || 'light';
      document.documentElement.setAttribute('data-theme', saved);
      updateThemeBtn(saved);
    })();
    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      localStorage.setItem('casa_theme', cur);
      updateThemeBtn(cur);
    }
    function updateThemeBtn(theme) {
      const btn = document.getElementById('theme-toggle-btn');
      if (btn) btn.textContent = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
  </script>
</body>
</html>`;
}

