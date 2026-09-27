// The demo GAIS sign-in: the studio is opened with a session cookie instead of pasting the shared
// secret into the URL.
//
// This is DEMO auth (see apps/casa-bff/src/demoAuth.ts) — it fakes the shape of the edge spec's
// `Authorization: Bearer <GAIS_API_KEY>` so the real thing is a one-file swap. These tests pin
// exactly that shape: the cookie works, a forged or expired one does not, the role rides along,
// and the old header/query paths still work so nothing that used them breaks.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { issueSession, verifySession, isDemoRole } from "../../../apps/casa-bff/src/demoAuth.js";

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
    const token = issueSession("agent");
    expect(verifySession(token)).toBe("agent");

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

  it("only accepts the three GAIS roles", () => {
    expect(isDemoRole("staff")).toBe(true);
    expect(isDemoRole("agent")).toBe(true);
    expect(isDemoRole("guest")).toBe(true);
    expect(isDemoRole("admin")).toBe(false);
    expect(isDemoRole(null)).toBe(false);
  });
});

describe("the studio behind the demo sign-in", () => {
  it("sends an unauthenticated visitor to the sign-in page", async () => {
    const app = createApp();
    const res = await app.request("/quotes");
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
  });

  // Deep links: a staff member opening /quotes/<id> while signed out used to land on the studio
  // LIST after signing in, losing the quotation they were sent. The redirect now carries the
  // destination, and the form posts it back.
  describe("returning staff to the page they asked for", () => {
    it("sends an unauthenticated deep link to /login with its destination", async () => {
      const app = createApp();
      const res = await app.request(`/quotes/${SEED_QUOTE_ID}`);
      expect([301, 302, 303, 307, 308]).toContain(res.status);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/login");
      expect(decodeURIComponent(location)).toContain(`next=/quotes/${SEED_QUOTE_ID}`);
    });

    it("puts the destination in the form, and honours it after a good password", async () => {
      const app = createApp();
      const dest = `/quotes/${SEED_QUOTE_ID}`;
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
    // else falls back to the studio list rather than becoming an open redirect.
    it("refuses a destination that is not an in-app /quotes path", async () => {
      const app = createApp();
      for (const hostile of ["https://evil.example/steal", "//evil.example", "/admin", "/q/slug"]) {
        const res = await app.request("/login", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ password: STAFF_TOKEN, role: "staff", next: hostile }).toString(),
        });
        expect(res.headers.get("location"), `next=${hostile} escaped`).toBe("/quotes");
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

  it("opens the studio with the cookie alone — no token in the URL", async () => {
    const res = await signIn("staff");
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    const cookie = sessionCookie(res);
    expect(cookie).not.toBe("");

    const app = createApp();
    const studio = await app.request("/quotes", { headers: { cookie } });
    expect(studio.status).toBe(200);
    const html = await studio.text();
    expect(html).toContain("DEMO AUTH");
    expect(html).toContain("Staff Role: <strong>staff</strong>");
  });

  it("carries the demo role into the page", async () => {
    const res = await signIn("agent");
    const cookie = sessionCookie(res);

    const app = createApp();
    const studio = await app.request("/quotes", { headers: { cookie } });
    const html = await studio.text();
    expect(html).toContain("Staff Role: <strong>agent</strong>");
    expect(html).toContain("Agent view");
  });

  it("refuses a forged cookie as firmly as no cookie", async () => {
    const app = createApp();
    const res = await app.request("/quotes", { headers: { cookie: "casa_gais_session=forged.deadbeef" } });
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("still accepts the GAIS-shaped bearer header and the old query token", async () => {
    const app = createApp();
    const bearer = await app.request("/quotes", { headers: { authorization: `Bearer ${STAFF_TOKEN}` } });
    expect(bearer.status).toBe(200);

    const query = await app.request(`/quotes?token=${STAFF_TOKEN}`);
    expect(query.status).toBe(200);

    const header = await app.request("/quotes", { headers: { "x-verify-token": STAFF_TOKEN } });
    expect(header.status).toBe(200);
  });

  it("guards the JSON API with the same session", async () => {
    const app = createApp();
    expect((await app.request("/v1/quotes")).status).toBe(401);

    const res = await signIn("staff");
    const cookie = sessionCookie(res);
    expect((await app.request("/v1/quotes", { headers: { cookie } })).status).toBe(200);
  });
});

describe("switching the demo role", () => {
  it("refuses to mint a session for a caller who has none", async () => {
    const app = createApp();
    const res = await app.request("/login/role", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ role: "agent" }).toString(),
    });
    // Otherwise this endpoint would hand out an "agent" session to anyone who found it.
    expect(res.status).toBe(401);
    expect(sessionCookie(res)).toBe("");
  });

  it("re-issues the cookie with the new role for a signed-in viewer", async () => {
    const signInRes = await signIn("staff");
    const cookie = sessionCookie(signInRes);

    const app = createApp();
    const switched = await app.request("/login/role", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ role: "agent" }).toString(),
    });
    const newCookie = sessionCookie(switched);
    expect(newCookie).not.toBe("");

    const studio = await app.request("/quotes", { headers: { cookie: newCookie } });
    expect(await studio.text()).toContain("Staff Role: <strong>agent</strong>");
  });
});
