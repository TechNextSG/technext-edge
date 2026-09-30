import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// public/ only — see add-back-buttons.mjs: the docs/ copies of these pages are gone,
// because a second copy that the server never reads is a copy that drifts unnoticed.
const rootFiles = [
  "public/benchmark-report.html",
  "public/casa-anilao-test-scenarios.html",
  "public/extractor-pod-status.html",
  "public/roadmap-next.html",
  "public/demo-checklist.html",
  "public/team-guide.html",
];

const diagramFiles = [
  "public/diagrams/extractor-pod.html",
  "public/diagrams/extractor-pod.vi.html",
  "public/diagrams/extractor-pod.viewer.html",
];

for (const f of rootFiles) {
  const p = resolve(f);
  if (!existsSync(p)) continue;
  let s = readFileSync(p, "utf8");
  // Replace href="/" with smart local fallback
  s = s.replace(
    /href="\/"/g,
    `href="/" onclick="if(location.protocol==='file:'){this.href='index.html';}"`
  );
  writeFileSync(p, s, "utf8");
}

for (const f of diagramFiles) {
  const p = resolve(f);
  if (!existsSync(p)) continue;
  let s = readFileSync(p, "utf8");
  s = s.replace(
    /href="\/"/g,
    `href="/" onclick="if(location.protocol==='file:'){this.href='../index.html';}"`
  );
  writeFileSync(p, s, "utf8");
}

console.log("Updated all back buttons with smart file:// fallback to local index.html.");
