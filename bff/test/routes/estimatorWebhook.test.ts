import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { estimatorWebhookRoutes } from "../../src/routes/estimatorWebhook.ts";
import { createInMemoryConversationStore } from "../../src/store/conversationStore.ts";
import { createInMemoryQuotationStore } from "../../src/store/quotationStoreClient.ts";
import type { HonoQuotationDraft } from "../../src/quote/index.ts";

const SECRET = "test-webhook-secret-xyz";

function signPayload(body: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function mockQuotation(overrides: Partial<HonoQuotationDraft> = {}): HonoQuotationDraft {
  return {
    quoteId: "QT-1010-ANA",
    slug: "ana-1010",
    phone: "639171234567",
    status: "pending_hono_review",
    createdAt: "2026-10-15T10:00:00Z",
    updatedAt: "2026-10-15T10:00:00Z",
    bffTrip: {
      checkIn: "2026-11-20",
      checkOut: "2026-11-23",
      roomCount: 1,
      guestCount: 2,
      guests: [{ name: "Ana", days: {} }],
    },
    staffAlerts: [],
    pricing: null,
    estimator: {
      id: "est-ana-999",
      cookie: null,
      seq: 1,
      guestUrl: null,
      sharedAt: null,
    },
    ...overrides,
  };
}

describe("Pattern 5: Estimator Webhook Receiver", () => {
  it("rejects unauthorized webhook when HMAC signature is invalid", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();
    const app = new Hono().route("/", estimatorWebhookRoutes({
      store,
      quotationStore,
      webhookSecret: SECRET,
    }));

    const body = JSON.stringify({
      event: "approved",
      estimateId: "est-ana-999",
      timestamp: Date.now(),
      url: "https://casa.test/quote/token-123",
    });

    const res = await app.request("/v1/estimator/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-estimator-signature": "invalid_hex",
      },
      body,
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("invalid_signature");
  });

  it("rejects requests with stale timestamp older than 5 minutes", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();
    const app = new Hono().route("/", estimatorWebhookRoutes({
      store,
      quotationStore,
      webhookSecret: SECRET,
    }));

    const staleTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    const body = JSON.stringify({
      event: "approved",
      estimateId: "est-ana-999",
      timestamp: staleTime,
      url: "https://casa.test/quote/token-123",
    });

    const res = await app.request("/v1/estimator/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-estimator-signature": signPayload(body),
      },
      body,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("stale_timestamp");
  });

  it("processes 'approved' event: updates draft, transitions state to link_sent, and sends WhatsApp link", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();
    const q = mockQuotation();
    await quotationStore.save(q);

    // Initial state drafted
    await store.transitionState(q.phone!, { type: "DRAFT_CREATED", estimateId: "est-ana-999" });
    expect(await store.getState(q.phone!)).toBe("drafted");

    const sentMessages: { to: string; text: string }[] = [];
    const sendWhatsApp = async ({ to, body: text }: { to: string; body: string }) => {
      sentMessages.push({ to, text });
    };

    const app = new Hono().route("/", estimatorWebhookRoutes({
      store,
      quotationStore,
      sendWhatsApp,
      webhookSecret: SECRET,
    }));

    const now = Date.now();
    const quoteUrl = "https://casa.test/quote/token-ana-999";
    const body = JSON.stringify({
      event: "approved",
      estimateId: "est-ana-999",
      guestPhone: q.phone,
      url: quoteUrl,
      timestamp: now,
    });

    const res = await app.request("/v1/estimator/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-estimator-signature": signPayload(body),
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(true);

    // Verified quotation updated
    const updatedDraft = await quotationStore.get(q.quoteId);
    expect(updatedDraft?.status).toBe("confirmed_by_hono");
    expect(updatedDraft?.quotationUrl).toBe(quoteUrl);

    // Verified state transitioned to link_sent
    expect(await store.getState(q.phone!)).toBe("link_sent");

    // Verified WhatsApp link dispatched
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].to).toBe(q.phone);
    expect(sentMessages[0].text).toContain(quoteUrl);
  });

  it("is idempotent: duplicate webhook delivery is acknowledged without sending duplicate WhatsApp messages", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();
    const q = mockQuotation();
    await quotationStore.save(q);
    await store.transitionState(q.phone!, { type: "DRAFT_CREATED" });

    const sentMessages: { to: string; text: string }[] = [];
    const sendWhatsApp = async ({ to, body: text }: { to: string; body: string }) => {
      sentMessages.push({ to, text });
    };

    const app = new Hono().route("/", estimatorWebhookRoutes({
      store,
      quotationStore,
      sendWhatsApp,
      webhookSecret: SECRET,
    }));

    const now = Date.now();
    const body = JSON.stringify({
      event: "approved",
      estimateId: "est-ana-999",
      guestPhone: q.phone,
      url: "https://casa.test/quote/token-ana-999",
      timestamp: now,
    });
    const headers = {
      "content-type": "application/json",
      "x-estimator-signature": signPayload(body),
    };

    const res1 = await app.request("/v1/estimator/webhook", { method: "POST", headers, body });
    expect(res1.status).toBe(200);
    expect((await res1.json()).processed).toBe(true);

    // Redelivery with same body & signature
    const res2 = await app.request("/v1/estimator/webhook", { method: "POST", headers, body });
    expect(res2.status).toBe(200);
    expect((await res2.json()).duplicate).toBe(true);

    // Still only 1 WhatsApp message sent
    expect(sentMessages).toHaveLength(1);
  });

  it("processes 'archived' event: cancels draft and transitions state to handed_off", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();
    const q = mockQuotation();
    await quotationStore.save(q);
    await store.transitionState(q.phone!, { type: "DRAFT_CREATED" });

    const app = new Hono().route("/", estimatorWebhookRoutes({
      store,
      quotationStore,
      webhookSecret: SECRET,
    }));

    const body = JSON.stringify({
      event: "archived",
      estimateId: "est-ana-999",
      guestPhone: q.phone,
      timestamp: Date.now(),
    });

    const res = await app.request("/v1/estimator/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-estimator-signature": signPayload(body),
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Verified quotation cancelled
    const updatedDraft = await quotationStore.get(q.quoteId);
    expect(updatedDraft?.status).toBe("cancelled");

    // Verified state transitioned to handed_off
    expect(await store.getState(q.phone!)).toBe("handed_off");
  });

  it("fails closed with 503 when ESTIMATOR_WEBHOOK_SECRET is not configured, rejecting valid body and not sending WhatsApp", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();
    const q = mockQuotation();
    await quotationStore.save(q);

    const sentMessages: { to: string; text: string }[] = [];
    const sendWhatsApp = async ({ to, body: text }: { to: string; body: string }) => {
      sentMessages.push({ to, text });
    };

    // Note: webhookSecret is undefined
    const app = new Hono().route("/", estimatorWebhookRoutes({
      store,
      quotationStore,
      sendWhatsApp,
      webhookSecret: undefined,
    }));

    const body = JSON.stringify({
      event: "approved",
      estimateId: "est-ana-999",
      url: "https://casa.test/quote/token-ana-999",
      timestamp: Date.now(),
    });

    const res = await app.request("/v1/estimator/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-estimator-signature": signPayload(body, "any-secret"),
      },
      body,
    });

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("webhook_secret_not_configured");
    expect(sentMessages).toHaveLength(0);
  });

  it("looks up quotation strictly by estimateId, refusing to match quotation by guestPhone", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();
    const q = mockQuotation({ estimator: { id: "est-ana-999", cookie: null, seq: 1, guestUrl: null, sharedAt: null } });
    await quotationStore.save(q);

    const sentMessages: { to: string; text: string }[] = [];
    const sendWhatsApp = async ({ to, body: text }: { to: string; body: string }) => {
      sentMessages.push({ to, text });
    };

    const app = new Hono().route("/", estimatorWebhookRoutes({
      store,
      quotationStore,
      sendWhatsApp,
      webhookSecret: SECRET,
    }));

    // Payload has the guest's phone, but a different estimateId
    const body = JSON.stringify({
      event: "approved",
      estimateId: "est-different-id",
      guestPhone: q.phone,
      url: "https://casa.test/quote/token-ana-999",
      timestamp: Date.now(),
    });

    const res = await app.request("/v1/estimator/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-estimator-signature": signPayload(body),
      },
      body,
    });

    // Should NOT match q and should NOT send WhatsApp
    expect(sentMessages).toHaveLength(0);
    const untouchedDraft = await quotationStore.get(q.quoteId);
    expect(untouchedDraft?.status).toBe("pending_hono_review");
    expect(res.status).toBe(404);
  });

  it("uses KV dedupe with SET NX 24h TTL to claim events before sending WhatsApp", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();
    const q = mockQuotation();
    await quotationStore.save(q);

    const kvCalls: (string | number)[][] = [];
    const mockKv = {
      url: "https://mock-kv.upstash.io",
      token: "mock-token",
    };

    // Intercept fetch for mock Kv
    const originalFetch = globalThis.fetch;
    let setNxCallCount = 0;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === "string" && input.includes("mock-kv.upstash.io")) {
        const cmd = JSON.parse(init?.body as string);
        kvCalls.push(cmd);
        if (cmd[0] === "SET" && cmd.includes("NX")) {
          setNxCallCount++;
          // First call succeeds, second call returns null (already claimed)
          if (setNxCallCount === 1) {
            return new Response(JSON.stringify({ result: "OK" }));
          } else {
            return new Response(JSON.stringify({ result: null }));
          }
        }
        return new Response(JSON.stringify({ result: "OK" }));
      }
      return originalFetch(input, init);
    };

    try {
      const sentMessages: { to: string; text: string }[] = [];
      const sendWhatsApp = async ({ to, body: text }: { to: string; body: string }) => {
        sentMessages.push({ to, text });
      };

      const app = new Hono().route("/", estimatorWebhookRoutes({
        store,
        quotationStore,
        sendWhatsApp,
        webhookSecret: SECRET,
        kv: mockKv,
      }));

      const body = JSON.stringify({
        event: "approved",
        estimateId: "est-ana-999",
        url: "https://casa.test/quote/token-ana-999",
        timestamp: Date.now(),
      });
      const headers = {
        "content-type": "application/json",
        "x-estimator-signature": signPayload(body),
      };

      const res1 = await app.request("/v1/estimator/webhook", { method: "POST", headers, body });
      expect(res1.status).toBe(200);
      expect((await res1.json()).processed).toBe(true);
      expect(sentMessages).toHaveLength(1);

      // Verify KV SET NX was called with 86400 (24h) TTL
      const setNxCmd = kvCalls.find((cmd) => cmd[0] === "SET" && cmd.includes("NX"));
      expect(setNxCmd).toBeDefined();
      expect(setNxCmd).toContain(86400);

      // Retry should be recognized as duplicate via KV
      const res2 = await app.request("/v1/estimator/webhook", { method: "POST", headers, body });
      expect(res2.status).toBe(200);
      expect((await res2.json()).duplicate).toBe(true);
      expect(sentMessages).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
