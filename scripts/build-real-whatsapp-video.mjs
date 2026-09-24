import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const FFPROBE = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe";
const EDGE_TTS = "edge-tts";

const INPUT_VIDEO = "C:\\Users\\nguye\\Videos\\Captures\\WhatsApp 2026-09-24 17-18-08.mp4";
const WORK_DIR = path.resolve("docs/real-whatsapp-demo");
const OUT_DOCS = path.resolve("docs/casa-whatsapp-conversation-demo.mp4");
const OUT_PUBLIC = path.resolve("public/casa-whatsapp-conversation-demo.mp4");
const OUT_SRT_DOCS = path.resolve("docs/casa-whatsapp-conversation-demo.srt");
const OUT_SRT_PUBLIC = path.resolve("public/casa-whatsapp-conversation-demo.srt");

fs.mkdirSync(WORK_DIR, { recursive: true });

function synthesizeAudio(text, outFile, rate = "-6%") {
  execFileSync(
    EDGE_TTS,
    [
      "--voice",
      "en-US-AvaMultilingualNeural",
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

function getAudioDuration(filePath) {
  const out = execFileSync(
    FFPROBE,
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf8" }
  );
  return parseFloat(out.trim());
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

// Exact timestamps mapped from the real WhatsApp Web recording (61.58s + 3.5s tail hold)
const CUES = [
  {
    id: "01-intro",
    startSec: 0.3,
    maxEndSec: 8.7,
    text: "Welcome to our live WhatsApp Business integration for Casa Escondida, connected to the production Cloud API.",
  },
  {
    id: "02-turn1-send",
    startSec: 9.0,
    maxEndSec: 19.3,
    text: "First, Sarah Jenkins sends a booking enquiry for four guests in two Deluxe rooms from October seventeenth for three nights.",
  },
  {
    id: "03-turn1-reply",
    startSec: 19.8,
    maxEndSec: 29.3,
    text: "Within seconds, the assistant extracts the dates, rooms, and full-board meals, then asks if the group plans to dive.",
  },
  {
    id: "04-turn2-send",
    startSec: 29.7,
    maxEndSec: 38.8,
    text: "In the second turn, Sarah adds two days of boat diving for two guests, plus airport pickup from Manila.",
  },
  {
    id: "05-turn2-reply",
    startSec: 39.2,
    maxEndSec: 46.6,
    text: "The engine logs boat diving and the Manila transfer, and asks to confirm the exact diver headcount.",
  },
  {
    id: "06-turn3-send",
    startSec: 47.0,
    maxEndSec: 53.9,
    text: "Finally, Sarah confirms two divers and an eleven AM arrival at Manila airport for all four guests.",
  },
  {
    id: "07-turn3-reply",
    startSec: 54.3,
    maxEndSec: 64.8,
    text: "All required details are now complete. The assistant locks the full itinerary and hands over to staff for official quotation.",
  },
];

async function main() {
  console.log("=== BUILDING SYNCHRONIZED NARRATION & SUBTITLES FOR REAL WHATSAPP VIDEO ===");

  // 1. Synthesize each cue and adjust rate slightly if needed so it never overflows maxEndSec
  for (let i = 0; i < CUES.length; i++) {
    const c = CUES[i];
    const mp3 = path.join(WORK_DIR, `cue-${String(i + 1).padStart(2, "0")}-${c.id}.mp3`);
    let dur = synthesizeAudio(c.text, mp3, "-6%");
    const windowSec = c.maxEndSec - c.startSec;
    if (dur > windowSec - 0.15) {
      console.log(`  [Cue ${i + 1}] Duration ${dur.toFixed(2)}s > window ${windowSec.toFixed(2)}s, speeding up slightly to +4%...`);
      dur = synthesizeAudio(c.text, mp3, "+4%");
    }
    c.audioPath = mp3;
    c.duration = dur;
    c.endSec = Math.min(c.startSec + dur, c.maxEndSec);
    console.log(`  [Cue ${i + 1}/${CUES.length}] ${c.id}: ${c.startSec.toFixed(2)}s -> ${c.endSec.toFixed(2)}s (dur: ${dur.toFixed(2)}s / window: ${windowSec.toFixed(2)}s)`);
  }

  // 2. Write SRT files
  const srtLines = CUES.map((c, i) => {
    return `${i + 1}\n${formatSrtTime(c.startSec)} --> ${formatSrtTime(c.endSec)}\n${c.text}\n`;
  }).join("\n");
  fs.writeFileSync(OUT_SRT_DOCS, srtLines, "utf8");
  fs.writeFileSync(OUT_SRT_PUBLIC, srtLines, "utf8");

  // 3. Write ASS subtitle file for crisp, high-visibility burned-in subtitle dock
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

  const assEvents = CUES.map((c) => {
    return `Dialogue: 0,${formatAssTime(c.startSec)},${formatAssTime(c.endSec)},DockSub,,0,0,0,,${c.text}`;
  }).join("\n");

  const assPath = path.join(WORK_DIR, "subtitles.ass");
  fs.writeFileSync(assPath, assHeader + assEvents + "\n", "utf8");

  // 4. Mix Audio Track with FFmpeg
  console.log("\n--- Mixing Neural Voiceover Track ---");
  const audioInputs = [];
  const filterParts = [];
  for (let i = 0; i < CUES.length; i++) {
    const c = CUES[i];
    audioInputs.push("-i", c.audioPath);
    const delayMs = Math.round(c.startSec * 1000);
    filterParts.push(`[${i}:a]adelay=${delayMs}|${delayMs}[a${i}]`);
  }
  const mixLabels = CUES.map((_, i) => `[a${i}]`).join("");
  const audioFilter = `${filterParts.join(";")};${mixLabels}amix=inputs=${CUES.length}:dropout_transition=0:normalize=0,volume=1.15[aout]`;

  const mixedAudio = path.join(WORK_DIR, "mixed_voice.m4a");
  execFileSync(
    FFMPEG,
    [
      "-y",
      ...audioInputs,
      "-filter_complex",
      audioFilter,
      "-map",
      "[aout]",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      mixedAudio,
    ],
    { stdio: "inherit" }
  );

  // 5. Render Final Video (1920x1080 with bottom dock + burned-in ASS subtitles + synced audio)
  console.log("\n--- Rendering Final 1080p MP4 with Burned-In Subtitles & Voiceover ---");
  // Escape path for ffmpeg subtitles filter on Windows
  const assEscaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const vf = [
    "scale=1920:1032",
    "pad=1920:1080:0:0:color=#0b141a",
    "tpad=stop_mode=clone:stop_duration=3.5",
    "drawbox=x=0:y=1032:w=1920:h=48:color=#080e14@1.0:t=fill",
    "drawbox=x=0:y=1031:w=1920:h=2:color=#25d366@0.65:t=fill",
    `subtitles='${assEscaped}'`,
    "format=yuv420p"
  ].join(",");

  execFileSync(
    FFMPEG,
    [
      "-y",
      "-i",
      INPUT_VIDEO,
      "-i",
      mixedAudio,
      "-vf",
      vf,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      OUT_DOCS,
    ],
    { stdio: "inherit" }
  );

  fs.copyFileSync(OUT_DOCS, OUT_PUBLIC);

  console.log("\n=== SUCCESS! REAL WHATSAPP VIDEO WITH VOICEOVER & SUBTITLES READY ===");
  console.log(`  - Video Docs: ${OUT_DOCS}`);
  console.log(`  - Video Public: ${OUT_PUBLIC}`);
  console.log(`  - SRT Docs: ${OUT_SRT_DOCS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
