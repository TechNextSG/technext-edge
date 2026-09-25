import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createInMemoryConversationStore,
  createConversationStoreFromEnv,
  MAX_TURNS,
  THREAD_TTL_MS,
  IN_FLIGHT_CLAIM_TTL_MS,
} from "../../../apps/casa-bff/src/conversationStore.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createInMemoryConversationStore", () => {
  it("keeps turns in the order they arrived", async () => {
    const store = createInMemoryConversationStore();
    await store.append("639171234567", { role: "guest", text: "hi" });
    await store.append("639171234567", { role: "assistant", text: "How many guests in total?" });

    expect(await store.history("639171234567")).toEqual([
      { role: "guest", text: "hi" },
      { role: "assistant", text: "How many guests in total?" },
    ]);
  });

  it("keeps threads per number apart", async () => {
    const store = createInMemoryConversationStore();
    await store.append("111", { role: "guest", text: "from 111" });
    await store.append("222", { role: "guest", text: "from 222" });

    expect(await store.history("111")).toEqual([{ role: "guest", text: "from 111" }]);
    expect(await store.history("222")).toEqual([{ role: "guest", text: "from 222" }]);
    expect(await store.history("333")).toEqual([]);
  });

  it("caps the transcript at MAX_TURNS, dropping the oldest — the same cap the console enforces", async () => {
    const store = createInMemoryConversationStore();
    for (let i = 0; i < MAX_TURNS + 5; i++) {
      await store.append("111", { role: "guest", text: `turn-${i}` });
    }

    const history = await store.history("111");
    expect(history).toHaveLength(MAX_TURNS);
    expect(history[0].text).toBe("turn-5");
    expect(history[history.length - 1].text).toBe(`turn-${MAX_TURNS + 4}`);
  });

  it("hands out a copy, so a later append cannot rewrite a transcript already in use", async () => {
    const store = createInMemoryConversationStore();
    await store.append("111", { role: "guest", text: "hi" });

    const firstRead = await store.history("111");
    await store.append("111", { role: "assistant", text: "hello" });

    expect(firstRead).toHaveLength(1);
    expect(await store.history("111")).toHaveLength(2);
  });

  it("claims a message id exactly once, so a Meta redelivery is a no-op", async () => {
    const store = createInMemoryConversationStore();
    const c1 = await store.claimMessage("wamid.AAA");
    expect(c1.claimed).toBe(true);
    expect(c1.fenceToken).toBeTruthy();

    const c2 = await store.claimMessage("wamid.AAA");
    expect(c2.claimed).toBe(false);

    const c3 = await store.claimMessage("wamid.BBB");
    expect(c3.claimed).toBe(true);
  });

  it("gives a claim back when a turn failed, so Meta's redelivery becomes a retry", async () => {
    const store = createInMemoryConversationStore();
    const c1 = await store.claimMessage("wamid.AAA");
    expect(c1.claimed).toBe(true);

    await store.releaseMessage("wamid.AAA", c1.fenceToken);

    // Taken again by the retry — and still deduped from there, so releasing
    // cannot turn every redelivery into another model call.
    const c2 = await store.claimMessage("wamid.AAA");
    expect(c2.claimed).toBe(true);

    const c3 = await store.claimMessage("wamid.AAA");
    expect(c3.claimed).toBe(false);
    // Other ids are untouched by the release.
    expect((await store.claimMessage("wamid.BBB")).claimed).toBe(true);
  });

  it("does NOT release claim if fenceToken does not match (protects newer retries from older slow retries)", async () => {
    const store = createInMemoryConversationStore();
    const c1 = await store.claimMessage("wamid.AAA");
    expect(c1.claimed).toBe(true);

    // Attempt release with wrong token
    await store.releaseMessage("wamid.AAA", "wrong-fence-token");

    // Claim should still be held
    const c2 = await store.claimMessage("wamid.AAA");
    expect(c2.claimed).toBe(false);

    // Now release with correct token
    await store.releaseMessage("wamid.AAA", c1.fenceToken);
    const c3 = await store.claimMessage("wamid.AAA");
    expect(c3.claimed).toBe(true);
  });

  it("expires in-flight claim after IN_FLIGHT_CLAIM_TTL_MS (60s), allowing redelivery without waiting 24h", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));

    const store = createInMemoryConversationStore();
    const c1 = await store.claimMessage("wamid.AAA");
    expect(c1.claimed).toBe(true);

    // Immediate second claim should be rejected
    expect((await store.claimMessage("wamid.AAA")).claimed).toBe(false);

    // Advance 65 seconds (past in-flight timeout, far before 24h)
    vi.setSystemTime(new Date(Date.now() + IN_FLIGHT_CLAIM_TTL_MS + 5_000));

    // Can reclaim now because worker was assumed dead/timed out
    const c2 = await store.claimMessage("wamid.AAA");
    expect(c2.claimed).toBe(true);
    expect(c2.fenceToken).not.toBe(c1.fenceToken);
  });

  it("permanently marks message done for 24h when markDone is called", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));

    const store = createInMemoryConversationStore();
    const c1 = await store.claimMessage("wamid.AAA");
    await store.markDone("wamid.AAA", c1.fenceToken);

    // Even after 65 seconds, message remains done and cannot be reclaimed
    vi.setSystemTime(new Date(Date.now() + IN_FLIGHT_CLAIM_TTL_MS + 5_000));
    expect((await store.claimMessage("wamid.AAA")).claimed).toBe(false);

    // After 24h, it finally expires
    vi.setSystemTime(new Date(Date.now() + THREAD_TTL_MS + 1));
    expect((await store.claimMessage("wamid.AAA")).claimed).toBe(true);
  });

  it("executes operations for the same phone sequentially using withPhoneLock", async () => {
    const store = createInMemoryConversationStore();
    const executionOrder: string[] = [];

    const op1 = store.withPhoneLock("639170001", async () => {
      executionOrder.push("op1:start");
      await new Promise((res) => setTimeout(res, 50));
      executionOrder.push("op1:end");
      return "res1";
    });

    const op2 = store.withPhoneLock("639170001", async () => {
      executionOrder.push("op2:start");
      executionOrder.push("op2:end");
      return "res2";
    });

    const [r1, r2] = await Promise.all([op1, op2]);
    expect(r1).toBe("res1");
    expect(r2).toBe("res2");
    // op2 must not start before op1 has finished
    expect(executionOrder).toEqual(["op1:start", "op1:end", "op2:start", "op2:end"]);
  });

  it("forgets a thread once the 24h WhatsApp service window has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));

    const store = createInMemoryConversationStore();
    await store.append("111", { role: "guest", text: "hi" });
    expect(await store.history("111")).toHaveLength(1);

    vi.setSystemTime(new Date(Date.now() + THREAD_TTL_MS + 1));
    expect(await store.history("111")).toEqual([]);
  });
});

