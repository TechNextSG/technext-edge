import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../src/app.ts";

describe("BFF Endpoints", () => {
  const app = createApp();

  it("responds 200 { ok: true } on /v1/health (canonical Delivery Plan endpoint)", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("responds 200 { ok: true } on /healthz (backward compatibility alias)", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("sends GET / to the studio, which sends a signed-out visitor on to sign in", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/quotes");
  });

  describe("the test console is for staff", () => {
    const STAFF = "staff-key-console";
    beforeEach(() => {
      vi.stubEnv("STAFF_ACCESS_KEY", STAFF);
      vi.stubEnv("WHATSAPP_VERIFY_TOKEN", STAFF);
    });
    afterEach(() => vi.unstubAllEnvs());

    it.each(["/test", "/test-console", "/console"])("%s sends a signed-out visitor to sign in", async (path) => {
      const res = await app.request(path);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it.each(["/test", "/test-console", "/console"])("%s opens for a staff session", async (path) => {
      const res = await app.request(path, { headers: { "x-verify-token": STAFF } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      // The console uses the server's model; it neither offers a provider list nor takes a key from the browser.
      expect(html).toContain("admin dashboard");
      expect(html).not.toContain('id="api-key"');
      expect(html).not.toContain('id="provider-select"');
    });
  });

  it.each(["/hub", "/benchmark", "/scenarios", "/status", "/roadmap", "/guide", "/showcase", "/plan", "/architecture", "/demo", "/diagrams"])(
    "no longer serves the documentation page %s",
    async (path) => {
      expect((await app.request(path)).status).toBe(404);
    },
  );
});
