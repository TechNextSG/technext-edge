// Builds the two customer-facing demo videos:
//   VIDEO 1 (web)      -> docs/casa-web-console-demo.mp4      (demo-theatre steps 0-3)
//   VIDEO 2 (whatsapp)  -> docs/casa-whatsapp-conversation-demo.mp4 (demo-theatre steps 4-7)
//
// Why this exists next to scripts/record-demo-video.mjs:
//   - that script narrates with PowerShell System.Speech ("Microsoft Zira"), which
//     is the robotic voice the customer videos were meant to replace;
//   - it produces ONE video; the customer deliverable is two (web / WhatsApp);
//   - it burns no subtitles (customers watch muted).
//
// It still reuses the same proven stage: docs/demo-theatre.html?manual=1 plus the
// deterministic window.__setDemoStep(idx, label) hook the theatre exposes for
// exactly this purpose.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const FFPROBE = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe";
const EDGE_TTS = "edge-tts";

// Voice: identified against docs/demo-video/voice-samples/2-new-script-female.mp3
// (the sample the team picked). Pitch profile of that file: median F0 200.0 Hz,
// IQR 181.8-231.9 Hz. AvaMultilingual reproduced it closest at the rate that
// matched the sample's 38.65s runtime (38.14s at -8%).
const VOICE = "en-US-AvaMultilingualNeural";
const VOICE_RATE = "-8%";

const HTML_PATH = path.resolve("docs/demo-theatre.html");
const TMP_DIR = path.resolve("docs/.two-videos-tmp");

