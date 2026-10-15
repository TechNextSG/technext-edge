// The demo GAIS sign-in: the studio is opened with a session cookie instead of pasting the shared
// secret into the URL.
//
// This is DEMO auth (see bff/src/auth/) — it fakes the shape of the edge spec's
// `Authorization: Bearer <GAIS_API_KEY>` so the real thing is a one-file swap. These tests pin
// exactly that shape: the cookie works, a forged or expired one does not, the role rides along,
// and the old header/query paths still work so nothing that used them breaks.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createApp } from "../../src/app.ts";
import { issueSession, verifySession, isDemoRole } from "../../src/auth/session.ts";
import { ensureSampleQuotation } from "../helpers/sampleQuotation.ts";

// The app no longer seeds a cold-start record; this file reads the sample one.
beforeAll(async () => {
  await ensureSampleQuotation();
});

const STAFF_TOKEN = "test-staff-token";
/** The seeded studio record, so a deep link points at a quotation that exists. */
const SEED_QUOTE_ID = "QT-1010-SKY";
const savedToken = process.env.WHATSAPP_VERIFY_TOKEN;
const savedGais = process.env.GAIS_API_KEY;

beforeAll(() => {
  process.env.WHATSAPP_VERIFY_TOKEN = STAFF_TOKEN;
  delete process.env.GAIS_API_KEY;
});
afterAll(() => {
  if (savedToken === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
  else process.env.WHATSAPP_VERIFY_TOKEN = savedToken;
  if (savedGais === undefined) delete process.env.GAIS_API_KEY;
  else process.env.GAIS_API_KEY = savedGais;
});

/** The session cookie out of a Set-Cookie header, ready to send back as a `cookie` header. */
function sessionCookie(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = /casa_gais_session=([^;]+)/.exec(raw);
  return match ? `casa_gais_session=${match[1]}` : "";
}

function signIn(role = "staff", password = STAFF_TOKEN) {
  const app = createApp();
  return app.request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password, role }).toString(),
  });
}

