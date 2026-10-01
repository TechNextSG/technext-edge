import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.ts";
import {
  checkRecipient,
  createWhatsAppSender,
  explainMetaError,
  parseInboundTexts,
  verifySignature,
  whatsAppConfig,
} from "../src/services/whatsapp.ts";
import { createInMemoryConversationStore, type ConversationStore } from "../src/stores/conversationStore.ts";
import { ASK_LIMIT, STALL_LIMIT } from "../../ai/src/index.ts";
import type { ExtractProvider } from "../../ai/src/index.ts";
import { listQuotations } from "../src/stores/quotationStore.ts";

const VERIFY_TOKEN = "casa-verify-token";
const APP_SECRET = "casa-app-secret";
const GUEST = "639171234567";
// What the tests stub WHATSAPP_TURN_TIMEOUT_MS to. Small on purpose: this file
// runs on fake timers, so the clock is moved, not waited on.
const TURN_TIMEOUT_MS = 5_000;

// The same partial extraction converse.test.ts uses: checkIn is `stated` (so the
// deterministic date resolver fills it) while guests is missing, which makes the
// first numbered question of the reply deterministic — "How many guests in
// total?" — instead of vendor-dependent.
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
  // The Tier-2 fields a real provider usually returns as missing — that is what puts
  // the diving question on the reply. When it omits them instead, extract.ts normalizes
  // the absence to this same state (see extract.test.ts), so the question survives.
  diver: { value: null, state: "missing", evidence: null },
  diveFrom: { value: null, state: "missing", evidence: null },
  diveTo: { value: null, state: "missing", evidence: null },
  transportType: { value: null, state: "missing", evidence: null },
};

const FIRST_TEXT = "Hi, next Saturday for 3 nights please";
// What the guests field gets asked — the first missing field of PARTIAL_RAW, so
// the question the transcript is always left waiting on. Assertions use it with
// toContain, because how many questions one reply bundles is converse.ts's
// decision (owned by converse.test.ts), not this file's.
const FIRST_REPLY = "How many guests in total?";

function providerReturning(raw: unknown): ExtractProvider {
  return {
    id: "fake:v1",
    call: vi.fn().mockResolvedValue({ raw, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 }),
  };
}

function transcriptSentOn(provider: ExtractProvider, callIndex = 0): string {
  return (provider.call as ReturnType<typeof vi.fn>).mock.calls[callIndex][0].text;
}

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

// Meta's inbound envelope, trimmed to the fields we read.
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
              contacts: [{ profile: { name: "Minh" }, wa_id: from }],
              messages: [{ from, id, timestamp: "1789700000", type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

function textBatchEvent(messages: Array<{ id: string; text: string }>, from = GUEST): string {
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
              contacts: [{ profile: { name: "Minh" }, wa_id: from }],
              messages: messages.map((m) => ({
                from,
                id: m.id,
                timestamp: "1789700000",
                type: "text",
                text: { body: m.text },
              })),
            },
          },
        ],
      },
    ],
  });
}

type App = ReturnType<typeof createApp>;

function post(app: App, body: string, signature = sign(body)) {
  return app.request("/v1/channels/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body,
  });
}

// Injects both seams: a fake provider (no vendor call) and a recording sender
// (no Graph API call), which is what keeps every webhook test offline. The store
// comes back too, because several tests have to read what the channel did to the
// thread — a claim kept or given back, a thread parked, a transcript.
function harness(provider: ExtractProvider, store: ConversationStore = createInMemoryConversationStore()) {
  const sent: Array<{ to: string; body: string }> = [];
  const app = createApp({
    provider,
    store,
    sendWhatsApp: async (message) => {
      sent.push(message);
    },
  });
  return { app, sent, store };
}

// Everything a turn does after the provider call resolves is plain async code,
// so this is enough to let a turn that answers *late* run to its own end.
async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

// Reaches the route's whole-turn deadline, which is a setTimeout, by moving the
// fake clock rather than by waiting it out for real. Takes what Hono's
// app.request() returns, which is typed Response | Promise<Response>.
async function abandon<T>(pending: Promise<T> | T, ms = TURN_TIMEOUT_MS): Promise<T> {
  await flush(); // let the handler get as far as arming its deadline
  await vi.advanceTimersByTimeAsync(ms + 1);
  return pending;
}

