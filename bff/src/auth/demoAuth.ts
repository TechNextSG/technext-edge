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
import { loadEnv, type Env } from "../env.ts";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The studio is a staff tool and nothing else. In the team estimator a role comes from the login
 * session (Odoo decides it), never from what a client sends, and agents and instructors use the
 * team estimator — so there is one role here. A cookie signed with an older role ("guest",
 * "agent") is no longer a session at all: `verifySession` returns null for it.
 */
export type DemoRole = "staff" | "admin";

export const DEMO_ROLES: readonly DemoRole[] = ["staff", "admin"];

/**
 * `admin` exists for one thing: the AI settings dashboard (`/admin`). It can do everything `staff` can; `staff`
 * cannot open `/admin`. The role comes from *which key was typed* at sign-in — never from a form field — and only
 * when `ADMIN_ACCESS_KEY` is set: unset, there is no admin and the dashboard does not exist.
 */

/** Cookie the demo session rides in. HttpOnly: script on the page never reads it. */
export const DEMO_SESSION_COOKIE = "casa_gais_session";

/** A demo shift, not a real session policy. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Where a sign-in may send you afterwards. Same-origin paths only, by prefix, and a fixed list —
 * anything not on it falls back to the studio. The single source of truth for both the page's
 * hidden field and the POST handler, so the two cannot disagree about what is allowed.
 */
export const SAFE_NEXT_PREFIXES = ["/quotes", "/handoff", "/admin"] as const;

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
export function staffAccessKey(env: Env = loadEnv()): string {
  return env.STAFF_ACCESS_KEY || env.WHATSAPP_VERIFY_TOKEN || "";
}

/** The key that opens the admin dashboard. Empty = the dashboard is off. Must differ from the staff key to mean anything. */
export function adminAccessKey(env: Env = loadEnv()): string {
  return env.ADMIN_ACCESS_KEY || "";
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
function sessionSecret(env: Env = loadEnv()): string {
  return staffAccessKey(env);
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

/** `<payload>.<hmac>` — payload is base64url JSON `{ role, exp }`. */
export function issueSession(role: DemoRole, env: Env = loadEnv()): string {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + SESSION_TTL_MS }), "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload, sessionSecret(env))}`;
}

/** The role on a valid, unexpired session — or null. Fails closed when no secret is configured. */
export function verifySession(token: string | undefined, env: Env = loadEnv()): DemoRole | null {
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
