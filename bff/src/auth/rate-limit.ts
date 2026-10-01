/** A brake on guessing the staff key. */

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
