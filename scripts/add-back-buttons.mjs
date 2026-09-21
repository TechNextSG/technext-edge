import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function replaceInFile(filePath, search, replacement) {
  const p = resolve(filePath);
  if (!existsSync(p)) return;
  let s = readFileSync(p, "utf8");
  if (s.includes(search)) {
    s = s.replaceAll(search, replacement);
    writeFileSync(p, s, "utf8");
    console.log(`Updated ${filePath}`);
  }
}

// Replace any "Edge Docs Hub" with "technext-edge"
const files = [
  "public/index.html",
  "docs/index.html",
  "public/benchmark-report.html",
  "docs/benchmark-report.html",
  "public/casa-anilao-test-scenarios.html",
  "docs/casa-anilao-test-scenarios.html",
  "public/extractor-pod-status.html",
  "docs/extractor-pod-status.html",
  "public/roadmap-next.html",
  "docs/roadmap-next.html",
  "public/demo-checklist.html",
  "docs/demo-checklist.html",
  "public/team-guide.html",
  "docs/team-guide.html",
  "public/diagrams/extractor-pod.html",
  "docs/diagrams/extractor-pod.html",
  "public/diagrams/extractor-pod.vi.html",
  "docs/diagrams/extractor-pod.vi.html",
  "public/diagrams/extractor-pod.viewer.html",
  "docs/diagrams/extractor-pod.viewer.html",
];

for (const f of files) {
  replaceInFile(f, "Edge Docs Hub", "technext-edge");
  replaceInFile(f, "Kho Tài Liệu Hub", "technext-edge");
  replaceInFile(f, "Kho Tài Liệu Edge", "technext-edge");
}

// Add back button into extractor-pod.viewer.html if not present
for (const p of ["public/diagrams/extractor-pod.viewer.html", "docs/diagrams/extractor-pod.viewer.html"]) {
  const fullPath = resolve(p);
  if (existsSync(fullPath)) {
    let s = readFileSync(fullPath, "utf8");
    if (!s.includes('href="/"')) {
      s = s.replace(
        `<div class="title">`,
        `<a href="/" style="display:inline-flex;align-items:center;gap:6px;color:var(--muted);text-decoration:none;font:600 12px var(--font-m);padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,.05);margin-right:12px">← technext-edge</a>\n    <div class="title">`
      );
      writeFileSync(fullPath, s, "utf8");
      console.log(`Added back button to ${p}`);
    }
  }
}

console.log("All back button labels standardized to '← technext-edge'.");
