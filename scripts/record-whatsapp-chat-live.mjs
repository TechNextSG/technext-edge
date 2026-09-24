import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const EDGE_TTS = "edge-tts";

const VIEW = { width: 1920, height: 1080 };
const TMP = path.resolve("docs/.live-whatsapp-tmp");
const STAGE_HTML = path.resolve("docs/stage-whatsapp-live.html");

const OUT_DOCS = path.resolve("docs/casa-whatsapp-conversation-demo.mp4");
const OUT_PUBLIC = path.resolve("public/casa-whatsapp-conversation-demo.mp4");
const OUT_SRT_DOCS = path.resolve("docs/casa-whatsapp-conversation-demo.srt");
const OUT_SRT_PUBLIC = path.resolve("public/casa-whatsapp-conversation-demo.srt");

fs.mkdirSync(TMP, { recursive: true });

function synthesizeNeuralAudio(text, outFile) {
  const dir = path.dirname(outFile);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(
    EDGE_TTS,
    [
      "--voice",
      "en-US-AvaMultilingualNeural",
      "--rate=-8%",
      "--text",
      text,
      "--write-media",
      outFile,
    ],
    { stdio: "ignore" }
  );
}

function getAudioDuration(mp3Path) {
  try {
    const res = execFileSync(
      FFMPEG,
      ["-i", mp3Path],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
    );
    const m = res.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (m) {
      return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : "";
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (m) {
      return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
    }
  }
  return 12.0;
}

class Cdp {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.buffer = "";
    this.pending = new Map();
    this.handlers = new Map();
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
        let m;
        try { m = JSON.parse(raw); } catch { continue; }
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (m.error) reject(new Error(m.error.message));
          else resolve(m.result);
        } else if (m.method && this.handlers.has(m.method)) {
          this.handlers.get(m.method)(m.params, m.sessionId);
        }
      }
    });
  }
  on(method, fn) { this.handlers.set(method, fn); }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writePipe.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatSrtTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

async function setPointers(cdp, sessionId, marks) {
  await cdp.send("Runtime.evaluate", {
    expression: `window.__showPointers(${JSON.stringify(marks)})`,
  }, sessionId);
}

async function clearPointers(cdp, sessionId) {
  await cdp.send("Runtime.evaluate", {
    expression: `window.__clearPointers()`,
  }, sessionId);
}

async function setSubtitle(cdp, sessionId, text) {
  await cdp.send("Runtime.evaluate", {
    expression: `window.__setSubtitle(${JSON.stringify(text)})`,
  }, sessionId);
}

async function animateTyping(cdp, sessionId, text, totalMs = 1800) {
  const stepMs = Math.round(totalMs / text.length);
  for (let i = 1; i <= text.length; i++) {
    const sub = text.slice(0, i);
    await cdp.send("Runtime.evaluate", {
      expression: `window.__typeMessage(${JSON.stringify(sub)})`,
    }, sessionId);
    await sleep(stepMs);
  }
}