fs.mkdirSync(TMP_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Narration. `step` indexes docs/demo-theatre.html's `steps` array verbatim.
// Each cue is one sentence so the SRT has an honest one-line-per-cue grid.
// ---------------------------------------------------------------------------
const VIDEOS = [
  {
    id: "web",
    clean: true,
    outDocs: path.resolve("docs/casa-web-console-demo.mp4"),
    outPublic: path.resolve("public/casa-web-console-demo.mp4"),
    header: "VIDEO 1/2 · WEB CONSOLE (guest self-service)",
    accent: "#14b8a6",
    steps: [
      {
        step: 0,
        cues: [
          "Every booking starts as a message. On the web console, a guest writes the way people actually write.",
          "Alex describes six guests, four divers and two non-divers, arriving November fifteenth — and stops there.",
          "No form. No fields to fill in. Just what he happened to say.",
        ],
      },
      {
        step: 1,
        cues: [
          "Watch what comes back.",
          "Every fact Alex stated is already recorded — his name, the date, all six guests, and which four of them dive.",
          "So the assistant asks only for what is genuinely missing: how many nights, how many rooms, and which dates the divers dive.",
          "It never asks him to repeat something he already said.",
        ],
      },
      {
        step: 2,
        cues: [
          "Alex fills in the gaps in one sentence — three nights, three rooms, full board, diving on the sixteenth and seventeenth.",
        ],
      },
      {
        step: 3,
        cues: [
          "All six booking details are now confirmed.",
          "The assistant reads them back so Alex can check every figure himself.",
          "And notice what it does not do: it quotes no price, and it confirms nothing as booked.",
          "It says plainly that someone from the team will follow up to confirm availability and pricing.",
          "That is the whole idea. The assistant handles the conversation; your team still makes every call about money.",
        ],
      },
    ],
  },
  {
    id: "whatsapp",
    clean: true,
    outDocs: path.resolve("docs/casa-whatsapp-conversation-demo.mp4"),
    outPublic: path.resolve("public/casa-whatsapp-conversation-demo.mp4"),
    header: "VIDEO 2/2 · REAL WHATSAPP (official Casa Escondida number)",
    accent: "#25d366",
    steps: [
      {
        step: 4,
        cues: [
          "The same assistant on real WhatsApp, on Casa Escondida's own business number.",
          "A guest books ten people for four nights in five twin rooms, with full-board meals.",
          "The assistant confirms every one of those details — and asks only about the diving.",
        ],
      },
      {
        step: 5,
        cues: [
          "Guests rarely write it neatly, and they mix things together.",
          "Here, three guests are staying overnight and three are only visiting for the day.",
          "The assistant keeps those apart — it does not inflate the booking to six — and records a custom diving schedule where one person dives one day and five dive both days.",
        ],
      },
      {
        step: 6,
        cues: [
          "Plans change mid-conversation too.",
          "In the same thread, the group drops from ten guests to eight, and the diving splits into two groups with different schedules.",
          "The guest also asks about a partner rate.",
        ],
      },
      {
        step: 7,
        cues: [
          "The assistant recalculates on the spot: eight guests, four twin rooms, both diving groups recorded correctly.",
          "And notice what it refuses to do. It does not quote a price. It does not promise the discount.",
          "It routes the partner rate and the custom diving schedule to your reservation team, and says so plainly.",
          "That is how the guest gets a fast, warm answer — while every decision about money stays with your people.",
          "Casa Escondida, built by TechNext Edge.",
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Cue audio cache. Keyed by voice + rate + text, so changing either regenerates
// instead of silently reusing audio spoken by a different voice.
import { createHash } from "node:crypto";

function synthesizeCue(text, mp3Path) {
  const key = createHash("sha1").update(`${VOICE}|${VOICE_RATE}|${text}`).digest("hex").slice(0, 16);
  const cached = path.join(TMP_DIR, "cue-cache", `${key}.mp3`);
  fs.mkdirSync(path.dirname(cached), { recursive: true });

  if (!fs.existsSync(cached)) {
    execFileSync(
      EDGE_TTS,
      ["--voice", VOICE, `--rate=${VOICE_RATE}`, "--text", text, "--write-media", cached],
      { stdio: "ignore" },
    );
  }
  fs.copyFileSync(cached, mp3Path);

  const seconds = Number(
    execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3Path], {
      encoding: "utf8",
    }).trim(),
  );
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`could not read duration of ${mp3Path}`);
  }
  return seconds;
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const mm = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${mm}`;
}

function wrap(text, width = 68) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else {
      line += " " + w;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
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

/**
 * Films the stage rather than the tool: strips the interactive chrome and, most
 * importantly, crops the real WhatsApp Web sidebar off the capture.
 *
 * The captures in public/demo-captures/ are full WhatsApp Web screenshots, and the
 * sidebar carries real contact names and phone numbers from the account they were
 * taken on. A customer-facing video must not ship those, so the left 36% of the
 * image is cropped away and only the conversation is shown.
 */
function ensureStageCss(video) {
  const isWa = video.id === "whatsapp";
  return `(() => {
    const st = document.createElement('style');
    st.id = 'rec-css';
    st.textContent = \`
      /* tool chrome: not part of the product story */
      .btn-play, .btn-secondary, .dot-row, .cc-badge { display: none !important; }

      /* the theatre's own bottom caption bar duplicates the burned-in subtitle */
      .subtitle-bar { display: none !important; }

      /* privacy: the real WhatsApp Web sidebar holds live contacts + phone numbers.
         The image itself is NOT cropped by CSS here — cropWaSidebar() below measures
         the element and applies a numeric transform, because object-fit:cover crops
         by whatever the aspect-ratio gap happens to be, which is not a measured
         boundary. */
      #wa-real-img { object-fit: fill !important; object-position: 0 0 !important; }

      /* breathing room where the burned-in subtitle lands */
      body { padding-bottom: ${isWa ? "150px" : "140px"} !important; }

      ${video.clean ? `
      /* CUSTOMER-FACING CUT: strip the QA/QC instrumentation.
         These are engineering artefacts — a step counter, an endpoint tag
         (POST /v1/converse), latency figures and guardrail names like
         "NEVER RE-ASK" / "Symbolic Math Reconciler" — and they read as an
         internal test harness rather than a product a guest would use.
         The structured-state inspector is KEPT on purpose: watching the bot fill
         in facts is the product's value, not test scaffolding. */
      .qa-top-banner,
      .endpoint-tag,
      .qa-mark-tag,
      .qa-rect-overlay { display: none !important; }

      /* the red outlines addQaMark() draws directly on elements */
      [data-qa-outline] { outline: none !important; }
      ` : ""}

      ${isWa ? `
      /* VIDEO 2 is the WhatsApp story: the web console half is a distraction, so the
         split workspace becomes a single centered column. (.workspace is a 2-column
         grid; the panels are the grid items, so the columns are what to change.) */
      .workspace {
        grid-template-columns: 1fr !important;
        padding-left: 260px !important;
        padding-right: 260px !important;
      }
      #web-panel-box, .web-panel { display: none !important; }
      .wa-real-stage, #wa-real-stage {
        border-radius: 20px !important;
      }
      .wa-header { padding: 14px 20px !important; }
      .wa-name { font-size: 15px !important; }
      .wa-status { font-size: 12px !important; }
      ` : `
      /* VIDEO 1 is the Web Console story: keep both halves but label the split. */
      .workspace { grid-template-columns: 58% 42% !important; }
      `}
    \`;
    document.head.appendChild(st);
    return 'css-ready';
  })()`;
}

// Measured against every capture in public/demo-captures (see the boundary probe
// kept alongside this build): WhatsApp Web's chat list ends at 38.2% of the image
// width, identically on all five frames. Cropping at 38.8% also takes the divider.
const WA_SIDEBAR_FRACTION = 0.388;

/**
 * Removes the QA/QC instrumentation outright.
 *
 * `display: none` was tried twice and the banner still reached the final video, so
 * this deletes the nodes instead of hiding them: a removed element cannot be shown
 * again by a later class change or a re-render, and setQaBanner() writing textContent
 * into a detached node is a harmless no-op.
 *
 * Every selector is re-queried per step because the theatre creates fresh callout
 * marks for each step.
 */
function stripQaChrome() {
  return `(() => {
    // The .topbar element (brand + LIVE DEMO badge + scene pill) is the bar actually
    // visible at the top of the frame. .qa-top-banner is a separate, taller bar
    // stacked above it. Removing only the latter — as earlier revisions did — left
    // the topbar on screen, which is what kept reaching the "clean" cut.
    // NOTE: no backticks in this comment; the whole expression is a template literal.
    const selectors = [
      '.qa-top-banner',
      '.topbar',
      '.brand',
      '.dot-row',
      '.cc-badge',
      '.endpoint-tag',
      '.qa-mark-tag',
      '.qa-rect-overlay',
      '.subtitle-bar',
      '.btn-play',
      '.btn-secondary',
    ];
    let n = 0;
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => { el.remove(); n++; });
    }
    // Red outlines are applied straight onto elements by addQaMark().
    document.querySelectorAll('[data-qa-outline]').forEach((el) => {
      el.style.setProperty('outline', 'none', 'important');
      el.style.setProperty('outline-offset', '0', 'important');
    });
    // Report what is left, so the recorder can fail loudly instead of shipping a
    // frame with test chrome on it.
    const leftover = document.querySelectorAll('.qa-top-banner, .topbar').length;
    return 'removed:' + n + ' chromeLeft:' + leftover;
  })()`;
}

/**
 * Scales the capture so only the conversation pane fills the stage, and shifts the
 * sidebar off to the left. Numeric, so it lands on the measured boundary rather
 * than on an aspect-ratio accident.
 */
function cropWaSidebar(fraction = WA_SIDEBAR_FRACTION) {
  return `(() => {
    const img = document.getElementById('wa-real-img');
    if (!img) return 'no-img';
    const stage = img.parentElement;
    const apply = () => {
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      const iw = img.clientWidth;
      const ih = img.clientHeight;
      if (!sw || !sh || !iw || !ih) return;
      const scale = sw / (iw * (1 - ${fraction}));
      img.style.transformOrigin = '0 0';
      img.style.transform = 'translateX(' + (-${fraction} * iw * scale) + 'px) scale(' + scale + ')';
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
    apply();
    return 'cropped';
  })()`;
}

function encodeSegment(framePng, audioMp3, durationSec, segMp4) {
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-loop", "1",
      "-i", framePng,
      "-i", audioMp3,
      "-t", String(durationSec),
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-r", "24",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "44100",
      "-ac", "2",
      "-shortest",
      segMp4,
    ],
    { stdio: "ignore" },
  );
}

function concatSegments(segmentFiles, outMp4) {
  const listPath = path.join(TMP_DIR, `concat-${path.basename(outMp4)}.txt`);
  fs.writeFileSync(listPath, segmentFiles.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  execFileSync(
    FFMPEG,
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outMp4],
    { stdio: "ignore" },
  );
}

/** Hard-burn the SRT so the video is readable with the sound off. */
function burnSubtitles(inMp4, srtPath, outMp4) {
  // subtitles filter needs an escaped, forward-slashed absolute path on Windows.
  const esc = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-i", inMp4,
      "-vf",
      `subtitles='${esc}':force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BorderStyle=3,Outline=2,Shadow=1,MarginV=118,Bold=1'`,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outMp4,
    ],
    { stdio: "ignore" },
  );
}

