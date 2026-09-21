import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function updateDiagram() {
  const target = resolve("public/diagrams/extractor-pod.html");
  if (!existsSync(target)) return;
  let s = readFileSync(target, "utf8");
  if (s.includes("archify-back-btn")) return;

  const btn = `<a href="/" id="archify-back-btn" style="position:fixed;top:12px;left:12px;z-index:99999;display:inline-flex;align-items:center;gap:6px;background:rgba(15,23,42,0.88);color:#e2e8f0;border:1px solid rgba(255,255,255,0.22);border-radius:6px;padding:6px 14px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;font-weight:700;text-decoration:none;backdrop-filter:blur(8px);box-shadow:0 4px 12px rgba(0,0,0,0.35);transition:all .15s" onmouseover="this.style.borderColor='#38bdf8';this.style.color='#38bdf8'" onmouseout="this.style.borderColor='rgba(255,255,255,0.22)';this.style.color='#e2e8f0'">← Edge Docs Hub</a>`;
  s = s.replace(/<body[^>]*>/i, (m) => `${m}\n  ${btn}`);
  writeFileSync(target, s, "utf8");
  writeFileSync(resolve("docs/diagrams/extractor-pod.html"), s, "utf8");
  console.log("Updated extractor-pod.html with back button");
}

function updateBenchmark() {
  const target = resolve("public/benchmark-report.html");
  if (!existsSync(target)) return;
  let s = readFileSync(target, "utf8");
  if (s.includes("href=\"/\"")) return;

  // Insert back button inside .topbar-top next to .seg
  const oldChunk = `<div class="seg">`;
  const newChunk = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <a href="/" style="display:inline-flex;align-items:center;gap:6px;color:#9FC6C9;text-decoration:none;font-family:var(--font-m);font-size:12px;font-weight:600;padding:6px 14px;border:1px solid rgba(255,255,255,.2);border-radius:20px;background:rgba(255,255,255,.08);transition:all .15s">← <span class="en">Edge Docs Hub</span><span class="vi">Kho Tài Liệu Hub</span></a>
      <div class="seg">`;
  if (s.includes(oldChunk)) {
    s = s.replace(oldChunk, newChunk);
    s = s.replace(`</div>\n  </div>\n  <p>`, `</div>\n    </div>\n  </div>\n  <p>`);
    writeFileSync(target, s, "utf8");
    writeFileSync(resolve("docs/benchmark-report.html"), s, "utf8");
    console.log("Updated benchmark-report.html with back button");
  }
}

function updateScenarios() {
  const target = resolve("public/casa-anilao-test-scenarios.html");
  if (!existsSync(target)) return;
  let s = readFileSync(target, "utf8");
  if (s.includes("href=\"/\"")) return;

  const oldChunk = `<div class="sb-brand">`;
  const newChunk = `<a href="/" style="display:inline-flex;align-items:center;gap:6px;color:#9fb0c4;text-decoration:none;font:600 12px Consolas, monospace;padding:6px 12px;border:1px solid rgba(255,255,255,.18);border-radius:6px;background:rgba(255,255,255,.06);margin-bottom:16px;width:fit-content;transition:all .15s">← <span class="en">Edge Docs Hub</span><span class="vi">Kho Tài Liệu Hub</span></a>\n    <div class="sb-brand">`;
  if (s.includes(oldChunk)) {
    s = s.replace(oldChunk, newChunk);
    writeFileSync(target, s, "utf8");
    writeFileSync(resolve("docs/casa-anilao-test-scenarios.html"), s, "utf8");
    console.log("Updated casa-anilao-test-scenarios.html with back button");
  }
}

function updateStatus() {
  const target = resolve("public/extractor-pod-status.html");
  if (!existsSync(target)) return;
  let s = readFileSync(target, "utf8");
  if (s.includes("href=\"/\"")) return;

  // Find sidebar brand or top
  const oldChunk = `<div class="sb-brand">`;
  const newChunk = `<a href="/" style="display:inline-flex;align-items:center;gap:6px;color:#9fb0c4;text-decoration:none;font:600 12px Consolas, monospace;padding:6px 12px;border:1px solid rgba(255,255,255,.18);border-radius:6px;background:rgba(255,255,255,.06);margin-bottom:16px;width:fit-content;transition:all .15s">← <span class="en">Edge Docs Hub</span><span class="vi">Kho Tài Liệu Hub</span></a>\n      <div class="sb-brand">`;
  if (s.includes(oldChunk)) {
    s = s.replace(oldChunk, newChunk);
    writeFileSync(target, s, "utf8");
    writeFileSync(resolve("docs/extractor-pod-status.html"), s, "utf8");
    console.log("Updated extractor-pod-status.html with back button");
  }
}

function updateRoadmap() {
  const target = resolve("public/roadmap-next.html");
  if (!existsSync(target)) return;
  let s = readFileSync(target, "utf8");
  if (s.includes("href=\"/\"")) return;

  const oldChunk = `<div class="topbar">`;
  const newChunk = `<div class="topbar">\n    <div style="margin-bottom:12px"><a href="/" style="display:inline-flex;align-items:center;gap:6px;color:#9FC6C9;text-decoration:none;font-family:var(--font-m);font-size:12px;font-weight:600;padding:5px 12px;border:1px solid rgba(255,255,255,.2);border-radius:6px;background:rgba(255,255,255,.06)">← Edge Docs Hub</a></div>`;
  if (s.includes(oldChunk)) {
    s = s.replace(oldChunk, newChunk);
    writeFileSync(target, s, "utf8");
    writeFileSync(resolve("docs/roadmap-next.html"), s, "utf8");
    console.log("Updated roadmap-next.html with back button");
  }
}

function updateChecklist() {
  const target = resolve("public/demo-checklist.html");
  if (!existsSync(target)) return;
  let s = readFileSync(target, "utf8");
  if (s.includes("href=\"/\"")) return;

  const oldChunk = `<div class="topbar">`;
  const newChunk = `<div class="topbar">\n    <div style="margin-bottom:12px"><a href="/" style="display:inline-flex;align-items:center;gap:6px;color:#9FC6C9;text-decoration:none;font-family:var(--font-m);font-size:12px;font-weight:600;padding:5px 12px;border:1px solid rgba(255,255,255,.2);border-radius:6px;background:rgba(255,255,255,.06)">← Edge Docs Hub</a></div>`;
  if (s.includes(oldChunk)) {
    s = s.replace(oldChunk, newChunk);
    writeFileSync(target, s, "utf8");
    writeFileSync(resolve("docs/demo-checklist.html"), s, "utf8");
    console.log("Updated demo-checklist.html with back button");
  }
}

function updateTeamGuide() {
  const target = resolve("public/team-guide.html");
  if (!existsSync(target)) return;
  let s = readFileSync(target, "utf8");
  if (s.includes("href=\"/\"")) return;

  const oldChunk = `<body`;
  s = s.replace(/<body[^>]*>/i, (m) => `${m}\n  <div style="padding:16px 24px 0;max-width:920px;margin:0 auto"><a href="/" style="display:inline-flex;align-items:center;gap:6px;color:var(--teal-strong);text-decoration:none;font-family:var(--font-m);font-size:12px;font-weight:600;padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:var(--card)">← Edge Docs Hub</a></div>`);
  writeFileSync(target, s, "utf8");
  writeFileSync(resolve("docs/team-guide.html"), s, "utf8");
  console.log("Updated team-guide.html with back button");
}

updateDiagram();
updateBenchmark();
updateScenarios();
updateStatus();
updateRoadmap();
updateChecklist();
updateTeamGuide();
console.log("All documents updated with Edge Docs Hub back button.");
