import { Hono, type Context } from "hono";
import { deleteCookie } from "hono/cookie";
import { adminAccessKey, staffAccessKey } from "../auth/keys.ts";
import { DEMO_SESSION_COOKIE, SAFE_NEXT_PREFIXES, type StaffRole } from "../auth/session.ts";
import { type LoginAttemptLimiter } from "../auth/rate-limit.ts";
import { renderLoginHtml } from "../views/loginPage.ts";
import { sameSecret } from "../auth/keys.ts";

export interface AuthRouteDeps {
  /**
   * Shared with the studio pages rather than created here, so an address that is being
   * brute-forced is limited across the whole app instead of per route module.
   */
  loginLimiter: LoginAttemptLimiter;
  /** Writes the signed demo cookie. Owned by app.ts, which also clears it elsewhere. */
  setSession: (c: Context, role: StaffRole) => void;
}

/**
 * Sign in and sign out for the studio.
 *
 * `sameSecret` is imported from the WhatsApp module because the comparison and the `401`
 * path both have to behave identically for both secrets — see loginHardening.test.ts,
 * which pins that the sign-in attempt is answered the same way however the key is guessed.
 */
export function authRoutes(deps: AuthRouteDeps): Hono {
  const app = new Hono();
  const { loginLimiter, setSession } = deps;

  app.get("/login", (c) => c.html(renderLoginHtml(false, c.req.query("next") || "/quotes")));

  app.post("/login", async (c) => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const password = typeof body.password === "string" ? body.password : "";
    const rawNext = typeof body.next === "string" ? body.next : "";
    const nextPath = SAFE_NEXT_PREFIXES.some((prefix) => rawNext.startsWith(prefix)) ? rawNext : "/quotes";

    // Checked before the comparison, so a brute force is answered the same way however the key is
    // guessed. The address is the one the platform forwards; without a proxy header there is no
    // useful key and the limiter simply does nothing rather than lumping every caller together.
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "";
    if (ip) {
      const verdict = loginLimiter.check(ip);
      if (!verdict.allowed) {
        return c.html(renderLoginHtml(true, nextPath), 429, {
          "retry-after": String(verdict.retryAfterSeconds),
        });
      }
    }

    // Which key was typed is the only thing that decides the role; the form's `role` field is ignored. The
    // staff key is checked first, so a deployment that gave both keys the same value has no admin rather than
    // an admin that everyone with the staff key can be.
    const isStaff = sameSecret(password, staffAccessKey());
    const adminKey = adminAccessKey();
    const isAdmin = !isStaff && adminKey !== "" && sameSecret(password, adminKey);
    if (!isStaff && !isAdmin) {
      if (ip) loginLimiter.fail(ip);
      return c.html(renderLoginHtml(true, nextPath), 401);
    }
    if (ip) loginLimiter.reset(ip);
    setSession(c, isAdmin ? "admin" : "staff");
    return c.redirect(isAdmin && nextPath === "/quotes" ? "/admin/ai" : nextPath);
  });

  // Signing out clears the cookie. There is no server-side session to revoke — the demo session is
  // a signed cookie and nothing else — so this is the whole of it, and saying so here is cheaper
  // than someone later assuming a revocation that does not exist.
  app.post("/logout", (c) => {
    deleteCookie(c, DEMO_SESSION_COOKIE, { path: "/" });
    return c.redirect("/login");
  });

  // `/login/role` used to live here: it re-issued the demo cookie with another role, and its only
  // caller was the role picker in the studio header. The picker is gone — the studio is a staff
  // tool, the guest's own view is the customer's `/quote/:token` page, and a "guest view" of the
  // studio is a screen no guest can ever reach — so the route went with it. The role is chosen at
  // sign-in (`POST /login` reads `role`), which is the one place it means anything.

  return app;
}
