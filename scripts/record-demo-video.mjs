import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const HTML_PATH = path.resolve("docs/demo-theatre.html");
const TMP_DIR = path.resolve("docs/.demo-frames");
const OUT_MP4_DOCS = path.resolve("docs/casa-escondida-demo.mp4");
const OUT_MP4_PUBLIC = path.resolve("public/casa-escondida-demo.mp4");

fs.mkdirSync(TMP_DIR, { recursive: true });

const chrome = findChrome();
if (!chrome) {
  throw new Error("Could not find Chrome executable");
}

console.log("[record] Using Chrome:", chrome);

class SimplePipeCdp {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.buffer = "";
    this.pending = new Map();
    this.writePipe = child.stdio[3];
    this.readPipe = child.stdio[4];
    this.readPipe.setEncoding("utf8");
    this.readPipe.on("data", (chunk) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf("\0")) !== -1) {
        const raw = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        if (!raw.trim()) continue;
        const msg = JSON.parse(raw);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writePipe.write(payload);
    });
  }
}

async function main() {
  const userDataDir = path.join(TMP_DIR, "profile");
  fs.mkdirSync(userDataDir, { recursive: true });
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--window-size=1920,1080",
      `--user-data-dir=${userDataDir}`,
      "--remote-debugging-pipe",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] }
  );

  const cdp = new SimplePipeCdp(child);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pageTarget = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });

  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
    sessionId
  );

  const url = pathToFileURL(HTML_PATH).href + "?manual=1";
  await cdp.send("Page.navigate", { url }, sessionId);
  await new Promise((r) => setTimeout(r, 1200));

  const stepDurations = [5, 7, 5, 6, 5, 6, 6, 8]; // total 48 seconds
  let elapsed = 0;
  const concatLines = [];

  for (let i = 0; i < 8; i++) {
    const dur = stepDurations[i];
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    const label = `${mm}:${ss} / 00:48`;
    await cdp.send(
      "Runtime.evaluate",
      { expression: `window.__setDemoStep(${i}, ${JSON.stringify(label)})` },
      sessionId
    );
    await new Promise((r) => setTimeout(r, 350));
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const frameFile = path.join(TMP_DIR, `step-${i}.png`);
    fs.writeFileSync(frameFile, Buffer.from(data, "base64"));
    concatLines.push(`file '${frameFile.replace(/\\/g, "/")}'`);
    concatLines.push(`duration ${dur}`);
    elapsed += dur;
    console.log(`[record] Captured Step ${i + 1}/8 (${dur}s)`);
  }

  // Repeat last frame for ffmpeg concat demuxer
  concatLines.push(`file '${path.join(TMP_DIR, "step-7.png").replace(/\\/g, "/")}'`);
  const listPath = path.join(TMP_DIR, "frames.txt");
  fs.writeFileSync(listPath, concatLines.join("\n"));

  child.kill();

  console.log("[record] Encoding 1920x1080 H.264 MP4 via ffmpeg...");
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-vf",
      "fps=24,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "20",
      "-movflags",
      "+faststart",
      OUT_MP4_DOCS,
    ],
    { stdio: "inherit" }
  );

  fs.copyFileSync(OUT_MP4_DOCS, OUT_MP4_PUBLIC);
  fs.copyFileSync(HTML_PATH, path.resolve("public/demo-theatre.html"));
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  const stat = fs.statSync(OUT_MP4_DOCS);
  console.log(`[record] DONE! Video saved to ${OUT_MP4_DOCS} (${(stat.size / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
