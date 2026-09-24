// Builds the three scripted scenario videos from docs/demo-video/scenarios.json.
//
// Shares the voice, the subtitle burn-in and the encode settings with
// scripts/record-customer-videos.mjs (which films the theatre captures). The stage
// here is docs/demo-scenarios.html, rendered in HTML so the WhatsApp pane carries
// scripted copy instead of a live account's screenshots.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const FFPROBE = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe";
const EDGE_TTS = "edge-tts";

// Same voice as the theatre videos, identified from the team's chosen sample.
const VOICE = "en-US-AvaMultilingualNeural";
const VOICE_RATE = "-8%";

const STAGE = path.resolve("docs/demo-scenarios.html");
const SCENARIOS_PATH = path.resolve("docs/demo-video/scenarios.json");
const TMP_DIR = path.resolve("docs/.scenario-videos-tmp");

fs.mkdirSync(TMP_DIR, { recursive: true });

function synthesizeCue(text) {
  const key = createHash("sha1").update(`${VOICE}|${VOICE_RATE}|${text}`).digest("hex").slice(0, 16);
  const cached = path.join(TMP_DIR, "cue-cache", `${key}.mp3`);
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  if (!fs.existsSync(cached)) {
    execFileSync(EDGE_TTS, ["--voice", VOICE, `--rate=${VOICE_RATE}`, "--text", text, "--write-media", cached], {
      stdio: "ignore",
    });
  }
  const seconds = Number(
    execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", cached], {
      encoding: "utf8",
    }).trim(),
  );
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`bad duration for: ${text.slice(0, 40)}`);
  return { file: cached, seconds };
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  return (
    `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:` +
    `${String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0")}:` +
    `${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")},` +
    `${String(ms % 1000).padStart(3, "0")}`
  );
}

function wrap(text, width = 68) {
  const words = text.split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      out.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out.join("\n");
}

class Cdp {
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writePipe.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }
}

function encodeSegment(framePng, audioMp3, durationSec, outMp4) {
  execFileSync(
    FFMPEG,
    [
      "-y", "-loop", "1", "-i", framePng, "-i", audioMp3,
      "-t", String(durationSec),
      "-vf", "fps=24,format=yuv420p",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", "24",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-shortest", outMp4,
    ],
    { stdio: "ignore" },
  );
}

function concat(list, outMp4) {
  const listPath = path.join(TMP_DIR, `concat-${path.basename(outMp4)}.txt`);
  fs.writeFileSync(listPath, list.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  execFileSync(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outMp4], {
    stdio: "ignore",
  });
}

function burnSubtitles(inMp4, srtPath, outMp4) {
  const esc = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  execFileSync(
    FFMPEG,
    [
      "-y", "-i", inMp4,
      "-vf",
      `subtitles='${esc}':force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BorderStyle=3,Outline=2,Shadow=1,MarginV=160,Bold=1'`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "copy", "-movflags", "+faststart", outMp4,
    ],
    { stdio: "ignore" },
  );
}