async function main() {
  console.log(`[build] voice=${VOICE} rate=${VOICE_RATE}`);

  // ---- 1. Synthesize every cue up front so the on-screen step can be sized to it.
  for (const video of VIDEOS) {
    console.log(`\n[build] === VIDEO "${video.id}" ===`);
    for (const stepDef of video.steps) {
      stepDef.cueFiles = [];
      stepDef.cueDur = [];
      for (let c = 0; c < stepDef.cues.length; c++) {
        const mp3 = path.join(TMP_DIR, `${video.id}-s${stepDef.step}-c${c}.mp3`);
        const dur = synthesizeCue(stepDef.cues[c], mp3);
        stepDef.cueFiles.push(mp3);
        stepDef.cueDur.push(dur);
      }
      stepDef.total = stepDef.cueDur.reduce((a, b) => a + b, 0);
      console.log(
        `  step ${stepDef.step}: ${stepDef.cues.length} cue(s), ${stepDef.total.toFixed(2)}s total`,
      );
    }
    video.grandTotal = video.steps.reduce((a, s) => a + s.total, 0);
    console.log(`  total runtime: ${video.grandTotal.toFixed(1)}s`);
  }

  // ---- 2. Launch Chrome once and drive the theatre stage.
  const chrome = findChrome();
  if (!chrome) throw new Error("Could not find Chrome executable");
  const userDataDir = path.join(TMP_DIR, "chrome-profile");
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
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] },
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
    sessionId,
  );

  // ?manual=1 keeps the theatre's own timers (and its browser TTS) off, so steps
  // advance only when this script says so.
  // Cache-bust: Chrome caches file:// documents by URL and this profile is reused
  // between runs, so a plain path can render a stale copy of the theatre.
  await cdp.send("Page.navigate", { url: pathToFileURL(HTML_PATH).href + "?manual=1&run=" + Date.now() }, sessionId);
  await new Promise((r) => setTimeout(r, 1500));

  // Relabel the on-screen badge, and silence the theatre's speechSynthesis in case
  // anything triggers it — the voice in the finished file is the edge-tts one only.
  await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        window.speechSynthesis && window.speechSynthesis.cancel();
        try { Object.defineProperty(window, 'speechSynthesis', { value: { speak(){}, cancel(){} } }); } catch (e) {}
        return 'ok';
      })()`,
    },
    sessionId,
  );

  for (const video of VIDEOS) {
    console.log(`\n[build] recording video "${video.id}"`);

    // Restyle for this video before the first frame is captured.
    await cdp.send("Runtime.evaluate", { expression: ensureStageCss(video) }, sessionId);
    await new Promise((r) => setTimeout(r, 350));

    const segments = [];
    const srtLines = [];
    let elapsed = 0;
    let cueIndex = 1;

    for (const stepDef of video.steps) {
      const label = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(Math.round(elapsed) % 60).padStart(2, "0")} / ${String(Math.floor(video.grandTotal / 60)).padStart(2, "0")}:${String(Math.round(video.grandTotal) % 60).padStart(2, "0")}`;

      await cdp.send(
        "Runtime.evaluate",
        { expression: `window.__setDemoStep(${stepDef.step}, ${JSON.stringify(label)})` },
        sessionId,
      );
      // Keep the on-screen caption bar short — the full sentence is burned in as a
      // subtitle, and a second long copy on screen reads as clutter.
      await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const box = document.getElementById('subtitle-box');
            if (box) box.textContent = ${JSON.stringify(stepDef.cues[0])};
            return 'ok';
          })()`,
        },
        sessionId,
      );
      // The theatre staggers its QA callouts by 80ms; wait past that so the marks
      // are in the frame.
      await new Promise((r) => setTimeout(r, 900));

      // Crop the sidebar after the step has swapped the capture in, so the
      // transform is measured against the image actually on screen.
      const cropRes = await cdp.send("Runtime.evaluate", { expression: cropWaSidebar() }, sessionId);
      // Re-strip each step: the theatre creates fresh callout marks per step.
      let stripRes = "n/a";
      if (video.clean) {
        const r = await cdp.send("Runtime.evaluate", { expression: stripQaChrome() }, sessionId);
        stripRes = r?.result?.value ?? JSON.stringify(r);
      }
      console.log(`    step ${stepDef.step}: crop=${cropRes?.result?.value} strip=${stripRes}`);
      await new Promise((r) => setTimeout(r, 250));

      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      const framePng = path.join(TMP_DIR, `${video.id}-frame-${stepDef.step}.png`);
      fs.writeFileSync(framePng, Buffer.from(data, "base64"));

      // Concatenate this step's cues into one audio track for the segment.
      const stepAudio = path.join(TMP_DIR, `${video.id}-audio-${stepDef.step}.mp3`);
      if (stepDef.cueFiles.length === 1) {
        fs.copyFileSync(stepDef.cueFiles[0], stepAudio);
      } else {
        const cueList = path.join(TMP_DIR, `${video.id}-cues-${stepDef.step}.txt`);
        fs.writeFileSync(cueList, stepDef.cueFiles.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
        execFileSync(
          FFMPEG,
          ["-y", "-f", "concat", "-safe", "0", "-i", cueList, "-c", "copy", stepAudio],
          { stdio: "ignore" },
        );
      }

      const segMp4 = path.join(TMP_DIR, `${video.id}-seg-${stepDef.step}.mp4`);
      encodeSegment(framePng, stepAudio, stepDef.total, segMp4);
      segments.push(segMp4);

      // SRT: lay each cue onto the running clock by its own measured duration.
      let cueStart = elapsed;
      for (let c = 0; c < stepDef.cues.length; c++) {
        const cueEnd = cueStart + stepDef.cueDur[c];
        srtLines.push(
          `${cueIndex++}\n${srtTime(cueStart)} --> ${srtTime(Math.max(cueStart + 0.4, cueEnd - 0.08))}\n${wrap(stepDef.cues[c])}\n`,
        );
        cueStart = cueEnd;
      }

      elapsed += stepDef.total;
      console.log(`  step ${stepDef.step} -> ${stepDef.total.toFixed(2)}s`);
    }

    const silentMp4 = path.join(TMP_DIR, `${video.id}-silent-subs.mp4`);
    concatSegments(segments, silentMp4);

    const srtPath = path.resolve(`docs/demo-video/${video.id}.en.srt`);
    fs.writeFileSync(srtPath, srtLines.join("\n"), "utf8");
    console.log(`  subtitles: ${srtPath}`);

    const finalMp4 = path.join(TMP_DIR, `${video.id}-final.mp4`);
    burnSubtitles(silentMp4, srtPath, finalMp4);
    fs.copyFileSync(finalMp4, video.outDocs);
    fs.copyFileSync(finalMp4, video.outPublic);
    const size = fs.statSync(video.outDocs).size;
    console.log(`  written: ${video.outDocs} (${(size / 1048576).toFixed(1)} MB)`);
  }

  child.kill();
  console.log("\n[build] done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
