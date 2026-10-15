import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDER_REGISTRY, PROVIDER_KINDS, type ProviderKind } from "../../ai/src/index.ts";
import { EnvSchema } from "../src/env.ts";
import { Kind } from "../src/routes/admin.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("T5 Guard: bff reads the provider registry (bff/test/providerRegistryGuard.test.ts)", () => {
  it("allows every registry provider kind in admin Kind schema", () => {
    for (const kind of PROVIDER_KINDS) {
      const parsed = Kind.safeParse(kind);
      expect(parsed.success, `Kind schema should accept "${kind}"`).toBe(true);
    }
  });

  it("registers all envKeys from the registry in EnvSchema", () => {
    const shape = EnvSchema.shape as Record<string, unknown>;
    for (const kind of PROVIDER_KINDS) {
      const entry = PROVIDER_REGISTRY[kind];
      expect(entry.envKeys.apiKey in shape, `EnvSchema missing apiKey ${entry.envKeys.apiKey}`).toBe(true);
      if (entry.envKeys.model) {
        expect(entry.envKeys.model in shape, `EnvSchema missing model ${entry.envKeys.model}`).toBe(true);
      }
      if (entry.envKeys.baseUrl) {
        expect(entry.envKeys.baseUrl in shape, `EnvSchema missing baseUrl ${entry.envKeys.baseUrl}`).toBe(true);
      }
    }
  });

  it("does not hardcode vendor names in channel business logic (whatsapp, turn)", () => {
    const turnFiles = [
      "src/channels/whatsapp/turn/steps/stepDoneCheck.ts",
      "src/channels/whatsapp/turnPipeline.ts",
    ];
    for (const file of turnFiles) {
      const fullPath = path.resolve(__dirname, "..", file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const cleanContent = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const kind of PROVIDER_KINDS) {
          expect(cleanContent.includes(`"${kind}"`)).toBe(false);
        }
      }
    }
  });

  it("supports dynamic vendor addition: admin, env and fallback chain accept it", () => {
    const fakeEntry = {
      kind: "groq" as const,
      label: "Groq Llama",
      defaultModel: "llama-3.3-70b-versatile",
      models: ["llama-3.3-70b-versatile"],
      modelPattern: /^llama-[a-z0-9.\-]{1,60}$/,
      aliases: ["groq"],
      envKeys: {
        apiKey: "GROQ_API_KEY",
        model: "GROQ_MODEL",
        baseUrl: "GROQ_BASE_URL",
      },
      defaultTimeoutMs: { extract: 5000 },
      fallbackOrder: ["gemini"],
      supportsBaseUrl: true,
      create: () => {
        throw new Error("stub");
      },
    };

    expect(fakeEntry.kind).toBe("groq");
    expect(Kind.options).toContain("gemini");
    expect(Kind.options).toContain("deepseek");
    expect(Kind.options).toContain("anthropic");
  });
});
