// The shape of bff/src, held by a test: where the environment is read, and which folder may import which.
//
//   env.ts                       the only file that touches process.env
//   auth/   -> env               sessions and the login limiter; knows nothing of pages, stores or services
//   store/  -> env, kv, ai, quotation barrels
//                                persistence; must not import views, services, auth or routes
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (name.endsWith(".ts")) yield full;
  }
}

const SPECIFIER = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

/** The top-level folder of `bff/src` (or the file for `env.ts`) each relative import points at. */
export function importTargets(file: string, source: string): string[] {
  const targets: string[] = [];
  for (const [, spec] of source.matchAll(SPECIFIER)) {
    const resolved = path.resolve(path.dirname(file), spec!);
    const rel = path.relative(SRC, resolved);
    if (rel.startsWith("..")) continue; // another package (ai, quotation, contracts)
    targets.push(rel.split(path.sep)[0]!.replace(/\.ts$/, ""));
  }
  return targets;
}

/** What `folder` imports that it may not, given the folders it is allowed to import. */
export function violations(folder: string, files: Array<[string, string]>, allowed: string[]): string[] {
  const out: string[] = [];
  for (const [file, source] of files) {
    for (const target of importTargets(file, source)) {
      if (target !== folder && !allowed.includes(target)) {
        out.push(`${path.relative(SRC, file).split(path.sep).join("/")} imports ${target}`);
      }
    }
  }
  return out;
}

const filesIn = (folder: string): Array<[string, string]> =>
  [...walk(path.join(SRC, folder))].map((f) => [f, readFileSync(f, "utf8")]);

describe("the environment is read in one place", () => {
  it("has process.env nowhere in bff/src but env.ts", () => {
    const offenders = [...walk(SRC)]
      .filter((f) => path.basename(f) !== "env.ts")
      .filter((f) => /process\.env\b/.test(readFileSync(f, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

describe("folders import downward only", () => {
  it("auth/ imports nothing but env", () => {
    expect(violations("auth", filesIn("auth"), ["env"])).toEqual([]);
  });

  it("store/ does not import views, services, auth or routes", () => {
    expect(violations("store", filesIn("store"), ["env"])).toEqual([]);
  });

  it("the checker sees a violation when there is one", () => {
    const fake: Array<[string, string]> = [
      [path.join(SRC, "store/x.ts"), `import { themeCss } from "../views/theme.ts";\nimport { kv } from "./kv.ts";\nconst m = await import("../auth/demoAuth.ts");`],
    ];
    expect(violations("store", fake, ["env"])).toEqual(["store/x.ts imports views", "store/x.ts imports auth"]);
  });
});