// The production fallback is the failure mode with no visible symptom: nothing errors, the
// webhook answers, and the only clue is a guest being asked something they already told us.
describe("createConversationStoreFromEnv", () => {
  const KV_VARS = [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ] as const;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of [...KV_VARS, "VERCEL_ENV", "NODE_ENV"]) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("uses the Redis store when KV credentials are present", () => {
    process.env.KV_REST_API_URL = "https://fake.upstash.io";
    process.env.KV_REST_API_TOKEN = "t";
    // Touching history proves it is talking to the KV rather than an in-memory Map: a
    // request goes out, and the stub answers nothing useful.
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ result: null }),
    } as never);

    const store = createConversationStoreFromEnv();
    void store;
    return store.history("111").then(() => {
      expect(spy).toHaveBeenCalled();
    });
  });

  it("accepts the UPSTASH_* names as well as the KV_* ones", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ result: null }),
    } as never);

    await createConversationStoreFromEnv().history("111");

    expect(spy).toHaveBeenCalled();
  });

  it("returns the in-memory store without credentials, and stays quiet outside production", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "test";

    const store = createConversationStoreFromEnv();

    // Quiet locally: this is the expected path in dev and in the suite.
    expect(spy).not.toHaveBeenCalled();
    expect(store).toBeDefined();
  });

  it("shouts in production when it falls back, because the failure is otherwise invisible", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.VERCEL_ENV = "production";

    createConversationStoreFromEnv();

    expect(spy).toHaveBeenCalledTimes(1);
    const message = String(spy.mock.calls[0]?.[0] ?? "");
    // It has to name the consequence and the fix, not just the condition.
    expect(message).toContain("NO KV CONFIGURED IN PRODUCTION");
    expect(message).toContain("KV_REST_API_URL");
    expect(message).toMatch(/phone lock/);
  });

  it("still builds a working store in production rather than refusing to start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.VERCEL_ENV = "production";

    // Degraded memory beats no service: a missing env var must not take the tool down.
    const store = createConversationStoreFromEnv();
    await store.append("111", { role: "guest", text: "hi" });
    expect(await store.history("111")).toEqual([{ role: "guest", text: "hi" }]);
  });
});
