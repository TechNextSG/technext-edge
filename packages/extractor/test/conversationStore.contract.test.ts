// One behavioural spec, run against EVERY ConversationStore adapter.
//
// Why this file exists (roadmap L2, "Store cho production + contract test dùng chung"):
// the in-memory and Redis stores were covered by two *different* test files, so they were
// only ever asserted to agree by hand. The Redis file's fake KV answered "OK" to any
// command it did not recognise and had no SADD/SMEMBERS/SREM handling, which means the
// pause/resume/hold path — the one a guest actually feels — had never been exercised
// against Redis at all. A divergence there surfaces only in production.
//
// Everything here is written against the interface in apps/casa-bff/src/conversationStore.ts,
// using only public methods, so a new adapter is covered by adding one line at the bottom.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createInMemoryConversationStore,
  MAX_TURNS,
  THREAD_TTL_MS,
  IN_FLIGHT_CLAIM_TTL_MS,
  type ConversationStore,
} from "../../../apps/casa-bff/src/conversationStore.js";
import { createRedisConversationStore } from "../../../apps/casa-bff/src/redisStore.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * A stand-in for the Upstash/Vercel KV REST API that implements the commands the Redis
 * adapter issues, with real expiry, real NX semantics and real set operations.
 *
 * It is deliberately stricter than the previous mock: an unknown command throws instead of
 * answering "OK", so a new command in redisStore.ts cannot pass unnoticed.
 */
function makeFakeKv() {
  const strings = new Map<string, { value: string; expireAt: number | null }>();
  const sets = new Map<string, Set<string>>();

  const live = (key: string): string | null => {
    const e = strings.get(key);
    if (!e) return null;
    if (e.expireAt !== null && e.expireAt <= Date.now()) {
      strings.delete(key);
      return null;
    }
    return e.value;
  };

  const handlers: Record<string, (args: (string | number)[]) => unknown> = {
    GET: (a) => live(String(a[1])),
    SET: (a) => {
      const key = String(a[1]);
      const value = String(a[2]);
      const nx = a.includes("NX");
      if (nx && live(key) !== null) return null;
      let expireAt: number | null = null;
      const exIdx = a.indexOf("EX");
      const pxIdx = a.indexOf("PX");
      if (exIdx !== -1) expireAt = Date.now() + Number(a[exIdx + 1]) * 1000;
      else if (pxIdx !== -1) expireAt = Date.now() + Number(a[pxIdx + 1]);
      strings.set(key, { value, expireAt });
      return "OK";
    },
    DEL: (a) => {
      const key = String(a[1]);
      const had = strings.delete(key) || sets.delete(key);
      return had ? 1 : 0;
    },
    SADD: (a) => {
      const key = String(a[1]);
      const s = sets.get(key) ?? new Set<string>();
      const before = s.size;
      s.add(String(a[2]));
      sets.set(key, s);
      return s.size - before;
    },
    SREM: (a) => {
      const s = sets.get(String(a[1]));
      return s ? (s.delete(String(a[2])) ? 1 : 0) : 0;
    },
    SMEMBERS: (a) => [...(sets.get(String(a[1])) ?? new Set<string>())],
  };

  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const args = JSON.parse(init.body) as (string | number)[];
    const cmd = String(args[0]).toUpperCase();
    const handler = handlers[cmd];
    if (!handler) throw new Error(`fake KV received an unhandled command: ${cmd}`);
    return { ok: true, json: async () => ({ result: handler(args) }) };
  });

  return { fetchMock, strings, sets };
}

/** Creates an adapter plus a fresh fake KV, and installs the KV as global fetch. */
type MakeStore = () => { store: ConversationStore; kv: ReturnType<typeof makeFakeKv> };

const ADAPTERS: Array<{ name: string; make: MakeStore }> = [
  {
    name: "in-memory",
    make: () => {
      // Always build a fake KV so callers can inspect it uniformly, even though this
      // adapter never touches it.
      const kv = makeFakeKv();
      vi.stubGlobal("fetch", kv.fetchMock);
      return { store: createInMemoryConversationStore(), kv };
    },
  },
  {
    name: "redis-rest",
    make: () => {
      const kv = makeFakeKv();
      vi.stubGlobal("fetch", kv.fetchMock);
      return { store: createRedisConversationStore({ url: "https://fake.upstash.io", token: "t" }), kv };
    },
  },
];

