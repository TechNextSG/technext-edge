// Builds the narrated demo video from the three REAL screencasts.
//
// Narration is laid onto the measured event times from each recording (docs/.live-scenarios-tmp/*/timing.json),
// so the voice speaks about what is on screen at that moment rather than on a guessed
// grid. No frame is re-timed or composited: the clips are concatenated as recorded.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const FFPROBE = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe";
const EDGE_TTS = "edge-tts";

const VOICE = "en-US-AvaMultilingualNeural";
const VOICE_RATE = "-8%";
const TMP = path.resolve("docs/.live-scenarios-tmp/narrated");
fs.mkdirSync(TMP, { recursive: true });

const OUT_DOCS = path.resolve("docs/casa-live-demo-narrated.mp4");
const OUT_PUBLIC = path.resolve("public/casa-live-demo-narrated.mp4");
const SRT_PATH = path.resolve("docs/demo-video/live-demo.en.srt");

// Cue windows are named after the marks the recorder wrote, so this stays correct if
// the message text changes and the timings move.
const SEGMENTS = [
  {
    id: "2guests",
    title: "Two guests",
    roll: "Scenario 1 · a couple",
    cues: [
      { to: "t1-type-start", text: "Every booking starts as a message. This is the real console, on the live service." },
      { to: "t1-send", text: "Anna gives everything in one go — two guests, three nights from October seventeenth, one room, both of them diving, and a ride from the airport." },
      { to: "t1-reply", text: "Watch what comes back." },
      { to: "end", text: "One message in, one complete enquiry out. Every detail read back, and a person still confirms the price." },
    ],
  },
  {
    id: "3guests",
    title: "Three guests",
    roll: "Scenario 2 · three friends",
    cues: [
      { to: "t1-type-start", text: "Same assistant, a different shape of booking." },
      { to: "t1-send", text: "Lucia writes for three people — two rooms, full board, and only two of them dive. She names the days she wants to dive, and asks for the airport pickup." },
      { to: "t1-reply", text: "Three guests, two divers. Those are different numbers, and the system keeps them apart." },
      { to: "end", text: "Nothing to chase and nothing invented. The diving is priced from two people, not three." },
    ],
  },
  {
    id: "10guests",
    title: "Ten guests, a dive club",
    roll: "Scenario 3 · partner agency",
    cues: [
      { to: "t1-type-start", text: "Now the hard one. A dive club books for a group." },
      { to: "t1-send", text: "Marco needs five twin rooms for ten guests, four nights, full board, and airport transfer from Manila." },
      { to: "t1-reply", text: "Six fields from one message. All it asks back is about the diving." },
      { to: "t2-type-start", text: "The group does not dive on the same days." },
      { to: "t2-send", text: "Six dive for four days, the other four dive for two — and he asks about their partner rate." },
      { to: "t2-reply", text: "No single number describes that, so the assistant keeps his own words as the schedule instead of inventing one." },
      { to: "end", text: "The partner rate is routed to your team, never quoted by the assistant. That is the whole idea: the conversation is instant, and every decision about money stays with your people." },
    ],
  },
];

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

function wrap(text, width = 68) {
  const words = text.split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) { out.push(line.trim()); line = w; }
    else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out.join("\n");
}

function tts(text) {
  const key = createHash("sha1").update(`${VOICE}|${VOICE_RATE}|${text}`).digest("hex").slice(0, 16);
  const file = path.join(TMP, `${key}.mp3`);
  if (!fs.existsSync(file)) {
    execFileSync(EDGE_TTS, ["--voice", VOICE, `--rate=${VOICE_RATE}`, "--text", text, "--write-media", file], { stdio: "ignore" });
  }
  const seconds = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
  return { file, seconds };
}

function duration(p) {
  return Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], { encoding: "utf8" }).trim());
}

// ---- build the audio track and srt -------------------------------------------------
const timeline = [];
let offset = 0;
const clips = [];

