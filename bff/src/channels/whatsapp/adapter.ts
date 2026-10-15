import type { ChannelAdapter, ChannelVerifyRequest, OutboundChannelMessage } from "../channelAdapter.ts";
import {
  type WhatsAppConfig,
  type InboundTextMessage,
  verifySignature,
  parseInboundTexts,
  createWhatsAppSender,
} from "./meta.ts";

export interface WhatsAppChannelAdapter extends ChannelAdapter<InboundTextMessage, OutboundChannelMessage> {
  readonly name: "whatsapp";
}

/**
 * Concrete WhatsApp implementation of ChannelAdapter (Pattern 3).
 * Wraps Meta Cloud API webhook signature verification, payload extraction, and outbound message sending.
 */
export function createWhatsAppChannelAdapter(config: WhatsAppConfig): WhatsAppChannelAdapter {
  const sender = createWhatsAppSender(config);

  return {
    name: "whatsapp",

    verify(request: ChannelVerifyRequest): boolean {
      if (!config.appSecret) return false;
      const signature =
        request.headers["x-hub-signature-256"] ??
        request.headers["X-Hub-Signature-256"] ??
        "";
      return verifySignature(request.rawBody, signature, config.appSecret);
    },

    parseInbound(rawPayload: unknown): InboundTextMessage[] {
      return parseInboundTexts(rawPayload);
    },

    async send(message: OutboundChannelMessage): Promise<void> {
      return sender(message);
    },
  };
}
