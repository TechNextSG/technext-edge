// Every page this service renders is HTML with an inline <script>. Those scripts live inside
// TypeScript template literals, where a single `\n` is a REAL newline by the time it reaches the
// browser. This file verifies that each rendered page parses its JavaScript without SyntaxError,
// and adheres to unified design tokens.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createApp } from "../../src/app.ts";

const STAFF_TOKEN = "test-staff-token";
const savedToken = process.env.WHATSAPP_VERIFY_TOKEN;

beforeAll(() => {
  process.env.WHATSAPP_VERIFY_TOKEN = STAFF_TOKEN;
});
afterAll(() => {
  if (savedToken === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
  else process.env.WHATSAPP_VERIFY_TOKEN = savedToken;
});

/** Every inline script body on a page. */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map((m) => m[1] ?? "")
    .filter((code) => code.trim() !== "");
}

/** `new Function` compiles the body without running it — a SyntaxError here is what the browser hits. */
function firstSyntaxError(code: string): string | null {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    return null;
  } catch (err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
}

describe("the JavaScript on every rendered page parses", () => {
  it("the sign-in page", async () => {
    const app = createApp();
    const html = await (await app.request("/login")).text();

    for (const [i, code] of inlineScripts(html).entries()) {
      expect(firstSyntaxError(code), `login script #${i + 1} does not parse`).toBeNull();
    }
  });

  it("the handoff inbox", async () => {
    const app = createApp();
    const html = await (await app.request(`/handoff?token=${STAFF_TOKEN}`)).text();

    for (const [i, code] of inlineScripts(html).entries()) {
      expect(firstSyntaxError(code), `handoff script #${i + 1} does not parse`).toBeNull();
    }
  });

  it("the AI settings dashboard", async () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", "test-admin-key");
    const app = createApp();
    const html = await (await app.request("/admin/ai", { headers: { "x-admin-key": "test-admin-key" } })).text();

    for (const [i, code] of inlineScripts(html).entries()) {
      expect(firstSyntaxError(code), `admin script #${i + 1} does not parse`).toBeNull();
    }
    vi.unstubAllEnvs();
  });

  it("the test console", async () => {
    const app = createApp();
    const html = await (await app.request(`/test?token=${STAFF_TOKEN}`)).text();

    for (const [i, code] of inlineScripts(html).entries()) {
      expect(firstSyntaxError(code), `test script #${i + 1} does not parse`).toBeNull();
    }
  });
});

/**
 * One palette across every page staff and guests walk through.
 */
describe("every page draws from one set of colour tokens", () => {
  const LIGHT_BG = "--bg: #f8fafc;";
  const LIGHT_ACCENT = "--accent: #0284c7;";
  const DARK_ACCENT = "--accent: #38bdf8;";

  it("carries the shared tokens on sign-in, handoff, docs, and admin dashboard", async () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", "test-admin-key");
    const app = createApp();

    const pages: Array<[string, string]> = [
      ["sign-in", await (await app.request("/login")).text()],
      ["handoff", await (await app.request(`/handoff?token=${STAFF_TOKEN}`)).text()],
      ["docs", await (await app.request(`/docs?token=${STAFF_TOKEN}`)).text()],
      ["admin", await (await app.request("/admin/ai", { headers: { "x-admin-key": "test-admin-key" } })).text()],
    ];

    for (const [name, html] of pages) {
      expect(html, `${name} is missing the shared light background`).toContain(LIGHT_BG);
      expect(html, `${name} is missing the shared light accent`).toContain(LIGHT_ACCENT);
      expect(html, `${name} is missing the shared dark accent`).toContain(DARK_ACCENT);
    }
    vi.unstubAllEnvs();
  });
});
