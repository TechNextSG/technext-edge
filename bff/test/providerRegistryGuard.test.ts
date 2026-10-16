import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_REGISTRY,
  PROVIDER_KINDS,
  registerProvider,
  choiceFromName,
  isKnownModel,
  keyFor,
  settingsFromEnv,
  type RegistryEntry,
} from "../../ai/src/index.ts";
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

  it("dynamically supports adding a vendor 'fakeai': choiceFromName, isKnownModel, keyFor, settingsFromEnv and admin Kind accept it WITHOUT changing any other files", () => {
    const fakeEntry: RegistryEntry<"fakeai"> = {
      kind: "fakeai",
      label: "Fake AI",
      defaultModel: "fake-v1",
      models: ["fake-v1", "fake-v2"],
      modelPattern: /^fake-[a-z0-9.\-]{1,60}$/,
      aliases: ["fakeai", "fake"],
      aliasModels: { fake: "fake-v1" },
      envKeys: {
        apiKey: "FAKEAI_API_KEY",
        model: "FAKEAI_MODEL",
        baseUrl: "FAKEAI_BASE_URL",
      },
      defaultTimeoutMs: { extract: 5_000, synthesis: 5_000 },
      fallbackOrder: ["gemini"],
      requiresBaseUrl: false,
      create: () => {
        throw new Error("stub");
      },
    };

    // Before registering: Kind must reject fakeai
    expect(Kind.safeParse("fakeai").success).toBe(false);

    // Register dynamically
    registerProvider(fakeEntry);

    // 1. choiceFromName
    expect(choiceFromName("fakeai", {})).toEqual({
      provider: "fakeai",
      model: "fake-v1",
    });
    expect(choiceFromName("fake:fake-v2", {})).toEqual({
      provider: "fakeai",
      model: "fake-v2",
    });

    // 2. isKnownModel
    expect(isKnownModel("fakeai" as any, "fake-v1")).toBe(true);
    expect(isKnownModel("fakeai" as any, "fake-custom-99")).toBe(true);
    expect(isKnownModel("fakeai" as any, "gpt-4o")).toBe(false);

    // 3. keyFor
    expect(keyFor("fakeai" as any, { keys: { fakeai: "dashboard-key" } as any }, {})).toBe("dashboard-key");
    expect(keyFor("fakeai" as any, { keys: {} }, { FAKEAI_API_KEY: "env-key" })).toBe("env-key");

    // 4. settingsFromEnv
    const settings = settingsFromEnv({
      EXTRACTOR_PROVIDER: "fakeai",
      FAKEAI_API_KEY: "key1",
      GEMINI_API_KEY: "key2",
    });
    expect(settings.primary).toEqual({
      provider: "fakeai",
      model: "fake-v1",
    });
    expect(settings.fallback?.provider).toBe("gemini");

    // 5. Admin Kind schema accepts it immediately
    const parsed = Kind.safeParse("fakeai");
    expect(parsed.success, "Admin Kind schema must dynamically accept registered fakeai").toBe(true);
    expect(Kind.options).toContain("fakeai");
  });

  it("scans ai/src and bff/src (except ai/src/infra/providers/ and comments): zero hardcoded vendor name literals ('gemini' | 'deepseek' | 'anthropic')", () => {
    function walk(dir: string): string[] {
      let files: string[] = [];
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
          files = files.concat(walk(full));
        } else if (f.endsWith(".ts") || f.endsWith(".js")) {
          files.push(full);
        }
      }
      return files;
    }

    const repoRoot = path.resolve(__dirname, "../..");
    const searchDirs = [path.join(repoRoot, "ai/src"), path.join(repoRoot, "bff/src")];
    const providersDir = path.normalize(path.join(repoRoot, "ai/src/infra/providers"));

    const targets = [
      '"gemini"', "'gemini'", '`gemini`',
      '"deepseek"', "'deepseek'", '`deepseek`',
      '"anthropic"', "'anthropic'", '`anthropic`',
    ];

    const violations: Array<{ file: string; target: string; line: number; snippet: string }> = [];

    for (const dir of searchDirs) {
      for (const file of walk(dir)) {
        const norm = path.normalize(file);
        if (norm.startsWith(providersDir)) continue;

        const raw = fs.readFileSync(file, "utf8");
        const lines = raw.split("\n");
        let inBlockComment = false;

        for (let i = 0; i < lines.length; i++) {
          let line = lines[i]!;

          // handle block comment start / end across lines
          if (inBlockComment) {
            const endIdx = line.indexOf("*/");
            if (endIdx !== -1) {
              inBlockComment = false;
              line = line.slice(endIdx + 2);
            } else {
              continue;
            }
          }

          while (line.includes("/*")) {
            const startIdx = line.indexOf("/*");
            const endIdx = line.indexOf("*/", startIdx + 2);
            if (endIdx !== -1) {
              line = line.slice(0, startIdx) + line.slice(endIdx + 2);
            } else {
              inBlockComment = true;
              line = line.slice(0, startIdx);
              break;
            }
          }

          // Strip line comment
          const lineCommentIdx = line.indexOf("//");
          if (lineCommentIdx !== -1) {
            line = line.slice(0, lineCommentIdx);
          }

          for (const target of targets) {
            if (line.includes(target)) {
              violations.push({
                file: path.relative(repoRoot, file),
                target,
                line: i + 1,
                snippet: line.trim(),
              });
            }
          }
        }
      }
    }

    expect(
      violations,
      `Found hardcoded vendor name literals outside ai/src/infra/providers:\n${violations
        .map((v) => `  ${v.file}:${v.line} -> ${v.snippet}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
