import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRedisConversationStore } from "../../../apps/casa-bff/src/redisStore.js";

describe("createRedisConversationStore", () => {
  const config = {
    url: "https://fake-redis.upstash.io",
    token: "fake-token",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends commands to Redis REST endpoint with authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "OK" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = createRedisConversationStore(config);
    await store.append("639170001", { role: "guest", text: "hello" });

    // First call is GET thread:639170001 (returns null/empty)
    // Second call is SET thread:639170001 ...
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://fake-redis.upstash.io");
    expect(init.headers.authorization).toBe("Bearer fake-token");
  });

  it("claims a message atomically with SET NX PX and handles release", async () => {
    let mockKv: Record<string, string> = {};
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body) as (string | number)[];
      const cmd = body[0];
      if (cmd === "SET") {
        const key = String(body[1]);
        const val = String(body[2]);
        const nx = body[3] === "NX";
        if (nx && mockKv[key]) {
          return { ok: true, json: async () => ({ result: null }) };
        }
        mockKv[key] = val;
        return { ok: true, json: async () => ({ result: "OK" }) };
      }
      if (cmd === "GET") {
        const key = String(body[1]);
        return { ok: true, json: async () => ({ result: mockKv[key] ?? null }) };
      }
      if (cmd === "DEL") {
        const key = String(body[1]);
        delete mockKv[key];
        return { ok: true, json: async () => ({ result: 1 }) };
      }
      return { ok: true, json: async () => ({ result: "OK" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = createRedisConversationStore(config);
    const c1 = await store.claimMessage("wamid.100");
    expect(c1.claimed).toBe(true);
    expect(c1.fenceToken).toBeTruthy();

    // Redelivery while in-flight -> rejected
    const c2 = await store.claimMessage("wamid.100");
    expect(c2.claimed).toBe(false);

    // Release with matching token
    await store.releaseMessage("wamid.100", c1.fenceToken);

    // Now redelivery can claim again
    const c3 = await store.claimMessage("wamid.100");
    expect(c3.claimed).toBe(true);
  });

  it("executes operations with withPhoneLock sequentially", async () => {
    const store = createRedisConversationStore(config);
    const order: number[] = [];

    const op1 = store.withPhoneLock("123", async () => {
      order.push(1);
      await new Promise((res) => setTimeout(res, 20));
      order.push(2);
    });

    const op2 = store.withPhoneLock("123", async () => {
      order.push(3);
      order.push(4);
    });

    await Promise.all([op1, op2]);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
