import type { ConversationTurn } from "../../../packages/extractor/src/index.js";
import {
  type ConversationStore,
  type PausedThread,
  type ClaimResult,
  MAX_TURNS,
  THREAD_TTL_MS,
  IN_FLIGHT_CLAIM_TTL_MS,
} from "./conversationStore.js";
import { randomUUID } from "node:crypto";

export interface RedisConfig {
  url: string;
  token: string;
}

interface StoredThread {
  turns: ConversationTurn[];
}

interface StoredClaim {
  state: "in_flight" | "done";
  fenceToken: string;
}

/**
 * How long a phone lock lives in Redis before it is considered abandoned.
 *
 * Must exceed a whole inbound turn (one provider call plus one send, bounded by
 * `WHATSAPP_TURN_TIMEOUT_MS`, 20s by default) or a slow turn's lock would expire while it
 * was still running and let a second container in. The lock is released in a `finally`, so
 * this TTL only matters when a container is killed mid-turn — which on serverless is
 * routine, not exceptional.
 */
const PHONE_LOCK_TTL_MS = 30_000;

/**
 * How long a second container waits for the holder to finish before giving up and taking
 * its turn anyway.
 *
 * Giving up and proceeding is deliberate, and it is the least-bad option available:
 *
 * - Throwing would ask Meta to redeliver, but this message has already been claimed and
 *   `markDone` is written by the holder, so the redelivery is dropped as a duplicate and
 *   the guest's message is lost silently. That is strictly worse than a small race.
 * - The lock exists to stop two containers reading the same history and sending two
 *   replies. If the lock service is unhealthy, one reply that might be worded against a
 *   one-message-stale history is still far better than no reply at all.
 */
const PHONE_LOCK_WAIT_MS = 15_000;
const PHONE_LOCK_POLL_MS = 60;

export interface RedisStoreOptions {
  /**
   * How long to wait between attempts at the phone lock. Exists so a test can watch two
   * store instances contend without the suite taking fifteen seconds.
   */
  lockWaitMs?: number;
  lockPollMs?: number;
}

