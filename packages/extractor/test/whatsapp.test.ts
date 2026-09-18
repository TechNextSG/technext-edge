import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { createWhatsAppSender, parseInboundTexts, verifySignature } from "../../../apps/casa-bff/src/whatsapp.js";
import { createInMemoryConversationStore } from "../../../apps/casa-bff/src/conversationStore.js";
import type { ExtractProvider } from "../src/provider.js";

const VERIFY_TOKEN = "casa-verify-token";
const APP_SECRET = "casa-app-secret";
const GUEST = "639171234567";
// What the tests stub WHATSAPP_TURN_TIMEOUT_MS to. Small on purpose: this file
// runs on fake timers, so the clock is moved, not waited on.
const TURN_TIMEOUT_MS = 5_000;

// The same partial extraction converse.test.ts uses: checkIn is `stated` (so the
// deterministic date resolver fills it) while guests is missing, which makes the
// reply deterministic — "How many guests in total?" — instead of vendor-dependent.
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
// (no Graph API call), which is what keeps every webhook test offline.
function harness(provider: ExtractProvider) {
  const sent: Array<{ to: string; body: string }> = [];
  const app = createApp({
    provider,
    sendWhatsApp: async (message) => {
      sent.push(message);
    },
  });
  return { app, sent };
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
    expect(await res.json()).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 0 });
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(transcriptSentOn(provider)).toContain(`Guest: ${FIRST_TEXT}`);
    // The wording is the extractor's business, not the channel's: whether one reply
    // asks about one unanswered field or four is a converse.ts decision (owned by
    // converse.test.ts). So this asserts that the guest was asked about the first
    // missing field of PARTIAL_RAW, not the exact phrasing.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(GUEST);
    expect(sent[0].body).toContain(FIRST_REPLY);
  });

  it("carries earlier turns forward, so turn two is not answered as a brand-new guest", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);

    await post(app, textEvent("wamid.1", FIRST_TEXT));
    await post(app, textEvent("wamid.2", "2 of us, 1 room"));

    const secondTurn = transcriptSentOn(provider, 1);
    expect(secondTurn).toContain(`Guest: ${FIRST_TEXT}`);
    expect(secondTurn).toContain(`Assistant: ${FIRST_REPLY}`);
    expect(secondTurn).toContain("Guest: 2 of us, 1 room");
    expect(sent).toHaveLength(2);
  });

  it("treats a Meta redelivery of the same message id as already handled", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);
    const body = textEvent("wamid.1", FIRST_TEXT);

    await post(app, body);
    const res = await post(app, body);

    expect(await res.json()).toEqual({ received: 1, replied: 0, duplicates: 1, failed: 0 });
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it("gives the claim back when a turn fails before any reply, so Meta's redelivery answers instead of duplicating", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = providerReturning(PARTIAL_RAW);
    const call = provider.call as ReturnType<typeof vi.fn>;
    // extract() retries once, so both attempts have to fail for the turn to fail:
    // the shape of a gateway that is down, or of a key that stopped working.
    call.mockRejectedValue(new Error("DeepSeek gateway extract failed: 500"));
    const { app, sent } = harness(provider);
    const body = textEvent("wamid.1", FIRST_TEXT);

    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 0, duplicates: 0, failed: 1 });
    expect(sent).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // Provider recovers and Meta redelivers the same wamid unmodified: that
    // delivery is a retry now, not a duplicate swallowed in silence.
    call.mockResolvedValue({ raw: PARTIAL_RAW, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 });
    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(GUEST);
    expect(sent[0].body).toContain(FIRST_REPLY);
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

    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 0, duplicates: 0, failed: 1 });
    // The guest may well have this reply already — a send that fails after Meta
    // accepted it looks identical from here — so the redelivery is a duplicate.
    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 0, duplicates: 1, failed: 0 });
    expect(provider.call).toHaveBeenCalledTimes(1);
  });

  it("abandons a turn that outlives its deadline, acks Meta, and lets the redelivery answer", async () => {
    vi.stubEnv("WHATSAPP_TURN_TIMEOUT_MS", String(TURN_TIMEOUT_MS));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createInMemoryConversationStore();
    // The 15:33 stall: the provider never answers. The route has to return anyway.
    let releaseProvider: (() => void) | undefined;
    const hung = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const sent: Array<{ to: string; body: string }> = [];
    const app = createApp({
      provider: {
        id: "fake:hang",
        call: vi.fn(() => hung.then(() => ({ raw: PARTIAL_RAW, tokensIn: 10, tokensOut: 10, cacheReadTokens: 0, ms: 5 }))),
      },
      store,
      sendWhatsApp: async (message) => {
        sent.push(message);
      },
    });
    const body = textEvent("wamid.1", FIRST_TEXT);

    const res = await abandon(post(app, body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 1, replied: 0, duplicates: 0, failed: 1 });
    expect(sent).toHaveLength(0);
    expect(String(errorSpy.mock.calls[0][3])).toContain("WhatsApp turn exceeded");

    // The provider finally answers *after* Meta already had its 200. The
    // abandoned turn must not append a reply or message the guest behind the
    // redelivery's back — that is what keeps "one guest message, at most one
    // reply" true, and it is why releasing the claim is safe.
    releaseProvider?.();
    await flush();

    expect(sent).toHaveLength(0);
    expect(await store.history(GUEST)).toEqual([{ role: "guest", text: FIRST_TEXT }]);

    // Now Meta's redelivery really does answer the guest.
    expect(await (await post(app, body)).json()).toEqual({ received: 1, replied: 1, duplicates: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(GUEST);
    expect(sent[0].body).toContain(FIRST_REPLY);
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
    expect(await res.json()).toEqual({ received: 0, replied: 0, duplicates: 0, failed: 0 });
    expect(provider.call).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("ignores a voice note rather than guessing at its content", async () => {
    const provider = providerReturning(PARTIAL_RAW);
    const { app, sent } = harness(provider);
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ id: "wamid.1", from: GUEST, type: "audio", audio: { id: "MEDIA" } }] } }] }],
    });

    expect(await (await post(app, body)).json()).toEqual({ received: 0, replied: 0, duplicates: 0, failed: 0 });
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
    expect(await res.json()).toEqual({ received: 1, replied: 0, duplicates: 0, failed: 1 });
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