const PHASES = [
  // 0. Overview
  {
    id: "wa-intro",
    title: "Casa Escondida WhatsApp Concierge — Overview",
    narration: "Welcome to the Casa Escondida WhatsApp Concierge. Running directly on the official WhatsApp Business Cloud API, our hybrid AI assistant handles multi-turn booking dialogues naturally across English, Vietnamese, and Chinese.",
    runLive: async (cdp, sessionId) => {
      await setPointers(cdp, sessionId, [
        { sel: "#wa-header", n: "1", label: "Official WhatsApp Cloud API (+1 555-150-6595)", pos: "below" },
        { sel: "#inspector-card", n: "2", label: "Real-time Neuro-Symbolic Trip State & Guardrails", pos: "below" },
        { sel: "#wa-input-row", n: "3", label: "Natural Conversational Chat Input", pos: "above" }
      ]);
      await sleep(6500);
      await clearPointers(cdp, sessionId);
      await sleep(800);
    }
  },

  // 1. Turn 1
  {
    id: "wa-turn-1",
    title: "WhatsApp Turn 1 — Booking Enquiry (Sarah Jenkins)",
    narration: "Sarah Jenkins sends an unstructured WhatsApp enquiry for four guests in two rooms. The assistant immediately locks the dates, rooms, and meals, and asks a single focused question about diving plans.",
    runLive: async (cdp, sessionId) => {
      await setPointers(cdp, sessionId, [
        { sel: "#wa-input-row", n: "➔", label: "Guest typing reservation enquiry...", pos: "above" }
      ]);
      const guestText = "Hi, I'm Sarah Jenkins. We'd like to book 2 Deluxe rooms for 4 guests checking in Oct 17, 2026 for 3 nights on full board.";
      await animateTyping(cdp, sessionId, guestText, 2200);
      await sleep(400);

      // Send guest message
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          window.__clearInput();
          window.__addGuestMessage(${JSON.stringify(guestText)}, "10:14 AM");
          window.__showTyping(true);
        })()`,
      }, sessionId);

      await sleep(1500);

      // Bot reply
      const botText = "Hello Sarah! Thanks for reaching out to Casa Escondida Anilao. I've noted 4 guests in 2 Deluxe rooms from Oct 17 to Oct 20 (3 nights) with full-board meals. Will anyone in your group be planning to dive during your stay?";
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          window.__showTyping(false);
          window.__addBotMessage(${JSON.stringify(botText)}, "10:14 AM");
          window.__updateSlots({
            name: { value: "Sarah Jenkins", state: "stated" },
            dates: { value: "Oct 17–20 (3 nights)", state: "stated" },
            guests: { value: "4 guests", state: "stated" },
            rooms: { value: "2 Deluxe rooms (Full Board)", state: "stated" },
          });
        })()`,
      }, sessionId);

      await setPointers(cdp, sessionId, [
        { sel: ".wa-row.bot:last-of-type", n: "AI", label: "AI locks dates & rooms, asks if diving", pos: "below" },
        { sel: "#slot-dates", n: "✓", label: "Slots captured without double-asking", pos: "below" }
      ]);
      await sleep(2200);
    }
  },

  // 2. Turn 2
  {
    id: "wa-turn-2",
    title: "WhatsApp Turn 2 — Diving Schedule & Airport Transfer",
    narration: "In the second turn, Sarah adds boat diving and Manila airport pickup. The assistant updates the trip state in memory and asks to confirm the exact diver headcount.",
    runLive: async (cdp, sessionId) => {
      await setPointers(cdp, sessionId, [
        { sel: "#wa-input-row", n: "➔", label: "Guest adds boat diving & airport transfer...", pos: "above" }
      ]);
      const guestText = "Yes, 2 of us will do boat diving from Oct 18 to Oct 19, and we need airport pickup from Manila.";
      await animateTyping(cdp, sessionId, guestText, 2000);
      await sleep(400);

      // Send guest message
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          window.__clearInput();
          window.__addGuestMessage(${JSON.stringify(guestText)}, "10:15 AM");
          window.__showTyping(true);
        })()`,
      }, sessionId);

      await sleep(1500);

      // Bot reply
      const botText = "Wonderful! I have added boat diving for Oct 18–19 and private NAIA airport van pickup. Could you please confirm how many people will be diving so we can reserve your dive gear and boat slots?";
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          window.__showTyping(false);
          window.__addBotMessage(${JSON.stringify(botText)}, "10:15 AM");
          window.__updateSlots({
            diving: { value: "Boat Diving (Oct 18–19)", state: "stated" },
            transfer: { value: "Manila NAIA Van Pickup", state: "stated" },
          });
        })()`,
      }, sessionId);

      await setPointers(cdp, sessionId, [
        { sel: ".wa-row.bot:last-of-type", n: "AI", label: "AI records diving & transfer, asks for diver count", pos: "below" },
        { sel: "#slot-diving", n: "✓", label: "Diving & Transfer slots updated in memory", pos: "below" }
      ]);
      await sleep(2200);
    }
  },

  // 3. Turn 3
  {
    id: "wa-turn-3",
    title: "WhatsApp Turn 3 — Confirmation & Front Desk Handover",
    narration: "Once Sarah confirms two divers and an eleven AM airport pickup, all eight required slots are satisfied. The assistant locks the trip state and routes the booking to staff for official quotation.",
    runLive: async (cdp, sessionId) => {
      await setPointers(cdp, sessionId, [
        { sel: "#wa-input-row", n: "➔", label: "Confirming 2 divers & pickup time...", pos: "above" }
      ]);
      const guestText = "Exactly 2 divers. Manila pickup for all 4 of us, arriving at 11 AM. Thanks!";
      await animateTyping(cdp, sessionId, guestText, 1800);
      await sleep(400);

      // Send guest message
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          window.__clearInput();
          window.__addGuestMessage(${JSON.stringify(guestText)}, "10:16 AM");
          window.__showTyping(true);
        })()`,
      }, sessionId);

      await sleep(1500);

      // Bot reply
      const botText = "Everything is set, Sarah! 4 guests in 2 Deluxe rooms (Oct 17–20, 3 nights), 2 divers on Oct 18–19, and Manila van transfer at 11 AM. I have locked your reservation details and notified our reservations desk to issue your official Odoo quotation shortly!";
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          window.__showTyping(false);
          window.__addBotMessage(${JSON.stringify(botText)}, "10:16 AM");
          window.__updateSlots({
            divers: { value: "2 divers (2 non-divers)", state: "stated" },
            transfer: { value: "Manila NAIA (11:00 AM)", state: "stated" },
            status: { value: "Completed · Ready for Odoo", state: "complete" },
            __complete: true
          });
        })()`,
      }, sessionId);

      await setPointers(cdp, sessionId, [
        { sel: ".wa-row.bot:last-of-type", n: "✓", label: "All 8 slots satisfied · Trip state locked", pos: "below" },
        { sel: "#trip-status-chip", n: "✓", label: "Handover gate triggered for staff quotation", pos: "below" }
      ]);
      await sleep(2600);
    }
  }
];

