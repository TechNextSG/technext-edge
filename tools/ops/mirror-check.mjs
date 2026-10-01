#!/usr/bin/env node
/**
 * Fails when `ai/` or `contracts/` stop being byte-copies of the team estimator
 * (TechNextSG/tn-casa-quotation-estimator). Line endings are ignored.
 *
 *   npm run mirror:check
 *
 * Those two directories are mirrored, never edited here: a change goes into the team repo first
 * (a PR there), then is copied back. Read-only: it runs `git fetch` in the team checkout and `git show`.
 *
 * Env:
 *   TEAM_REPO      path of the team checkout (default E:\tn-casa-quotation-estimator)
 *   CONTRACTS_REF  where `contracts/` is compared to (default origin/main)
 *   AI_REF         where `ai/` is compared to. Default is the branch that carries it until it is merged
 *                  (PR #5); set it to origin/main afterwards and change the default here.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repo = process.env.TEAM_REPO ?? "E:\\tn-casa-quotation-estimator";
const PARTS = [
  { dir: "contracts", ref: process.env.CONTRACTS_REF ?? "origin/main" },
  { dir: "ai", ref: process.env.AI_REF ?? "feat/ai-layered-fix" },
];
// Run output, never committed on either side.
const IGNORED = [/^ai\/eval\/results\//, /\/node_modules\//];

const run = (cwd, args, encoding = "buffer") => execFileSync("git", args, { cwd, encoding, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
const lf = (buf) => buf.toString("utf8").replace(/\r\n/g, "\n");

if (!existsSync(path.join(repo, ".git"))) {
  console.error(`No git checkout at ${repo}. Set TEAM_REPO to the team repo path.`);
  process.exit(2);
}
try {
  run(repo, ["fetch", "--quiet", "origin"]);
} catch (err) {
  console.error(`git fetch failed (${err.stderr?.toString().trim() || err.message}); comparing with what is already local.`);
}

let problems = 0;
for (const { dir, ref } of PARTS) {
  const theirs = run(repo, ["ls-tree", "-r", "--name-only", ref, "--", dir], "utf8").split("\n").filter(Boolean);
  // Tracked or new, and present on disk (a file deleted but not yet staged is not ours).
  const ours = run(here, ["ls-files", "--cached", "--others", "--exclude-standard", "--", dir], "utf8")
    .split("\n")
    .filter((f) => f && existsSync(path.join(here, f)));
  const all = [...new Set([...theirs, ...ours])].filter((f) => !IGNORED.some((re) => re.test(f))).sort();
  let same = 0;
  const lines = [];
  for (const file of all) {
    const inTeam = theirs.includes(file);
    const inHere = ours.includes(file);
    if (!inHere) lines.push(`  only in the team repo   ${file}`);
    else if (!inTeam) lines.push(`  only here               ${file}`);
    else {
      const a = lf(run(repo, ["show", `${ref}:${file}`]));
      const b = lf(readFileSync(path.join(here, file)));
      if (a === b) same += 1;
      else lines.push(`  differs                 ${file}`);
    }
  }
  console.log(`${dir}/ vs ${ref}: ${same} identical, ${lines.length} not`);
  for (const l of lines) console.log(l);
  problems += lines.length;
}

if (problems) {
  console.error(`\nMirror broken (${problems} file(s)). Change the team repo, then copy it back; do not edit ai/ or contracts/ here.`);
  process.exit(1);
}
console.log("mirror: ok");