beforeEach(() => {
  // Same fixed "today" as converse.test.ts, so "next Saturday" resolves the same way.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
  vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("verifySignature", () => {
  const body = '{"object":"whatsapp_business_account"}';

  it("accepts the signature Meta computes over the raw body", () => {
    expect(verifySignature(body, sign(body), APP_SECRET)).toBe(true);
  });

  it("accepts an uppercase hex digest", () => {
    const upper = createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex").toUpperCase();
    expect(verifySignature(body, `sha256=${upper}`, APP_SECRET)).toBe(true);
  });

  it("rejects a body tampered with after it was signed", () => {
    expect(verifySignature(`${body} `, sign(body), APP_SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifySignature(body, sign(body, "not-our-secret"), APP_SECRET)).toBe(false);
  });

  it("rejects a missing header, an empty header, and a non-sha256 algorithm", () => {
    expect(verifySignature(body, undefined, APP_SECRET)).toBe(false);
    expect(verifySignature(body, "", APP_SECRET)).toBe(false);
    expect(verifySignature(body, "sha1=abc", APP_SECRET)).toBe(false);
  });

  it("rejects a truncated digest without throwing on the length mismatch", () => {
    expect(verifySignature(body, sign(body).slice(0, 20), APP_SECRET)).toBe(false);
  });
});

describe("parseInboundTexts", () => {
  it("walks every entry and change, not just the first", () => {
    const payload = {
      entry: [
        { changes: [{ value: { messages: [{ id: "wamid.1", from: "111", type: "text", text: { body: "first" } }] } }] },
        { changes: [{ value: { messages: [{ id: "wamid.2", from: "222", type: "text", text: { body: "second" } }] } }] },
      ],
    };

    expect(parseInboundTexts(payload)).toEqual([
      { id: "wamid.1", from: "111", text: "first" },
      { id: "wamid.2", from: "222", text: "second" },
    ]);
  });

  it("returns nothing for a receipt-only delivery", () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered" }] } }] }] };
    expect(parseInboundTexts(payload)).toEqual([]);
  });

  it("ignores non-text message types", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: "wamid.1", from: "111", type: "audio", audio: { id: "MEDIA", mime_type: "audio/ogg" } },
                  { id: "wamid.2", from: "111", type: "image", image: { id: "MEDIA2" } },
                  { id: "wamid.3", from: "111", type: "text", text: { body: "typed" } },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(parseInboundTexts(payload)).toEqual([{ id: "wamid.3", from: "111", text: "typed" }]);
  });

  it("shrugs off a payload with nothing readable in it", () => {
    expect(parseInboundTexts(null)).toEqual([]);
    expect(parseInboundTexts("not json")).toEqual([]);
    expect(parseInboundTexts({})).toEqual([]);
    expect(parseInboundTexts({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
    // a text message missing its body and id is not answerable either
    expect(parseInboundTexts({ entry: [{ changes: [{ value: { messages: [{ from: "111", type: "text" }] } }] }] })).toEqual([]);
  });
});

describe("WhatsApp webhook (Meta Cloud API)", () => {
  it("completes Meta's GET subscription handshake with the raw challenge", async () => {
    const { app } = harness(providerReturning(PARTIAL_RAW));
    const res = await app.request(
      `/v1/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1158201444");
  });

  it("rejects a handshake carrying the wrong verify token", async () => {
    const { app } = harness(providerReturning(PARTIAL_RAW));
    const res = await app.request("/v1/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1");
    expect(res.status).toBe(403);
  });

  it("says so loudly when the deployment has no verify token configured", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
    const { app } = harness(providerReturning(PARTIAL_RAW));
    const res = await app.request(
      `/v1/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`,
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("server_misconfigured");
  });

  it("refuses a POST whose signature does not match, without calling the model or the guest", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);
    const body = textEvent("wamid.1", FIRST_TEXT);

    const res = await post(app, body, sign(body, "wrong-secret"));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_signature");
    expect(provider.call).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("refuses a POST when no app secret is configured", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    const { app } = harness(providerReturning(PARTIAL_RAW));
    const res = await post(app, textEvent("wamid.1", FIRST_TEXT));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("server_misconfigured");
  });

  it("extracts a guest text and sends the reply back to the same number", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);

    const res = await post(app, textEvent("wamid.1", FIRST_TEXT));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 0, handoffs: 0 });
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(transcriptSentOn(provider)).toContain(`Guest: ${FIRST_TEXT}`);
    // The wording is the extractor's business, not the channel's: how much of the
    // form one reply carries is a converse.ts decision (owned by
    // converse.test.ts). So this asserts that the guest was asked about the first
    // missing field of PARTIAL_RAW, not the exact phrasing.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(GUEST);
    expect(sent[0].body).toContain(FIRST_REPLY);
  });

  it("answers with an acknowledgment and every open field in a single message, not one question per turn", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);

    await post(app, textEvent("wamid.1", FIRST_TEXT));

    // One guest message, one WhatsApp message — and that message acknowledges
    // what was understood, then asks every open field, numbered.
    expect(sent).toHaveLength(1);
    const numbered = sent[0].body.split("\n").filter((line) => /^\d+\. /.test(line));
    expect(numbered).toHaveLength(4); // guests, roomType, diver, contactName
    expect(sent[0].body).toContain("1. How many guests in total?"); // priority order, not alphabetical
    expect(sent[0].body).toContain("Would you like a standard, deluxe, or suite room?");
    expect(sent[0].body).toContain("I've noted down your stay starting Sep 26 for 3 nights.");
    expect(sent[0].body).not.toContain("Rooms:"); // a house norm, shown in the summary rather than asked
    expect(sent[0].body.length).toBeLessThan(4096); // the whole reply is nowhere near Meta's limit
  });

  it("carries earlier turns forward, so turn two is not answered as a brand-new guest", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);

    await post(app, textEvent("wamid.1", FIRST_TEXT));
    await post(app, textEvent("wamid.2", "2 of us, 1 room"));

    const secondTurn = transcriptSentOn(provider, 1);
    expect(secondTurn).toContain(`Guest: ${FIRST_TEXT}`);
    // The assistant turn kept in history is the whole form, so every question it
    // asked reaches the model inside a single assistant message.
    expect(secondTurn).toContain("Assistant: Thanks! I've noted down");
    expect(secondTurn).toContain(FIRST_REPLY);
    expect(secondTurn).toContain("Guest: 2 of us, 1 room");
    expect(sent).toHaveLength(2);
  });

  it("treats a Meta redelivery of the same message id as already handled", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);
    const body = textEvent("wamid.1", FIRST_TEXT);

    await post(app, body);
    const res = await post(app, body);

    expect(await res.json()).toEqual({ received: 1, replied: 0, duplicates: 1, failed: 0, handoffs: 0 });
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it("processes concurrent messages from the same phone sequentially without race conditions", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const store = createInMemoryConversationStore();
    const { app, sent } = harness(provider, store);

    // Two messages from the same phone sent sequentially
    const res1 = await post(app, textEvent("wamid.1", FIRST_TEXT));
    const res2 = await post(app, textEvent("wamid.2", "2 guests"));

    expect((await res1.json()).replied).toBe(1);
    expect((await res2.json()).replied).toBe(1);
    expect(sent).toHaveLength(2);

    const history = await store.history(GUEST);
    expect(history).toHaveLength(4);
    expect(history[0].role).toBe("guest");
    expect(history[0].text).toBe(FIRST_TEXT);
    expect(history[1].role).toBe("assistant");
    expect(history[2].role).toBe("guest");
    expect(history[2].text).toBe("2 guests");
    expect(history[3].role).toBe("assistant");
  });

  it("coalesces multiple rapid messages in the same delivery batch into a single model call", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const store = createInMemoryConversationStore();
    const { app, sent } = harness(provider, store);

    const body = textBatchEvent([
      { id: "wamid.A", text: "Hi Casa Escondida" },
      { id: "wamid.B", text: "We are 2 guests for 3 nights" },
    ]);

    const res = await post(app, body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 2, replied: 1, duplicates: 0, failed: 0, handoffs: 0 });

    // Exactly ONE model call is made with the combined text!
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);

    const history = await store.history(GUEST);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("guest");
    expect(history[0].text).toBe("Hi Casa Escondida\nWe are 2 guests for 3 nights");
    expect(history[1].role).toBe("assistant");
  });

  it("clears transcript and unparks thread when guest sends a reset command", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const store = createInMemoryConversationStore();
    const { app, sent } = harness(provider, store);

    await post(app, textEvent("wamid.1", FIRST_TEXT));
    expect(await store.history(GUEST)).toHaveLength(2);

    const res = await (await post(app, textEvent("wamid.2", "reset"))).json();
    expect(res).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 0, handoffs: 0 });
    expect(provider.call).toHaveBeenCalledTimes(1); // zero model call on reset!
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toContain("Conversation reset!");
    expect(await store.history(GUEST)).toHaveLength(0);
  });

  it("apologizes rather than falling silent when the provider fails, and parks the thread for a person", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = providerReturning(PARTIAL_RAW);
    const call = provider.call as ReturnType<typeof vi.fn>;
    // extract() retries once, so both attempts have to fail for the turn to fail:
    // the shape of a gateway that is down, or of a key that stopped working.
    call.mockRejectedValue(new Error("DeepSeek gateway extract failed: 500"));
    const { app, sent, store } = harness(provider);
    const body = textEvent("wamid.1", FIRST_TEXT);

    // Still a failed turn — but the guest is not left with nothing, which is the
    // point of the whole path: one static message, saying a person has it.
    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 1, handoffs: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(GUEST);
    expect(sent[0].body).toContain("Sorry");
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // The thread is a person's now, under a reason the reception view can read.
    expect(await store.paused(GUEST)).toMatchObject({ phone: GUEST, reason: "turn_failed" });
    expect(await store.history(GUEST)).toEqual([
      { role: "guest", text: FIRST_TEXT },
      { role: "assistant", text: expect.stringContaining("Sorry") },
    ]);

    // A message that did reach the guest keeps the claim taken: Meta's redelivery
    // of the same wamid is a duplicate, not a second apology.
    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 0, duplicates: 1, failed: 0, handoffs: 0 });
    expect(sent).toHaveLength(1);

    // And the next thing the guest writes buys no model call at all: a person owns
    // this thread, so the bot does not answer over them. They were told a moment
    // ago, so this is quiet rather than a second identical sentence.
    call.mockResolvedValue({ raw: PARTIAL_RAW, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 });
    expect(await (await post(app, textEvent("wamid.2", "3 nights"))).json()).toEqual({
      received: 1,
      replied: 0,
      duplicates: 0,
      failed: 0,
      handoffs: 0,
    });
    expect(provider.call).toHaveBeenCalledTimes(2); // the two failed attempts, and nothing since
    expect(sent).toHaveLength(1);
  });

  it("tells a parked guest once, and again only after the holding window has passed", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);
    // "Can I speak to a human" parks the thread in the same turn it is answered.
    await post(app, textEvent("wamid.1", "Can I speak to a human please?"));

    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("A member of the Casa team");

    // Three messages typed in a row are three separate deliveries, and none of
    // them deserves the same sentence again — but none of them is silence either.
    await post(app, textEvent("wamid.2", "hello?"));
    await post(app, textEvent("wamid.3", "ok"));
    expect(sent).toHaveLength(1);
    expect(provider.call).not.toHaveBeenCalled();

    // A new question an hour later is answered again: "we're on it" beats silence
    // even when the sentence is the same one.
    vi.setSystemTime(new Date("2026-09-15T01:00:00Z"));
    expect(await (await post(app, textEvent("wamid.4", "any news?"))).json()).toEqual({
      received: 1,
      replied: 1,
      duplicates: 0,
      failed: 0,
      handoffs: 1,
    });
    expect(sent).toHaveLength(2);
  });

  it("hands the thread to a person when the guest asks for one, in the guest's own language", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent, store } = harness(provider);

    // Chinese, so the holding reply has to be Chinese: the guest's words are the only
    // evidence of which language to be stuck in, and the model is never asked — that is
    // the point of reading the escalate keywords before the call.
    expect(await (await post(app, textEvent("wamid.1", "我想找人工客服"))).json()).toEqual({
      received: 1,
      replied: 1,
      duplicates: 0,
      failed: 0,
      handoffs: 1,
    });
    expect(provider.call).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("Casa 团队正在处理您的咨询");
    expect(await store.paused(GUEST)).toMatchObject({ reason: "guest_asked_for_human" });
  });

  it("stops asking at the asking limit and hands over, instead of asking a ninth time", async () => {
    const store = createInMemoryConversationStore();
    // A thread asked ASK_LIMIT times that is still incomplete: a guest answering
    // one field at a time forever, or an extractor that never fills the field it
    // keeps asking about. Either way, another round of questions is not progress.
    for (let i = 0; i < ASK_LIMIT; i++) {
      await store.append(GUEST, { role: "guest", text: `message ${i}` }, { role: "assistant", text: `reply ${i}` });
    }
    const provider = providerReturning(PARTIAL_RAW); // fields still missing ⇒ done: false
    const { app, sent } = harness(provider, store);

    expect(await (await post(app, textEvent("wamid.1", "still thinking about it"))).json()).toEqual({
      received: 1,
      replied: 1,
      duplicates: 0,
      failed: 0,
      handoffs: 1,
    });
    expect(provider.call).toHaveBeenCalledTimes(1); // one extraction, then a person takes it
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("A member of the Casa team");
    expect(await store.paused(GUEST)).toMatchObject({ reason: "asking_limit" });

    // Parked, so the *next* message costs nothing: the limit is never re-decided
    // by asking the model again.
    provider.call = vi.fn().mockResolvedValue({ raw: PARTIAL_RAW, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 });
    await post(app, textEvent("wamid.2", "hello?"));
    expect(provider.call).not.toHaveBeenCalled();
  });

  it("keeps the claim once a send is in flight, so a redelivery cannot reply twice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = providerReturning(PARTIAL_RAW);
    const app = createApp({
      provider,
      sendWhatsApp: async () => {
        throw new Error("WhatsApp send failed: 401 Token expired");
      },
    });
    const body = textEvent("wamid.1", FIRST_TEXT);

    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 0, duplicates: 0, failed: 1, handoffs: 0 });
    // The guest may well have this reply already — a send that fails after Meta
    // accepted it looks identical from here — so the redelivery is a duplicate.
    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 0, duplicates: 1, failed: 0, handoffs: 0 });
    expect(provider.call).toHaveBeenCalledTimes(1);
  });

  it("abandons a turn that outlives its deadline, apologizes, and never answers that message twice", async () => {
    vi.stubEnv("WHATSAPP_TURN_TIMEOUT_MS", String(TURN_TIMEOUT_MS));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createInMemoryConversationStore();
    // The 15:33 stall: the provider never answers. The route has to return anyway.
    let releaseProvider: (() => void) | undefined;
    const hung = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const provider: ExtractProvider = {
      id: "fake:hang",
      call: vi.fn(() => hung.then(() => ({ raw: PARTIAL_RAW, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 }))),
    };
    const { app, sent } = harness(provider, store);
    const body = textEvent("wamid.1", FIRST_TEXT);

    const res = await abandon(post(app, body));

    // Meta still gets its 200 — and the guest has something to read while the
    // provider is stuck, which is the half that used to be silence.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 1, handoffs: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("Sorry");
    expect(String(errorSpy.mock.calls[0][3])).toContain("WhatsApp turn exceeded");

    // The provider finally answers *after* Meta already had its 200. The abandoned
    // turn must not append a reply or message the guest behind the apology's back:
    // that is what keeps "one guest message, at most one reply" true.
    releaseProvider?.();
    await flush();

    expect(sent).toHaveLength(1);
    expect(await store.history(GUEST)).toEqual([
      { role: "guest", text: FIRST_TEXT },
      { role: "assistant", text: expect.stringContaining("Sorry") },
    ]);

    // Meta's redelivery is a duplicate: the claim stayed taken precisely because
    // the guest already heard from us. No second model call, no repeated sentence.
    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 0, duplicates: 1, failed: 0, handoffs: 0 });
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it("answers nothing at all for a delivery receipt", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "read" }] } }] }],
    });

    const res = await post(app, body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 0, replied: 0, duplicates: 0, failed: 0, handoffs: 0 });
    expect(provider.call).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("ignores a voice note rather than guessing at its content", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ id: "wamid.1", from: GUEST, type: "audio", audio: { id: "MEDIA" } }] } }] }],
    });

    expect(await (await post(app, body)).json()).toEqual({ received: 0, replied: 0, duplicates: 0, failed: 0, handoffs: 0 });
    expect(provider.call).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("still acks 200 when sending fails, so Meta does not retry us into a double reply", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = providerReturning(PARTIAL_RAW);
    const app = createApp({
      provider,
      sendWhatsApp: async () => {
        throw new Error("WhatsApp send failed: 401 Token expired");
      },
    });

    const res = await post(app, textEvent("wamid.1", FIRST_TEXT));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 1, replied: 0, duplicates: 0, failed: 1, handoffs: 0 });
    // The failure is logged, and logged masked: the number never appears raw.
    expect(errorSpy).toHaveBeenCalledWith("whatsapp turn failed", "[phone]", FIRST_TEXT, expect.anything());
    expect(errorSpy.mock.calls[0].join(" ")).not.toContain(GUEST);
  });

  it("refuses to reply at all when the deployment has no sender credentials", async () => {
    // Stubbed to empty rather than relied on being absent: a developer with
    // WHATSAPP_* exported in their shell (e.g. from a local webhook demo) would
    // otherwise make this test reach graph.facebook.com for real.
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    const app = createApp({ provider: providerReturning(PARTIAL_RAW) });

    const res = await post(app, textEvent("wamid.1", FIRST_TEXT));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("server_misconfigured");
  });
});

/**
 * The links on a guest's reply, tested through the webhook because that is the layer that got this
 * wrong. A real production reply carried the staff studio URL next to the customer one — a link
 * addressed to staff, pasted into the guest's chat, and answering 401 as written (verified against
 * production). Nothing asserted the reply's links, so nothing noticed.
 */
describe("the links on a guest's reply once a quotation exists", () => {
  // Every handoff-required field answered or house-normed, so the turn ends in a summary and
  // builds a draft. `rooms`/`meals`/`transport` are left `missing` on purpose: postProcess fills
  // them with the house norms, which is the same path a real unmentioned field takes. `diver:
  // false` keeps the dive window inapplicable — its rule is gated on diving.
  const COMPLETE_RAW = {
    ...PARTIAL_RAW,
    guests: { value: 4, state: "stated", evidence: "4 of us" },
    roomType: { value: "suite", state: "stated", evidence: "the suite" },
    contactName: { value: "Ana", state: "stated", evidence: "Ana" },
    diver: { value: false, state: "stated", evidence: "no diving" },
  };
  const TEXT = "4 of us next Saturday for 3 nights, the suite, no diving, my name is Ana";

  async function replyForCompletedTurn() {
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
    const { app, sent } = harness(providerReturning(COMPLETE_RAW));
    await post(app, textEvent("wamid.quote", TEXT));
    await flush();
    return sent;
  }

  it("promises the quotation without quoting a price or a link", async () => {
    const sent = await replyForCompletedTurn();
    expect(sent).toHaveLength(1);
    // The bot used to append its own `/q/<slug>` link the moment it had enough information. That
    // quoted a price to a customer before anyone at the resort had seen it, from a hand-copied
    // table. The link a guest gets is the one the team estimator mints, after staff publish.
    expect(sent[0]!.body).not.toContain("🔗");
    expect(sent[0]!.body).not.toMatch(/\/q\//);
    expect(sent[0]!.body).not.toMatch(/\/quote\//);
    expect(sent[0]!.body).toContain("reservations team is preparing your quotation");
    expect(sent[0]!.body).toContain("nothing is booked yet");
  });

  it("does NOT send the guest the staff studio link", async () => {
    const sent = await replyForCompletedTurn();
    // `/quotes/:id` is guarded, so this URL answers 401 for anyone who clicks it — and it is
    // internal tooling that has no business in a guest's chat.
    expect(sent[0]!.body).not.toContain("/quotes/");
    expect(sent[0]!.body).not.toContain("Edit Table & Confirm");
  });

  it("uses WhatsApp's bold syntax, not Markdown's", async () => {
    const sent = await replyForCompletedTurn();
    // WhatsApp renders *single asterisks*; `**` shows up as literal asterisks in the guest's chat.
    expect(sent[0]!.body).not.toContain("**");
  });
});

describe("handoff view", () => {  it("refuses to list or resume threads without the verify token", async () => {
    const { app } = harness(providerReturning(PARTIAL_RAW));

    const list = await app.request("/v1/channels/whatsapp/threads");
    expect(list.status).toBe(401);
    // A wrong token is refused too: the guard is a comparison, not a presence check.
    const wrong = await app.request("/v1/channels/whatsapp/threads", {
      headers: { "x-verify-token": `${VERIFY_TOKEN}x` },
    });
    expect(wrong.status).toBe(401);
    const resume = await app.request(`/v1/channels/whatsapp/threads/${GUEST}/resume`, { method: "POST" });
    expect(resume.status).toBe(401);
  });

  it("lists what a person has to answer, and hands the thread back on resume", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent, store } = harness(provider);
    // "Can I speak to a human" parks the thread, which is what reception has to see.
    await post(app, textEvent("wamid.1", "Can I speak to a human please?"));
    expect(await store.pausedThreads()).toHaveLength(1);

    const list = await app.request("/v1/channels/whatsapp/threads", { headers: { "x-verify-token": VERIFY_TOKEN } });
    expect(await list.json()).toEqual({
      paused: [
        {
          phone: GUEST,
          reason: "guest_asked_for_human",
          since: expect.any(Number),
          toldAt: expect.any(Number),
          // The message the bot stopped on, so whoever picks this up is not starting cold.
          context: "Can I speak to a human please?",
        },
      ],
    });

    // Someone answered, so the bot takes the thread again — and this time it does
    // call the model, because the thread is its own again.
    const resume = await app.request(`/v1/channels/whatsapp/threads/${GUEST}/resume`, {
      method: "POST",
      headers: { "x-verify-token": VERIFY_TOKEN },
    });
    expect(await resume.json()).toEqual({ ok: true, phone: GUEST });
    expect(await store.pausedThreads()).toEqual([]);

    await post(app, textEvent("wamid.2", FIRST_TEXT));
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toContain(FIRST_REPLY);
  });
  it("reports whether the deployment's own credentials work, without sending anything", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "EAAG-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1278878915314039");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ display_phone_number: "+1 555-150-6595", quality_rating: "GREEN", platform_type: "CLOUD_API" }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { app } = harness(providerReturning(PARTIAL_RAW));

    const res = await app.request("/v1/channels/whatsapp/status", { headers: { "x-verify-token": VERIFY_TOKEN } });

    expect(await res.json()).toEqual({
      configured: { verifyToken: true, appSecret: true, accessToken: true, phoneNumberId: true },
      sender: { ok: true, displayPhoneNumber: "+1 555-150-6595", qualityRating: "GREEN", platformType: "CLOUD_API" },
    });
    // Read-only by construction: a GET of the number's own attributes, never a message.
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("1278878915314039");
    expect(init.headers.authorization).toBe("Bearer EAAG-token");
    expect(init.body).toBeUndefined();
  });

  it("says what Meta refused when the credentials this deployment holds are unusable", async () => {
    // The failure this route exists for: a token pasted into a dashboard keeps the
    // quotes it was copied with. It is present, so "configured" is all true — and a
    // send would still answer 401 (#190) on a guest's message.
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", '"EAAG-quoted"');
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1278878915314039");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"error":{"code":190,"message":"Authentication Error"}}', { status: 401 }),
      ),
    );
    const { app } = harness(providerReturning(PARTIAL_RAW));

    const res = await app.request("/v1/channels/whatsapp/status", { headers: { "x-verify-token": VERIFY_TOKEN } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.configured.accessToken).toBe(true);
    expect(body.sender.ok).toBe(false);
    expect(body.sender.error).toContain("401");
    expect(body.sender.error).toContain("190");
  });
});

describe("a partner enquiry, and the answer that ends the invitation", () => {
  // The loop this closes was reproduced on production on 2026-09-28: an agency enquiry was invited to
  // sign in, the guest replied "actually we're booking for ourselves", and the bot invited them
  // again — because `guestType` is read from the whole transcript and the earlier agency phrasing
  // never stopped being there. The invitation's own last sentence ("just tell me and I'll carry on")
  // is the promise the loop broke.
  const f = <T,>(value: T | null, state = "stated", evidence: string | null = null) => ({ value, state, evidence });

  const AGENCY_RAW = {
    language: f("en", "default"),
    checkIn: f("2026-12-10", "stated", "10 Dec 2026"),
    checkOut: f(null, "missing"),
    nights: f(3, "stated", "3 nights"),
    guests: f(4, "stated", "4 guests"),
    rooms: f(2, "stated", "2 rooms"),
    roomType: f("deluxe", "stated", "deluxe"),
    meals: f("full_board", "stated", "full board"),
    transport: f(false, "stated", "no transport"),
    transportType: f("none", "stated", "no transport"),
    guestType: f("agent", "stated", "our agency"),
    diver: f(false, "stated", "no diving"),
    divers: f(null, "missing"),
    diveFrom: f(null, "missing"),
    diveTo: f(null, "missing"),
    diveNotes: f(null, "missing"),
    contactName: f("Mia", "stated", "Mia"),
  };

  const AGENCY_ENQUIRY =
    "Hi, this is Blue Fin Dive Shop. For our agency: 4 guests, 2 rooms, deluxe, 3 nights from 10 Dec 2026, full board, no transport, no diving. Name: Mia";

  let wamid = 0;
  const say = (app: App, text: string, from: string) => post(app, textEvent(`wamid.partner.${++wamid}`, text, from));

  /**
   * One phone per test: the quotation store is one in-memory instance for the whole file (and it seeds
   * itself with the fixture), so counting records only means anything per phone.
   */
  async function agencyTurn(phone: string) {
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
    // The invitation needs a host the guest can actually open, and only the team estimator is that.
    vi.stubEnv("ESTIMATOR_MODE", "remote");
    vi.stubEnv("ESTIMATOR_BASE_URL", "https://their-app.test");
    const h = harness(providerReturning(AGENCY_RAW));
    await say(h.app, AGENCY_ENQUIRY, phone);
    await flush();
    return h;
  }

  const forPhone = async (phone: string) => (await listQuotations()).filter((q) => q.phone === phone);

  it("invites the agency to sign in, once, with an absolute link", async () => {
    const phone = "639170000901";
    const { sent, store } = await agencyTurn(phone);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain("https://their-app.test/signin");
    expect(sent[0]!.body).toContain("for yourselves");
    // Parked so a person sees the thread, and no quotation is priced at the retail rate.
    expect((await store.paused(phone))?.reason).toBe("partner_self_serve");
    expect(await forPhone(phone)).toHaveLength(0);
  });

  it("carries on as a retail enquiry when the guest says they are booking for themselves", async () => {
    const phone = "639170000902";
    const { app, sent, store } = await agencyTurn(phone);
    sent.length = 0;

    await say(app, "Actually we're booking for ourselves, not an agency. Same dates please.", phone);
    await flush();

    // One reply, and it is not the invitation again.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).not.toContain("/signin");
    expect(sent[0]!.body).not.toContain("for yourselves");
    // The enquiry took the ordinary path: a quotation is waiting for staff.
    expect(await forPhone(phone)).toHaveLength(1);
    expect((await store.paused(phone)) ?? null).toBeNull();
  });

  it("does not send an invitation it has nowhere to send, rather than a bare path", async () => {
    // No customer app configured — the simulated engine's case, and what `ESTIMATOR_BASE_URL` unset
    // means in production. The old code built `${base ?? ""}/signin`, i.e. the relative "/signin",
    // which is not a link anybody can open in WhatsApp.
    const phone = "639170000903";
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
    const { app, sent, store } = harness(providerReturning(AGENCY_RAW));

    await say(app, AGENCY_ENQUIRY, phone);
    await flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).not.toContain("/signin");
    expect((await store.paused(phone)) ?? null).toBeNull();
    // The enquiry is a quotation for staff instead, which is the honest fallback.
    expect(await forPhone(phone)).toHaveLength(1);
  });
});

describe("what staff are told when Meta refuses a send", () => {
  // The studio prints this sentence beside the send button, so it is read by whoever is taking the
  // booking. Meta's body is JSON — and it quotes the guest's number back — which is why the
  // unrecognised case must not paste it. Measured: the default branch sliced 120 characters of that
  // body into the sentence a receptionist reads.
  const RAW = '{"error":{"message":"(#131030) Recipient phone number not in allowed list: 84359386414","code":999999,"fbtrace_id":"AbCd"}}';

  it("names the code for a refusal it does not recognise, and never quotes the body", () => {
    const said = explainMetaError(999999, RAW);
    expect(said).toContain("999999");
    expect(said).not.toContain("131030");
    expect(said).not.toContain("84359386414");
    expect(said).not.toContain("{");
    expect(said).toContain("deployment log");
  });

  it("still says something when Meta gave no code at all", () => {
    const said = explainMetaError(undefined, "<html><body>SSO sign-in required</body></html>");
    expect(said).toContain("did not say why");
    expect(said).not.toContain("<html>");
    expect(said).not.toContain("SSO");
    // The length is enough of a reference to find the line in the log, and it cannot carry anything.
    expect(said).toContain("characters");
  });

  it("keeps the sentences for the codes staff can act on", () => {
    expect(explainMetaError(131030, RAW)).toContain("test list");
    expect(explainMetaError(131047, RAW)).toContain("24 hours");
    expect(explainMetaError(190, RAW)).toContain("token has expired");
    expect(explainMetaError(133010, RAW)).toContain("not registered");
  });
});

describe("a phone number staff typed", () => {
  it("accepts the 00 international prefix instead of refusing the country code it already has", () => {
    // The 00 branch sat below the leading-zero refusal, so it was dead code: a number written
    // `0063917…` was told to "add the country code" while being refused.
    expect(checkRecipient("00639171234567")).toEqual({ ok: true, phone: "639171234567" });
    expect(checkRecipient("+63 917 123 4567")).toEqual({ ok: true, phone: "639171234567" });
  });

  it("still refuses a local number that really has no country code", () => {
    const refused = checkRecipient("09171234567");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe("phone_invalid");
      expect(refused.message).toContain("country code");
    }
  });

  it("asks for a number rather than sending to nothing", () => {
    expect(checkRecipient("  ")).toEqual({
      ok: false,
      code: "phone_missing",
      message: "Enter the guest's WhatsApp number, including the country code.",
    });
  });
});

