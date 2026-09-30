// The rule the structure cleanup established, kept honest by a test rather than by memory.
//
// Every page this BFF serves used to exist twice: once in public/ (the directory Vercel
// publishes) and once in docs/. The two drifted — `roadmap-next.html` was edited in docs/
// a full day after the copy in public/, so the page guests opened was the older one, and
// `extractor-pod.html` was served from a diagram JSON that had already been replaced.
// Nothing failed, because nothing was checking. This is that check, on both halves of the
// rule: the single copy exists where it is served from, and no second copy is left behind.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVED_DOCUMENTS, getIndexHtml } from "../src/views/reportsHtml.js";

// test/ -> apps/casa-bff -> apps/ -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("every document reportsHtml serves", () => {
  it("has a copy in public/, the directory Vercel publishes", () => {
    const missing = SERVED_DOCUMENTS.filter((name) => !existsSync(resolve(repoRoot, "public", name)));
    expect(missing, `not found under public/: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no second copy under docs/, which is what let the two drift apart", () => {
    const duplicated = SERVED_DOCUMENTS.filter((name) => existsSync(resolve(repoRoot, "docs", name)));
    expect(duplicated, `delete these docs/ copies: ${duplicated.join(", ")}`).toEqual([]);
  });

  it("resolves from the module's own location, not from whatever cwd the suite started in", () => {
    // The bug this pins, found when reportsHtml.ts moved from src/ to src/views/: every
    // __dirname-relative candidate came up one level short, and the page still answered —
    // as "Document Not Found" — because a cwd-based fallback happened to match when the
    // suite was launched from the repo root. Under `npm test` the workspace is the cwd, so
    // the fallback missed and the failure appeared only in the full run, not in isolation.
    const html = getIndexHtml();
    expect(html).not.toContain("Document Not Found");
    expect(html.toLowerCase()).toContain("<!doctype html");
  });
});
