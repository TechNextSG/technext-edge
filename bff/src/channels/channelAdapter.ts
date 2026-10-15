/**
 * Generic abstraction for guest messaging channels (Pattern 3 Strategy).
 * Normalizes signature verification, inbound message parsing, and outbound sending
 * across channels (WhatsApp, Telegram, Zalo, Web, etc.).
 */

export interface InboundChannelMessage {
  id: string;
  from: string;
  text: string;
  timestamp?: string | undefined;
  raw?: unknown;
}

export interface OutboundChannelMessage {
  to: string;
  body: string;
}

export interface ChannelVerifyRequest {
  headers: Record<string, string | undefined>;
  rawBody: string;
}

export interface ChannelAdapter<
  TInbound extends InboundChannelMessage = InboundChannelMessage,
  TOutbound extends OutboundChannelMessage = OutboundChannelMessage,
> {
  readonly name: string;
  verify(request: ChannelVerifyRequest): boolean;
  parseInbound(rawPayload: unknown): TInbound[];
  send(message: TOutbound): Promise<void>;
}