async function main() {
  const doc = JSON.parse(fs.readFileSync(SCENARIOS_PATH, "utf8"));
  const scenarios = doc.scenarios;
  console.log(`[scenarios] voice=${VOICE} rate=${VOICE_RATE} · ${scenarios.length} scenarios`);

  // ---- 1. Synthesize every cue and total each step.
  for (const sc of scenarios) {
    sc.stepAudio = [];
    sc.stepTotal = [];
    // Per-cue durations, not just per-step totals: the subtitle grid must follow the
    // real audio of each sentence or the text drifts off the voice.
    sc.stepCueDur = [];
    for (const step of sc.steps) {
      const files = [];
      const durs = [];
      let total = 0;
      for (const cue of step.cues) {
        const { file, seconds } = synthesizeCue(cue);
        files.push(file);
        durs.push(seconds);
        total += seconds;
      }
      sc.stepAudio.push(files);
      sc.stepCueDur.push(durs);
      sc.stepTotal.push(total);
    }
    sc.runtime = sc.stepTotal.reduce((a, b) => a + b, 0);
    console.log(`  ${sc.id}: ${sc.steps.length} steps, ${sc.runtime.toFixed(1)}s`);
  }

  // ---- 2. Chrome + stage.
  const chrome = findChrome();
  if (!chrome) throw new Error("Could not find Chrome");
  const profile = path.join(TMP_DIR, "chrome-profile");
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(
    chrome,
    ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--window-size=1920,1080",
     `--user-data-dir=${profile}`, "--remote-debugging-pipe", "about:blank"],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] },
  );
  const cdp = new Cdp(child);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const page = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);

  // A fresh query string per run is load-bearing: Chrome caches file:// documents by
  // URL, and this script reuses its own profile directory, so without it a run can
  // silently render the PREVIOUS layout — which is how an edited stage first produced
  // a video with the old geometry.
  const stageUrl = pathToFileURL(STAGE).href + `?run=${Date.now()}`;
  const scenariosJson = JSON.stringify(doc);

  for (const sc of scenarios) {
    console.log(`\n[scenarios] recording "${sc.id}"`);
    await cdp.send("Page.navigate", { url: stageUrl + `&s=${sc.id}` }, sessionId);
    await new Promise((r) => setTimeout(r, 1200));
    await cdp.send("Runtime.evaluate", { expression: `window.__setScenarios(${scenariosJson})` }, sessionId);

    const segments = [];
    const srt = [];
    let elapsed = 0;
    let cueNo = 1;

    for (let s = 0; s < sc.steps.length; s++) {
      const step = sc.steps[s];
      await cdp.send("Runtime.evaluate", { expression: `window.__renderScene(${JSON.stringify(sc.id)}, ${s})` }, sessionId);
      // Let the bubble pop animation settle before the frame is grabbed.
      await new Promise((r) => setTimeout(r, 700));

      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      const frame = path.join(TMP_DIR, `${sc.id}-frame-${s}.png`);
      fs.writeFileSync(frame, Buffer.from(data, "base64"));

      const audio = path.join(TMP_DIR, `${sc.id}-audio-${s}.mp3`);
      const files = sc.stepAudio[s];
      if (files.length === 1) fs.copyFileSync(files[0], audio);
      else {
        const l = path.join(TMP_DIR, `${sc.id}-cues-${s}.txt`);
        fs.writeFileSync(l, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
        execFileSync(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", l, "-c", "copy", audio], { stdio: "ignore" });
      }

      const seg = path.join(TMP_DIR, `${sc.id}-seg-${s}.mp4`);
      encodeSegment(frame, audio, sc.stepTotal[s], seg);
      segments.push(seg);

      // SRT laid onto the running clock from each cue's own measured duration.
      let at = elapsed;
      const durs = sc.stepCueDur[s];
      for (let c = 0; c < step.cues.length; c++) {
        const end = at + durs[c];
        srt.push(`${cueNo++}\n${srtTime(at)} --> ${srtTime(Math.max(at + 0.4, end - 0.08))}\n${wrap(step.cues[c])}\n`);
        at = end;
      }
      elapsed += sc.stepTotal[s];
      console.log(`  step ${s + 1}/${sc.steps.length} -> ${sc.stepTotal[s].toFixed(2)}s`);
    }

    const silent = path.join(TMP_DIR, `${sc.id}-silent.mp4`);
    concat(segments, silent);

    const srtPath = path.resolve(`docs/demo-video/${sc.id}.en.srt`);
    fs.writeFileSync(srtPath, srt.join("\n"), "utf8");

    const finalMp4 = path.join(TMP_DIR, `${sc.id}-final.mp4`);
    burnSubtitles(silent, srtPath, finalMp4);

    const outDocs = path.resolve("docs", sc.file);
    const outPublic = path.resolve("public", sc.file);
    fs.copyFileSync(finalMp4, outDocs);
    fs.copyFileSync(finalMp4, outPublic);
    console.log(`  written: ${outDocs} (${(fs.statSync(outDocs).size / 1048576).toFixed(1)} MB)`);
  }

  child.kill();
  console.log("\n[scenarios] done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
