// The handoff inbox is what turns "a person will take it" from a sentence into a queue.
//
// The JSON thread list already existed and is tested; what these tests pin is that a *human* can
// act on it — the page renders what the person has to ask, and the two buttons that hand the
// thread back are guarded server-side rather than only hidden in the markup.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  createInMemoryConversationStore,
  type ConversationStore,
} from "../src/stores/conversationStore.js";
import type { ExtractProvider } from "../../ai/src/ports/provider.js";

const VERIFY_TOKEN = "handoff-inbox-token";
const APP_SECRET = "handoff-app-secret";
const GUEST = "639171234567";

const PARTIAL_RAW = {
  language: { value: null, state: "missing", evidence: null },
  checkIn: { value: null, state: "missing", evidence: null },
  checkOut: { value: null, state: "missing", evidence: null },
  nights: { value: null, state: "missing", evidence: null },
  guests: { value: null, state: "missing", evidence: null },
  rooms: { value: null, state: "missing", evidence: null },
  meals: { value: null, state: "missing", evidence: null },
  transport: { value: null, state: "missing", evidence: null },
  contactName: { value: null, state: "missing", evidence: null },
  diver: { value: null, state: "missing", evidence: null },
};

function providerReturning(raw: unknown): ExtractProvider {
  return {
    id: "fake:handoff",
    call: vi.fn().mockResolvedValue({ raw, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 }),
  };
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

function textEvent(id: string, text: string): string {
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
              contacts: [{ profile: { name: "Minh" }, wa_id: GUEST }],
              messages: [{ from: GUEST, id, timestamp: "1789700000", type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

function harness(store: ConversationStore = createInMemoryConversationStore()) {
  const app = createApp({
    provider: providerReturning(PARTIAL_RAW),
    store,
    sendWhatsApp: async () => undefined,
  });
  return { app, store };
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
  vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the handoff inbox page", () => {
  it("needs a session, and sends an unauthenticated visitor to sign in", async () => {
    const { app } = harness();
    const res = await app.request("/handoff");

    expect(res.status).toBe(302);
    // Deep-linked, so signing in lands on the inbox rather than on the studio.
    expect(res.headers.get("location")).toBe("/login?next=%2Fhandoff");
  });

  it("says so plainly when nothing is waiting", async () => {
    const { app } = harness();
    const html = await (await app.request(`/handoff?token=${VERIFY_TOKEN}`)).text();

    expect(html).toContain("Handoff inbox");
    expect(html).toContain("Nothing is waiting.");
    expect(html).toContain("0 waiting");
  });

  it("shows what the person has to ask, in words they can use, rather than internal field names", async () => {
    // Parked directly: the value under test is the rendering, and driving a real conversation to a
    // stall is covered in whatsapp.test.ts. What matters here is that a person reads "check-in
    // date", not "checkIn".
    const store = createInMemoryConversationStore();
    await store.pause(GUEST, "stalled", {
      missingFields: ["checkIn", "guests"],
      context: "we are thinking about October maybe",
    });
    const { app } = harness(store);

    const html = await (await app.request(`/handoff?token=${VERIFY_TOKEN}`)).text();

    expect(html).toContain("1 waiting");
    expect(html).toContain(GUEST);
    expect(html).toContain("Stuck — same questions open");
    expect(html).toContain("check-in date");
    expect(html).toContain("number of guests");
    expect(html).not.toContain("checkIn");
    expect(html).toContain("we are thinking about October maybe");
  });

  it("renders a row a person can act on even when the park record predates the extra fields", async () => {
    // A park written before `missingFields`/`context` existed. The row must still render, and it
    // must not print "undefined" at a member of staff.
    const store = createInMemoryConversationStore();
    await store.pause(GUEST, "guest_asked_for_human");
    const { app } = harness(store);

    const html = await (await app.request(`/handoff?token=${VERIFY_TOKEN}`)).text();

    expect(html).toContain("Guest asked for a person");
    expect(html).not.toContain("undefined");
  });

  it("lists a thread the webhook itself parked, so the two ends are wired together", async () => {
    const { app, store } = harness();
    const body = textEvent("wamid.1", "Please cancel my booking");

    await app.request("/v1/channels/whatsapp/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
      body,
    });

    const html = await (await app.request(`/handoff?token=${VERIFY_TOKEN}`)).text();
    expect(html).toContain("Cancellation / complaint");
    expect(html).toContain("Please cancel my booking");
    expect(await store.paused(GUEST)).toBeDefined();
  });
});

describe("handing a thread back", () => {
  it("refuses an unauthenticated resume and leaves the thread parked", async () => {
    const store = createInMemoryConversationStore();
    await store.pause(GUEST, "stalled");
    const { app } = harness(store);

    const res = await app.request(`/handoff/${GUEST}/resume`, { method: "POST" });

    expect(res.status).toBe(401);
    expect(await store.paused(GUEST)).toBeDefined();
  });

  it("hands the thread back and returns to the list", async () => {
    const store = createInMemoryConversationStore();
    await store.pause(GUEST, "stalled");
    const { app } = harness(store);

    const res = await app.request(`/handoff/${GUEST}/resume?token=${VERIFY_TOKEN}`, { method: "POST" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/handoff");
    expect(await store.paused(GUEST)).toBeUndefined();
  });

  it("clears a thread the bot should forget entirely", async () => {
    const store = createInMemoryConversationStore();
    await store.append(GUEST, { role: "guest", text: "hello" });
    await store.pause(GUEST, "stalled");
    const { app } = harness(store);

    const res = await app.request(`/handoff/${GUEST}/reset?token=${VERIFY_TOKEN}`, { method: "POST" });

    expect(res.status).toBe(302);
    expect(await store.paused(GUEST)).toBeUndefined();
    expect(await store.history(GUEST)).toEqual([]);
  });
});
