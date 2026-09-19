import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("dataset.mock-30.json", () => {
  it("contains exactly 30 valid mock benchmark cases", async () => {
    const filePath = path.join(__dirname, "../eval/dataset.mock-30.json");
    const raw = await readFile(filePath, "utf-8");
    const dataset = JSON.parse(raw);

    expect(Array.isArray(dataset)).toBe(true);
    expect(dataset.length).toBe(30);

    const enCases = dataset.filter((d: { id: string }) => d.id.startsWith("en-"));
    const viCases = dataset.filter((d: { id: string }) => d.id.startsWith("vi-"));
    const zhCases = dataset.filter((d: { id: string }) => d.id.startsWith("zh-"));

    expect(enCases.length).toBe(10);
    expect(viCases.length).toBe(10);
    expect(zhCases.length).toBe(10);

    for (const item of dataset) {
      expect(item.id).toBeDefined();
      expect(typeof item.text).toBe("string");
      expect(item.text.length).toBeGreaterThan(5);
      expect(item.expected).toBeDefined();
      expect(typeof item.expected).toBe("object");
    }
  });
});