describe("createWhatsAppSender", () => {
  const config = {
    accessToken: "EAAG-token",
    phoneNumberId: "PHONE_ID",
    apiVersion: "v21.0",
    timeoutMs: 10_000,
    turnTimeoutMs: 20_000,
  };

  it("refuses to be constructed without credentials, rather than failing mid-conversation", () => {
    expect(() => createWhatsAppSender({ ...config, accessToken: undefined })).toThrow("WHATSAPP_ACCESS_TOKEN");
    expect(() => createWhatsAppSender({ ...config, phoneNumberId: undefined })).toThrow("WHATSAPP_PHONE_NUMBER_ID");
  });

  it("posts a text message to the phone number's /messages endpoint with the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createWhatsAppSender(config)({ to: GUEST, body: FIRST_REPLY });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/PHONE_ID/messages");
    expect(init.headers.authorization).toBe("Bearer EAAG-token");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: GUEST,
      type: "text",
      text: { preview_url: false, body: FIRST_REPLY },
    });
  });

  // The reply a guest reads is the one artefact no server-side assertion can see: the webhook
  // answers `{replied: 1}` whether the message said the right thing or not. `WHATSAPP_GRAPH_BASE_URL`
  // exists so a test can capture the exact bytes Meta would have delivered — and it is exactly the
  // kind of seam that quietly becomes a security hole, so both directions are pinned here.
  it("sends to Meta by default, and to the configured host only when one is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    // A deployment that sets nothing must reach the real host: this is the default that ships.
    expect(whatsAppConfig({} as NodeJS.ProcessEnv).graphBaseUrl).toBe("https://graph.facebook.com");
    await createWhatsAppSender(config)({ to: GUEST, body: "hi" });
    expect(fetchMock.mock.calls[0][0]).toContain("https://graph.facebook.com/");

    // And a configured host is honoured, which is what makes the capture possible.
    fetchMock.mockClear();
    const capture = whatsAppConfig({ WHATSAPP_GRAPH_BASE_URL: "http://127.0.0.1:8899" } as NodeJS.ProcessEnv);
    expect(capture.graphBaseUrl).toBe("http://127.0.0.1:8899");
    await createWhatsAppSender({ ...config, graphBaseUrl: capture.graphBaseUrl })({ to: GUEST, body: "hi" });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8899/v21.0/PHONE_ID/messages");
  });

  it("surfaces Meta's own error body, which is where the actionable part lives", async () => {    const metaError = '{"error":{"message":"Message failed to send because more than 24 hours have passed"}}';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(metaError, { status: 400 })));

    await expect(createWhatsAppSender(config)({ to: GUEST, body: "hi" })).rejects.toThrow(/400 .*24 hours/);
  });

  it("clamps a reply to WhatsApp's 4096-character text limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createWhatsAppSender(config)({ to: GUEST, body: "x".repeat(5000) });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text.body).toHaveLength(4096);
  });
});

