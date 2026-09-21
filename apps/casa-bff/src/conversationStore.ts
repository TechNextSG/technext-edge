// WhatsApp gives us one message per delivery and never the conversation so
// far, while converse() re-extracts the whole transcript on every turn. So the
// transcript has to live somewhere between two webhook deliveries — otherwise
// turn two arrives context-free ("3 nights" with no dates, no guest count, no
// name) and the guest is asked to start over. This is the same reason the test
// console sends its own `history` field instead of a bare `message`.
import type { ConversationTurn } from "../../../packages/extractor/src/index.js";
import { randomUUID } from "node:crypto";
import { createRedisConversationStore } from "./redisStore.js";

export interface ClaimResult {
  claimed: boolean;
  fenceToken: string;
}

export interface ConversationStore {
  history(phone: string): Promise<ConversationTurn[]>;
  append(phone: string, ...turns: ConversationTurn[]): Promise<void>;

  /**
   * Claims a message id with an in-flight timeout (default 60s) and returns a unique fenceToken.
   * If already marked done (24h) or currently in-flight, returns claimed: false.
   */
  claimMessage(messageId: string, inFlightMs?: number): Promise<ClaimResult>;

  /**
   * Releases an in-flight claim if the fenceToken matches (or if omitted for cleanup).
   * Allows retries if the turn failed before sending any reply.
   */
  releaseMessage(messageId: string, fenceToken?: string): Promise<void>;

  /**
   * Marks a message as permanently completed (24h TTL) once an answer or apology has been sent.
   */
  markDone(messageId: string, fenceToken?: string): Promise<void>;

  /**
   * Executes an async operation with a mutex lock for a specific phone number.
   * Prevents concurrent webhook executions for the same guest from clobbering each other.
   */
  withPhoneLock<T>(phone: string, op: () => Promise<T>): Promise<T>;

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

// In-flight claim timeout: if a serverless worker crashes or is terminated midway
// before completing or releasing, the claim expires after 60s so Meta's subsequent
// redelivery can retry instead of being blocked for 24h.
export const IN_FLIGHT_CLAIM_TTL_MS = 60_000;

interface InternalClaimEntry {
  state: "in_flight" | "done";
  fenceToken: string;
  expiresAt: number;
}

export function createInMemoryConversationStore(ttlMs = THREAD_TTL_MS): ConversationStore {
  const threads = new Map<string, { turns: ConversationTurn[]; expiresAt: number }>();
  const claimed = new Map<string, InternalClaimEntry>();
  const parkedThreads = new Map<string, PausedThread & { expiresAt: number }>();
  const phoneLocks = new Map<string, Promise<void>>();

  // Expiry is enforced lazily on access instead of with an interval: a
  // background timer would keep a serverless instance alive and leak into
  // tests, for a table that is only ever read on an inbound message anyway.
  function sweep(): void {
    const now = Date.now();
    for (const [phone, entry] of threads) if (entry.expiresAt <= now) threads.delete(phone);
    for (const [id, entry] of claimed) if (entry.expiresAt <= now) claimed.delete(id);
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
      return [...(live(phone)?.turns ?? [])];
    },

    async append(phone, ...turns) {
      sweep();
      const entry = live(phone) ?? { turns: [], expiresAt: 0 };
      entry.turns = [...entry.turns, ...turns].slice(-MAX_TURNS);
      entry.expiresAt = Date.now() + ttlMs;
      threads.set(phone, entry);
    },

    async claimMessage(messageId, inFlightMs = IN_FLIGHT_CLAIM_TTL_MS): Promise<ClaimResult> {
      sweep();
      const now = Date.now();
      const existing = claimed.get(messageId);

      if (existing) {
        if (existing.state === "done") {
          return { claimed: false, fenceToken: existing.fenceToken };
        }
        if (existing.state === "in_flight" && existing.expiresAt > now) {
          return { claimed: false, fenceToken: existing.fenceToken };
        }
      }

      const fenceToken = randomUUID();
      claimed.set(messageId, {
        state: "in_flight",
        fenceToken,
        expiresAt: now + inFlightMs,
      });
      return { claimed: true, fenceToken };
    },

    async releaseMessage(messageId, fenceToken) {
      sweep();
      const existing = claimed.get(messageId);
      if (!existing) return;
      if (existing.state === "in_flight") {
        if (!fenceToken || existing.fenceToken === fenceToken) {
          claimed.delete(messageId);
        }
      }
    },

    async markDone(messageId, fenceToken) {
      sweep();
      const existing = claimed.get(messageId);
      if (!existing) {
        claimed.set(messageId, {
          state: "done",
          fenceToken: fenceToken ?? randomUUID(),
          expiresAt: Date.now() + ttlMs,
        });
        return;
      }
      if (!fenceToken || existing.fenceToken === fenceToken) {
        existing.state = "done";
        existing.expiresAt = Date.now() + ttlMs;
      }
    },

    async withPhoneLock<T>(phone: string, op: () => Promise<T>): Promise<T> {
      const current = phoneLocks.get(phone) ?? Promise.resolve();
      let release!: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      phoneLocks.set(phone, next);

      try {
        await current;
        return await op();
      } finally {
        release();
        if (phoneLocks.get(phone) === next) {
          phoneLocks.delete(phone);
        }
      }
    },

    async pause(phone, reason) {
      sweep();
      const existing = livePause(phone);
      parkedThreads.set(phone, {
        phone,
        reason,
        since: existing?.since ?? Date.now(),
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
      if (entry) entry.toldAt = Date.now();
    },
  };
}

/**
 * Creates conversation store based on environment configuration:
 * Uses Redis REST store if KV_REST_API_URL / UPSTASH_REDIS_REST_URL is configured,
 * otherwise falls back to the in-memory store.
 */
export function createConversationStoreFromEnv(): ConversationStore {
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (kvUrl && kvToken) {
    return createRedisConversationStore({ url: kvUrl, token: kvToken });
  }

  return createInMemoryConversationStore();
}
