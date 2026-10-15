import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../../../src/app.ts";
import { createInMemoryConversationStore } from "../../../src/store/conversationStore.ts";
import { createInMemoryQuotationStore } from "../../../src/store/quotationStoreClient.ts";
import type { ExtractProvider } from "../../../../ai/src/index.ts";
import type { EstimatorPort } from "../../../src/estimator/port.ts";
import type { BffTrip } from "../../../../contracts/src/index.ts";

const VERIFY_TOKEN = "casa-verify-token";
const APP_SECRET = "casa-app-secret";
const WEBHOOK_SECRET = "estimator-webhook-secret-999";
const GUEST = "639179998888";

function signMeta(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function signEstimator(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function textEvent(id: string, text: string, from = GUEST): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "639170000000", phone_number_id: "PHONE_ID" },
              contacts: [{ wa_id: from, profile: { name: "Guest" } }],
              messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

describe("Pattern 5 End-to-End: State Machine, Outbox & Signed Approval Webhook", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
    vi.stubEnv("ESTIMATOR_WEBHOOK_SECRET", WEBHOOK_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("walks the complete lifecycle: collecting -> drafted (ready+201) -> link_sent (webhook approved) -> handed_off", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();

    let createDraftCount = 0;
    const estimator: EstimatorPort = {
      async createDraft(trip: BffTrip) {
        createDraftCount++;
        return {
          ok: true,
          id: "est-e2e-777",
          seq: 1,
          computedAt: "2026-10-15T12:00:00Z",
        };
      },
      async calculatePrice() {
        return { ok: false, reason: "unimplemented" as const };
      },
      async validate() {
        return { ok: true, valid: true };
      },
      async submit() {
        return { ok: false, reason: "unimplemented" as const };
      },
    };

    const sentWhatsApp: { to: string; body: string }[] = [];
    const sendWhatsApp = async ({ to, body }: { to: string; body: string }) => {
      sentWhatsApp.push({ to, body });
    };

    const PARTIAL_RAW = {
      language: { value: null, state: "missing", evidence: null },
      checkIn: { value: null, state: "stated", evidence: "next Saturday" },
      checkOut: { value: null, state: "missing", evidence: null },
      nights: { value: 3, state: "stated", evidence: "3 nights" },
      guests: { value: null, state: "missing", evidence: null },
      rooms: { value: null, state: "missing", evidence: null },
      roomType: { value: null, state: "missing", evidence: null },
      meals: { value: null, state: "missing", evidence: null },
      transport: { value: null, state: "missing", evidence: null },
      contactName: { value: null, state: "missing", evidence: null },
      diver: { value: null, state: "missing", evidence: null },
      diveFrom: { value: null, state: "missing", evidence: null },
      diveTo: { value: null, state: "missing", evidence: null },
      transportType: { value: null, state: "missing", evidence: null },
    };

    const COMPLETE_RAW = {
      ...PARTIAL_RAW,
      guests: { value: 4, state: "stated", evidence: "4 of us" },
      roomType: { value: "suite", state: "stated", evidence: "the suite" },
      contactName: { value: "Ana", state: "stated", evidence: "Ana" },
      diver: { value: false, state: "stated", evidence: "no diving" },
    };

    const sequence = [PARTIAL_RAW, COMPLETE_RAW, COMPLETE_RAW];
    let seqIdx = 0;
    const provider: ExtractProvider = {
      id: "fake:sequence",
      call: vi.fn().mockImplementation(async () => {
        const raw = sequence[Math.min(seqIdx, sequence.length - 1)];
        seqIdx++;
        return { raw, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 };
      }),
    };

    const env = {
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      WHATSAPP_APP_SECRET: APP_SECRET,
      ESTIMATOR_WEBHOOK_SECRET: WEBHOOK_SECRET,
    };

    const app = createApp({
      env,
      store,
      quotationStore,
      estimator,
      sendWhatsApp,
      provider,
    });

    // 1. Initial inbound message -> State is "collecting"
    const event1 = textEvent("m1", "Hi, next Saturday for 3 nights");
    await app.request("/v1/channels/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": signMeta(event1), "content-type": "application/json" },
      body: event1,
    });

    expect(await store.getState(GUEST)).toBe("collecting");
    expect(createDraftCount).toBe(0);

    // 2. Complete information provided -> Calls Estimator createDraft (201) -> State transitions to "drafted"
    const event2 = textEvent("m2", "4 of us, the suite, no diving, my name is Ana");
    const res2 = await app.request("/v1/channels/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": signMeta(event2), "content-type": "application/json" },
      body: event2,
    });
    if (res2.status !== 200) {
      console.log("res2 error body:", await res2.json());
    }
    expect(res2.status).toBe(200);

    expect(createDraftCount).toBe(1);
    expect(await store.getState(GUEST)).toBe("drafted");

    const all = await quotationStore.list();
    const draft = all.find((q) => q.phone === GUEST);
    expect(draft).toBeDefined();
    expect(draft?.estimator?.id).toBe("est-e2e-777");

    // Guest was notified that reservations team is preparing the quotation
    expect(sentWhatsApp[sentWhatsApp.length - 1].body).toContain("preparing your quotation now");

    // 3. Staff in Trips clicks Save + Share -> Estimator sends signed HMAC webhook -> State transitions to "link_sent"
    const webhookApprovedPayload = JSON.stringify({
      event: "approved",
      estimateId: "est-e2e-777",
      guestPhone: GUEST,
      guestName: "Ana",
      url: "https://casa.test/quote/guest-link-777",
      timestamp: Date.now(),
    });

    const webhookRes = await app.request("/v1/estimator/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-estimator-signature": signEstimator(webhookApprovedPayload),
      },
      body: webhookApprovedPayload,
    });
    expect(webhookRes.status).toBe(200);
    expect((await webhookRes.json()).processed).toBe(true);

    expect(await store.getState(GUEST)).toBe("link_sent");

    // Quotation draft has quotationUrl and confirmed status
    const approvedDraft = await quotationStore.get(draft!.quoteId);
    expect(approvedDraft?.status).toBe("confirmed_by_hono");
    expect(approvedDraft?.quotationUrl).toBe("https://casa.test/quote/guest-link-777");

    // WhatsApp dispatched link to guest
    const lastMsg = sentWhatsApp[sentWhatsApp.length - 1];
    expect(lastMsg.to).toBe(GUEST);
    expect(lastMsg.body).toContain("https://casa.test/quote/guest-link-777");

    // 4. Guest asks to talk to human staff -> State transitions to "handed_off"
    const event3 = textEvent("m3", "Can I speak to someone about boat transfers?");
    await app.request("/v1/channels/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": signMeta(event3), "content-type": "application/json" },
      body: event3,
    });

    expect(await store.getState(GUEST)).toBe("handed_off");
  });
});