/** A provider that answers with a different raw payload on each call. */
function providerSequence(raws: unknown[]): ExtractProvider {
  const call = vi.fn();
  for (const raw of raws) {
    call.mockResolvedValueOnce({ raw, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 });
  }
  const last = raws[raws.length - 1];
  call.mockResolvedValue({ raw: last, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 });
  return { id: "fake:sequence", call };
}

describe("the stopping point", () => {
  it("stops after a few turns that close no questions, and tells the guest what was still needed", async () => {
    // The extractor keeps returning the same payload, which is what "the conversation is going
    // nowhere" actually looks like from here: every turn asks the same questions again. Turn one
    // cannot count (nothing recorded yet), so with STALL_LIMIT=3 the fourth message is the one
    // that hands over.
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent, store } = harness(provider);

    for (let i = 1; i <= STALL_LIMIT; i++) {
      await post(app, textEvent(`wamid.${i}`, `still thinking about it ${i}`));
    }
    expect(await store.paused(GUEST)).toBeUndefined();
    expect(sent).toHaveLength(STALL_LIMIT);

    const res = await post(app, textEvent("wamid.final", "hmm"));
    expect(await res.json()).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 0, handoffs: 1 });

    // The guest never asked for a person and nothing failed, so the reply owes them the reason —
    // and the same list of gaps the human is being handed.
    expect(sent[STALL_LIMIT]!.body).toContain("Rather than ask you the same things again");
    expect(sent[STALL_LIMIT]!.body).toContain("how many guests");
    expect(await store.paused(GUEST)).toMatchObject({
      reason: "stalled",
      missingFields: expect.arrayContaining(["guests"]),
    });
  });

  it("does not stop a guest who is getting somewhere, however slowly", async () => {
    // One field closed per turn. `ASK_LIMIT` alone would eventually cut this off; the progress
    // signal must not, because every turn is real progress.
    const withGuests = { ...PARTIAL_RAW, guests: { value: 2, state: "stated", evidence: "we are 2" } };
    const withName = { ...withGuests, contactName: { value: "Minh", state: "stated", evidence: "Minh" } };
    const provider = providerSequence([PARTIAL_RAW, withGuests, withName]);
    const { app, sent, store } = harness(provider);

    await post(app, textEvent("wamid.1", FIRST_TEXT));
    await post(app, textEvent("wamid.2", "we are 2"));
    await post(app, textEvent("wamid.3", "Minh"));

    expect(provider.call).toHaveBeenCalledTimes(3);
    expect(await store.paused(GUEST)).toBeUndefined();
    // Every reply is an answer, not a holding message.
    expect(sent.every((m) => !m.body.includes("passed your enquiry"))).toBe(true);
  });

  it("forgets the stall once the enquiry settles, so a settled guest starts clean", async () => {
    // Two dead turns, then a complete trip: the counter resets rather than carrying two strikes
    // into whatever the guest asks next.
    const complete = {
      ...PARTIAL_RAW,
      guests: { value: 2, state: "stated", evidence: "we are 2" },
      rooms: { value: 1, state: "stated", evidence: "one room" },
      meals: { value: "full_board", state: "stated", evidence: "full board" },
      transport: { value: false, state: "stated", evidence: "no transfer" },
      contactName: { value: "Minh", state: "stated", evidence: "Minh" },
      diver: { value: false, state: "stated", evidence: "no diving" },
    };
    const provider = providerSequence([PARTIAL_RAW, PARTIAL_RAW, complete, PARTIAL_RAW, PARTIAL_RAW]);
    const { app, store } = harness(provider);

    await post(app, textEvent("wamid.1", FIRST_TEXT));
    await post(app, textEvent("wamid.2", "we are 2"));
    const settled = await post(app, textEvent("wamid.3", "we are 2, one room, full board, no transfer, Minh, no diving"));
    expect(settled).toBeDefined();

    // Back to a thread that closes nothing, but it must take a fresh STALL_LIMIT to trip.
    await post(app, textEvent("wamid.4", "one more thing"));
    await post(app, textEvent("wamid.5", "one more thing again"));
    expect(await store.paused(GUEST)).toBeUndefined();
  });
});

