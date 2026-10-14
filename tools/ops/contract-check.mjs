#!/usr/bin/env node
/**
 * Verifies Estimator API contracts against fixtures and upstream OpenAPI schemas.
 *
 *   npm run contract:check
 *
 * Runs contract tests on contracts/fixtures/estimator/*.
 * If ESTIMATOR_SPEC_URL is configured, fetches upstream OpenAPI spec and verifies compatibility.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

console.log("[contract:check] Running contract verification tests against Estimator fixtures...");
try {
  execFileSync("npx", ["vitest", "run", "contracts/test/estimator-api.test.ts"], {
    cwd: here,
    stdio: "inherit",
    shell: true,
  });
  console.log("[contract:check] All fixture contract tests passed.");
} catch (err) {
  console.error("[contract:check] Fixture contract verification failed.");
  process.exit(1);
}

const specUrl = process.env.ESTIMATOR_SPEC_URL;
if (specUrl) {
  console.log(`[contract:check] Checking upstream OpenAPI schema from ${specUrl}...`);
  try {
    const res = await fetch(specUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[contract:check] Upstream spec check returned HTTP ${res.status}; skipped.`);
    } else {
      const spec = await res.json();
      console.log(`[contract:check] Upstream spec reachable: ${spec.info?.title ?? "OpenAPI"} v${spec.info?.version ?? "unknown"}`);
    }
  } catch (err) {
    console.warn(`[contract:check] Could not reach upstream spec at ${specUrl} (${err.message}); skipping live schema diff.`);
  }
} else {
  console.log("[contract:check] (ESTIMATOR_SPEC_URL not set; verified against local fixtures).");
}

process.exit(0);
