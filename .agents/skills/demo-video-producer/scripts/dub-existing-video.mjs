#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FFMPEG = process.env.FFMPEG_PATH || "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const FFPROBE = process.env.FFPROBE_PATH || "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe";
const EDGE_TTS = "edge-tts";

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(`--${flag}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const INPUT_VIDEO = getArg("input", "");
const CUES_FILE = getArg("cues", "");
const OUT_MP4 = getArg("out", "docs/demo-output.mp4");
const OUT_SRT = getArg("srt", OUT_MP4.replace(/\.mp4$/i, ".srt"));
const VOICE = getArg("voice", "en-US-AvaMultilingualNeural");
const DEFAULT_RATE = getArg("rate", "-6%");
const TAIL_PAD_SEC = parseFloat(getArg("tail-pad", "3.5"));

if (!INPUT_VIDEO || !CUES_FILE) {
  console.error("Usage: node dub-existing-video.mjs --input <raw.mp4> --cues <cues.json> [--out <out.mp4>] [--voice <voice>]");
  process.exit(1);
}

function getAudioDuration(filePath) {
  const out = execFileSync(
    FFPROBE,
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf8" }
  );
  return parseFloat(out.trim());
}

function synthesizeAudio(text, outFile, rate = DEFAULT_RATE) {
  execFileSync(
    EDGE_TTS,
    [
      "--voice",
      VOICE,
      `--rate=${rate}`,
      "--text",
      text,
      "--write-media",
      outFile,
    ],
    { stdio: "ignore" }
  );
  return getAudioDuration(outFile);
}

function formatSrtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function formatAssTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

async function main() {
  const workDir = path.resolve("docs/.dub-tmp-" + Date.now());
  fs.mkdirSync(workDir, { recursive: true });

  const cues = JSON.parse(fs.readFileSync(CUES_FILE, "utf8"));
  console.log(`=== DUBBING & SUBTITLING VIDEO (${cues.length} cues) ===`);

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const mp3 = path.join(workDir, `cue-${String(i + 1).padStart(2, "0")}.mp3`);
    let dur = synthesizeAudio(c.text, mp3, DEFAULT_RATE);
    const windowSec = c.maxEndSec - c.startSec;
    if (dur > windowSec - 0.15) {
      dur = synthesizeAudio(c.text, mp3, "+5%");
    }
    c.audioPath = mp3;
    c.duration = dur;
    c.endSec = Math.min(c.startSec + dur, c.maxEndSec);
    console.log(`  [Cue ${i + 1}] ${c.startSec.toFixed(2)}s -> ${c.endSec.toFixed(2)}s (${dur.toFixed(2)}s)`);
  }

  // Write SRT
  const srtContent = cues.map((c, i) => `${i + 1}\n${formatSrtTime(c.startSec)} --> ${formatSrtTime(c.endSec)}\n${c.text}\n`).join("\n");
  fs.mkdirSync(path.dirname(path.resolve(OUT_SRT)), { recursive: true });
  fs.writeFileSync(OUT_SRT, srtContent, "utf8");

  // Write ASS
  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: DockSub,Segoe UI,26,&H00FFFFFF,&H0000FFFF,&H00101827,&HDA0B1120,-1,0,0,0,100,100,0.2,0,3,14,0,2,90,90,16,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const assEvents = cues.map((c) => `Dialogue: 0,${formatAssTime(c.startSec)},${formatAssTime(c.endSec)},DockSub,,0,0,0,,${c.text}`).join("\n");
  const assPath = path.join(workDir, "subtitles.ass");
  fs.writeFileSync(assPath, assHeader + assEvents + "\n", "utf8");

  // Mix Audio
  const audioInputs = [];
  const filterParts = [];
  cues.forEach((c, i) => {
    audioInputs.push("-i", c.audioPath);
    const delayMs = Math.round(c.startSec * 1000);
    filterParts.push(`[${i}:a]adelay=${delayMs}|${delayMs}[a${i}]`);
  });
  const mixLabels = cues.map((_, i) => `[a${i}]`).join("");
  const audioFilter = `${filterParts.join(";")};${mixLabels}amix=inputs=${cues.length}:dropout_transition=0:normalize=0,volume=1.15[aout]`;
  const mixedAudio = path.join(workDir, "mixed.m4a");

  execFileSync(FFMPEG, [
    "-y", ...audioInputs,
    "-filter_complex", audioFilter,
    "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", mixedAudio
  ], { stdio: "inherit" });

  // Render Final Video
  const assEscaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const vf = [
    "scale=1920:1032:force_original_aspect_ratio=decrease",
    "pad=1920:1080:(ow-iw)/2:0:color=#0b141a",
    `tpad=stop_mode=clone:stop_duration=${TAIL_PAD_SEC}`,
    "drawbox=x=0:y=1032:w=1920:h=48:color=#080e14@1.0:t=fill",
    "drawbox=x=0:y=1031:w=1920:h=2:color=#22d3ee@0.65:t=fill",
    `subtitles='${assEscaped}'`,
    "format=yuv420p"
  ].join(",");

  fs.mkdirSync(path.dirname(path.resolve(OUT_MP4)), { recursive: true });
  execFileSync(FFMPEG, [
    "-y", "-i", INPUT_VIDEO, "-i", mixedAudio,
    "-vf", vf,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-c:a", "copy", "-movflags", "+faststart",
    path.resolve(OUT_MP4)
  ], { stdio: "inherit" });

  fs.rmSync(workDir, { recursive: true, force: true });
  console.log(`=== DONE: ${OUT_MP4} & ${OUT_SRT} ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
