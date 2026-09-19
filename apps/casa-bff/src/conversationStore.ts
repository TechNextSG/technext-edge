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

  /**
   * Parks the thread for a human. While it is parked no model is called at all:
   * the bot would be talking over the person who owns the enquiry now.
   * `reason` is for the human reading the list, never for the guest.
   *
   * Parking is not permanent — the record lives as long as the thread does (see
   * THREAD_TTL_MS), and `resume()` hands the enquiry back before that.
   */
  pause(phone: string, reason: string): Promise<void>;
  /** Hands the thread back to the bot once a person is done with it. */
  resume(phone: string): Promise<void>;
  /** The park record, or undefined while the bot still owns the thread. */
  paused(phone: string): Promise<PausedThread | undefined>;
  /** Every parked thread — what a reception view reads. */
  pausedThreads(): Promise<PausedThread[]>;
  /**
   * True when the guest has not been told a person is on it within `withinMs`.
   * A parked thread must not repeat the same holding sentence at every "ok" the
   * guest types, and it must never be the silence this path exists to end: the
   * guest is told once, then again only after the window has passed.
   */
  needsTelling(phone: string, withinMs: number): Promise<boolean>;
  /** Records that the guest has just been told (see needsTelling). */
  markTold(phone: string): Promise<void>;
  /** Clears both the conversation transcript and any park record for this phone. */
  clear(phone: string): Promise<void>;
}

/** A thread a human has to answer, as the reception view reads it. */
export interface PausedThread {
  phone: string;
  /** Why the bot stopped answering: a failed turn, an escalate keyword, or the asking limit. */
  reason: string;
  /** When a person was first needed (epoch ms). */
  since: number;
  /** When the guest was last told a person is on it (epoch ms), or 0 if never. */
  toldAt: number;
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
  const parkedThreads = new Map<string, PausedThread & { expiresAt: number }>();

  // Expiry is enforced lazily on access instead of with an interval: a
  // background timer would keep a serverless instance alive and leak into
  // tests, for a table that is only ever read on an inbound message anyway.
  function sweep(): void {
    const now = Date.now();
    for (const [phone, entry] of threads) if (entry.expiresAt <= now) threads.delete(phone);
    for (const [id, expiresAt] of claimed) if (expiresAt <= now) claimed.delete(id);
    for (const [phone, entry] of parkedThreads) if (entry.expiresAt <= now) parkedThreads.delete(phone);
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

  // Same lazy expiry for the park records: a thread nobody came back to within
  // the 24h window cannot be answered free-form any more, so the park expires
  // with it and the bot (if it ever sees that guest again) starts clean.
  function livePause(phone: string): PausedThread | undefined {
    const entry = parkedThreads.get(phone);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      parkedThreads.delete(phone);
      return undefined;
    }
    return entry;
  }

  // The shape the reception view reads is not the internal record: `expiresAt` is
  // this adapter's business, and a caller copying a park record around must not be
  // able to mutate the map's entry by accident.
  function publicPause(entry: PausedThread): PausedThread {
    return { phone: entry.phone, reason: entry.reason, since: entry.since, toldAt: entry.toldAt };
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

    async pause(phone, reason) {
      sweep();
      const existing = livePause(phone);
      parkedThreads.set(phone, {
        phone,
        reason,
        // `since` is when a person was first needed, so re-parking an already
        // parked thread (a guest asking for a human twice) does not reset the
        // clock the reception view sorts by.
        since: existing?.since ?? Date.now(),
        // Nobody has been told yet: the caller says so with markTold() once the
        // holding message is actually on its way. Assuming it here would leave a
        // guest who never received it waiting in silence.
        toldAt: existing?.toldAt ?? 0,
        expiresAt: Date.now() + ttlMs,
      });
    },

    async resume(phone) {
      sweep();
      parkedThreads.delete(phone);
    },

    async clear(phone) {
      sweep();
      threads.delete(phone);
      parkedThreads.delete(phone);
    },

    async paused(phone) {
      sweep();
      const entry = livePause(phone);
      return entry ? publicPause(entry) : undefined;
    },

    async pausedThreads() {
      sweep();
      // Oldest first: the enquiry that has been waiting longest is the one a
      // person should pick up.
      return [...parkedThreads.values()].sort((a, b) => a.since - b.since).map(publicPause);
    },

    async needsTelling(phone, withinMs) {
      sweep();
      const entry = livePause(phone);
      if (!entry) return false;
      return entry.toldAt === 0 || Date.now() - entry.toldAt >= withinMs;
    },

    async markTold(phone) {
      sweep();
      const entry = livePause(phone);
      // A thread resumed (or expired) between the send and this call has nothing
      // to record, and inventing an entry here would park a thread nobody parked.
      if (entry) entry.toldAt = Date.now();
    },
  };
}
