import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createProviderFromSettings,
  createResilientProvider,
  settingsFromEnv,
  isKnownModel,
  choiceFromName,
  DEFAULT_MODELS,
  type ProviderSettings,
  type ProviderOutcome,
} from "../../src/infra/providers/providerFromEnv.js";
import type { ExtractProvider } from "../../src/ports/provider.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const base = (over: Partial<ProviderSettings> = {}): ProviderSettings => ({
  primary: { provider: "gemini", model: "gemini-3.1-flash-lite" },
  fallback: { provider: "deepseek", model: "deepseek-flash" },
  timeoutsMs: { extract: 15_000, synthesis: 8_000 },
  breaker: { cooldownMs: 60_000, authCooldownMs: 3_600_000 },
  synthesisEnabled: true,
  keys: {},
  deepseekBaseUrl: "https://gateway.test/v1",
  ...over,
});

const ok = (raw: unknown = {}) => ({ raw, tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, ms: 1 });
const CALL = { text: "x", jsonSchema: {}, today: "2026-09-30" };

function fakeProvider(id: string, behaviour: () => Promise<ReturnType<typeof ok>>): ExtractProvider & { calls: number } {
  const p = {
    id,
    calls: 0,
    async call() {
      p.calls += 1;
      return behaviour();
    },
    async generateText() {
      return "text";
    },
  };
  return p;
}

describe("settings decide the provider", () => {
  it("a key saved in the dashboard wins over the environment", () => {
    const provider = createProviderFromSettings(base({ keys: { gemini: "from-dashboard" } }), { GEMINI_API_KEY: "from-env" });
    expect(provider.id).toBe("google:gemini-3.1-flash-lite");
  });

  it("the environment key is used when the dashboard has none", () => {
    expect(createProviderFromSettings(base(), { GEMINI_API_KEY: "from-env" }).id).toBe("google:gemini-3.1-flash-lite");
  });

  it("a DeepSeek primary is built from its own key and the configured gateway", () => {
    const provider = createProviderFromSettings(
      base({ primary: { provider: "deepseek", model: "deepseek-pro" }, fallback: null, keys: { deepseek: "d" } }),
      {},
    );
    expect(provider.id).toContain("deepseek");
  });

  it("runs on the fallback alone when the primary has no key, and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createProviderFromSettings(base({ keys: { deepseek: "d" } }), {});
    expect(provider.id).toContain("deepseek");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to DeepSeek"));
  });

  it("refuses with a message that names both places a key can come from when there is none", () => {
    expect(() => createProviderFromSettings(base(), {})).toThrow(/GEMINI_API_KEY not set.*admin dashboard/);
  });

  it("drops a fallback that is the same model as the primary: it protects nothing", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", fetchImpl);
    const provider = createProviderFromSettings(
      base({
        primary: { provider: "gemini", model: "gemini-2.5-flash" },
        fallback: { provider: "gemini", model: "gemini-2.5-flash" },
        keys: { gemini: "k" },
      }),
      {},
    );
    await expect(provider.call(CALL)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no second attempt on "the fallback"
  });

  it("switches the written reply off when synthesis is disabled", () => {
    const off = createProviderFromSettings(base({ synthesisEnabled: false, keys: { gemini: "k" } }), {});
    expect(off.generateText).toBeUndefined();
    const on = createProviderFromSettings(base({ keys: { gemini: "k" } }), {});
    expect(on.generateText).toBeTypeOf("function");
  });

  it("the environment alone still describes a working default, with the same backup pairing as before", () => {
    const s = settingsFromEnv({ GEMINI_API_KEY: "g", DEEPSEEK_GATEWAY_KEY: "d", DEEPSEEK_BASE_URL: "https://gateway.test/v1" });
    expect(s.primary).toEqual({ provider: "gemini", model: DEFAULT_MODELS.gemini });
    expect(s.fallback?.provider).toBe("deepseek");
    expect(settingsFromEnv({ EXTRACTOR_PROVIDER: "deepseek-pro", GEMINI_API_KEY: "g" }).primary).toEqual({
      provider: "deepseek",
      model: "deepseek-pro",
    });
    expect(() => settingsFromEnv({ EXTRACTOR_PROVIDER: "claude", GEMINI_API_KEY: "g" })).toThrow(/Unknown EXTRACTOR_PROVIDER/);
    expect(() => settingsFromEnv({ EXTRACTOR_PROVIDER: "klingon" })).toThrow(/Unknown EXTRACTOR_PROVIDER/);
  });

  it("knows which model ids an admin may pick", () => {
    expect(isKnownModel("gemini", "gemini-9.9-flash")).toBe(true); // the gemini- family
    expect(isKnownModel("gemini", "gpt-5")).toBe(false);
    expect(isKnownModel("deepseek", "deepseek-flash")).toBe(true);
    expect(choiceFromName("claude-sonnet-5-5", {})).toBeNull();
  });
});

