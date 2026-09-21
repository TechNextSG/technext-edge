// Meta WhatsApp Cloud API adapter — the inbound half of the channel.
//
// No SDK: the whole integration is one HMAC check on the way in and one POST to
// graph.facebook.com on the way out, which is cheaper to read than a dependency
// and keeps the "exactly one seam to a vendor" rule from extract.ts intact.
//
// Two things this file deliberately does NOT do, both documented in
// docs/01-team-guide.md §6 and neither with an ADR yet (ADR-005b is reserved for
// the model bake-off):
//   - send template messages, so we cannot answer a guest more than 24h after
//     their last message (Meta rejects free-form text outside that window)
//   - handle voice notes / images; v1 reads text only, and transcription would
//     be a new vendor with its own data-residency question (ADR-005a Gate A)
import { createHmac, timingSafeEqual } from "node:crypto";

export interface WhatsAppConfig {
  verifyToken?: string;
  appSecret?: string;
  accessToken?: string;
  phoneNumberId?: string;
  apiVersion: string;
  /** One POST to graph.facebook.com. */
  timeoutMs: number;
  /** One whole inbound turn — and therefore how long Meta waits for our 200. */
  turnTimeoutMs: number;
  /** Coalescing window in ms for rapid consecutive messages from the same phone (default 100ms). */
  debounceMs: number;
}

/**
 * Read lazily rather than at module load: this module is imported by app.ts,
 * which tests import and then set these vars per-case, and by api/index.ts on
 * Vercel where env vars are not guaranteed to exist at module evaluation.
 */
export function whatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  return {
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: env.WHATSAPP_API_VERSION ?? "v21.0",
    timeoutMs: Number(env.WHATSAPP_TIMEOUT_MS ?? 10_000),
    // The turn has to clear a normal provider call plus a send (measured 1.9s and
    // ~1.5s on this path, and the adapters cap themselves at Gemini 8s / DeepSeek
    // 20s) while still answering Meta before it gives up on our 200 and
    // redelivers the same message — measured at +23s on 2026-09-18. That band is
    // what the deadline in app.ts is racing.
    turnTimeoutMs: Number(env.WHATSAPP_TURN_TIMEOUT_MS ?? 20_000),
    debounceMs: Number(env.WHATSAPP_DEBOUNCE_MS ?? (env.NODE_ENV === "test" ? 0 : 100)),
  };
}

/**
 * Verifies the `X-Hub-Signature-256` header: HMAC-SHA256 of the *raw request
 * body* keyed with the Meta app secret. This is the only thing standing between
 * a public URL and anyone on the internet making us extract-and-reply as Casa —
 * and the raw body matters, since re-serialising the parsed JSON changes the
 * bytes and fails a signature that was actually valid.
 */
export function verifySignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  const PREFIX = "sha256=";
  if (!header || !header.startsWith(PREFIX)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = header.slice(PREFIX.length).toLowerCase();
  // timingSafeEqual throws on a length mismatch, so guard first; the comparison
  // itself is constant-time so the header can't be brute-forced byte by byte.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, "utf8"), Buffer.from(expected, "utf8"));
}

/**
 * Constant-time comparison of a shared secret a caller sent us, for the routes
 * that are guarded by the verify token instead of by a signature (the handoff
 * view in app.ts). Same reasoning as verifySignature's comparison: `===` on a
 * secret exits at the first differing byte, which leaks it to anyone willing to
 * measure how long a rejection takes.
 */
export function sameSecret(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on a length mismatch, so guard first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface SenderCheck {
  ok: boolean;
  displayPhoneNumber?: string;
  qualityRating?: string;
  platformType?: string;
  error?: string;
}

/**
 * Asks Meta what it thinks of the sender credentials *this process* was given.
 *
 * scripts/whatsapp-check.mjs answers that for an env file on a laptop, which is a
 * different question: a value pasted into a hosting dashboard keeps whatever quotes
 * it was copied with (Node strips them from a .env file, a dashboard does not), and
 * the first symptom is a 401 on a real guest's message, hours later. Read-only: a GET
 * of the phone number's own public attributes, so it cannot send anything.
 */
export async function checkSenderCredentials(config: WhatsAppConfig): Promise<SenderCheck> {
  const { accessToken, phoneNumberId, apiVersion, timeoutMs } = config;
  if (!accessToken || !phoneNumberId) {
    return { ok: false, error: "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are both required" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}`);
    url.searchParams.set("fields", "display_phone_number,quality_rating,platform_type");
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: controller.signal });
    const body = await res.text();
    if (!res.ok) {
      // Meta's body names the problem (190 invalid token, 133010 not registered),
      // and this is the one place that error is worth reading before a guest finds it.
      return { ok: false, error: `Meta refused the token: ${res.status} ${body.slice(0, 300)}` };
    }
    const json = JSON.parse(body) as Record<string, unknown>;
    return {
      ok: true,
      displayPhoneNumber: typeof json.display_phone_number === "string" ? json.display_phone_number : undefined,
      qualityRating: typeof json.quality_rating === "string" ? json.quality_rating : undefined,
      platformType: typeof json.platform_type === "string" ? json.platform_type : undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { ok: false, error: `Meta did not answer within ${timeoutMs}ms` };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export interface InboundTextMessage {
  /** Meta's message id (`wamid...`) — the dedupe key, not the guest's number. */
  id: string;
  /** Guest's number, international format, digits only (e.g. `639171234567`). */
  from: string;
  text: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Flattens Meta's `entry[].changes[].value` envelope down to the text messages
 * worth answering. Everything else the same webhook carries — delivery and read
 * receipts (`statuses`), and non-text message types — is dropped here instead of
 * being filtered at the call site, so the route stays a straight line.
 */
export function parseInboundTexts(payload: unknown): InboundTextMessage[] {
  const out: InboundTextMessage[] = [];

  for (const entry of asArray(asRecord(payload)?.entry)) {
    for (const change of asArray(asRecord(entry)?.changes)) {
      const value = asRecord(asRecord(change)?.value);
      if (!value) continue;

      for (const message of asArray(value.messages)) {
        const record = asRecord(message);
        const text = asRecord(record?.text);
        if (record?.type !== "text" || typeof text?.body !== "string") continue;

        const id = record.id;
        const from = record.from;
        if (typeof id !== "string" || typeof from !== "string") continue;

        out.push({ id, from, text: text.body });
      }
    }
  }

  return out;
}

export type WhatsAppSendText = (input: { to: string; body: string }) => Promise<void>;

// Meta rejects a text body over 4096 characters outright. A reply is a short
// deterministic message now (see renderReply in questions.ts): a greeting, an
// acknowledgment plus the open questions, or a summary — a dozen short lines at
// most, so this only ever fires if a conversation grows a novel.
const MAX_BODY_CHARS = 4096;

export function createWhatsAppSender(config: WhatsAppConfig): WhatsAppSendText {
  const { accessToken, phoneNumberId, apiVersion, timeoutMs } = config;
  if (!accessToken || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are both required to send a reply");
  }

  return async ({ to, body }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          // preview_url off: a guest enquiry has no link worth unfurling, and
          // guest-supplied text is exactly what we don't want triggering an
          // outbound fetch from Meta's side on our behalf.
          text: { preview_url: false, body: body.slice(0, MAX_BODY_CHARS) },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Body included on purpose: Meta puts the actionable part there
        // (expired token, unapproved recipient, 24h window passed), and a bare
        // status code turns every one of those into the same support thread.
        throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`WhatsApp send timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