describe("a count the guest changed their mind about", () => {
  // The extractor re-reads the whole transcript each turn, so a changed count otherwise arrives as
  // a silent substitution: the new number replaces the old one and the reply moves on. For a number
  // a price is built from, that is a different quotation the guest never saw change.
  it("reads the change back once, naming both numbers", async () => {
    const five = { ...PARTIAL_RAW, guests: { value: 5, state: "stated", evidence: "5 of us" } };
    const three = { ...PARTIAL_RAW, guests: { value: 3, state: "stated", evidence: "3 of us" } };
    const provider = providerSequence([five, three, three]);
    const { app, sent } = harness(provider);

    await post(app, textEvent("wamid.1", "we are 5 of us"));
    // Nothing to confirm yet: filling a field for the first time is the enquiry arriving, not the
    // guest contradicting themselves.
    expect(sent[0]!.body).not.toContain("Just to check");

    await post(app, textEvent("wamid.2", "sorry, actually 3 of us"));
    expect(sent[1]!.body).toContain("Just to check");
    expect(sent[1]!.body).toContain("5 guests");
    expect(sent[1]!.body).toContain("3 guests");

    // Once, not every turn: the store recorded 3 as the stated value, so a third turn that changes
    // nothing is not asked about again.
    await post(app, textEvent("wamid.3", "yes that's right"));
    expect(sent[2]!.body).not.toContain("Just to check");
  });

  it("does not treat a house-norm default as something the guest changed", async () => {
    // `rooms` is defaulted by the pipeline, never stated by the guest, so it cannot have been
    // changed by them — confirming it would be asking about Casa's own assumption.
    const provider = providerSequence([PARTIAL_RAW, PARTIAL_RAW]);
    const { app, sent } = harness(provider);

    await post(app, textEvent("wamid.1", FIRST_TEXT));
    await post(app, textEvent("wamid.2", "still thinking"));

    expect(sent[1]!.body).not.toContain("Just to check");
  });
});