describe("the circuit breaker keeps its state between calls", () => {
  it("after the primary fails once, the next call goes straight to the fallback without asking the primary", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = fakeProvider("primary", async () => {
      throw new Error("503 upstream");
    });
    const fallback = fakeProvider("fallback", async () => ok({ from: "fallback" }));
    const provider = createResilientProvider(primary, fallback, { primary: "gemini", fallback: "deepseek" });

    await provider.call(CALL);
    await provider.call(CALL);

    expect(primary.calls).toBe(1); // the second call did not try it: the cooldown held
    expect(fallback.calls).toBe(2);
  });

  it("tries the primary again once the cooldown is over", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let healthy = false;
    const primary = fakeProvider("primary", async () => {
      if (!healthy) throw new Error("503");
      return ok();
    });
    const fallback = fakeProvider("fallback", async () => ok());
    const provider = createResilientProvider(primary, fallback, { primary: "gemini", fallback: "deepseek" }, { cooldownMs: 1_000 });

    await provider.call(CALL);
    healthy = true;
    vi.advanceTimersByTime(1_500);
    await provider.call(CALL);

    expect(primary.calls).toBe(2);
  });

  it("an auth failure holds the long cooldown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = fakeProvider("primary", async () => {
      throw new Error("401 invalid x-api-key");
    });
    const fallback = fakeProvider("fallback", async () => ok());
    const provider = createResilientProvider(
      primary,
      fallback,
      { primary: "deepseek", fallback: "gemini" },
      { cooldownMs: 10, authCooldownMs: 10_000_000 },
    );

    await provider.call(CALL);
    await new Promise((r) => setTimeout(r, 30));
    await provider.call(CALL);

    expect(primary.calls).toBe(1);
  });
});

describe("who answered, and what the dashboard counts", () => {
  it("names the fallback as the answering provider when it stood in", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = fakeProvider("google:x", async () => {
      throw new Error("boom");
    });
    const fallback = fakeProvider("deepseek-gateway:y", async () => ok());
    const provider = createResilientProvider(primary, fallback, { primary: "gemini", fallback: "deepseek" });

    expect(provider.id).toBe("google:x"); // the configured primary
    await provider.call(CALL);
    expect(provider.answeredBy!()).toBe("deepseek-gateway:y");
  });

  it("reports ok, fail and fallback outcomes per provider", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const events: ProviderOutcome[] = [];
    let failPrimary = false;
    const primary = fakeProvider("p", async () => {
      if (failPrimary) throw new Error("x");
      return ok();
    });
    const fallback = fakeProvider("f", async () => ok());
    const provider = createResilientProvider(
      primary,
      fallback,
      { primary: "gemini", fallback: "deepseek" },
      { onOutcome: (e) => events.push(e) },
    );

    await provider.call(CALL);
    failPrimary = true;
    await provider.call(CALL);

    expect(events.map((e) => `${e.provider}:${e.kind}`)).toEqual(["gemini:ok", "gemini:fail", "deepseek:fallback"]);
    expect(events.every((e) => typeof e.ms === "number")).toBe(true);
  });

  it("with no fallback, a failure is counted and thrown", async () => {
    const events: ProviderOutcome[] = [];
    const primary = fakeProvider("p", async () => {
      throw new Error("x");
    });
    const provider = createResilientProvider(primary, undefined, { primary: "gemini" }, { onOutcome: (e) => events.push(e) });
    await expect(provider.call(CALL)).rejects.toThrow("x");
    expect(events.map((e) => `${e.provider}:${e.kind}`)).toEqual(["gemini:fail"]);
  });
});