for (const seg of SEGMENTS) {
  const timingFile = path.resolve(`docs/.live-scenarios-tmp/${seg.id}/timing.json`);
  const timing = JSON.parse(fs.readFileSync(timingFile, "utf8"));
  const clip = path.resolve("docs", `casa-live-${seg.id}-demo.mp4`);
  const clipDur = duration(clip);
  if (clipDur > timing.durationMs / 1000 + 0.5) {
    console.log(`  [note] ${seg.id}: clip ${clipDur.toFixed(1)}s longer than marks ${(timing.durationMs / 1000).toFixed(1)}s`);
  }
  const marks = new Map(timing.marks.map((m) => [m.name, m.atMs / 1000]));
  const placements = [];

  for (const cue of seg.cues) {
    const endTarget = marks.get(cue.to) ?? clipDur;
    const startTarget = placements.length ? placements[placements.length - 1].endAbs : offset + 0.3;
    const available = Math.max(1.2, endTarget - (startTarget - offset));
    const { file, seconds } = tts(cue.text);
    // Speed up rather than clip if the sentence does not fit its window, and never
    // overrun the next cue's start.
    const atempo = seconds > available ? Math.min(2.0, seconds / available) : 1.0;
    placements.push({ cue, file, seconds, startAbs: startTarget, available, atempo, endAbs: startTarget + seconds / atempo });
  }

  // Lay the narration onto this clip's own timeline.
  const inputs = [];
  const filters = [];
  placements.forEach((p, i) => {
    inputs.push("-i", p.file);
    const chain = p.atempo !== 1 ? `atempo=${p.atempo.toFixed(3)},` : "";
    filters.push(`[${i + 1}:a]${chain}adelay=${Math.round(p.startAbs * 1000)}|${Math.round(p.startAbs * 1000)},volume=1.0[a${i}]`);
  });
  if (placements.length) {
    filters.push(`${placements.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placements.length}:normalize=0:dropout_transition=0[mix]`);
  }

  const segAudio = path.join(TMP, `${seg.id}-audio.m4a`);
  const args = ["-y", "-f", "lavfi", "-t", String(clipDur), "-i", "anullsrc=r=44100:cl=stereo"];
  if (placements.length) {
    args.push(...inputs, "-filter_complex", filters.join(";"), "-map", "[mix]");
  } else {
    args.push("-map", "0:a");
  }
  args.push("-t", String(clipDur), "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", segAudio);
  execFileSync(FFMPEG, args, { stdio: "ignore" });

  for (const p of placements) {
    timeline.push({
      start: offset + p.startAbs,
      end: offset + Math.min(clipDur - 0.2, p.endAbs),
      text: p.cue.text,
    });
  }
  // Carry the accumulated offset forward, and never let it exceed the real clip length.
  offset += clipDur;
  clips.push({ seg, clip, clipDur, audio: segAudio });
}

const total = offset;
const srt = timeline.map((t, i) => `${i + 1}\n${srtTime(t.start)} --> ${srtTime(Math.max(t.start + 0.6, t.end))}\n${wrap(t.text)}\n`).join("\n");
fs.writeFileSync(SRT_PATH, srt, "utf8");
console.log(`[narrate] ${timeline.length} cues, total ${total.toFixed(1)}s, srt -> ${SRT_PATH}`);

// ---- concatenate clips with their narration, then burn the subtitles ---------------
const inputs = [];
clips.forEach((c) => { inputs.push("-i", c.clip, "-i", c.audio); });
const labels = clips.map((_, i) => `[${i * 2}:v][${i * 2 + 1}:a]`).join("");
const concatFilter = `${labels}concat=n=${clips.length}:v=1:a=1[v][a]`;
const stitched = path.join(TMP, "stitched.mp4");
execFileSync(FFMPEG, [
  "-y", ...inputs,
  "-filter_complex", concatFilter,
  "-map", "[v]", "-map", "[a]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
  stitched,
], { stdio: "ignore" });

const esc = SRT_PATH.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
execFileSync(FFMPEG, [
  "-y", "-i", stitched,
  "-vf", `subtitles='${esc}':force_style='FontName=Arial,FontSize=19,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BorderStyle=3,Outline=2,Shadow=1,MarginV=48,Bold=1'`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-c:a", "copy", "-movflags", "+faststart",
  OUT_DOCS,
], { stdio: "ignore" });

fs.copyFileSync(OUT_DOCS, OUT_PUBLIC);
const stat = fs.statSync(OUT_DOCS);
console.log(`[narrate] wrote ${OUT_DOCS} (${(stat.size / 1048576).toFixed(2)} MB, ${duration(OUT_DOCS).toFixed(1)}s)`);
