#!/usr/bin/env node
/**
 * Fails when an import crosses a package boundary the wrong way.
 *
 *   contracts  <-  ai  <-  quotation  <-  bff
 *
 * - A package may import only the packages to its left.
 * - Across packages, only `<pkg>/src/index.ts` (the barrel) may be imported. A deep import couples
 *   the caller to a file layout the other package is free to change.
 *
 * Imports stay relative on purpose (see the note at the top of bff/src/app.ts: the workspace
 * symlink did not resolve in the Vercel bundle), so this is the check that keeps them honest.
 * Run from the repo root: `node tools/ops/check-boundaries.mjs`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ORDER = ["contracts", "ai", "quotation", "bff"];
const ENTRIES = new Set(["src/index.js", "bff-contract/contract-spec.mjs"]);
const SPEC = /(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "results" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|mts|mjs)$/.test(name)) yield full;
  }
}

const problems = [];
for (const pkg of ORDER) {
  const allowed = new Set(ORDER.slice(0, ORDER.indexOf(pkg)));
  for (const file of walk(path.join(root, pkg))) {
    const src = readFileSync(file, "utf8");
    for (const [, spec] of src.matchAll(SPEC)) {
      const target = path.relative(root, path.resolve(path.dirname(file), spec)).split(path.sep);
      const other = target[0];
      if (!ORDER.includes(other) || other === pkg) continue;
      const where = `${path.relative(root, file)} -> ${spec}`;
      if (!allowed.has(other)) problems.push(`${where}\n    ${pkg} may not depend on ${other}`);
      else if (!ENTRIES.has(target.slice(1).join("/"))) problems.push(`${where}\n    import ${other}/src/index.js, not a file inside it`);
    }
  }
}

if (problems.length) {
  console.error(`Package boundary violations (${problems.length}):\n\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}
console.log("package boundaries: ok (contracts <- ai <- quotation <- bff)");
