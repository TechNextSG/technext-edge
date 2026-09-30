/**
 * DEMO auth for the quotation studio — a stand-in for GAIS, not the real thing.
 *
 * The studio used to be opened by pasting the shared `WHATSAPP_VERIFY_TOKEN` into the URL. That
 * is workable for a demo but wrong as a product: the secret lands in browser history and in any
 * screenshot, and there is no notion of who is looking. The real target is documented in
 * `docs/specs/ai-hono-odoo-architecture-spec.md` §3.3 ("Auth GAIS"): the studio accepts
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
import { themeCss } from "../views/theme.js";
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
 * The key a person types to reach the studio.
 *
 * Deliberately NOT `WHATSAPP_VERIFY_TOKEN`, which is what it used to be. That one string was doing
 * two unrelated jobs: answering Meta's webhook handshake, and signing staff in. So rotating it for
 * either reason broke the other, and — the part that actually bit — the staff key had to be a
 * string Meta already knew, which meant it lived in a Meta dashboard and in every place the webhook
 * was configured.
 *
 * `STAFF_ACCESS_KEY` separates them. The fallback to `WHATSAPP_VERIFY_TOKEN` is for the deployment
 * that is already running: without it, adding this env var would lock everyone out until it was
 * set, and a security change that takes the tool offline is not one anybody applies.
 */
export function staffAccessKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.STAFF_ACCESS_KEY || env.WHATSAPP_VERIFY_TOKEN || "";
}

export interface LoginAttemptLimiter {
  /** Whether this address may try again, and how long to wait if not. */
  check(ip: string): { allowed: boolean; retryAfterSeconds: number };
  /** Record a wrong key. */
  fail(ip: string): void;
  /** Forget an address's failures — called on a correct key. */
  reset(ip: string): void;
}

/**
 * A brake on guessing the staff key.
 *
 * Per-instance, in memory, and deliberately so: Vercel runs concurrent requests in separate
 * instances, so this cannot bound an attacker who lands on ten of them. What it does bound is the
 * case that matters for a demo — one address trying keys in a loop — and it does it without adding
 * a Redis round trip to every sign-in. Their own repo documents the same trade-off for the same
 * endpoint (`bff/src/auth/rate-limit.ts`, D-021), and upgrading this to a shared counter is a
 * follow-up rather than something to fake here.
 */
export function createLoginAttemptLimiter(
  options: { limit?: number; windowMs?: number; now?: () => number } = {},
): LoginAttemptLimiter {
  const limit = options.limit ?? 5;
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const failures = new Map<string, number[]>();

  function live(ip: string): number[] {
    const cutoff = now() - windowMs;
    return (failures.get(ip) ?? []).filter((at) => at > cutoff);
  }

  return {
    check(ip) {
      const recent = live(ip);
      if (recent.length < limit) return { allowed: true, retryAfterSeconds: 0 };
      const oldest = recent[0] ?? now();
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now()) / 1000)) };
    },
    fail(ip) {
      failures.set(ip, [...live(ip), now()]);
    },
    reset(ip) {
      failures.delete(ip);
    },
  };
}

/**
 * The demo's signing key: the same `staffAccessKey` the sign-in form checks.
 *
 * One key for the whole staff surface. It used to be `GAIS_API_KEY || WHATSAPP_VERIFY_TOKEN` while
 * `/login` compared against `STAFF_ACCESS_KEY || WHATSAPP_VERIFY_TOKEN` and the header/query paths
 * compared against the WhatsApp token outright — three different answers to "what is the staff key",
 * which meant setting `STAFF_ACCESS_KEY` did *not* stop the WhatsApp token from opening the studio,
 * and rotating the WhatsApp token logged every staff member out. A deployment that has not set
 * `STAFF_ACCESS_KEY` still falls back to the WhatsApp token, so this changes nothing until it is set.
 */
function sessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  return staffAccessKey(env);
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