export function createRedisConversationStore(
  config: RedisConfig,
  ttlMs = THREAD_TTL_MS,
  options: RedisStoreOptions = {},
): ConversationStore {
  const ttlSeconds = Math.ceil(ttlMs / 1000);
  const lockWaitMs = options.lockWaitMs ?? PHONE_LOCK_WAIT_MS;
  const lockPollMs = options.lockPollMs ?? PHONE_LOCK_POLL_MS;

  // In-process phone mutex so overlapping requests within the same container execute
  // sequentially, plus a Redis lock inside it for the case this exists to fix: two
  // requests for one sender landing in DIFFERENT containers, where a promise chain in one
  // process cannot see the other at all. Vercel runs concurrent requests in separate
  // instances, so that is the normal path, not an edge case.
  const phoneLocks = new Map<string, Promise<void>>();

  async function command<T = unknown>(args: (string | number)[]): Promise<T> {
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Redis command [${args[0]}] failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as { result: T; error?: string };
    if (json.error) {
      throw new Error(`Redis command error [${args[0]}]: ${json.error}`);
    }
    return json.result;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Takes a short-lived Redis lock keyed by sender phone, runs `op`, and releases it.
   *
   * The release is compare-and-delete with the holder's own token, because a lock whose TTL
   * expired mid-turn must not be released by its original owner — a plain `DEL` there would
   * delete the *next* holder's lock and let a third container in. The two commands cannot be
   * atomic without Lua, which this HTTP interface does not offer; the TTL is sized so that a
   * turn overrunning 30s is already killed by the turn deadline first.
   *
   * Never throws. A Redis that cannot answer, or a holder that never lets go, ends in `op`
   * running unlocked rather than in the guest getting nothing — see PHONE_LOCK_WAIT_MS.
   */
  async function withDistributedPhoneLock<T>(phone: string, op: () => Promise<T>): Promise<T> {
    const key = `phonelock:${phone}`;
    const token = randomUUID();
    const deadline = Date.now() + lockWaitMs;
    let held = false;

    while (Date.now() < deadline) {
      let acquired: string | null;
      try {
        acquired = await command<string | null>(["SET", key, token, "NX", "PX", PHONE_LOCK_TTL_MS]);
      } catch {
        // Redis is not answering, and waiting cannot help — the wait itself is Redis round
        // trips. Take the turn unlocked rather than fail the guest.
        return await op();
      }
      if (acquired === "OK") {
        held = true;
        break;
      }
      await sleep(lockPollMs);
    }

    try {
      return await op();
    } finally {
      if (held) {
        try {
          const current = await command<string | null>(["GET", key]);
          if (current === token) await command(["DEL", key]);
        } catch {
          // Nothing useful to do: the TTL will clear it. Swallowing matters, because
          // throwing from a `finally` would replace the turn's real result or error.
        }
      }
    }
  }

  return {
    async history(phone: string): Promise<ConversationTurn[]> {
      const raw = await command<string | null>(["GET", `thread:${phone}`]);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as StoredThread;
        return Array.isArray(parsed?.turns) ? parsed.turns : [];
      } catch {
        return [];
      }
    },

    async append(phone: string, ...turns: ConversationTurn[]): Promise<void> {
      const existing = await this.history(phone);
      const combined = [...existing, ...turns].slice(-MAX_TURNS);
      const data: StoredThread = { turns: combined };
      await command(["SET", `thread:${phone}`, JSON.stringify(data), "EX", ttlSeconds]);
    },

    async claimMessage(messageId: string, inFlightMs = IN_FLIGHT_CLAIM_TTL_MS): Promise<ClaimResult> {
      const fenceToken = randomUUID();
      const payload: StoredClaim = { state: "in_flight", fenceToken };
      const res = await command<string | null>([
        "SET",
        `claim:${messageId}`,
        JSON.stringify(payload),
        "NX",
        "PX",
        inFlightMs,
      ]);

      if (res === "OK") {
        return { claimed: true, fenceToken };
      }

      // Check existing claim
      const raw = await command<string | null>(["GET", `claim:${messageId}`]);
      if (!raw) {
        // Expired in between, retry claim once
        const retry = await command<string | null>([
          "SET",
          `claim:${messageId}`,
          JSON.stringify(payload),
          "NX",
          "PX",
          inFlightMs,
        ]);
        if (retry === "OK") return { claimed: true, fenceToken };
      }

      return { claimed: false, fenceToken: "" };
    },

    async releaseMessage(messageId: string, fenceToken?: string): Promise<void> {
      const raw = await command<string | null>(["GET", `claim:${messageId}`]);
      if (!raw) return;
      try {
        const claim = JSON.parse(raw) as StoredClaim;
        if (claim.state === "in_flight") {
          if (!fenceToken || claim.fenceToken === fenceToken) {
            await command(["DEL", `claim:${messageId}`]);
          }
        }
      } catch {
        // If malformed, delete to avoid blocking
        await command(["DEL", `claim:${messageId}`]);
      }
    },

    async markDone(messageId: string, fenceToken?: string): Promise<void> {
      const token = fenceToken ?? randomUUID();
      const payload: StoredClaim = { state: "done", fenceToken: token };
      await command(["SET", `claim:${messageId}`, JSON.stringify(payload), "EX", ttlSeconds]);
    },

    async withPhoneLock<T>(phone: string, op: () => Promise<T>): Promise<T> {
      // Two locks, because they stop two different things and neither is sufficient:
      // this promise chain serialises turns that share one container (cheap, no round
      // trip), and the Redis key below serialises containers against each other.
      const current = phoneLocks.get(phone) ?? Promise.resolve();
      let release!: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      phoneLocks.set(phone, next);

      try {
        await current;
        return await withDistributedPhoneLock(phone, op);
      } finally {
        release();
        if (phoneLocks.get(phone) === next) {
          phoneLocks.delete(phone);
        }
      }
    },

    async pause(phone: string, reason: string): Promise<void> {
      const existing = await this.paused(phone);
      const data: PausedThread = {
        phone,
        reason,
        since: existing?.since ?? Date.now(),
        toldAt: existing?.toldAt ?? 0,
      };
      await command(["SET", `pause:${phone}`, JSON.stringify(data), "EX", ttlSeconds]);
      await command(["SADD", "paused_phones", phone]);
    },

    async resume(phone: string): Promise<void> {
      await command(["DEL", `pause:${phone}`]);
      await command(["SREM", "paused_phones", phone]);
    },

    async paused(phone: string): Promise<PausedThread | undefined> {
      const raw = await command<string | null>(["GET", `pause:${phone}`]);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as PausedThread;
      } catch {
        return undefined;
      }
    },

    async pausedThreads(): Promise<PausedThread[]> {
      const phones = (await command<string[] | null>(["SMEMBERS", "paused_phones"])) ?? [];
      const out: PausedThread[] = [];
      for (const phone of phones) {
        const item = await this.paused(phone);
        if (item) out.push(item);
        else await command(["SREM", "paused_phones", phone]);
      }
      return out.sort((a, b) => a.since - b.since);
    },

    async needsTelling(phone: string, withinMs: number): Promise<boolean> {
      const p = await this.paused(phone);
      if (!p) return false;
      return p.toldAt === 0 || Date.now() - p.toldAt >= withinMs;
    },

    async markTold(phone: string): Promise<void> {
      const p = await this.paused(phone);
      if (p) {
        p.toldAt = Date.now();
        await command(["SET", `pause:${phone}`, JSON.stringify(p), "EX", ttlSeconds]);
      }
    },

    async clear(phone: string): Promise<void> {
      await command(["DEL", `thread:${phone}`]);
      await command(["DEL", `pause:${phone}`]);
      await command(["SREM", "paused_phones", phone]);
    },
  };
}