async function main() {
  console.log("=== STARTING WHATSAPP LIVE CONVERSATION DEMO RECORDING ===");

  // 1. Synthesize audio
  console.log("\n--- Phase 1: Synthesizing Neural Speech (AvaMultilingualNeural -8%) ---");
  for (let i = 0; i < PHASES.length; i++) {
    const p = PHASES[i];
    const mp3 = path.join(TMP, `cue-${i}-${p.id}.mp3`);
    synthesizeNeuralAudio(p.narration, mp3);
    p.audioPath = mp3;
    p.audioDuration = getAudioDuration(mp3);
    console.log(`  [Cue ${i + 1}/${PHASES.length}] ${p.id}: ${p.audioDuration.toFixed(1)}s`);
  }

  // 2. Launch Chrome CDP
  console.log("\n--- Phase 2: Launching Chrome CDP on WhatsApp Live Stage ---");
  const chrome = findChrome();
  const userDataDir = path.join(TMP, "chrome-prof");
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

  const cdp = new Cdp(child);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pageTarget = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });

  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false },
    sessionId
  );

  const stageUrl = pathToFileURL(STAGE_HTML).href;
  console.log(`  Navigating to stage: ${stageUrl}`);
  await cdp.send("Page.navigate", { url: stageUrl }, sessionId);
  await sleep(2000);

  // 3. Start Live Screencast
  console.log("\n--- Phase 3: Starting Page.startScreencast ---");
  const frames = [];
  const t0 = Date.now();
  cdp.on("Page.screencastFrame", (params, sid) => {
    frames.push({ atMs: Date.now() - t0, data: params.data });
    cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sid).catch(() => {});
  });
  await cdp.send(
    "Page.startScreencast",
    { format: "jpeg", quality: 90, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 },
    sessionId
  );

  // 4. Run Phases
  console.log("\n--- Phase 4: Executing Live Interactive WhatsApp Phases ---");
  const audioTimeline = [];

  for (let i = 0; i < PHASES.length; i++) {
    const p = PHASES[i];
    const phaseStartMs = Date.now() - t0;
    console.log(`\n---> [Live Step ${i + 1}/${PHASES.length}] ${p.title} (audio: ${p.audioDuration.toFixed(1)}s)`);

    await setSubtitle(cdp, sessionId, p.narration);

    audioTimeline.push({
      startSec: phaseStartMs / 1000,
      duration: p.audioDuration,
      audioPath: p.audioPath,
      narration: p.narration,
    });

    const actionStart = Date.now();
    await p.runLive(cdp, sessionId);
    const actionTook = (Date.now() - actionStart) / 1000;

    const remaining = Math.max(0, p.audioDuration - actionTook);
    if (remaining > 0) {
      await sleep(Math.round(remaining * 1000));
    }
    await clearPointers(cdp, sessionId);
  }

  // 5. Stop screencast
  console.log("\n--- Phase 5: Stopping Screencast & Flushing Frames ---");
  await sleep(1000);
  await cdp.send("Page.stopScreencast", {}, sessionId);
  child.kill();

  console.log(`  Total live frames captured: ${frames.length}`);
  const totalVideoSec = (Date.now() - t0) / 1000;
  console.log(`  Total live recording duration: ${totalVideoSec.toFixed(1)}s`);

  // Write SRT
  const srtEntries = [];
  for (let i = 0; i < audioTimeline.length; i++) {
    const a = audioTimeline[i];
    const startStr = formatSrtTime(a.startSec);
    const endStr = formatSrtTime(a.startSec + a.duration);
    srtEntries.push(`${i + 1}\n${startStr} --> ${endStr}\n${a.narration}\n`);
  }
  const srtContent = srtEntries.join("\n");
  fs.writeFileSync(OUT_SRT_DOCS, srtContent, "utf8");
  fs.writeFileSync(OUT_SRT_PUBLIC, srtContent, "utf8");

  // 6. Encode Frames into Silent MP4
  console.log("\n--- Phase 6: Encoding Video Frames with FFmpeg ---");
  const framesDir = path.join(TMP, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const frameFiles = [];
  for (let i = 0; i < frames.length; i++) {
    const fPath = path.join(framesDir, `f_${String(i).padStart(6, "0")}.jpg`);
    fs.writeFileSync(fPath, Buffer.from(frames[i].data, "base64"));
    frameFiles.push(fPath);
  }

  const listTxt = path.join(TMP, "concat_frames.txt");
  const listLines = [];
  for (let i = 0; i < frames.length; i++) {
    listLines.push(`file '${frameFiles[i].replace(/\\/g, "/")}'`);
    const nextMs = frames[i + 1] ? frames[i + 1].atMs : frames[i].atMs + 500;
    const durSec = Math.max(0.02, (nextMs - frames[i].atMs) / 1000);
    listLines.push(`duration ${durSec.toFixed(4)}`);
  }
  listLines.push(`file '${frameFiles[frames.length - 1].replace(/\\/g, "/")}'`);
  fs.writeFileSync(listTxt, listLines.join("\n"), "utf8");

  const silentMp4 = path.join(TMP, "screencast_silent.mp4");
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listTxt,
      "-fps_mode",
      "vfr",
      "-vf",
      `scale=${VIEW.width}:${VIEW.height}:force_original_aspect_ratio=decrease,pad=${VIEW.width}:${VIEW.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      silentMp4,
    ],
    { stdio: "inherit" }
  );

  // 7. Build Audio Track
  console.log("\n--- Phase 7: Building Audio Track Synced to Live Timeline ---");
  const audioInputs = [];
  const filterParts = [];
  for (let i = 0; i < audioTimeline.length; i++) {
    const a = audioTimeline[i];
    audioInputs.push("-i", a.audioPath);
    const delayMs = Math.round(a.startSec * 1000);
    filterParts.push(`[${i}:a]adelay=${delayMs}|${delayMs}[a${i}]`);
  }
  const mixLabels = audioTimeline.map((_, i) => `[a${i}]`).join("");
  const audioFilter = `${filterParts.join(";")};${mixLabels}amix=inputs=${audioTimeline.length}:dropout_transition=0:normalize=0[aout]`;

  const mixedAudioM4a = path.join(TMP, "mixed_narration.m4a");
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
      mixedAudioM4a,
    ],
    { stdio: "inherit" }
  );

  // 8. Combine Video + Audio
  console.log("\n--- Phase 8: Muxing Live Video + Synced Audio into Final MP4 ---");
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-i",
      silentMp4,
      "-i",
      mixedAudioM4a,
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      OUT_DOCS,
    ],
    { stdio: "inherit" }
  );

  fs.copyFileSync(OUT_DOCS, OUT_PUBLIC);

  console.log(`\n=== SUCCESS! WHATSAPP LIVE CONVERSATION DEMO VIDEO CREATED ===`);
  console.log(`  - Video Docs: ${OUT_DOCS}`);
  console.log(`  - Video Public: ${OUT_PUBLIC}`);
  console.log(`  - Subtitles Docs: ${OUT_SRT_DOCS}`);
  console.log(`  - Subtitles Public: ${OUT_SRT_PUBLIC}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