/**
 * The demo sign-in page. One password field, and a `role` field the form fills with `staff` — the
 * studio is a staff tool, and a session's role only changes what a view is *called*. (This comment
 * used to say the page had a role picker; it never did, and the picker that existed lived in the
 * studio header and has been removed.)
 */
export function renderLoginHtml(error = false, nextPath = "/quotes"): string {
  // An allow-list of prefixes, never a passthrough: `next` arrives from the query string, so
  // echoing it back unchecked is an open redirect. `/handoff` is here because the handoff inbox
  // deep-links itself ("/login?next=%2Fhandoff") and the earlier check only knew about `/quotes`,
  // so a person sent to sign in from the inbox landed in the studio instead.
  const safeNext = SAFE_NEXT_PREFIXES.some((prefix) => nextPath.startsWith(prefix)) ? nextPath : "/quotes";
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Staff Sign-In — Casa Escondida Quotation Studio</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
${themeCss()}
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
      padding: 24px 20px;
      transition: background 0.2s, color 0.2s;
      position: relative;
    }
    .theme-bar {
      position: fixed;
      top: 20px;
      right: 24px;
      z-index: 50;
    }
    .theme-btn {
      background: var(--card);
      color: var(--text);
      border: 2px solid var(--border);
      border-radius: 999px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      transition: border-color 0.15s;
    }
    .theme-btn:hover { border-color: var(--primary); }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 20px;
      padding: 40px 36px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
    }
    .brand-kicker {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--primary);
      margin-bottom: 8px;
    }
    h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; }
    p.sub { color: var(--muted); font-size: 15px; margin: 0 0 26px; font-weight: 500; }
    label { display: block; font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
    .password-wrapper {
      position: relative;
      margin-bottom: 24px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      background: var(--input-bg);
      border: 2px solid var(--border);
      color: var(--text);
      padding: 13px 48px 13px 14px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
    }
    input:focus { outline: none; border-color: var(--primary); }
    .pwd-toggle {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 6px;
    }
    .pwd-toggle:hover { color: var(--text); }
    button[type="submit"] {
      width: 100%;
      background: var(--primary);
      color: var(--primary-text);
      border: none;
      padding: 15px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
      transition: filter 0.15s;
    }
    button[type="submit"]:hover { filter: brightness(1.08); }
    .err {
      background: rgba(244, 63, 94, 0.12);
      border: 2px solid #f43f5e;
      color: #e11d48;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 14.5px;
      font-weight: 700;
      margin: 0 0 20px;
    }
    .footer-note {
      font-size: 13px;
      color: var(--muted);
      text-align: center;
      margin-top: 26px;
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
    <input type="hidden" name="role" value="staff" />
    <div class="brand-kicker">CASA ESCONDIDA RESORT &amp; DIVE CENTER</div>
    <h1>Quotation Studio</h1>
    <p class="sub">Staff sign-in to review &amp; finalize guest reservations</p>
    ${error ? `<p class="err">Incorrect password. Please verify and try again.</p>` : ""}
    <label for="password">Staff Access Key / Password</label>
    <div class="password-wrapper">
      <input id="password" name="password" type="password" placeholder="Enter staff access key or password..." autocomplete="current-password" autofocus />
      <button type="button" class="pwd-toggle" id="pwd-toggle-btn" onclick="togglePasswordVisibility()">Show</button>
    </div>
    <button type="submit">Sign In to Quotation Studio</button>
    <div class="footer-note">
      Casa Escondida Anilao · Reservation Management System<br />
      <span style="font-size:12px;opacity:0.8;">Authorized personnel and resort staff only</span>
    </div>
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
    function togglePasswordVisibility() {
      const input = document.getElementById('password');
      const btn = document.getElementById('pwd-toggle-btn');
      if (!input || !btn) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
      } else {
        input.type = 'password';
        btn.textContent = 'Show';
      }
    }
  </script>
</body>
</html>`;
}

