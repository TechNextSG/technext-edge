import type { Hono } from "hono";
import type { ExtractProvider } from "../../../ai/src/index.ts";
import type { ConversationStore } from "../store/conversationStore.ts";
import type { EstimatorPort } from "../services/estimatorPort.ts";
import { whatsAppConfig, verifySignature, parseInboundTexts, checkSenderCredentials, createWhatsAppSender, type WhatsAppSendText, type InboundTextMessage } from "../services/whatsapp.ts";
import {
  processPhoneTurnBatch,
  closeEnquiryQuotation,
  type TurnBatchItem,
} from "../services/whatsappTurnService.ts";

export interface WhatsAppRouteDeps {
  store: ConversationStore;
  providerFor: (data: { provider?: string; apiKey?: string }) => Promise<ExtractProvider>;
  sendWhatsApp?: WhatsAppSendText;
  estimator: EstimatorPort;
  /** Whether a request carries the WhatsApp verify token (the handoff JSON routes). */
  handoffAuthorized: (header: string | undefined) => boolean;
}

export function registerWhatsAppRoutes(app: Hono, deps: WhatsAppRouteDeps): void {
  const { store, providerFor, estimator, handoffAuthorized } = deps;

  // Meta's subscription handshake, called once when the webhook URL is pointed at
  // Meta and again whenever that URL or the token changes.
  app.get("/v1/channels/whatsapp/webhook", (c) => {
    const config = whatsAppConfig();
    if (!config.verifyToken) {
      return c.json({ error: "server_misconfigured", detail: "WHATSAPP_VERIFY_TOKEN is not set" }, 500);
    }

    const challenge = c.req.query("hub.challenge");
    if (
      c.req.query("hub.mode") === "subscribe" &&
      c.req.query("hub.verify_token") === config.verifyToken &&
      challenge
    ) {
      return c.text(challenge);
    }
    return c.json({ error: "invalid_verify_token" }, 403);
  });

  app.post("/v1/channels/whatsapp/webhook", async (c) => {
    const config = whatsAppConfig();
    if (!config.appSecret) {
      return c.json({ error: "server_misconfigured", detail: "WHATSAPP_APP_SECRET is not set" }, 500);
    }

    const raw = await c.req.text();
    if (!verifySignature(raw, c.req.header("x-hub-signature-256"), config.appSecret)) {
      return c.json({ error: "invalid_signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const inbound = parseInboundTexts(payload);
    if (inbound.length === 0) {
      return c.json({ received: 0, replied: 0, duplicates: 0, failed: 0, handoffs: 0 });
    }

    let provider: ExtractProvider;
    let sendText: WhatsAppSendText;
    try {
      provider = await providerFor({});
      sendText = deps.sendWhatsApp ?? createWhatsAppSender(config);
    } catch (err) {
      return c.json({ error: "server_misconfigured", detail: err instanceof Error ? err.message : String(err) }, 500);
    }

    let replied = 0;
    let duplicates = 0;
    let failed = 0;
    let handoffs = 0;

    const claimedInbound: TurnBatchItem[] = [];

    for (const message of inbound) {
      const claim = await store.claimMessage(message.id);
      if (!claim.claimed) {
        duplicates++;
        continue;
      }
      claimedInbound.push({ message, fenceToken: claim.fenceToken });
    }

    const byPhone = new Map<string, TurnBatchItem[]>();
    for (const item of claimedInbound) {
      const list = byPhone.get(item.message.from) ?? [];
      list.push(item);
      byPhone.set(item.message.from, list);
    }

    for (const [phone, batch] of byPhone) {
      const result = await processPhoneTurnBatch(phone, batch, {
        store,
        provider,
        sendWhatsApp: sendText,
        estimator,
        config,
      });
      replied += result.replied;
      failed += result.failed;
      handoffs += result.handoffs;
    }

    return c.json({ received: inbound.length, replied, duplicates, failed, handoffs });
  });

  app.get("/v1/channels/whatsapp/threads", async (c) => {
    if (!handoffAuthorized(c.req.header("x-verify-token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json({ paused: await store.pausedThreads() });
  });

  app.post("/v1/channels/whatsapp/threads/:phone/resume", async (c) => {
    if (!handoffAuthorized(c.req.header("x-verify-token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const phone = c.req.param("phone");
    await store.resume(phone);
    return c.json({ ok: true, phone });
  });

  app.post("/v1/channels/whatsapp/threads/:phone/reset", async (c) => {
    if (!handoffAuthorized(c.req.header("x-verify-token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const phone = c.req.param("phone");
    await closeEnquiryQuotation(phone);
    await store.clear(phone);
    return c.json({ ok: true, phone, reset: true });
  });

  app.get("/v1/channels/whatsapp/status", async (c) => {
    if (!handoffAuthorized(c.req.header("x-verify-token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const config = whatsAppConfig();
    return c.json({
      configured: {
        verifyToken: Boolean(config.verifyToken),
        appSecret: Boolean(config.appSecret),
        accessToken: Boolean(config.accessToken),
        phoneNumberId: Boolean(config.phoneNumberId),
      },
      sender: await checkSenderCredentials(config),
    });
  });
}
