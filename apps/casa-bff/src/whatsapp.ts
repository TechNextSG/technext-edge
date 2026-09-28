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
  /**
   * Where Meta's Graph API lives. Overridable **for tests only**, and the reason is that the reply a
   * guest reads is the one thing no server-side assertion can see: the webhook answers
   * `{replied: 1}` whether the message said the right thing or not, and with the real host a test
   * run either sends to a real phone or fails on a dummy token — so the text itself went
   * unverified. Pointing this at a local capture server lets a test read the exact bytes Meta would
   * have delivered, with no traffic leaving the machine.
   *
   * Defaults to the real host, so nothing changes for a deployment that does not set it.
   */
  graphBaseUrl?: string;
  /** One POST to graph.facebook.com. */
  timeoutMs: number;
  /** One whole inbound turn — and therefore how long Meta waits for our 200. */
  turnTimeoutMs: number;
}

/** The real Graph API host, and the default for `graphBaseUrl`. */
export const GRAPH_BASE_URL = "https://graph.facebook.com";

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
    graphBaseUrl: env.WHATSAPP_GRAPH_BASE_URL ?? GRAPH_BASE_URL,
    timeoutMs: Number(env.WHATSAPP_TIMEOUT_MS ?? 10_000),
    // The turn has to clear a normal provider call plus a send (measured 1.9s and
    // ~1.5s on this path, and the adapters cap themselves at Gemini 8s / DeepSeek
    // 20s) while still answering Meta before it gives up on our 200 and
    // redelivers the same message — measured at +23s on 2026-09-18. That band is
    // what the deadline in app.ts is racing.
    turnTimeoutMs: Number(env.WHATSAPP_TURN_TIMEOUT_MS ?? 20_000),
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
  const { accessToken, phoneNumberId, apiVersion, timeoutMs, graphBaseUrl } = config;
  if (!accessToken || !phoneNumberId) {
    return { ok: false, error: "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are both required" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(`${graphBaseUrl ?? GRAPH_BASE_URL}/${apiVersion}/${phoneNumberId}`);
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

/**
 * A send Meta refused, with its own numeric code kept separate from the raw body.
 *
 * `detail` is for the log. Nothing puts it in front of a staff member: `explainMetaError` turns the
 * code into one sentence in English, and an unrecognised code into a generic one.
 */
export class WhatsAppSendError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly code?: number,
  ) {
    super(`WhatsApp send failed: ${status} ${detail}`);
    this.name = "WhatsAppSendError";
  }
}

/** What a staff member's typed number turned into, or why it could not be used. */
export type RecipientCheck =  | { ok: true; phone: string }
  | { ok: false; code: "phone_missing" | "phone_invalid"; message: string };

/**
 * Clean up a phone number a staff member typed, or refuse it with something they can act on.
 *
 * Why this is not simply "strip non-digits": the studio used to send whatever was in the box
 * straight to Meta, and Meta's answer for a number it cannot route is a JSON blob with a numeric
 * code in it — which is what the studio then showed the receptionist. A number with no country code
 * is the common case, and it has exactly one honest answer.
 *
 * Deliberately does NOT guess the country for a leading zero. The plan was to read `0359…` as a
 * Vietnamese number and send `84359…`, and that is right for this team's own test numbers — but the
 * resort is in the Philippines, where a receptionist typing a guest's local `0917…` would have that
 * message sent to a stranger in Vietnam. Two countries are in play and the number itself does not
 * say which, so the caller is told to add the code. No country code is a question, not a default.
 */
export function checkRecipient(raw: string | undefined | null): RecipientCheck {
  const digits = String(raw ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const bare = digits.replace(/^\+/, "");
  if (bare === "") {
    return { ok: false, code: "phone_missing", message: "Enter the guest's WhatsApp number, including the country code." };
  }
  if (bare.startsWith("00")) {
    // 00 is the international prefix in most of the world; drop it and keep the country code.
    //
    // Checked BEFORE the leading-zero refusal below, which used to swallow it: `0063917…` does have a
    // country code, and telling a receptionist to add one — while refusing a number Meta can route —
    // was the wrong answer twice over. The branch was dead code until this order changed.
    return checkRecipient(bare.replace(/^00/, ""));
  }
  if (bare.startsWith("0")) {
    return {
      ok: false,
      code: "phone_invalid",
      message: `That number starts with 0. Add the country code — 63 for the Philippines, 84 for Vietnam — so it reads 63… or 84…`,
    };
  }
  if (bare.length < 8 || bare.length > 15) {
    return {
      ok: false,
      code: "phone_invalid",
      message: `That number is ${bare.length} digits. A WhatsApp number with its country code is 8 to 15.`,
    };
  }
  return { ok: true, phone: bare };
}

/**
 * Meta's error codes, in words a receptionist can act on.
 *
 * The raw body is `{"error":{"message":"...","code":131030,...}}` — useful to us, meaningless to the
 * person at the front desk, and it can quote the number back. Recognised codes become one English
 * sentence; anything unrecognised becomes a generic sentence that carries only Meta's **numeric**
 * code, and the body itself goes to the log.
 *
 * The default branch used to paste 120 characters of that body into the sentence instead, which
 * contradicted this paragraph and put vendor JSON — sometimes with the guest's own number in it — in
 * front of the receptionist. A number is a fact they can quote to us; the blob is not.
 */
export function explainMetaError(code: number | undefined, fallbackDetail: string): string {
  switch (code) {
    case 131030:
      return "This number isn't on the WhatsApp test list yet — add it in Meta, or send to a number that is on the list.";
    case 131026:
      return "WhatsApp could not deliver to that number. Check it includes the country code (e.g. 63… or 84…).";
    case 131047:
      return "WhatsApp only allows a free-form reply within 24 hours of the guest's last message. Ask them to message us again, or reply from the WhatsApp app.";
    case 190:
      return "The WhatsApp access token has expired or been revoked. It needs replacing in the deployment settings.";
    case 133010:
      return "This WhatsApp number is not registered for the Cloud API yet, so it cannot send at all. It has to be registered from the Meta side.";
    default:
      return code === undefined
        ? `WhatsApp refused the message and did not say why. Our team has the details in the deployment log (their answer was ${fallbackDetail.trim().length} characters).`
        : `WhatsApp refused the message (Meta code ${code}). Our team has the details in the deployment log.`;
  }
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
  const { accessToken, phoneNumberId, apiVersion, timeoutMs, graphBaseUrl } = config;
  if (!accessToken || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are both required to send a reply");
  }

  return async ({ to, body }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${graphBaseUrl ?? GRAPH_BASE_URL}/${apiVersion}/${phoneNumberId}/messages`, {
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
        // The body is parsed, not stringified into the message: Meta puts the actionable part there
        // (expired token, unapproved recipient, 24h window passed) as a numeric `code`, and the
        // caller turns that into one English sentence. The raw text still travels on the error for
        // the log, where it belongs.
        const text = await res.text();
        let code: number | undefined;
        try {
          const parsed = JSON.parse(text) as { error?: { code?: unknown } };
          if (typeof parsed.error?.code === "number") code = parsed.error.code;
        } catch {
          // Non-JSON body: no code to map, the caller falls back to a generic sentence.
        }
        throw new WhatsAppSendError(res.status, text.slice(0, 300), code);
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