describe("one quotation per enquiry, and a stopping point once it is complete", () => {
  // The same completing enquiry the reply tests use; declared here because those fixtures are
  // scoped to their own describe.
  const COMPLETE_RAW = {
    ...PARTIAL_RAW,
    guests: { value: 4, state: "stated", evidence: "4 of us" },
    roomType: { value: "suite", state: "stated", evidence: "the suite" },
    contactName: { value: "Ana", state: "stated", evidence: "Ana" },
    diver: { value: false, state: "stated", evidence: "no diving" },
  };
  const TEXT = "4 of us next Saturday for 3 nights, the suite, no diving, my name is Ana";

  it("reuses the thread's quotation instead of minting one per message", async () => {
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
    const { app } = harness(providerReturning(COMPLETE_RAW));

    await post(app, textEvent("wamid.q1", TEXT));
    const first = (await listQuotations()).filter((q) => q.phone === GUEST);
    expect(first).toHaveLength(1);

    // Measured on production before this: thirteen quotations for one guest, one per message.
    await post(app, textEvent("wamid.q2", "hmm"));
    await post(app, textEvent("wamid.q3", "thanks"));

    const after = (await listQuotations()).filter((q) => q.phone === GUEST);
    expect(after).toHaveLength(1);
    expect(after[0]!.quoteId).toBe(first[0]!.quoteId);
  });

  it("stops repeating the summary once a finished thread stops making progress", async () => {
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
    const { app, sent, store } = harness(providerReturning(COMPLETE_RAW));

    await post(app, textEvent("wamid.s1", TEXT));
    // The turn that completes the enquiry is progress, so it cannot count toward a stall.
    expect(await store.paused(GUEST)).toBeUndefined();

    await post(app, textEvent("wamid.s2", "hmm"));
    await post(app, textEvent("wamid.s3", "not sure yet"));
    expect(await store.paused(GUEST)).toBeUndefined();

    // The third message in a row that changes nothing hands over. Before this guard existed the
    // bot answered four of them with the same seven-line summary and never stopped.
    await post(app, textEvent("wamid.s4", "still thinking"));
    expect(await store.paused(GUEST)).toMatchObject({ reason: "stalled" });
    // The enquiry was already complete, so there is no gap to name and the plain handoff is used.
    expect(sent[sent.length - 1]!.body).toContain("A member of the Casa team is handling your enquiry");
  });
});

