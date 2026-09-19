import { describe, it, expect, vi } from "vitest";
import { createProviderFromEnv } from "../../src/providerFromEnv.js";

describe("createProviderFromEnv", () => {
  it("defaults to DeepSeek when DEEPSEEK_GATEWAY_KEY is set", () => {
    const provider = createProviderFromEnv({
      DEEPSEEK_GATEWAY_KEY: "fake-deepseek-key",
    });
    expect(provider.id).toContain("deepseek");
  });

  it("gracefully falls back to Gemini when DEEPSEEK_GATEWAY_KEY is missing but GEMINI_API_KEY is present", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createProviderFromEnv({
      GEMINI_API_KEY: "fake-gemini-key",
    });
    expect(provider.id).toContain("gemini");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("falling back to secondary provider Gemini"));
    warnSpy.mockRestore();
  });

  it("throws error when neither DeepSeek nor Gemini keys are present", () => {
    expect(() => createProviderFromEnv({})).toThrow("DEEPSEEK_GATEWAY_KEY not set (and no fallback GEMINI_API_KEY found)");
  });

  it("creates newer Gemini providers by name", async () => {
    const { createProviderByName } = await import("../../src/providerFromEnv.js");
    expect(createProviderByName("gemini-3-flash", "key").id).toBe("google:gemini-3.1-flash-lite");
    expect(createProviderByName("gemini-2.5-pro", "key").id).toBe("google:gemini-2.5-pro");
    expect(createProviderByName("gemini:gemini-custom", "key").id).toBe("google:gemini-custom");
  });
});
