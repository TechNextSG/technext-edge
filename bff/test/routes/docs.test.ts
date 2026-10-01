// /docs: the documents staff can read in the browser. A fixed list; the URL picks an entry, never a path.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/app.ts";
import { DOCUMENTS } from "../../src/routes/docs.ts";

const STAFF = "staff-key-docs";
const staff = { "x-verify-token": STAFF };
const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs");

beforeEach(() => {
  vi.stubEnv("STAFF_ACCESS_KEY", STAFF);
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", STAFF);
});
afterEach(() => vi.unstubAllEnvs());

describe("the documents page", () => {
  it("sends a signed-out visitor to sign in, for the list and for every document", async () => {
    const app = createApp();
    for (const p of ["/docs", ...DOCUMENTS.map((d) => `/docs/${d.slug}`)]) {
      const res = await app.request(p);
      expect(res.status, p).toBe(302);
      expect(res.headers.get("location"), p).toBe("/login");
    }
  });

  it("lists every document for a staff session", async () => {
    const res = await createApp().request("/docs", { headers: staff });
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const d of DOCUMENTS) expect(html).toContain(`href="/docs/${d.slug}"`);
  });

  it("serves each document as a full HTML page", async () => {
    const app = createApp();
    for (const d of DOCUMENTS) {
      const res = await app.request(`/docs/${d.slug}`, { headers: staff });
      expect(res.status, d.slug).toBe(200);
      expect(res.headers.get("content-type"), d.slug).toContain("text/html");
      expect((await res.text()).toLowerCase(), d.slug).toContain("<!doctype html");
    }
  });

  it("has a file behind every entry (a rename that forgets this list fails here)", () => {
    const missing = DOCUMENTS.filter((d) => !existsSync(path.join(docsDir, d.file))).map((d) => d.file);
    expect(missing).toEqual([]);
  });

  it("answers 404 for anything not in the list, including a path that tries to leave docs/", async () => {
    const app = createApp();
    for (const p of ["/docs/nope", "/docs/..%2f..%2f.env", "/docs/%2e%2e%2fpackage.json", "/docs/ARCHITECTURE.md", "/docs/guides%2fmanual-test-checklist.html"]) {
      const res = await app.request(p, { headers: staff });
      expect(res.status, p).toBe(404);
    }
  });
});
