import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseEstimatorWebhookPayload } from "../../../contracts/src/index.ts";
import type { ConversationStore } from "../store/conversationStore.ts";
import type { QuotationStore } from "../store/quotationStoreClient.ts";
import type { WhatsAppSendText } from "../channels/whatsapp/meta.ts";
import type { HonoQuotationDraft } from "../quote/index.ts";

export interface EstimatorWebhookDeps {
  store: ConversationStore;
  quotationStore?: QuotationStore;
  sendWhatsApp?: WhatsAppSendText;
  webhookSecret?: string;
}

export function verifyEstimatorSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  if (!signatureHeader) return false;

  const cleanHeader = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex").toLowerCase();

  try {
    const headerBuf = Buffer.from(cleanHeader, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (headerBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(headerBuf, expectedBuf);
  } catch {
    return false;
  }
}

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

export function estimatorWebhookRoutes(deps: EstimatorWebhookDeps): Hono {
  const app = new Hono();
  const { store, quotationStore, sendWhatsApp, webhookSecret } = deps;

  // Cache of processed event fingerprints for exactly-once idempotency
  const processedEvents = new Map<string, number>();

  function isProcessed(fingerprint: string): boolean {
    const now = Date.now();
    for (const [key, exp] of processedEvents) {
      if (exp <= now) processedEvents.delete(key);
    }
    return processedEvents.has(fingerprint);
  }

  function markProcessed(fingerprint: string): void {
    processedEvents.set(fingerprint, Date.now() + 24 * 60 * 60 * 1000);
  }

  app.post("/v1/estimator/webhook", async (c) => {
    const secret = webhookSecret;
    const raw = await c.req.text();

    if (secret) {
      const sigHeader =
        c.req.header("x-estimator-signature") ??
        c.req.header("x-hub-signature-256") ??
        c.req.header("x-signature");

      if (!verifyEstimatorSignature(raw, sigHeader, secret)) {
        return c.json({ ok: false, error: "invalid_signature" }, 401);
      }
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const parseResult = parseEstimatorWebhookPayload(parsedJson);
    if (!parseResult.ok) {
      return c.json({ ok: false, error: "invalid_payload", detail: parseResult.error.format() }, 400);
    }

    const payload = parseResult.data;
    const now = Date.now();

    // Timestamp freshness verification (replay protection)
    if (Math.abs(now - payload.timestamp) > MAX_TIMESTAMP_DRIFT_MS) {
      return c.json({ ok: false, error: "stale_timestamp" }, 400);
    }

    // Idempotent exactly-once check
    const fingerprint = `${payload.event}:${payload.estimateId}:${payload.timestamp}`;
    if (isProcessed(fingerprint)) {
      return c.json({ ok: true, duplicate: true });
    }

    // Lookup corresponding quotation draft
    let quotation: HonoQuotationDraft | undefined;
    if (quotationStore) {
      const all = await quotationStore.list();
      quotation = all.find(
        (q) => q.estimator?.id === payload.estimateId || (payload.guestPhone && q.phone === payload.guestPhone && q.status !== "cancelled"),
      );
    }

    const phone = payload.guestPhone ?? quotation?.phone;

    if (payload.event === "approved") {
      if (quotation && quotationStore) {
        quotation.status = "confirmed_by_hono";
        if (payload.url) quotation.quotationUrl = payload.url;
        quotation.estimator = {
          id: quotation.estimator?.id ?? payload.estimateId,
          cookie: quotation.estimator?.cookie ?? null,
          seq: quotation.estimator?.seq ?? payload.seq ?? null,
          guestUrl: payload.url ?? quotation.estimator?.guestUrl ?? null,
          sharedAt: new Date().toISOString(),
        };
        await quotationStore.save(quotation);
      }

      if (phone) {
        await store.transitionState(phone, {
          type: "STAFF_APPROVED",
          quoteId: quotation?.quoteId,
          estimateUrl: payload.url,
        });

        if (payload.url && sendWhatsApp) {
          const guestGreeting = payload.guestName ? `Hi ${payload.guestName}, ` : "";
          const messageText = `${guestGreeting}Great news! Your quotation has been prepared by our team.\n\nYou can review your trip details and book here:\n${payload.url}`;
          await sendWhatsApp({ to: phone, body: messageText });
        }
      }

      markProcessed(fingerprint);
      return c.json({ ok: true, event: "approved", processed: true, quoteId: quotation?.quoteId });
    }

    if (payload.event === "archived") {
      if (quotation && quotationStore) {
        quotation.status = "cancelled";
        await quotationStore.save(quotation);
      }

      if (phone) {
        await store.transitionState(phone, {
          type: "HANDOFF",
          reason: "staff_archived",
        });
      }

      markProcessed(fingerprint);
      return c.json({ ok: true, event: "archived", processed: true });
    }

    return c.json({ ok: false, error: "unknown_event" }, 400);
  });

  return app;
}
