// Đợt 0.4 — the sign-in page stops sharing a secret with Meta, gets a brake on guessing, and can be
// signed out of.
//
// Each of these replaced something that was load-bearing and wrong: one string answering both Meta's
// webhook handshake and staff sign-in, no limit on attempts, no way out of a session, and no
// security headers on pages that print a guest's own words.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/app.ts";
import { createLoginAttemptLimiter } from "../../src/auth/rate-limit.ts";
import { staffAccessKey } from "../../src/auth/keys.ts";

const VERIFY_TOKEN = "meta-verify-token";
const STAFF_KEY = "separate-staff-key";

function login(body: Record<string, string>) {
  return new Request("http://test/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "203.0.113.7" },
    body: new URLSearchParams(body).toString(),
  });
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
  vi.stubEnv("STAFF_ACCESS_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the staff key is not the webhook token", () => {
  it("falls back to the verify token so adding the env var cannot lock anyone out", () => {
    expect(staffAccessKey({ WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN } as NodeJS.ProcessEnv)).toBe(VERIFY_TOKEN);
    expect(staffAccessKey({ WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN, STAFF_ACCESS_KEY: STAFF_KEY } as NodeJS.ProcessEnv)).toBe(STAFF_KEY);
    expect(staffAccessKey({} as NodeJS.ProcessEnv)).toBe("");
  });

  it("accepts the separate key and refuses the old one once it is set", async () => {
    vi.stubEnv("STAFF_ACCESS_KEY", STAFF_KEY);
    const app = createApp();

    expect((await app.request(login({ password: STAFF_KEY }))).status).toBe(302);
    // The webhook token is no longer a way in: that is the whole point of separating them.
    expect((await app.request(login({ password: VERIFY_TOKEN }))).status).toBe(401);
  });
});

describe("guessing the staff key is braked", () => {
  it("answers 429 after five wrong attempts from one address", async () => {
    const app = createApp({ loginLimiter: createLoginAttemptLimiter({ limit: 5, windowMs: 60_000 }) });

    for (let i = 0; i < 5; i++) {
      expect((await app.request(login({ password: `wrong-${i}` }))).status).toBe(401);
    }

    const blocked = await app.request(login({ password: "wrong-again" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("lets a correct key through and forgets the failures", async () => {
    const app = createApp({ loginLimiter: createLoginAttemptLimiter({ limit: 2, windowMs: 60_000 }) });

    await app.request(login({ password: "wrong" }));
    expect((await app.request(login({ password: VERIFY_TOKEN }))).status).toBe(302);
    // Reset on success, so the next mistake is not already halfway to a block.
    await app.request(login({ password: "wrong" }));
    expect((await app.request(login({ password: VERIFY_TOKEN }))).status).toBe(302);
  });

  it("does not lump callers together when the platform forwards no address", async () => {
    const app = createApp({ loginLimiter: createLoginAttemptLimiter({ limit: 1, windowMs: 60_000 }) });
    const noIp = () =>
      new Request("http://test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: "wrong" }).toString(),
      });

    await app.request(noIp());
    // Without a per-caller key the brake simply does not apply, which is better than blocking
    // everybody behind one shared counter.
    expect((await app.request(noIp())).status).toBe(401);
  });
});

describe("signing out", () => {
  it("clears the session cookie and returns to the form", async () => {
    const app = createApp();
    const res = await app.request("/logout", { method: "POST" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("set-cookie") ?? "").toContain("casa_gais_session=;");
  });
});

describe("security headers", () => {
  it("are set on the pages that print a guest's own words", async () => {
    const app = createApp();
    const res = await app.request("/login");

    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
  });
});
