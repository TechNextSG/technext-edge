// Adds narration and small subtitles to the two-mode screen capture.
//
// Every cue is pinned to an ACTION MARK the recorder wrote (typing starts, send is
// clicked, the reply lands, the tab switches, the result card appears), so the voice
// describes what is on screen at that instant and the subtitle sits exactly under the
// action it belongs to. Windows are bounded by the next mark, so a cue can never run
// past the action it describes — a sentence that does not fit is sped up rather than
// allowed to overlap the next one.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const FFPROBE = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe";
const EDGE_TTS = "edge-tts";

const VOICE = "en-US-AvaMultilingualNeural";
const VOICE_RATE = "-8%";
// Smaller than the earlier cut (was 19): the console is legible on its own, so the
// subtitle only needs to carry the narration, not dominate the frame.
const SUBTITLE_FONT_SIZE = 15;
const SUBTITLE_MARGIN_V = 42;

const TMP = path.resolve("docs/.two-modes-tmp/narrated");
fs.mkdirSync(TMP, { recursive: true });

const VIDEO = path.resolve("docs/casa-two-modes-live-demo.mp4");
const TIMING = path.resolve("docs/.two-modes-tmp/timing.json");
const OUT_DOCS = path.resolve("docs/casa-two-modes-narrated.mp4");
const OUT_PUBLIC = path.resolve("public/casa-two-modes-narrated.mp4");
const SRT_PATH = path.resolve("docs/demo-video/two-modes.en.srt");

// `to` is the mark this cue must finish before — i.e. the cue describes the action that
// ENDS at that mark. Text is kept short enough to be spoken inside its own window at this
// voice's natural pace (~15.5 characters/second at -8%), so nothing has to be sped up into
// unintelligibility.
//
// PART A deliberately narrates the enquiry GROWING: the guest opens with almost nothing,
// and each turn's cue names what is still missing until the last one closes it.
const CUES = [
  // --- Part A: chat mode, incomplete -> complete ---
  { to: "A-t1-typing", text: "This is the booking assistant, running live. Chat mode — and the guest opens with almost nothing." },
  { to: "A-t1-send", text: "Just: we would like to book a room." },
  { to: "A-t2-select", text: "So the assistant asks for what it does not have yet — the date, the nights, how many guests, a name." },
  { to: "A-t2-typing", text: "The guest adds two of them." },
  { to: "A-t2-send", text: "Two people, from October seventeenth, for three nights." },
  { to: "A-t3-select", text: "Now it can work out the check-out, the room and the meal plan itself. Only two things are still missing: diving, and a name." },
  { to: "A-t3-typing", text: "Yes to diving, one room." },
  { to: "A-t3-send", text: "Notice the room count is one — the guest's own answer, not a guess." },
  { to: "A-t4-select", text: "One left." },
  { to: "A-t4-typing", text: "A name, and the airport pickup." },
  { to: "A-t4-send", text: "That answer also settles the transfer, so nothing more is owed." },
  { to: "A-done", text: "Four turns, and the enquiry is complete — every figure read back, and it never asked twice for anything the guest had already said." },

  // --- Part B: single message mode, three cases ---
  { to: "B-single-tab", text: "Now the other mode." },
  { to: "B-c1-select", text: "Single message — three cases in a row." },
  { to: "B-c1-typing", text: "Case one: three guests, two of them divers." },
  { to: "B-c1-extract", text: "Extract reads the whole message at once." },
  { to: "B-c1-result", text: "Every field filled, each with the exact words the guest used as evidence." },
  { to: "B-c2-select", text: "Case two." },
  { to: "B-c2-typing", text: "A dive club: ten guests, five rooms, and a split schedule — six people dive four days, four dive two." },
  { to: "B-c2-extract", text: "Plus a partner rate request, which is not the assistant's to answer." },
  { to: "B-c2-result", text: "The split schedule is kept whole, and the partner rate is routed to the reservations team." },
  { to: "B-c3-select", text: "Case three." },
  { to: "B-c3-typing", text: "A family of four, where only two dive." },
  { to: "B-c3-extract", text: "Guest count and diver count are different numbers, and the dive line is priced per head." },
  { to: "B-c3-result", text: "Four guests, two divers, and the two children noted as snorkelling." },
  { to: "end", text: "Both modes end the same way: nothing is booked, and no price is quoted. The assistant handles the conversation; your team makes every call about money." },
];

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

