import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createInMemoryConversationStore,
  MAX_TURNS,
  THREAD_TTL_MS,
} from "../../../apps/casa-bff/src/conversationStore.js";

afterEach(() => {
  vi.useRealTimers();
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
    expect(await store.claimMessage("wamid.AAA")).toBe(true);
    expect(await store.claimMessage("wamid.AAA")).toBe(false);
    expect(await store.claimMessage("wamid.BBB")).toBe(true);
  });

  it("gives a claim back when a turn failed, so Meta's redelivery becomes a retry", async () => {
    const store = createInMemoryConversationStore();
    expect(await store.claimMessage("wamid.AAA")).toBe(true);

    await store.releaseMessage("wamid.AAA");

    // Taken again by the retry — and still deduped from there, so releasing
    // cannot turn every redelivery into another model call.
    expect(await store.claimMessage("wamid.AAA")).toBe(true);
    expect(await store.claimMessage("wamid.AAA")).toBe(false);
    // Other ids are untouched by the release.
    expect(await store.claimMessage("wamid.BBB")).toBe(true);
  });

  it("releases an id it never claimed without throwing, because the failure path calls it blind", async () => {
    const store = createInMemoryConversationStore();
    await store.releaseMessage("wamid.never");
    expect(await store.claimMessage("wamid.never")).toBe(true);
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

  it("expires the dedupe claim too, so a much older event is not swallowed forever", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));

    const store = createInMemoryConversationStore();
    await store.claimMessage("wamid.AAA");
    expect(await store.claimMessage("wamid.AAA")).toBe(false);

    vi.setSystemTime(new Date(Date.now() + THREAD_TTL_MS + 1));
    expect(await store.claimMessage("wamid.AAA")).toBe(true);
  });
});
