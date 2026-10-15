import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PROVIDERS,
  PROVIDER_KINDS,
  createProviderByName,
  createProviderFromSettings,
  createProviderFromEnv,
  settingsFromEnv,
  isKnownModel,
  type ProviderSettings,
} from "../../src/infra/providers/providerFromEnv.ts";

describe("PROVIDERS registry & Pattern 3 Strategy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers all 3 provider kinds with descriptors", () => {
    expect(PROVIDER_KINDS).toEqual(["gemini", "deepseek", "anthropic"]);
    expect(PROVIDERS.anthropic.label).toBe("Anthropic Claude");
    expect(PROVIDERS.gemini.label).toBe("Gemini");
    expect(PROVIDERS.deepseek.label).toBe("DeepSeek");

    expect(PROVIDERS.anthropic.models).toContain("claude-3-5-haiku-20241022");
    expect(PROVIDERS.gemini.models).toContain("gemini-3.1-flash-lite");
    expect(PROVIDERS.deepseek.models).toContain("deepseek-flash");
  });

  it("verifies known models for all providers", () => {
    expect(isKnownModel("anthropic", "claude-3-5-haiku-20241022")).toBe(true);
    expect(isKnownModel("anthropic", "claude-custom-v1")).toBe(true);
    expect(isKnownModel("gemini", "gemini-3.1-flash-lite")).toBe(true);
    expect(isKnownModel("deepseek", "deepseek-pro")).toBe(true);
    expect(isKnownModel("deepseek", "unknown-model")).toBe(false);
  });

  it("creates Anthropic provider by name", () => {
    const p1 = createProviderByName("anthropic", "test-key", {});
    expect(p1.id).toBe("anthropic:claude-haiku-5-5");

    const p2 = createProviderByName("claude-3-5-haiku-latest", "test-key", {});
    expect(p2.id).toBe("anthropic:claude-3-5-haiku-latest");

    const p3 = createProviderByName("claude:claude-custom", "test-key", {});
    expect(p3.id).toBe("anthropic:claude-custom");
  });

  describe("D-129: Production Gate (Only Anthropic permitted in production)", () => {
    const baseSettings: ProviderSettings = {
      primary: { provider: "gemini", model: "gemini-3.1-flash-lite" },
      fallback: null,
      timeoutsMs: { extract: 5000, synthesis: 5000 },
      breaker: { cooldownMs: 60000, authCooldownMs: 3600000 },
      synthesisEnabled: true,
      keys: { gemini: "gemini-key", anthropic: "anthropic-key" },
    };

    it("rejects non-Anthropic primary provider when NODE_ENV is production", () => {
      expect(() =>
        createProviderFromSettings(baseSettings, {
          NODE_ENV: "production",
          GEMINI_API_KEY: "gemini-key",
        }),
      ).toThrow("Production policy gate (D-129) violation: only Anthropic Claude is permitted in production");
    });

    it("rejects non-Anthropic fallback provider in production even if primary is Anthropic", () => {
      const mixedSettings: ProviderSettings = {
        ...baseSettings,
        primary: { provider: "anthropic", model: "claude-haiku-5-5" },
        fallback: { provider: "gemini", model: "gemini-3.1-flash-lite" },
      };

      expect(() =>
        createProviderFromSettings(mixedSettings, {
          VERCEL_ENV: "production",
          ANTHROPIC_API_KEY: "ant-key",
          GEMINI_API_KEY: "gem-key",
        }),
      ).toThrow("Production policy gate (D-129) violation: only Anthropic Claude is permitted in production (configured fallback is \"gemini\")");
    });

    it("allows non-Anthropic when VERCEL_ENV is preview even if NODE_ENV is production", () => {
      const provider = createProviderFromSettings(baseSettings, {
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        GEMINI_API_KEY: "gemini-key",
      });
      expect(provider.id).toBe("google:gemini-3.1-flash-lite");
    });

    it("enforces D-129 policy when GUEST_DATA_MODE is production", () => {
      expect(() =>
        createProviderFromSettings(baseSettings, {
          GUEST_DATA_MODE: "production",
          GEMINI_API_KEY: "gemini-key",
        }),
      ).toThrow("Production policy gate (D-129) violation: only Anthropic Claude is permitted in production");
    });

    it("allows Anthropic primary provider when NODE_ENV is production", () => {
      const anthropicSettings: ProviderSettings = {
        ...baseSettings,
        primary: { provider: "anthropic", model: "claude-haiku-5-5" },
      };

      const provider = createProviderFromSettings(anthropicSettings, {
        NODE_ENV: "production",
        ANTHROPIC_API_KEY: "anthropic-key",
      });
      expect(provider.id).toBe("anthropic:claude-haiku-5-5");
    });

    it("allows non-Anthropic in production only if ALLOW_NON_ANTHROPIC_IN_PRODUCTION is explicitly set", () => {
      const provider = createProviderFromSettings(baseSettings, {
        NODE_ENV: "production",
        GEMINI_API_KEY: "gemini-key",
        ALLOW_NON_ANTHROPIC_IN_PRODUCTION: "true",
      });
      expect(provider.id).toBe("google:gemini-3.1-flash-lite");
    });
  });

  it("configures fallback correctly from env", () => {
    const settings = settingsFromEnv({
      EXTRACTOR_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "ant-key",
      GEMINI_API_KEY: "gem-key",
    });

    expect(settings.primary.provider).toBe("anthropic");
    expect(settings.fallback?.provider).toBe("gemini");
  });

  it("uses claude-haiku-5-5 as default Anthropic model", () => {
    expect(PROVIDERS.anthropic.defaultModel).toBe("claude-haiku-5-5");
    expect(PROVIDERS.anthropic.models).toContain("claude-haiku-5-5");
    const provider = createProviderByName("claude-haiku-5-5", "test-key", {});
    expect(provider.id).toBe("anthropic:claude-haiku-5-5");
  });
});