function wrap(text, width = 62) {
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

const timing = JSON.parse(fs.readFileSync(TIMING, "utf8"));
const marks = new Map(timing.marks.map((m) => [m.name, m.atMs / 1000]));
const videoDur = duration(VIDEO);

// 3 seconds of held opening frame, so the introduction has room to be spoken at a normal
// pace before the first action. Without it the intro had 1.4s and had to be sped up 2.2x.
const PREROLL = 3.0;
const totalDur = videoDur + PREROLL;
console.log(`[narrate] video ${videoDur.toFixed(1)}s + ${PREROLL}s preroll = ${totalDur.toFixed(1)}s, ${marks.size} action marks`);

// Lay each cue so that it ENDS at the action mark it describes.
//
// Chaining cues end-to-end (the previous approach) stretched every sentence across its
// whole window, which pushed the voice far away from the action it was talking about and
// left the video's many wait-for-the-model stretches out of step with the narration.
// Anchoring the end instead keeps the words landing as the thing happens.
//
// Back-to-back actions (typing, then send) simply butt up against each other; a long
// window before an action becomes deliberate silence, which is the honest place for it —
// that is the turn waiting on the model, not something to paper over with words.
const placed = [];
for (let i = 0; i < CUES.length; i++) {
  const cue = CUES[i];
  const markSec = (marks.get(cue.to) ?? videoDur) + PREROLL;
  const { file, seconds } = tts(cue.text);
  const spoken = seconds;

  // Prefer ending exactly at the mark; never start before the previous cue's end.
  let start = Math.max(0.4, markSec - spoken);
  const prevEnd = placed.length ? placed[placed.length - 1].end : 0;
  if (start < prevEnd) start = prevEnd;

  // If the shift would push the cue past the NEXT action's mark, compress it to fit
  // instead — a slightly quicker read is better than narration describing the wrong beat.
  const nextMark = i + 1 < CUES.length ? (marks.get(CUES[i + 1].to) ?? videoDur) + PREROLL : totalDur;
  const room = nextMark - start;
  const atempo = room < spoken ? Math.min(2.0, spoken / Math.max(0.3, room)) : 1.0;
  const end = start + spoken / atempo;

  const gapBefore = start - prevEnd;
  const flag = atempo > 1.15 ? "  <-- tightened" : gapBefore > 6 ? `  (silent ${gapBefore.toFixed(1)}s before)` : "";
  console.log(`  ${cue.to.padEnd(16)} ${start.toFixed(1)}→${end.toFixed(1)}s (mark ${markSec.toFixed(1)})${flag}`);
  placed.push({ cue, file, seconds, start, end, atempo });
}

// ---------- audio track ----------
// Built to the FULL length (video + preroll) with an explicit silence pad at the end, so
// the mux never has to choose between the two streams. An earlier attempt relied on
// -shortest and silently dropped the last four seconds of narration, because setpts on a
// tpad-extended video produced a stream shorter than the audio.
const inputs = [];
const filters = [];
let mixIndex = 0;
for (const p of placed) {
  if (!p.file) continue;
  inputs.push("-i", p.file);
  const chain = p.atempo !== 1 ? `atempo=${p.atempo.toFixed(3)},` : "";
  const delayMs = Math.round(p.start * 1000);
  filters.push(`[${mixIndex + 1}:a]${chain}adelay=${delayMs}|${delayMs}[a${mixIndex}]`);
  mixIndex++;
}
const audioOut = path.join(TMP, "narration.m4a");
const args = ["-y", "-f", "lavfi", "-t", String(totalDur), "-i", "anullsrc=r=44100:cl=stereo"];
if (mixIndex > 0) {
  // apad is required: amix stops when its longest input ends, which is the last cue, so
  // without it the track came out ~1s short of the video and the mux had to choose.
  args.push(
    ...inputs,
    "-filter_complex",
    `${filters.join(";")};${Array.from({ length: mixIndex }, (_, i) => `[a${i}]`).join("")}amix=inputs=${mixIndex}:normalize=0:dropout_transition=0,apad=whole_dur=${totalDur}[mix]`,
    "-map", "[mix]",
  );
} else {
  args.push("-map", "0:a");
}
args.push("-t", String(totalDur), "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", audioOut);
execFileSync(FFMPEG, args, { stdio: "ignore" });
const audioDur = duration(audioOut);
console.log(`[narrate] ${mixIndex} cues mixed; audio ${audioDur.toFixed(1)}s (target ${totalDur.toFixed(1)}s)`);
if (Math.abs(audioDur - totalDur) > 0.5) {
  throw new Error(`narration track is ${audioDur.toFixed(1)}s but the video needs ${totalDur.toFixed(1)}s`);
}

// ---------- subtitles ----------
// Each cue's subtitle runs exactly as long as its own spoken audio: start at the cue's
// start and end at start + audioDuration/atempo, NOT a fraction of a second earlier. The
// earlier 0.06s trim left a visible gap where no subtitle was on screen at each cue
// boundary, which reads as the text lagging the voice. The next cue's start is a hard
// ceiling so two subtitles can never be on screen at once.
const lines = [];
let n = 1;
for (let i = 0; i < placed.length; i++) {
  const p = placed[i];
  if (!p.cue.text) continue;
  const spoken = p.seconds / p.atempo;
  const nextStart = placed[i + 1] ? placed[i + 1].start : totalDur;
  const end = Math.min(p.start + spoken, nextStart);
  lines.push(`${n++}\n${srtTime(p.start)} --> ${srtTime(Math.max(p.start + 0.4, end))}\n${wrap(p.cue.text)}\n`);
}
fs.writeFileSync(SRT_PATH, lines.join("\n"), "utf8");
console.log(`[narrate] ${lines.length} subtitle cues -> ${SRT_PATH}`);

// ---------- mux + burn ----------
// The video is held on its first frame for PREROLL so the opening narration has room;
// subtitles are already laid out on the PREROLL-shifted clock. No -shortest: the audio is
// exactly totalDur and -t caps the held video at the same point.
const esc = SRT_PATH.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
execFileSync(FFMPEG, [
  "-y", "-i", VIDEO, "-i", audioOut,
  "-vf", `tpad=start_duration=${PREROLL}:start_mode=clone,setpts=PTS+${PREROLL}/TB,subtitles='${esc}':force_style='FontName=Arial,FontSize=${SUBTITLE_FONT_SIZE},PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BorderStyle=3,Outline=1,Shadow=0,MarginV=${SUBTITLE_MARGIN_V},Bold=0'`,
  "-map", "0:v", "-map", "1:a",
  "-t", String(totalDur),
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
  OUT_DOCS,
], { stdio: "ignore" });

fs.copyFileSync(OUT_DOCS, OUT_PUBLIC);
console.log(`[narrate] wrote ${OUT_DOCS} (${(fs.statSync(OUT_DOCS).size / 1048576).toFixed(2)} MB, ${duration(OUT_DOCS).toFixed(1)}s)`);
