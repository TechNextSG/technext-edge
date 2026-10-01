/** The two keys that open the studio, and the one comparison every secret goes through. */
import { timingSafeEqual } from "node:crypto";
import { loadEnv, type Env } from "../env.ts";

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

/**
 * Constant-time comparison of a shared secret a caller sent us, for the routes
 * that are guarded by the verify token instead of by a signature (the handoff
 * view in app.ts). Same reasoning as verifySignature's comparison: `===` on a
 * secret exits at the first differing byte, which leaks it to anyone willing to
 * measure how long a rejection takes.
 */
export function sameSecret(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on a length mismatch, so guard first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
