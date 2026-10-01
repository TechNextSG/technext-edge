// WhatsApp gives us one message per delivery and never the conversation so
// far, while converse() re-extracts the whole transcript on every turn. So the
// transcript has to live somewhere between two webhook deliveries — otherwise
// turn two arrives context-free ("3 nights" with no dates, no guest count, no
// name) and the guest is asked to start over. This is the same reason the test
// console sends its own `history` field instead of a bare `message`.
import type { ConversationTurn } from "../../../ai/src/index.ts";
import type { StatedValueChange } from "../../../ai/src/index.ts";
import { randomUUID } from "node:crypto";
import { createRedisConversationStore } from "./redisStore.ts";

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
  pause(phone: string, reason: string, extra?: PauseContext): Promise<void>;
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
  /**
   * Remembers which questions were still open at the end of this turn, and reports how many
   * consecutive turns have now failed to shrink that set.
   *
   * This is the progress signal `ASK_LIMIT` cannot provide. Counting turns punishes a guest who
   * answers one field per message and rewards an extractor that keeps failing on the same field;
   * counting "the open set did not get smaller" catches exactly the case the limit exists for.
   *
   * Compares by SET, not by order: the question order is a presentation decision, and a reorder
   * is not the guest's progress.
   */
  noteOpenFields(phone: string, fields: readonly string[], limit: number): Promise<StallState>;
  /**
   * Remembers the money-bearing values the guest has stated, and reports which of them changed
   * since the previous turn.
   *
   * Prices are built from counts, so a count that quietly changes between two messages is a
   * different quotation — and because the extractor re-reads the whole transcript each turn, the
   * change is otherwise invisible: the new value simply replaces the old one. Recording the last
   * stated values here is what lets the reply name the change instead of moving on.
   */
  noteStatedValues(phone: string, values: StatedValues): Promise<StatedValueChange[]>;
  /** Clears both the conversation transcript and any park record for this phone. */
  clear(phone: string): Promise<void>;
}

/** The values a price depends on, as the guest most recently stated them. */
export type StatedValues = Record<string, string | number | boolean>;

/** What a park records beyond its reason, so a person can pick the thread up fast. */
export interface PauseContext {
  /** The questions still open when the bot stopped — what the human has to ask. */
  missingFields?: readonly string[];
  /** The last thing the guest was acknowledged for, so the human is not starting cold. */
  context?: string;
}

/** How far a thread has drifted from making progress. */
export interface StallState {
  /** Consecutive turns whose open-question set did not shrink. */
  stallCount: number;
  /** True once `stallCount` has reached the limit passed in. */
  stalled: boolean;
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
  /**
   * The questions still open when the thread was parked, in the pipeline's own field names.
   * Optional because park records written before this existed do not carry it, and a reception
   * view must render one without crashing.
   */
  missingFields?: string[];
  /** One line of what the guest last had acknowledged, for the human picking it up. */
  context?: string;
}

// Deliberately the same number as the BFF's own cap on ConverseRequest.history,
// so a thread that starts on WhatsApp and continues in the console behaves
// identically on both sides.
export const MAX_TURNS = 20;

// Meta only allows a free-form reply inside 24h of the guest's last message;
// after that a pre-approved template is required, and this adapter does not send
// templates (see docs/guides/01-team-guide.md §6). A thread idle longer than the window
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

/**
 * One thread's memory. `openFields`/`stallCount` ride along with the transcript on purpose: they
 * are facts about the conversation's progress, and a store that kept them somewhere else could
 * report a stall for a thread whose transcript had already expired.
 */
interface ThreadEntry {
  turns: ConversationTurn[];
  expiresAt: number;
  /** The open-question set as of the last completed turn (see noteOpenFields). */
  openFields?: string[];
  /** Consecutive turns whose open-question set did not shrink. */
  stallCount?: number;
  /** The money-bearing values as of the last turn (see noteStatedValues). */
  statedValues?: StatedValues;
}

