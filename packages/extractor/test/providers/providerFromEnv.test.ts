import { describe, it, expect, vi } from "vitest";
import { createProviderFromEnv } from "../../src/providerFromEnv.js";

describe("createProviderFromEnv", () => {
  it("defaults to Gemini 3.1 Flash-Lite when GEMINI_API_KEY is set", () => {
    const provider = createProviderFromEnv({
      GEMINI_API_KEY: "fake-gemini-key",
    });
    expect(provider.id).toBe("google:gemini-3.1-flash-lite");
  });

  it("gracefully falls back to DeepSeek when GEMINI_API_KEY is missing but DEEPSEEK_GATEWAY_KEY is present", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createProviderFromEnv({
      DEEPSEEK_GATEWAY_KEY: "fake-deepseek-key",
    });
    expect(provider.id).toContain("deepseek");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("falling back to DeepSeek"));
    warnSpy.mockRestore();
  });

  it("throws error when neither Gemini nor DeepSeek keys are present", () => {
    expect(() => createProviderFromEnv({})).toThrow("GEMINI_API_KEY not set (and no fallback DEEPSEEK_GATEWAY_KEY found)");
  });

  it("creates newer Gemini providers by name", async () => {
    const { createProviderByName } = await import("../../src/providerFromEnv.js");
    expect(createProviderByName("gemini-3-flash", "key").id).toBe("google:gemini-3.1-flash-lite");
    expect(createProviderByName("gemini-2.5-pro", "key").id).toBe("google:gemini-2.5-pro");
    expect(createProviderByName("gemini:gemini-custom", "key").id).toBe("google:gemini-custom");
  });
});
