// A fresh studio has no records (the cold-start sample is gone): /quotes must still open for staff.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../src/app.ts";

const STAFF = "staff-key-empty-studio";

beforeEach(() => {
  vi.stubEnv("STAFF_ACCESS_KEY", STAFF);
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", STAFF);
});
afterEach(() => vi.unstubAllEnvs());

describe("the studio before the first enquiry", () => {
  it("opens for staff with a sentence about what fills it, not a server error", async () => {
    const res = await createApp().request("/quotes", { headers: { "x-verify-token": STAFF } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No enquiries yet");
    expect(html).toContain('href="/handoff"');
  });

  it("still sends a signed-out visitor to sign in", async () => {
    const res = await createApp().request("/quotes");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("answers 404 for a quotation that does not exist, whoever asks", async () => {
    const res = await createApp().request("/quotes/QT-NOPE", { headers: { "x-verify-token": STAFF } });
    expect(res.status).toBe(404);
  });
});
