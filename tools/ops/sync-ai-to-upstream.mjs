#!/usr/bin/env node
/**
 * sync-ai-to-upstream.mjs
 *
 * Verifies parity and assists synchronization between:
 * - Source: technext-edge/ai/src
 * - Target: tn-casa-quotation-estimator/ai/src
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const LOCAL_AI_DIR = path.resolve("ai/src");
const UPSTREAM_REPO_DIR = path.resolve("E:/tn-casa-quotation-estimator");
const UPSTREAM_AI_DIR = path.join(UPSTREAM_REPO_DIR, "ai/src");

console.log("=== AI Package Parity & Sync Check ===");
console.log(`Local  (Workbench): ${LOCAL_AI_DIR}`);
console.log(`Target (Upstream) : ${UPSTREAM_AI_DIR}`);

if (!fs.existsSync(UPSTREAM_AI_DIR)) {
  console.error(`[ERROR] Upstream directory not found: ${UPSTREAM_AI_DIR}`);
  process.exit(1);
}

function getFiles(dir, prefix = "") {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const relPath = path.join(prefix, file).replace(/\\/g, "/");
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getFiles(fullPath, relPath));
    } else if (file.endsWith(".ts") || file.endsWith(".json")) {
      results.push(relPath);
    }
  }
  return results;
}

const localFiles = new Set(getFiles(LOCAL_AI_DIR));
const upstreamFiles = new Set(getFiles(UPSTREAM_AI_DIR));

const allFiles = new Set([...localFiles, ...upstreamFiles]);
let diffCount = 0;

for (const file of [...allFiles].sort()) {
  const localPath = path.join(LOCAL_AI_DIR, file);
  const upstreamPath = path.join(UPSTREAM_AI_DIR, file);

  const localExists = fs.existsSync(localPath);
  const upstreamExists = fs.existsSync(upstreamPath);

  if (!localExists) {
    console.log(`- [ONLY IN UPSTREAM] ${file}`);
    diffCount++;
  } else if (!upstreamExists) {
    console.log(`+ [ONLY IN LOCAL]    ${file}`);
    diffCount++;
  } else {
    const localContent = fs.readFileSync(localPath, "utf8");
    const upstreamContent = fs.readFileSync(upstreamPath, "utf8");
    if (localContent !== upstreamContent) {
      console.log(`~ [DIFFERENT]       ${file}`);
      diffCount++;
    } else {
      console.log(`= [MATCH]           ${file}`);
    }
  }
}

console.log("\n--- Upstream Git Status ---");
try {
  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: UPSTREAM_REPO_DIR, encoding: "utf8" }).trim();
  const status = execSync("git status --short", { cwd: UPSTREAM_REPO_DIR, encoding: "utf8" }).trim();
  console.log(`Branch: ${branch}`);
  console.log(status ? `Working tree changes:\n${status}` : "Working tree is clean.");
} catch (err) {
  console.log("Could not read upstream git status:", err.message);
}

console.log("\nParity check complete.");
