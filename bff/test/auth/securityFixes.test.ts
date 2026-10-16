import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/app.ts";
import { renderHandoffPageHtml } from "../../src/views/handoffPage.ts";
import { buildHonoQuotationDraft } from "../../src/quote/application/quotationTool.ts";
import { createInMemoryConversationStore } from "../../src/store/conversationStore.ts";
import { createInMemoryQuotationStore } from "../../src/store/quotationStoreClient.ts";
import type { ExtractProvider, Trip } from "../../../ai/src/index.ts";

const STAFF_KEY = "test-staff-key-xyz";
const ADMIN_KEY = "test-admin-key-abc";

const COMPLETE_RAW = {
  language: { value: null, state: "missing" as const, evidence: null },
  checkIn: { value: null, state: "stated" as const, evidence: "next Saturday" },
  checkOut: { value: null, state: "missing" as const, evidence: null },
  nights: { value: 3, state: "stated" as const, evidence: "3 nights" },
  guests: { value: 4, state: "stated" as const, evidence: "4 of us" },
  rooms: { value: null, state: "missing" as const, evidence: null },
  roomType: { value: "suite", state: "stated" as const, evidence: "the suite" },
  meals: { value: null, state: "missing" as const, evidence: null },
  transport: { value: null, state: "missing" as const, evidence: null },
  contactName: { value: "Ana", state: "stated" as const, evidence: "Ana" },
  diver: { value: false, state: "stated" as const, evidence: "no diving" },
  diveFrom: { value: null, state: "missing" as const, evidence: null },
  diveTo: { value: null, state: "missing" as const, evidence: null },
  transportType: { value: null, state: "missing" as const, evidence: null },
};

function mockTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    language: { value: "en", state: "stated", evidence: "English" },
    checkIn: { value: "2026-11-20", state: "stated", evidence: "Nov 20" },
    checkOut: { value: "2026-11-23", state: "stated", evidence: "Nov 23" },
    nights: { value: 3, state: "stated", evidence: "3 nights" },
    guests: { value: 2, state: "stated", evidence: "2 guests" },
    rooms: { value: 1, state: "stated", evidence: "1 room" },
    roomType: { value: "deluxe", state: "stated", evidence: "deluxe" },
    meals: { value: "full_board", state: "stated", evidence: "full board" },
    transport: { value: null, state: "missing", evidence: null },
    contactName: { value: "Malicious <script>alert(1)</script>", state: "stated", evidence: "name" },
    diver: { value: false, state: "stated", evidence: "no diving" },
    diveFrom: { value: null, state: "missing", evidence: null },
    diveDays: { value: null, state: "missing", evidence: null },
    guestType: { value: null, state: "missing", evidence: null },
    notes: { value: null, state: "missing", evidence: null },
    specialRequests: { value: null, state: "missing", evidence: null },
    dietNotes: { value: null, state: "missing", evidence: null },
    transferDirection: { value: null, state: "missing", evidence: null },
    discountPercent: { value: 0, state: "stated", evidence: "none" },
    days: [
      { date: "2026-11-20", dives: 0 },
      { date: "2026-11-21", dives: 0 },
      { date: "2026-11-22", dives: 0 },
      { date: "2026-11-23", dives: 0 },
    ],
    extraDayCount: 0,
    ...overrides,
  };
}

