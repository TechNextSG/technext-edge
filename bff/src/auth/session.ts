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
 *   * `StaffRole` — the same three roles the field guide names. In this demo a role only changes
 *     what the studio *shows*; it is not an access-control boundary.
 *
 * What this deliberately is NOT: a user database, rate limiting, or Odoo authentication. Do not
 * grow it into one — when the real keys arrive, `verifySession` becomes a GAIS key check and
 * everything else stays.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { loadEnv, type Env } from "../env.ts";
import { staffAccessKey } from "./keys.ts";

/**
 * The studio is a staff tool and nothing else. In the team estimator a role comes from the login
 * session (Odoo decides it), never from what a client sends, and agents and instructors use the
 * team estimator — so there is one role here. A cookie signed with an older role ("guest",
 * "agent") is no longer a session at all: `verifySession` returns null for it.
 */
export type StaffRole = "staff" | "admin";

export const DEMO_ROLES: readonly StaffRole[] = ["staff", "admin"];

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

export function isDemoRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (DEMO_ROLES as readonly string[]).includes(value);
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
export function issueSession(role: StaffRole, env: Env = loadEnv()): string {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + SESSION_TTL_MS }), "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload, sessionSecret(env))}`;
}

/** The role on a valid, unexpired session — or null. Fails closed when no secret is configured. */
export function verifySession(token: string | undefined, env: Env = loadEnv()): StaffRole | null {
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

/** Puts the signed session in an HttpOnly cookie for one shift. */
export function setSession(c: Context, role: StaffRole, env: Env = loadEnv()): void {
  setCookie(c, DEMO_SESSION_COOKIE, issueSession(role, env), {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.NODE_ENV === "production" || env.VERCEL === "1",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
}
