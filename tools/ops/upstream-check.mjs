#!/usr/bin/env node
/**
 * Read-only drift report against the source repo (tn-casa-quotation-estimator).
 *
 *   npm run upstream:check
 *
 * Run it before touching anything that prices a trip (estimatorClient, simulatedEstimator,
 * odooHandoff, the mirrored ai/ and contracts/). It runs `git fetch` in the source checkout and nothing else:
 * no checkout, no pull, no write to either repo.
 *
 * What it prints, for `origin/main` and `origin/Stage1_Estimator_Tools`:
 *   - commits since the pinned contract commit that touch the paths that reach the chatbot, each
 *     marked [handled] (already in the behaviour snapshot) or [NEW];
 *   - the `TripIssueCode` union at the branch tip, diffed against the codes `bff/src/services/refusalCopy.ts`
 *     has a sentence for.
 *
 * `npm run mirror:check` is the other half: it proves ai/ and contracts/ are still byte-copies.
 *
 * Env: UPSTREAM_REPO — path of the source checkout (default E:\tn-casa-quotation-estimator).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repo = process.env.UPSTREAM_REPO ?? "E:\\tn-casa-quotation-estimator";
// `ds/ai-room-type-required` is watched until it merges: it carries F08, the contract of our channel.
const BRANCHES = ["origin/main", "origin/Stage1_Estimator_Tools", "origin/ds/ai-room-type-required"];
const WATCHED = [
  "contracts/",
  "bff/src/routes/",
  "bff/src/trip/",
  "bff/src/model/",
  "bff/src/odoo/",
  "bff/src/auth/",
  "ai/",
  "docs/integration/",
  "docs/flows/",
  "docs/product/",
  "docs/ledgers/customer-questions.md",
];

function git(...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

if (!existsSync(path.join(repo, ".git"))) {
  console.error(`No git checkout at ${repo}. Set UPSTREAM_REPO to the source repo path.`);
  process.exit(2);
}

// The pins, from docs/notes/upstream-provenance.md: the contract commit, and the behaviour snapshot's Stage 1 commit.
const provenance = readFileSync(path.join(root, "docs/notes/upstream-provenance.md"), "utf8");
const contractPin = /\| Commit \| `([0-9a-f]{7,40})`/.exec(provenance)?.[1];
const behaviourPin = /transcribed from `Stage1_Estimator_Tools@([0-9a-f]{7,40})`/.exec(provenance)?.[1];
const dsPin = /pinned at\s+`ds\/ai-room-type-required@([0-9a-f]{7,40})`/.exec(provenance)?.[1];
if (!contractPin || !behaviourPin || !dsPin) {
  console.error("Could not read the pinned commits from docs/notes/upstream-provenance.md.");
  process.exit(2);
}

try {
  git("fetch", "--quiet", "origin");
} catch (err) {
  console.error(`git fetch failed (${err.stderr?.toString().trim() || err.message}); reporting from what is already local.`);
}

// The codes this side has a sentence for: the keys of `ISSUE_COPY` in refusalCopy.ts.
const copySrc = readFileSync(path.join(root, "bff/src/services/refusalCopy.ts"), "utf8").replace(/\r\n/g, "\n");
const copyBlock = /export const ISSUE_COPY[^\n]*= \{\n([\s\S]*?)\n\};/.exec(copySrc)?.[1] ?? "";
const known = new Set([...copyBlock.matchAll(/^\s*"([a-z0-9-]+)":/gm)].map((m) => m[1]));
if (known.size === 0) {
  console.error("Could not read the issue codes from bff/src/services/refusalCopy.ts.");
  process.exit(2);
}

console.log(`Source repo   ${repo}`);
console.log(`Contract pin  ${contractPin.slice(0, 7)}   Behaviour snapshot  Stage1@${behaviourPin.slice(0, 7)}   ds pin  ${dsPin.slice(0, 7)}`);

let newCommits = 0;
let codeDrift = false;
for (const ref of BRANCHES) {
  let tip;
  try {
    tip = git("rev-parse", "--short", ref);
  } catch {
    console.log(`\n== ${ref}: not found locally, skipped`);
    continue;
  }
  const ahead = git("rev-list", "--count", `${contractPin}..${ref}`);
  console.log(`\n== ${ref} @ ${tip}  (${ahead} commits past the contract pin)`);

  const lines = git("log", "--no-merges", "--format=%h\t%ad\t%s", "--date=short", `${contractPin}..${ref}`, "--", ...WATCHED)
    .split("\n")
    .filter(Boolean);
  for (const line of lines) {
    const [hash, date, subject] = line.split("\t");
    // Each branch is judged against the snapshot that covers it: the ds branch has its own pin.
    const pin = ref.includes("ds/") ? dsPin : behaviourPin;
    let handled = false;
    try {
      git("merge-base", "--is-ancestor", hash, pin);
      handled = true;
    } catch {
      handled = false;
    }
    if (!handled) newCommits += 1;
    console.log(`  ${handled ? "[handled]" : "[NEW]    "} ${hash} ${date} ${subject}`);
  }
  if (lines.length === 0) console.log("  (no commits touching the watched paths)");

  let src = "";
  try {
    src = git("show", `${ref}:bff/src/trip/validate.ts`);
  } catch {
    console.log("  TripIssueCode: bff/src/trip/validate.ts not present at this ref");
    continue;
  }
  const union = /export type TripIssueCode\s*=([^;]+);/.exec(src)?.[1] ?? "";
  const codes = [...union.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  console.log(`  TripIssueCode (${codes.length}): ${codes.join(", ")}`);
  const fresh = codes.filter((c) => !known.has(c));
  const gone = [...known].filter((c) => !codes.includes(c));
  if (fresh.length) {
    codeDrift = true;
    console.log(`  !! no sentence in refusalCopy.ts yet (add one, then the ISSUE_CODES list in refusalCopy.test.ts): ${fresh.join(", ")}`);
  }
  if (gone.length) console.log(`  -- has a sentence here but not at this ref: ${gone.join(", ")}`);
}

console.log(
  `\n${newCommits} new commit(s) on watched paths since the behaviour snapshot; ` +
    (codeDrift ? "issue-code drift found." : "no issue-code drift."),
);