describe("demo GAIS session tokens", () => {
  it("round-trips a role, and refuses a tampered or forged token", () => {
    const token = issueSession("staff");
    expect(verifySession(token)).toBe("staff");

    // Any change to the payload invalidates the HMAC.
    const [payload, sig] = token.split(".");
    const flipped = Buffer.from(
      JSON.stringify({ role: "staff", exp: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    expect(verifySession(`${flipped}.${sig}`)).toBeNull();
    expect(verifySession(`${payload}.${"0".repeat(sig!.length)}`)).toBeNull();
    expect(verifySession("not-a-token")).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });

  it("does not honour a cookie signed with a role that no longer exists", () => {
    // Signed with the real key, so only the role is wrong. Before this a signed-in "agent" or "guest"
    // was a valid session with fewer buttons; now it is not a session.
    for (const old of ["agent", "guest"]) {
      expect(verifySession(issueSession(old as never))).toBeNull();
    }
  });

  it("rejects an expired session without recomputing the role", () => {
    const expired = Buffer.from(JSON.stringify({ role: "staff", exp: Date.now() - 1 }), "utf8").toString(
      "base64url",
    );
    expect(verifySession(expired)).toBeNull();
  });

  it("fails closed when no secret is configured", () => {
    const configured = process.env.WHATSAPP_VERIFY_TOKEN;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    try {
      const token = issueSession("staff", {} as NodeJS.ProcessEnv);
      expect(verifySession(token, {} as NodeJS.ProcessEnv)).toBeNull();
    } finally {
      process.env.WHATSAPP_VERIFY_TOKEN = configured;
    }
  });

  it("has two roles: staff, and admin for the AI settings dashboard; agents use the team estimator", () => {
    expect(isDemoRole("staff")).toBe(true);
    expect(isDemoRole("admin")).toBe(true);
    expect(isDemoRole("agent")).toBe(false);
    expect(isDemoRole("guest")).toBe(false);
    expect(isDemoRole("root")).toBe(false);
    expect(isDemoRole(null)).toBe(false);
  });
});

describe("the handoff inbox behind the demo sign-in", () => {
  it("sends an unauthenticated visitor to the sign-in page", async () => {
    const app = createApp();
    const res = await app.request("/handoff");
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
  });

  // Deep links: a staff member opening /handoff while signed out lands back on /handoff after signing in.
  describe("returning staff to the page they asked for", () => {
    it("sends an unauthenticated deep link to /login with its destination", async () => {
      const app = createApp();
      const res = await app.request("/handoff");
      expect([301, 302, 303, 307, 308]).toContain(res.status);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/login");
      expect(decodeURIComponent(location)).toContain("next=/handoff");
    });

    it("puts the destination in the form, and honours it after a good password", async () => {
      const app = createApp();
      const dest = "/handoff";
      const page = await app.request(`/login?next=${encodeURIComponent(dest)}`);
      expect(await page.text()).toContain(`value="${dest}"`);

      const res = await app.request("/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: STAFF_TOKEN, role: "staff", next: dest }).toString(),
      });
      expect([301, 302, 303, 307, 308]).toContain(res.status);
      expect(res.headers.get("location")).toBe(dest);
    });

    // The destination is attacker-controlled, so it is restricted to an in-app path. Anything
    // else falls back to /handoff rather than becoming an open redirect.
    it("refuses a destination that is not an in-app allowed path", async () => {
      const app = createApp();
      for (const hostile of ["https://evil.example/steal", "//evil.example", "/v1/quotes", "/q/slug"]) {
        const res = await app.request("/login", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ password: STAFF_TOKEN, role: "staff", next: hostile }).toString(),
        });
        expect(res.headers.get("location"), `next=${hostile} escaped`).toBe("/handoff");
      }
    });
  });

  it("renders a sign-in form, and refuses a wrong password", async () => {
    const app = createApp();
    const page = await app.request("/login");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Staff Access Key");

    const bad = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "not-it", role: "staff" }).toString(),
    });
    expect(bad.status).toBe(401);
    expect(sessionCookie(bad)).toBe("");
  });

  it("opens the handoff inbox with the cookie alone — no token in the URL", async () => {
    const res = await signIn("staff");
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    const cookie = sessionCookie(res);
    expect(cookie).not.toBe("");

    const app = createApp();
    const handoff = await app.request("/handoff", { headers: { cookie } });
    expect(handoff.status).toBe(200);
    const html = await handoff.text();
    expect(html).toContain("Handoff inbox");
  });

  it("offers no role switch", async () => {
    const app = createApp();
    const role = await app.request("/login/role", { method: "POST" });
    expect(role.status).toBe(404);
  });

  it("refuses a forged cookie as firmly as no cookie", async () => {
    const app = createApp();
    const res = await app.request("/handoff", { headers: { cookie: "casa_gais_session=forged.deadbeef" } });
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("still accepts the GAIS-shaped bearer header and the old query token", async () => {
    const app = createApp();
    const bearer = await app.request("/handoff", { headers: { authorization: `Bearer ${STAFF_TOKEN}` } });
    expect(bearer.status).toBe(200);

    const query = await app.request(`/handoff?token=${STAFF_TOKEN}`);
    expect(query.status).toBe(200);

    const header = await app.request("/handoff", { headers: { "x-verify-token": STAFF_TOKEN } });
    expect(header.status).toBe(200);
  });

  it("guards the docs page with the same session", async () => {
    const app = createApp();
    expect((await app.request("/docs")).status).toBe(302);

    const res = await signIn("staff");
    const cookie = sessionCookie(res);
    expect((await app.request("/docs", { headers: { cookie } })).status).toBe(200);
  });

  it("answers to STAFF_ACCESS_KEY and stops answering to the WhatsApp token", async () => {
    const staffKey = "studio-key-set-by-the-resort";
    vi.stubEnv("STAFF_ACCESS_KEY", staffKey);
    const app = createApp();

    // The new key works, through every door staff use.
    expect((await app.request(`/handoff?token=${staffKey}`)).status).toBe(200);
    expect((await app.request("/handoff", { headers: { authorization: `Bearer ${staffKey}` } })).status).toBe(200);
    const signedIn = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: staffKey, role: "staff" }).toString(),
    });
    const cookie = sessionCookie(signedIn);
    expect(cookie).not.toBe("");
    expect((await app.request("/docs", { headers: { cookie } })).status).toBe(200);

    // The WhatsApp webhook token does not.
    expect((await app.request(`/handoff?token=${STAFF_TOKEN}`)).status).not.toBe(200);
    expect((await app.request("/handoff", { headers: { authorization: `Bearer ${STAFF_TOKEN}` } })).status).not.toBe(200);
    expect((await app.request("/handoff", { headers: { "x-verify-token": STAFF_TOKEN } })).status).not.toBe(200);

    const oldSecretEnv = { ...process.env, STAFF_ACCESS_KEY: undefined, WHATSAPP_VERIFY_TOKEN: STAFF_TOKEN };
    const oldCookie = issueSession("staff", oldSecretEnv as NodeJS.ProcessEnv);
    expect((await app.request("/handoff", { headers: { cookie: `casa_gais_session=${oldCookie}` } })).status).not.toBe(200);

    vi.unstubAllEnvs();
  });
});

describe("the role a session carries", () => {
  it("is chosen at sign-in, and a caller with no session cannot pick one", async () => {
    const app = createApp();
    const res = await app.request("/login/role", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ role: "agent" }).toString(),
    });
    expect(res.status).toBe(404);
    expect(sessionCookie(res)).toBe("");
  });

  it("is always staff, whatever the sign-in form says", async () => {
    const res = await signIn("agent");
    const cookie = sessionCookie(res);
    expect(cookie).not.toBe("");

    const app = createApp();
    const handoff = await app.request("/handoff", { headers: { cookie } });
    expect(handoff.status).toBe(200);
  });
});
