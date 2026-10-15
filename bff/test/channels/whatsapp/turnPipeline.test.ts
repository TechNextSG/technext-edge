import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../../../src/app.ts";
import { createInMemoryConversationStore, type ConversationStore } from "../../../src/store/conversationStore.ts";
import { createInMemoryQuotationStore } from "../../../src/store/quotationStoreClient.ts";
import { ASK_LIMIT, STALL_LIMIT } from "../../../../ai/src/index.ts";
import type { ExtractProvider } from "../../../../ai/src/index.ts";

const VERIFY_TOKEN = "casa-verify-token";
const APP_SECRET = "casa-app-secret";
const GUEST = "639178888888";

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

const COMPLETE_TEXT = "4 of us next Saturday for 3 nights, the suite, no diving, my name is Ana";

function providerReturning(raw: unknown): ExtractProvider {
  return {
    id: "fake:v1",
    call: vi.fn().mockResolvedValue({ raw, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 }),
  };
}

function providerSequence(sequence: unknown[]): ExtractProvider & { call: ReturnType<typeof vi.fn> } {
  let index = 0;
  const call = vi.fn().mockImplementation(async () => {
    const raw = sequence[Math.min(index, sequence.length - 1)];
    index++;
    return { raw, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 };
  });
  return { id: "fake:sequence", call };
}

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
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
              metadata: { display_phone_number: "15551234567", phone_number_id: "PHONE_ID" },
              contacts: [{ profile: { name: "Guest" }, wa_id: from }],
              messages: [{ from, id, timestamp: "1789700000", type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

function harness(
  provider: ExtractProvider,
  store: ConversationStore = createInMemoryConversationStore(),
  quotationStore = createInMemoryQuotationStore(),
) {
  const sent: Array<{ to: string; body: string }> = [];
  const app = createApp({
    provider,
    store,
    quotationStore,
    sendWhatsApp: async (message) => {
      sent.push(message);
    },
  });
  return { app, sent, store, quotationStore };
}

function post(app: ReturnType<typeof createApp>, body: string, signature = sign(body)) {
  return app.request("/v1/channels/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body,
  });
}

describe("P3: Pattern 4 Turn Pipeline & ASK_LIMIT Fixes", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("1. tin thứ 9 hoàn tất phải ra nháp (không bị chặn bởi ASK_LIMIT)", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();

    // Seed 8 prior turns in history (assistantTurns = 8, exactly ASK_LIMIT)
    for (let i = 1; i <= ASK_LIMIT; i++) {
      await store.append(
        GUEST,
        { role: "guest", text: `I have a question ${i}` },
        { role: "assistant", text: `Question ${i} reply asking for more info` },
      );
    }

    // On turn 9, guest provides all missing info so the trip is complete!
    const { app, sent } = harness(providerReturning(COMPLETE_RAW), store, quotationStore);

    const res = await post(app, textEvent("wamid.turn9", COMPLETE_TEXT));
    expect(res.status).toBe(200);

    // Thread must NOT be paused
    const paused = await store.paused(GUEST);
    expect(paused).toBeUndefined();

    // A quotation draft must be created in the quotation store
    const quotations = await quotationStore.list();
    const guestQuote = quotations.find((q) => q.phone === GUEST);
    expect(guestQuote).toBeDefined();
    expect(guestQuote?.bffTrip?.guests?.length).toBe(4);

    // Reply must tell guest that reservations team is preparing the quotation
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("reservations team is preparing your quotation");
  });

  it("2. trả lời mỗi tin một ý suốt 10 tin không bị cắt", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();

    // 10 stages of progressive information disclosure where guest provides new facts each turn
    const texts = [
      "Hi, next Saturday for 3 nights",
      "there are 4 of us",
      "we would like 2 rooms",
      "the suite room please",
      "full board meals",
      "no airport transfer needed",
      "no diving for our trip",
      "my name is Minh",
      "please prepare vegetarian food",
      "and we need late check in",
    ];

    const stages = [
      { ...PARTIAL_RAW },
      { ...PARTIAL_RAW, guests: { value: 4, state: "stated", evidence: "4 of us" } },
      { ...PARTIAL_RAW, guests: { value: 4, state: "stated", evidence: "4 of us" }, rooms: { value: 2, state: "stated", evidence: "2 rooms" } },
      { ...PARTIAL_RAW, guests: { value: 4, state: "stated", evidence: "4 of us" }, rooms: { value: 2, state: "stated", evidence: "2 rooms" }, roomType: { value: "suite", state: "stated", evidence: "the suite" } },
      { ...PARTIAL_RAW, guests: { value: 4, state: "stated", evidence: "4 of us" }, rooms: { value: 2, state: "stated", evidence: "2 rooms" }, roomType: { value: "suite", state: "stated", evidence: "the suite" }, meals: { value: "full_board", state: "stated", evidence: "full board" } },
      { ...PARTIAL_RAW, guests: { value: 4, state: "stated", evidence: "4 of us" }, rooms: { value: 2, state: "stated", evidence: "2 rooms" }, roomType: { value: "suite", state: "stated", evidence: "the suite" }, meals: { value: "full_board", state: "stated", evidence: "full board" }, transport: { value: false, state: "stated", evidence: "no airport transfer" } },
      { ...PARTIAL_RAW, guests: { value: 4, state: "stated", evidence: "4 of us" }, rooms: { value: 2, state: "stated", evidence: "2 rooms" }, roomType: { value: "suite", state: "stated", evidence: "the suite" }, meals: { value: "full_board", state: "stated", evidence: "full board" }, transport: { value: false, state: "stated", evidence: "no airport transfer" }, diver: { value: false, state: "stated", evidence: "no diving" } },
      { ...PARTIAL_RAW, guests: { value: 4, state: "stated", evidence: "4 of us" }, rooms: { value: 2, state: "stated", evidence: "2 rooms" }, roomType: { value: "suite", state: "stated", evidence: "the suite" }, meals: { value: "full_board", state: "stated", evidence: "full board" }, transport: { value: false, state: "stated", evidence: "no airport transfer" }, diver: { value: false, state: "stated", evidence: "no diving" }, contactName: { value: "Minh", state: "stated", evidence: "Minh" } },
      { ...PARTIAL_RAW, guests: { value: 4, state: "stated", evidence: "4 of us" }, rooms: { value: 2, state: "stated", evidence: "2 rooms" }, roomType: { value: "suite", state: "stated", evidence: "the suite" }, meals: { value: "full_board", state: "stated", evidence: "full board" }, transport: { value: false, state: "stated", evidence: "no airport transfer" }, diver: { value: false, state: "stated", evidence: "no diving" }, contactName: { value: "Minh", state: "stated", evidence: "Minh" }, dietNotes: { value: "vegetarian", state: "stated", evidence: "vegetarian" } },
      { ...PARTIAL_RAW, guests: { value: 4, state: "stated", evidence: "4 of us" }, rooms: { value: 2, state: "stated", evidence: "2 rooms" }, roomType: { value: "suite", state: "stated", evidence: "the suite" }, meals: { value: "full_board", state: "stated", evidence: "full board" }, transport: { value: false, state: "stated", evidence: "no airport transfer" }, diver: { value: false, state: "stated", evidence: "no diving" }, contactName: { value: "Minh", state: "stated", evidence: "Minh" }, dietNotes: { value: "vegetarian", state: "stated", evidence: "vegetarian" }, specialRequests: { value: "late check in", state: "stated", evidence: "late check in" } },
    ];

    const provider = providerSequence(stages);
    const { app, sent } = harness(provider, store, quotationStore);

    for (let i = 0; i < 10; i++) {
      const res = await post(app, textEvent(`wamid.step.${i + 1}`, texts[i]));
      expect(res.status).toBe(200);
      // None of the 10 messages should be cut off by asking_limit
      expect(await store.paused(GUEST)).toBeUndefined();
    }

    expect(sent).toHaveLength(10);
    // Every reply is conversing, none handed off to staff
    expect(sent.every((s) => !s.body.includes("passed your enquiry"))).toBe(true);
  });

  it("3. lặp lại 3 lần không có gì mới thì chuyển người (stalled handoff)", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();

    // Constant partial payload with missing fields
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider, store, quotationStore);

    // Initial message
    await post(app, textEvent("wamid.init", "Hi, next Saturday for 3 nights please"));
    expect(await store.paused(GUEST)).toBeUndefined();

    // 3 repetitive messages providing no new facts
    for (let i = 1; i <= STALL_LIMIT; i++) {
      const res = await post(app, textEvent(`wamid.repeat.${i}`, `Same question repeat ${i}`));
      expect(res.status).toBe(200);
    }

    // After 3 uninformative replies, the thread must be paused for stall handoff
    const paused = await store.paused(GUEST);
    expect(paused).toBeDefined();
    expect(paused?.reason).toBe("stalled");

    // The last sent message must use the stalled reply explaining human takeover
    expect(sent.length).toBeGreaterThanOrEqual(4);
    expect(sent[sent.length - 1].body).toContain("Rather than ask you the same things again");
  });

  it("4. đã có nháp, sửa nhiều lần vẫn cập nhật nháp (không bị chặn bởi ASK_LIMIT)", async () => {
    const store = createInMemoryConversationStore();
    const quotationStore = createInMemoryQuotationStore();

    // Step 1: Create initial draft
    const { app, sent } = harness(providerReturning(COMPLETE_RAW), store, quotationStore);
    await post(app, textEvent("wamid.first", COMPLETE_TEXT));

    const initialQuotes = await quotationStore.list();
    const draft = initialQuotes.find((q) => q.phone === GUEST);
    expect(draft).toBeDefined();

    // Step 2: Seed conversation history up to 12 turns (exceeding ASK_LIMIT)
    for (let i = 1; i <= 6; i++) {
      await store.append(
        GUEST,
        { role: "guest", text: `Revision query ${i}` },
        { role: "assistant", text: `Revision reply ${i}` },
      );
    }

    // Step 3: Now modify the draft multiple times
    const modifications = [
      {
        raw: { ...COMPLETE_RAW, guests: { value: 3, state: "stated", evidence: "change to 3 guests" } },
        text: "Please change to 3 guests instead",
      },
      {
        raw: { ...COMPLETE_RAW, guests: { value: 3, state: "stated", evidence: "change to 3 guests" }, rooms: { value: 2, state: "stated", evidence: "2 rooms now" } },
        text: "Also we need 2 rooms now",
      },
      {
        raw: { ...COMPLETE_RAW, guests: { value: 5, state: "stated", evidence: "actually 5 of us" }, rooms: { value: 2, state: "stated", evidence: "2 rooms now" } },
        text: "Wait actually 5 of us in total",
      },
    ];

    for (let i = 0; i < modifications.length; i++) {
      const modProvider = providerReturning(modifications[i].raw);
      const modHarness = harness(modProvider, store, quotationStore);
      const res = await post(modHarness.app, textEvent(`wamid.mod.${i}`, modifications[i].text));
      expect(res.status).toBe(200);

      // Must NOT be paused for asking_limit
      expect(await store.paused(GUEST)).toBeUndefined();
    }

    // Verify final draft reflects updated guest count
    const finalQuotes = await quotationStore.list();
    const updated = finalQuotes.find((q) => q.phone === GUEST);
    expect(updated?.bffTrip?.guests?.length).toBe(5);
  });
});
