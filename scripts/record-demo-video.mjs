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

const NARRATIONS = [
  "Step 1. On the Web Console, a guest sends an initial inquiry for 6 guests, 4 divers and 2 non-divers, checking in on November 15.",
  "Step 2. Pass 1 and Pass 2 extract every stated fact with verbatim evidence, and the AI asks only for the missing fields, never re-asking known slots.",
  "Step 3. In Turn 2, the guest provides the remaining details: 3 nights, 3 Deluxe rooms, full-board meals, and diving dates November 16 to 17.",
  "Step 4. All 6 core booking slots are now complete, producing a verified structured Trip payload ready for the reservation team.",
  "Step 5. Switching to real WhatsApp Web on the official Casa Escondida number, Sir Sky books for 10 guests across 4 nights in 5 twin rooms, and the bot confirms all 5 slots while asking only about diving.",
  "Step 6. In another real WhatsApp thread, the bot separates 3 overnight guests from 3 day visitors and captures a custom split-day diving schedule.",
  "Step 7. Back in Sir Sky's WhatsApp thread, he updates the group from 10 to 8 divers, splits diving into 3-day and 2-day sub-groups, and asks for a 30 percent partner discount.",
  "Step 8. On real WhatsApp Web, the Symbolic Math Gate updates guests from 10 to 8 without double-counting, records the split dive groups, and flags the 30 percent partner discount for human staff review."
];

fs.mkdirSync(TMP_DIR, { recursive: true });

function synthesizeWav(text, wavPath) {
  const escapedText = text.replace(/'/g, "''");
  const escapedPath = wavPath.replace(/'/g, "''");
  const psScript = `
    Add-Type -AssemblyName System.Speech;
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
    try { $s.SelectVoice('Microsoft Zira Desktop'); } catch {}
    $s.Rate = 0;
    $s.SetOutputToWaveFile('${escapedPath}');
    $s.Speak('${escapedText}');
    $s.Dispose();
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", psScript], { stdio: "ignore" });
  // Read WAV duration from header/bytes (22050 Hz, 16-bit mono = 44100 bytes/sec)
  const buf = fs.readFileSync(wavPath);
  const byteRate = buf.readUInt32LE(28) || 44100;
  const dataBytes = Math.max(0, buf.length - 44);
  return Math.max(5.5, Number((dataBytes / byteRate + 0.6).toFixed(2)));
}

const chrome = findChrome();
if (!chrome) {
  throw new Error("Could not find Chrome executable");
}

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
  console.log("[record] Step A: Generating English Voiceover WAV files (Microsoft Zira en-US)...");
  const durations = [];
  for (let i = 0; i < NARRATIONS.length; i++) {
    const wavPath = path.join(TMP_DIR, `voice-${i}.wav`);
    const dur = synthesizeWav(NARRATIONS[i], wavPath);
    durations.push(dur);
    console.log(`  - Step ${i + 1}: ${dur}s (${wavPath})`);
  }

  const totalDuration = Math.round(durations.reduce((a, b) => a + b, 0));
  const totalMM = String(Math.floor(totalDuration / 60)).padStart(2, "0");
  const totalSS = String(totalDuration % 60).padStart(2, "0");

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

  let elapsed = 0;
  const segmentFiles = [];

  for (let i = 0; i < 8; i++) {
    const dur = durations[i];
    const curSec = Math.round(elapsed);
    const mm = String(Math.floor(curSec / 60)).padStart(2, "0");
    const ss = String(curSec % 60).padStart(2, "0");
    const label = `${mm}:${ss} / ${totalMM}:${totalSS}`;

    await cdp.send(
      "Runtime.evaluate",
      { expression: `window.__setDemoStep(${i}, ${JSON.stringify(label)})` },
      sessionId
    );
    await new Promise((r) => setTimeout(r, 400));
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const frameFile = path.join(TMP_DIR, `step-${i}.png`);
    const wavFile = path.join(TMP_DIR, `voice-${i}.wav`);
    const segMp4 = path.join(TMP_DIR, `seg-${i}.mp4`);
    fs.writeFileSync(frameFile, Buffer.from(data, "base64"));

    // Encode each step as a synced video+audio segment
    execFileSync(
      FFMPEG,
      [
        "-y",
        "-loop", "1",
        "-i", frameFile,
        "-i", wavFile,
        "-c:v", "libx264",
        "-t", String(dur),
        "-pix_fmt", "yuv420p",
        "-vf", "fps=24",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "44100",
        "-ac", "2",
        segMp4,
      ],
      { stdio: "ignore" }
    );
    segmentFiles.push(`file '${segMp4.replace(/\\/g, "/")}'`);
    elapsed += dur;
    console.log(`[record] Encoded QA/QC Step ${i + 1}/8 with Audio + Red Markers + EN Subtitles (${dur}s)`);
  }

  child.kill();

  const concatList = path.join(TMP_DIR, "segments.txt");
  fs.writeFileSync(concatList, segmentFiles.join("\n"));

  console.log("[record] Stitching final 1920x1080 MP4 with English Voiceover & QA/QC Markers...");
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatList,
      "-c", "copy",
      "-movflags", "+faststart",
      OUT_MP4_DOCS,
    ],
    { stdio: "inherit" }
  );

  fs.copyFileSync(OUT_MP4_DOCS, OUT_MP4_PUBLIC);
  fs.copyFileSync(HTML_PATH, path.resolve("public/demo-theatre.html"));
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  const stat = fs.statSync(OUT_MP4_DOCS);
  console.log(`[record] DONE! Narrated QA/QC Video saved to ${OUT_MP4_DOCS} (${(stat.size / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