describe("messages that are not booking enquiries", () => {  it("routes a cancellation to a person without spending a model call", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent, store } = harness(provider);

    const res = await post(app, textEvent("wamid.1", "Please cancel my booking for next week"));

    expect(await res.json()).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 0, handoffs: 1 });
    // A person is needed because of what the message IS. Asking this guest for their check-in date
    // would be the failure this branch exists to prevent.
    expect(provider.call).not.toHaveBeenCalled();
    expect(sent[0]!.body).toContain("A member of the Casa team");
    expect(await store.paused(GUEST)).toMatchObject({ reason: "complaint_or_cancel" });
  });

  it("answers a message that is not about a stay by naming what this number is for", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent, store } = harness(provider);

    const res = await post(app, textEvent("wamid.1", "hey what is the wifi password?"));

    expect(await res.json()).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 0, handoffs: 1 });
    expect(provider.call).not.toHaveBeenCalled();
    expect(sent[0]!.body).toContain("This number is for new booking enquiries");
    expect(await store.paused(GUEST)).toMatchObject({ reason: "not_booking" });
  });

  it("still treats an odd-looking first message as a booking enquiry", async () => {
    // The list of "not a booking" patterns is deliberately short. "hi", a fragment, or an unusual
    // phrasing is how real enquiries start, and dismissing one costs a customer — so the default
    // is to try, exactly as before this existed.
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent, store } = harness(provider);

    await post(app, textEvent("wamid.1", "hi"));
    await post(app, textEvent("wamid.2", "do you have a room for two on Saturday?"));

    expect(provider.call).toHaveBeenCalledTimes(2);
    expect(await store.paused(GUEST)).toBeUndefined();
    // Answered as an enquiry — the greeting, since "hi" states nothing a quote can use — rather
    // than dismissed as a message this number does not handle.
    expect(sent[0]!.body).toContain("Welcome to Casa Escondida");
  });
});

