import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { createWhatsAppSender, parseInboundTexts, verifySignature } from "../../../apps/casa-bff/src/whatsapp.js";
import { createInMemoryConversationStore, type ConversationStore } from "../../../apps/casa-bff/src/conversationStore.js";
import { ASK_LIMIT } from "../src/questions.js";
import type { ExtractProvider } from "../src/provider.js";

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
    expect(numbered).toHaveLength(3); // guests, diver, contactName
    expect(sent[0].body).toContain("1. How many guests in total?"); // priority order, not alphabetical
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

    // Vietnamese, so the holding reply has to be Vietnamese: the guest's words are
    // the only evidence of which language to be stuck in, and the model is never
    // asked — that is the point of reading the escalate keywords before the call.
    expect(await (await post(app, textEvent("wamid.1", "Cho mình gặp nhân viên nhé"))).json()).toEqual({
      received: 1,
      replied: 1,
      duplicates: 0,
      failed: 0,
      handoffs: 1,
    });
    expect(provider.call).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("Đội ngũ Casa");
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

describe("handoff view", () => {
  it("refuses to list or resume threads without the verify token", async () => {
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
      paused: [{ phone: GUEST, reason: "guest_asked_for_human", since: expect.any(Number), toldAt: expect.any(Number) }],
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

  it("surfaces Meta's own error body, which is where the actionable part lives", async () => {
    const metaError = '{"error":{"message":"Message failed to send because more than 24 hours have passed"}}';
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
