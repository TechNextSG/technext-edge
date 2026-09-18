// WhatsApp gives us one message per delivery and never the conversation so
// far, while converse() re-extracts the whole transcript on every turn. So the
// transcript has to live somewhere between two webhook deliveries — otherwise
// turn two arrives context-free ("3 nights" with no dates, no guest count, no
// name) and the guest is asked to start over. This is the same reason the test
// console sends its own `history` field instead of a bare `message`.
import type { ConversationTurn } from "../../../packages/extractor/src/index.js";

export interface ConversationStore {
  history(phone: string): Promise<ConversationTurn[]>;
  append(phone: string, ...turns: ConversationTurn[]): Promise<void>;
  /**
   * Returns true the first time a given provider message id is seen. Meta's
   * webhook is at-least-once: it redelivers whenever our ack is slow or
   * non-2xx, so without this claim the guest gets the same reply twice.
   */
  claimMessage(messageId: string): Promise<boolean>;
  /**
   * Gives a claim back after a turn failed — but only while nothing was sent
   * (see the call site in app.ts). Without this a stalled turn keeps the id
   * forever, and Meta's redelivery of that same message is answered
   * `duplicates: 1`: no reply, no status webhook, and a guest waiting for an
   * answer that already decided not to come.
   */
  releaseMessage(messageId: string): Promise<void>;
}

// Deliberately the same number as the BFF's own cap on ConverseRequest.history,
// so a thread that starts on WhatsApp and continues in the console behaves
// identically on both sides.
export const MAX_TURNS = 20;

// Meta only allows a free-form reply inside 24h of the guest's last message;
// after that a pre-approved template is required, and this adapter does not send
// templates (see docs/01-team-guide.md §6). A thread idle longer than the window
// cannot be answered at all, so holding it costs nothing.
export const THREAD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * POC/dev implementation, NOT sufficient for the deployed BFF: api/index.ts
 * runs as a Vercel Node function, where consecutive deliveries are not
 * guaranteed to land on the same instance (and every deploy starts cold), so a
 * Map here means "sometimes the bot forgets the conversation mid-enquiry".
 * Production needs this same interface backed by Redis / Key Value — documented
 * as an open item in docs/01-team-guide.md §6, with no ADR yet.
 */
export function createInMemoryConversationStore(ttlMs = THREAD_TTL_MS): ConversationStore {
  const threads = new Map<string, { turns: ConversationTurn[]; expiresAt: number }>();
  const claimed = new Map<string, number>();

  // Expiry is enforced lazily on access instead of with an interval: a
  // background timer would keep a serverless instance alive and leak into
  // tests, for a table that is only ever read on an inbound message anyway.
  function sweep(): void {
    const now = Date.now();
    for (const [phone, entry] of threads) if (entry.expiresAt <= now) threads.delete(phone);
    for (const [id, expiresAt] of claimed) if (expiresAt <= now) claimed.delete(id);
  }

  function live(phone: string) {
    const entry = threads.get(phone);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      threads.delete(phone);
      return undefined;
    }
    return entry;
  }

  return {
    async history(phone) {
      sweep();
      // A copy: callers hand this straight to converse(), and a shared array
      // reference would let a later append mutate a transcript already in use.
      return [...(live(phone)?.turns ?? [])];
    },

    async append(phone, ...turns) {
      sweep();
      const entry = live(phone) ?? { turns: [], expiresAt: 0 };
      entry.turns = [...entry.turns, ...turns].slice(-MAX_TURNS);
      entry.expiresAt = Date.now() + ttlMs;
      threads.set(phone, entry);
    },

    async claimMessage(messageId) {
      sweep();
      if (claimed.has(messageId)) return false;
      claimed.set(messageId, Date.now() + ttlMs);
      return true;
    },

    async releaseMessage(messageId) {
      sweep();
      // Deleting an id nobody claimed is deliberately a no-op: releasing is a
      // best-effort cleanup on the failure path and must never throw there.
      claimed.delete(messageId);
    },
  };
}
