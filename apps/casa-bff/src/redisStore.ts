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

export function createRedisConversationStore(config: RedisConfig, ttlMs = THREAD_TTL_MS): ConversationStore {
  const ttlSeconds = Math.ceil(ttlMs / 1000);
  const inFlightSeconds = Math.ceil(IN_FLIGHT_CLAIM_TTL_MS / 1000);

  // In-process phone mutex so overlapping requests within the same container execute sequentially
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
