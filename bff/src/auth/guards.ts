/**
 * Who may do what: the checks every route asks, built once from the environment.
 *
 * `staffSession` accepts a Bearer key, the `x-verify-token` header or `?token=` query (the old paths), or the signed
 * cookie. `adminGuard` is the one place that decides who may open `/admin`. Both read the environment on every call, not
 * at construction, because tests set it per case and Vercel does not guarantee it at import time.
 */
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { loadEnv, type Env } from "../env.ts";
import { adminAccessKey, sameSecret, staffAccessKey } from "./keys.ts";
import { DEMO_SESSION_COOKIE, verifySession, type StaffRole } from "./session.ts";

export interface StaffAuth {
  ok: boolean;
  role: StaffRole | null;
}

export interface GuardOptions {
  getEnv?: () => Env;
  /** The page an admin-only URL shows to a staff session. Passed in so `auth/` never imports a view. */
  adminOnlyHtml: string;
}

export function createGuards(options: GuardOptions) {
  const getEnv = options.getEnv ?? (() => loadEnv());

  function staffAuthorizedWithQuery(header: string | undefined, query: string | undefined): boolean {
    const key = staffAccessKey(getEnv());
    if (!key) return false;
    if (sameSecret(header, key)) return true;
    return Boolean(query && sameSecret(query, key));
  }

  function staffSession(c: Context): StaffAuth {
    const bearer = c.req.header("authorization");
    if (bearer?.startsWith("Bearer ") && sameSecret(bearer.slice(7).trim(), staffAccessKey(getEnv()))) {
      return { ok: true, role: "staff" };
    }
    if (staffAuthorizedWithQuery(c.req.header("x-verify-token"), c.req.query("token"))) {
      return { ok: true, role: "staff" };
    }
    const role = verifySession(getCookie(c, DEMO_SESSION_COOKIE), getEnv());
    return role ? { ok: true, role } : { ok: false, role: null };
  }

  function staffWriter(c: Context): boolean {
    const auth = staffSession(c);
    return auth.ok && (auth.role === "staff" || auth.role === "admin");
  }

  /**
   * Null when the caller is an admin; otherwise the response to send: 404 when the dashboard is not switched on (no
   * `ADMIN_ACCESS_KEY`), 401 without a session, 403 for a staff session — staff may not open `/admin`.
   */
  function adminGuard(c: Context, kind: "page" | "api"): Response | null {
    const key = adminAccessKey(getEnv());
    if (!key) return c.json({ error: "not_found" }, 404);
    const header = c.req.header("x-admin-key");
    if (header && sameSecret(header, key)) return null;
    const auth = staffSession(c);
    if (auth.ok && auth.role === "admin") return null;
    if (auth.ok) {
      return kind === "page"
        ? c.html(options.adminOnlyHtml, 403)
        : c.json({ error: "forbidden", detail: "the admin dashboard needs the admin key" }, 403);
    }
    return kind === "page" ? c.redirect("/login?next=%2Fadmin%2Fai") : c.json({ error: "unauthorized" }, 401);
  }

  /** The handoff JSON routes are guarded by the WhatsApp verify token, compared in constant time. */
  function handoffAuthorized(header: string | undefined): boolean {
    return sameSecret(header, getEnv().WHATSAPP_VERIFY_TOKEN);
  }

  return { staffSession, staffWriter, adminGuard, handoffAuthorized };
}

export type Guards = ReturnType<typeof createGuards>;