/** Order-insensitive equality: the question order is presentation, not progress. */
export function sameFieldSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((field) => set.has(field));
}

export function createInMemoryConversationStore(ttlMs = THREAD_TTL_MS): ConversationStore {
  const threads = new Map<string, ThreadEntry>();
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
    return {
      phone: entry.phone,
      reason: entry.reason,
      since: entry.since,
      toldAt: entry.toldAt,
      // Spread only when present: `exactOptionalPropertyTypes` is off, but a `undefined` value
      // that survives into JSON is a field the reception view has to special-case for nothing.
      ...(entry.missingFields ? { missingFields: entry.missingFields } : {}),
      ...(entry.context ? { context: entry.context } : {}),
    };
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

    async pause(phone, reason, extra) {
      sweep();
      const existing = livePause(phone);
      parkedThreads.set(phone, {
        phone,
        reason,
        since: existing?.since ?? Date.now(),
        toldAt: existing?.toldAt ?? 0,
        ...(extra?.missingFields ? { missingFields: [...extra.missingFields] } : {}),
        ...(extra?.context ? { context: extra.context } : {}),
        expiresAt: Date.now() + ttlMs,
      });
    },

    async noteOpenFields(phone, fields, limit) {
      sweep();
      const entry = live(phone) ?? { turns: [], expiresAt: 0 };
      const previous = entry.openFields ?? [];
      // A turn that closes questions is progress, and it resets the count. An unchanged non-empty
      // set — including the very first turn, where `previous` is empty — cannot increment, because
      // a thread with nothing recorded yet has nothing to be stuck on.
      const noProgress = fields.length > 0 && sameFieldSet(previous, fields);
      entry.stallCount = noProgress ? (entry.stallCount ?? 0) + 1 : 0;
      entry.openFields = [...fields];
      entry.expiresAt = Date.now() + ttlMs;
      threads.set(phone, entry);
      return { stallCount: entry.stallCount, stalled: entry.stallCount >= limit };
    },

    async noteStatedValues(phone, values) {
      sweep();
      const entry = live(phone) ?? { turns: [], expiresAt: 0 };
      const previous = entry.statedValues ?? {};
      const changes: StatedValueChange[] = [];
      for (const [field, value] of Object.entries(values)) {
        const before = previous[field];
        // Only a value the guest had ALREADY stated can "change". The first time a field is filled
        // it goes from nothing to something, which is the enquiry arriving, not the guest
        // contradicting themselves — and confirming that on every new field would be a questionnaire.
        if (before !== undefined && before !== value) {
          changes.push({ field, from: before, to: value });
        }
      }
      entry.statedValues = { ...values };
      entry.expiresAt = Date.now() + ttlMs;
      threads.set(phone, entry);
      return changes;
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
 *
 * The fallback is correct locally and wrong in production, and it is silent either way:
 * an in-memory store on serverless loses every thread on a cold start and cannot hold the
 * phone lock across containers (see redisStore.ts). A deployment that is missing its KV
 * credentials therefore looks like it works — right up until a guest's second message
 * arrives at a different instance and the bot has no idea who they are.
 *
 * So production says so, loudly and once per process. It deliberately does not throw: a
 * quoting tool that still answers, with degraded memory, beats a tool that answers nothing
 * because an env var is missing, and the operator can see the warning in the function logs.
 */
export function createConversationStoreFromEnv(): ConversationStore {
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (kvUrl && kvToken) {
    return createRedisConversationStore({ url: kvUrl, token: kvToken });
  }

  const isProduction =
    process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProduction) {
    console.error(
      "[casa-bff] NO KV CONFIGURED IN PRODUCTION: falling back to the in-memory conversation " +
        "store. Threads will be lost on every cold start and the phone lock will not hold " +
        "across instances, so a guest's follow-up message can be answered with no memory of " +
        "the first. Set KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_* equivalents).",
    );
  }

  return createInMemoryConversationStore();
}