for (const adapter of ADAPTERS) {
  describe(`ConversationStore contract — ${adapter.name}`, () => {
    it("keeps turns in arrival order and returns [] for an unknown number", async () => {
      const { store } = adapter.make();
      await store.append("639171234567", { role: "guest", text: "hi" });
      await store.append("639171234567", { role: "assistant", text: "How many guests in total?" });

      expect(await store.history("639171234567")).toEqual([
        { role: "guest", text: "hi" },
        { role: "assistant", text: "How many guests in total?" },
      ]);
      expect(await store.history("639179999999")).toEqual([]);
    });

    it("keeps threads per number apart", async () => {
      const { store } = adapter.make();
      await store.append("111", { role: "guest", text: "from 111" });
      await store.append("222", { role: "guest", text: "from 222" });

      expect(await store.history("111")).toEqual([{ role: "guest", text: "from 111" }]);
      expect(await store.history("222")).toEqual([{ role: "guest", text: "from 222" }]);
    });

    it("caps the transcript at MAX_TURNS, dropping the oldest", async () => {
      const { store } = adapter.make();
      for (let i = 0; i < MAX_TURNS + 5; i++) {
        await store.append("111", { role: "guest", text: `turn-${i}` });
      }
      const history = await store.history("111");
      expect(history).toHaveLength(MAX_TURNS);
      expect(history[0].text).toBe("turn-5");
      expect(history[history.length - 1].text).toBe(`turn-${MAX_TURNS + 4}`);
    });

    it("appends several turns in one call, in order", async () => {
      const { store } = adapter.make();
      await store.append(
        "111",
        { role: "guest", text: "one" },
        { role: "assistant", text: "two" },
        { role: "guest", text: "three" },
      );
      expect((await store.history("111")).map((t) => t.text)).toEqual(["one", "two", "three"]);
    });

    it("claims a message id once, and leaves a competing claim unclaimed", async () => {
      const { store } = adapter.make();
      const first = await store.claimMessage("wamid.A");
      const second = await store.claimMessage("wamid.A");

      expect(first.claimed).toBe(true);
      expect(first.fenceToken).toBeTruthy();
      expect(second.claimed).toBe(false);
    });

    it("releases an in-flight claim only for the matching fence token", async () => {
      const { store } = adapter.make();
      const claim = await store.claimMessage("wamid.B");
      expect(claim.claimed).toBe(true);

      // A stale holder must not be able to give away the current turn's claim.
      await store.releaseMessage("wamid.B", "a-different-token");
      expect((await store.claimMessage("wamid.B")).claimed).toBe(false);

      await store.releaseMessage("wamid.B", claim.fenceToken);
      expect((await store.claimMessage("wamid.B")).claimed).toBe(true);
    });

    it("marks a message done so a redelivery is a duplicate, not a second turn", async () => {
      const { store } = adapter.make();
      const claim = await store.claimMessage("wamid.C");
      await store.markDone("wamid.C", claim.fenceToken);

      expect((await store.claimMessage("wamid.C")).claimed).toBe(false);
    });

    it("expires an in-flight claim after the in-flight TTL, but not a done marker", async () => {
      vi.useFakeTimers();
      const { store } = adapter.make();

      const inFlight = await store.claimMessage("wamid.D");
      const done = await store.claimMessage("wamid.E");
      await store.markDone("wamid.E", done.fenceToken);

      // Just past the in-flight window: the abandoned turn's claim must be retryable.
      vi.advanceTimersByTime(IN_FLIGHT_CLAIM_TTL_MS + 1000);

      expect(inFlight.claimed).toBe(true);
      expect((await store.claimMessage("wamid.D")).claimed).toBe(true);
      // The completed message stays claimed for the long thread TTL, so Meta's redelivery
      // is still counted as a duplicate rather than answered twice.
      expect((await store.claimMessage("wamid.E")).claimed).toBe(false);
    });

    it("parks a thread, reports it, and hands it back on resume", async () => {
      const { store } = adapter.make();
      expect(await store.paused("639171234567")).toBeUndefined();

      await store.pause("639171234567", "turn_failed");
      const parked = await store.paused("639171234567");
      expect(parked?.reason).toBe("turn_failed");
      expect(parked?.phone).toBe("639171234567");

      expect((await store.pausedThreads()).map((p) => p.phone)).toContain("639171234567");

      await store.resume("639171234567");
      expect(await store.paused("639171234567")).toBeUndefined();
      expect((await store.pausedThreads()).map((p) => p.phone)).not.toContain("639171234567");
    });

    it("orders pausedThreads oldest first, so a reception list reads as a queue", async () => {
      vi.useFakeTimers();
      const { store } = adapter.make();
      await store.pause("first", "asking_limit");
      vi.advanceTimersByTime(5000);
      await store.pause("second", "turn_failed");

      expect((await store.pausedThreads()).map((p) => p.phone)).toEqual(["first", "second"]);
    });

    it("tells a parked guest once, then only after the repeat window has passed", async () => {
      const { store } = adapter.make();
      await store.pause("111", "turn_failed");

      // Never told yet, so the holding sentence is owed.
      expect(await store.needsTelling("111", 10 * 60 * 1000)).toBe(true);
      await store.markTold("111");
      expect(await store.needsTelling("111", 10 * 60 * 1000)).toBe(false);

      // An unparked thread is never told anything.
      expect(await store.needsTelling("222", 10 * 60 * 1000)).toBe(false);
    });

    it("re-tells after the repeat window elapses", async () => {
      vi.useFakeTimers();
      const { store } = adapter.make();
      await store.pause("111", "turn_failed");
      await store.markTold("111");

      vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
      expect(await store.needsTelling("111", 10 * 60 * 1000)).toBe(true);
    });

    it("clear() drops the transcript and the park record together", async () => {
      const { store } = adapter.make();
      await store.append("111", { role: "guest", text: "hello" });
      await store.pause("111", "asking_limit");

      await store.clear("111");

      expect(await store.history("111")).toEqual([]);
      expect(await store.paused("111")).toBeUndefined();
      expect((await store.pausedThreads()).map((p) => p.phone)).not.toContain("111");
    });

    it("serialises overlapping work for one number and leaves other numbers free", async () => {
      const { store } = adapter.make();
      const order: string[] = [];

      const slow = store.withPhoneLock("111", async () => {
        order.push("111-a-start");
        await new Promise((r) => setTimeout(r, 25));
        order.push("111-a-end");
      });
      const queued = store.withPhoneLock("111", async () => {
        order.push("111-b");
      });
      const other = store.withPhoneLock("222", async () => {
        order.push("222");
      });

      await Promise.all([slow, queued, other]);

      // The two turns for 111 never interleave; 222 is not blocked behind them.
      expect(order.indexOf("111-a-end")).toBeLessThan(order.indexOf("111-b"));
      expect(order).toContain("222");
    });

    it("releases the phone lock even when the work throws, so the next turn still runs", async () => {
      const { store } = adapter.make();
      await expect(
        store.withPhoneLock("111", async () => {
          throw new Error("turn blew up");
        }),
      ).rejects.toThrow("turn blew up");

      const ran = await store.withPhoneLock("111", async () => "ran");
      expect(ran).toBe("ran");
    });

    it("forgets a thread after THREAD_TTL_MS, matching Meta's 24h free-form window", async () => {
      vi.useFakeTimers();
      const { store } = adapter.make();
      await store.append("111", { role: "guest", text: "hello" });
      await store.pause("111", "turn_failed");

      vi.advanceTimersByTime(THREAD_TTL_MS + 1000);

      expect(await store.history("111")).toEqual([]);
      expect(await store.paused("111")).toBeUndefined();
    });
  });
}