describe("Security Fixes & Regressions", () => {
  beforeEach(() => {
    vi.stubEnv("STAFF_ACCESS_KEY", STAFF_KEY);
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("1. XSS Escaping on Handoff Page", () => {
    it("escapes guest names and context on the handoff page", () => {
      const xssPhone = "+639170001111<img src=x onerror=alert('xss')>";
      const xssContext = "Guest said: <script>alert('xss')</script> and & < ' \"";
      const xssReason = "help_me<script>evil()</script>";

      const html = renderHandoffPageHtml(
        [
          {
            phone: xssPhone,
            reason: xssReason,
            since: Date.now() - 60_000,
            toldAt: 0,
            context: xssContext,
            missingFields: ["checkIn"],
          },
        ],
        "staff",
      );

      // Verify unescaped tags are not present
      expect(html).not.toContain("<script>alert('xss')</script>");
      expect(html).not.toContain("<img src=x onerror=alert('xss')>");
      expect(html).not.toContain("<script>evil()</script>");

      // Verify properly escaped entities
      expect(html).toContain("&lt;script&gt;alert('xss')&lt;/script&gt;");
      expect(html).toContain("&lt;img src=x onerror=alert('xss')&gt;");
    });
  });

  describe("2. AI Submit / Converse Session Requirement", () => {
    it("refuses to persist quotation or return draft to anonymous converse callers", async () => {
      const quotationStore = createInMemoryQuotationStore();
      const sequence = [COMPLETE_RAW];
      let seqIdx = 0;
      const mockProvider: ExtractProvider = {
        id: "mock:provider",
        call: async () => ({
          raw: sequence[Math.min(seqIdx++, sequence.length - 1)],
          tokensIn: 10,
          tokensOut: 10,
          cacheReadTokens: 0,
          ms: 5,
        }),
      };

      const app = createApp({
        env: {
          STAFF_ACCESS_KEY: STAFF_KEY,
          ENABLE_HONO_QUOTATION_TOOL: "true",
        },
        quotationStore,
        provider: mockProvider,
      });

      const res = await app.request("/v1/converse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          history: [{ role: "guest", text: "Hi, next Saturday for 3 nights" }],
          message: "4 of us, the suite, no diving, my name is Ana",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.quotationSaved).toBe(false);
      expect(json.quotationDraft).toBeUndefined();
      expect(json.quotationNote).toContain("sign in to the staff studio to open one");

      // Verify quotationStore remains empty
      const stored = await quotationStore.list();
      expect(stored).toHaveLength(0);
    });

    it("rejects custom provider and apiKey overrides without staff credentials", async () => {
      const app = createApp();

      const res = await app.request("/v1/converse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "Test enquiry",
          provider: "anthropic",
          apiKey: "unauthorized-api-key",
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("unauthorized");
    });
  });

  describe("3. Open Redirect Protection on Login ('next' deep link)", () => {
    it("redirects only to safe allowed paths, rejecting external and protocol-relative URLs", async () => {
      const app = createApp();

      const maliciousTargets = [
        "https://evil.attacker.com/steal-cookie",
        "http://attacker.com",
        "//attacker.com/test",
        "javascript:alert(document.cookie)",
        "/unknown/external/path",
      ];

      for (const target of maliciousTargets) {
        const formData = new URLSearchParams();
        formData.set("password", STAFF_KEY);
        formData.set("next", target);

        const res = await app.request("/login", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: formData.toString(),
        });

        expect(res.status).toBe(302);
        const location = res.headers.get("location");
        // Must safely fall back to /handoff instead of following malicious target
        expect(location).toBe("/handoff");
      }
    });

    it("preserves valid same-origin safe paths", async () => {
      const app = createApp();
      const safePaths = ["/handoff", "/docs", "/admin/ai"];

      for (const safePath of safePaths) {
        const formData = new URLSearchParams();
        formData.set("password", STAFF_KEY);
        formData.set("next", safePath);

        const res = await app.request("/login", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: formData.toString(),
        });

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(safePath);
      }
    });
  });

  describe("4. Non-guessable UUID Quotation Slugs", () => {
    it("generates a random UUID v4 slug, completely decoupled from guessable guest PII or dates", () => {
      const trip = mockTrip({
        contactName: { value: "Celebrity Guest", state: "stated", evidence: "Celebrity Guest" },
        checkIn: { value: "2026-12-25", state: "stated", evidence: "Christmas" },
      });

      const draft = buildHonoQuotationDraft(trip);

      // Slug MUST be a standard RFC4122 UUID v4
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(draft.slug).toMatch(uuidV4Regex);

      // Slug must not expose PII
      expect(draft.slug.toLowerCase()).not.toContain("celebrity");
      expect(draft.slug.toLowerCase()).not.toContain("guest");
      expect(draft.slug).not.toContain("20261225");
      expect(draft.slug).not.toContain("1225");
    });
  });

  describe("5. 401 Responses Do Not Leak PII", () => {
    it("does not leak guest name, phone, or email in 401 unauthorized responses", async () => {
      const app = createApp();
      const sensitiveGuestName = "Secret Guest VIP";
      const sensitiveGuestPhone = "639178887777";

      // 1. Unauthenticated request with provider override containing sensitive body
      const res = await app.request("/v1/converse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: `Booking for ${sensitiveGuestName} phone ${sensitiveGuestPhone}`,
          provider: "anthropic",
          apiKey: "unauthorized-key",
        }),
      });

      expect(res.status).toBe(401);
      const resText = await res.text();

      expect(resText).not.toContain(sensitiveGuestName);
      expect(resText).not.toContain(sensitiveGuestPhone);
      expect(JSON.parse(resText)).toEqual({
        error: "unauthorized",
        detail: "choosing a provider or sending an API key needs a staff session",
      });
    });
  });
});
