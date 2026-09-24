import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const TMP_DIR = path.resolve("docs/.two-demos-tmp");

const OUT_WEB_DOCS = path.resolve("docs/casa-web-single-message-demo.mp4");
const OUT_WEB_PUBLIC = path.resolve("public/casa-web-single-message-demo.mp4");

const OUT_WA_DOCS = path.resolve("docs/casa-whatsapp-live-demo.mp4");
const OUT_WA_PUBLIC = path.resolve("public/casa-whatsapp-live-demo.mp4");

// Also update the default demo MP4 so existing links point to the new neural-narrated video
const OUT_DEFAULT_DOCS = path.resolve("docs/casa-escondida-demo.mp4");
const OUT_DEFAULT_PUBLIC = path.resolve("public/casa-escondida-demo.mp4");

fs.mkdirSync(TMP_DIR, { recursive: true });

function synthesizeNeuralMp3(text, mp3Path, voice = "en-US-AndrewMultilingualNeural") {
  execFileSync(
    "edge-tts",
    [
      "--voice",
      voice,
      "--rate=+4%",
      "--text",
      text,
      "--write-media",
      mp3Path,
    ],
    { stdio: "ignore" }
  );
  // Probe exact audio duration with ffprobe/ffmpeg
  try {
    const out = execFileSync(
      FFMPEG,
      ["-i", mp3Path],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return 10;
  } catch (err) {
    const stderr = String(err.stderr || "");
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) {
      const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      return Math.max(6, Number((secs + 0.6).toFixed(2)));
    }
    return 10;
  }
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

function encodeSegment(framePng, audioMp3, durationSec, segMp4) {
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-loop",
      "1",
      "-i",
      framePng,
      "-i",
      audioMp3,
      "-t",
      String(durationSec),
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-r",
      "24",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-shortest",
      segMp4,
    ],
    { stdio: "ignore" }
  );
}

function concatSegments(segmentFiles, outMp4) {
  const concatListPath = path.join(TMP_DIR, `concat-${ path.basename(outMp4) }.txt`);
  fs.writeFileSync(
    concatListPath,
    segmentFiles.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n")
  );
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outMp4,
    ],
    { stdio: "ignore" }
  );
}

// ============================================================================
// VIDEO 1: WEB TEST CONSOLE — SINGLE MESSAGE MODE (3 ADVERSARIAL STRESS CASES)
// ============================================================================
const WEB_CASES = [
  {
    caseNum: 1,
    guestText:
      "Hi Casa Escondida! I am Dr. Elena Vance. We are booking 3 Deluxe Twin rooms for 6 overnight guests checking in October 15, 2026 for 4 nights (full-board meals, no airport transfer needed). Note that 4 local colleagues will drive down from Manila just to join us for lunch on Saturday—so 10 people at lunch, but only 6 sleeping at the resort! All 6 overnight guests are certified divers, but 4 of us will dive for 3 days (Oct 16–18) while the other 2 will only dive for 1 day (Oct 16).",
    stepInput: {
      stepNum: 1,
      bannerTitle: "Step 1 — Case 1 Input (Single Message Mode): Overnight (6) vs Day Visitors (4) + Split Dive",
      bannerSub: "POST /v1/extract · Long paragraph mixing 10 lunch attendees with 6 overnight guests & 3d/1d split diving",
      subtitle:
        "Case 1 Input: In Single Message mode, Dr. Elena Vance sends a complex paragraph mixing 6 overnight guests with 4 lunch-only visitors and a split diving schedule.",
      narration:
        "Welcome to the Web Single-Message Stress Test. In Case 1, Dr. Elena Vance submits a long paragraph mixing 6 overnight guests with 4 lunch-only day visitors—totaling 10 people at lunch—plus a split diving schedule where 4 divers dive for 3 days and 2 divers dive for only 1 day.",
    },
    stepOutput: {
      stepNum: 2,
      bannerTitle: "Step 2 — Case 1 Extracted JSON: Symbolic Math Separates 6 Staying Guests from 4 Day Visitors",
      bannerSub: "guests = 6 (not 10!) · rooms = 3 · nights = 4 · divers = 6 · Verbatim evidence & split dive preserved",
      subtitle:
        "Case 1 Result: The Extractor locks guests at 6 instead of 10, extracts all 9 fields with verbatim evidence, and flags zero missing questions.",
      narration:
        "Clicking Extract runs Dual-Pass extraction and the Symbolic Math Gate. Notice that guests is locked at 6 staying overnight—refusing to inflate the room count to 10—while all 9 booking fields are populated with verbatim evidence and zero follow-up questions are needed.",
    },
  },
  {
    caseNum: 2,
    guestText:
      "Hello, this is Marcus Tan from Singapore. Originally we wanted 6 rooms for 12 people starting November 20, 2026—wait, scratch that, 2 couples just cancelled this morning so our final headcount is 8 guests in 4 Twin rooms for 3 nights (Nov 20 to Nov 23) with full-board meals and Manila NAIA airport pickup. Out of the 8 guests, only 5 are divers (diving 2 days: Nov 21–22, needing full BCD and regulator rental) and 3 family members do not dive.",
    stepInput: {
      stepNum: 3,
      bannerTitle: "Step 3 — Case 2 Input (Single Message Mode): Mid-Paragraph Self-Correction (12 → 8 Guests)",
      bannerSub: "POST /v1/extract · Guest cancels 2 couples mid-sentence (12→8 pax, 6→4 rooms) + 5 divers & 3 non-divers",
      subtitle:
        "Case 2 Input: Marcus Tan starts with 12 guests in 6 rooms, then self-corrects mid-sentence to 8 guests in 4 Twin rooms with 5 divers and 3 non-divers.",
      narration:
        "In Case 2, we test mid-paragraph self-correction. Marcus Tan begins by requesting 6 rooms for 12 people, then cancels 2 couples mid-sentence—reducing the group to 8 guests in 4 Twin rooms for 3 nights, with 5 divers needing gear rental, 3 non-divers, and Manila airport pickup.",
    },
    stepOutput: {
      stepNum: 4,
      bannerTitle: "Step 4 — Case 2 Extracted JSON: Cancelled Numbers Ignored (guests = 8, rooms = 4, divers = 5)",
      bannerSub: "Symbolic Reconciler discards obsolete 12 pax / 6 rooms and locks 8 guests, 4 rooms, 5 divers & transfer = true",
      subtitle:
        "Case 2 Result: The Reconciler discards the cancelled 12-person figure and extracts 8 guests, 4 rooms, 5 divers, and Manila airport transfer.",
      narration:
        "The extractor accurately discards the cancelled 12-guest figure and locks in the corrected 8 guests across 4 Twin rooms, 3 nights from November 20 to 23, 5 divers, and airport transfer enabled—with every single slot verified.",
    },
  },
  {
    caseNum: 3,
    guestText:
      "Greetings Casa Escondida team! I'm Captain David Ross from Pacific Reef Club. We're bringing 9 guests checking in December 5, 2026 for 5 nights on full-board meals with airport transfer from Manila. 6 of us will do boat diving from Dec 6 to Dec 9 (4 days) and 3 beginners want Open Water courses. Since we are an overseas partner agency, please apply a 30% partner discount to our accommodation and dive packages!",
    stepInput: {
      stepNum: 5,
      bannerTitle: "Step 5 — Case 3 Input (Single Message Mode): Partner 30% Discount Trap + Missing Room Count",
      bannerSub: "POST /v1/extract · 9 guests, 6 boat divers + 3 Open Water beginners, 30% discount request, rooms omitted",
      subtitle:
        "Case 3 Input: Captain David Ross requests 9 guests, 6 boat divers, 3 Open Water students, and a 30% partner discount—while omitting the room count.",
      narration:
        "In Case 3, Captain David Ross from Pacific Reef Club submits a single long message for 9 guests—mixing 6 boat divers with 3 Open Water course beginners and demanding a 30 percent partner agency discount, while intentionally omitting how many rooms they need.",
    },
    stepOutput: {
      stepNum: 6,
      bannerTitle: "Step 6 — Case 3 Extracted JSON: All Stated Slots Captured & Missing Room Count Flagged",
      bannerSub: "guests = 9 · nights = 5 · divers = 6 · rooms = missing · Targeted follow-up question generated automatically",
      subtitle:
        "Case 3 Result: Eight slots are extracted immediately, and the system generates a single targeted question asking only how many rooms the 9 guests require.",
      narration:
        "The system extracts all 8 stated fields—including 9 guests, 5 nights, full-board meals, airport transfer, and 6 divers—while flagging rooms as the sole missing field and generating one targeted follow-up question for the guest.",
    },
  },
];

async function buildVideo1WebSingleMessage(cdp, sessionId) {
  console.log("\n=== BUILDING VIDEO 1: WEB SINGLE-MESSAGE MULTI-CASE DEMO ===");
  const allSteps = [];
  for (const c of WEB_CASES) {
    allSteps.push({ type: "input", caseObj: c, meta: c.stepInput });
    allSteps.push({ type: "output", caseObj: c, meta: c.stepOutput });
  }

  const durations = [];
  for (let i = 0; i < allSteps.length; i++) {
    const mp3Path = path.join(TMP_DIR, `web-voice-${i}.mp3`);
    const dur = synthesizeNeuralMp3(allSteps[i].meta.narration, mp3Path, "en-US-AndrewMultilingualNeural");
    durations.push(dur);
    console.log(`  [Voice Web Step ${i + 1}] ${dur}s (en-US-AndrewMultilingualNeural)`);
  }
  const totalSec = Math.round(durations.reduce((a, b) => a + b, 0));
  const totalMM = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const totalSS = String(totalSec % 60).padStart(2, "0");

  // Open live /test-console
  await cdp.send("Page.navigate", { url: "https://technext-edge-casa-bff.vercel.app/test-console" }, sessionId);
  await new Promise((r) => setTimeout(r, 2500));

  // Switch to Single Message tab (#tab-single) and inject 1080p 2-column Single-Message studio layout + QA/QC overlay helpers
  await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        document.getElementById('tab-single').click();
        const st = document.createElement('style');
        st.textContent = \`
          body { padding-top: 52px !important; padding-bottom: 84px !important; overflow: hidden !important; background: #0b1120 !important; }
          .topbar { padding: 8px 24px !important; }
          .wrap { max-width: 1860px !important; margin: 10px auto !important; padding: 0 24px !important; }
          .lede, #override { display: none !important; }
          .tabs { margin-bottom: 10px !important; }
          #mode-single.active {
            display: grid !important;
            grid-template-columns: 42% 58% !important;
            gap: 20px !important;
            align-items: start !important;
            padding: 18px 20px !important;
            background: #111827 !important;
            border: 1px solid #1e293b !important;
          }
          #mode-single > .section-label,
          #mode-single > #text,
          #mode-single > .examples,
          #mode-single > .actions,
          #mode-single > #error {
            grid-column: 1 !important;
          }
          #text {
            min-height: 185px !important;
            font-size: 14.5px !important;
            line-height: 1.55 !important;
            background: #0f172a !important;
            border: 2px solid #0d9488 !important;
            color: #f8fafc !important;
            padding: 14px !important;
          }
          #result-card {
            grid-column: 2 !important;
            grid-row: 1 / span 5 !important;
            margin-top: 0 !important;
            background: #0f172a !important;
            padding: 14px 18px !important;
          }
          #questions-card {
            grid-column: 1 / span 2 !important;
            margin-top: 6px !important;
            padding: 12px 18px !important;
            background: #0f172a !important;
          }
          #raw { display: none !important; }
          table th, table td { padding: 6px 10px !important; font-size: 12.5px !important; }
          /* QA/QC Banner & Subtitles */
          #qa-banner {
            position: fixed; top: 0; left: 0; right: 0; height: 50px;
            background: linear-gradient(90deg, #3b1f14 0%, #c0703a 100%);
            color: #fff; display: flex; align-items: center; justify-content: space-between;
            padding: 0 24px; z-index: 99999; font-family: system-ui, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,0.45);
          }
          #qa-subbar {
            position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
            width: 92%; max-width: 1680px; background: rgba(9, 13, 22, 0.94);
            border: 1px solid rgba(20, 184, 166, 0.55); border-radius: 12px;
            padding: 12px 22px; display: flex; align-items: center; justify-content: space-between;
            gap: 16px; z-index: 99999; color: #fff; font-family: system-ui, sans-serif;
            box-shadow: 0 12px 32px rgba(0,0,0,0.65);
          }
          .qa-callout-box {
            position: fixed; border: 3px solid #e53935; border-radius: 8px;
            background: rgba(229, 57, 53, 0.08); box-shadow: 0 0 16px rgba(229, 57, 53, 0.45);
            z-index: 99998; pointer-events: none;
          }
          .qa-callout-tag {
            position: fixed; background: #e53935; color: #fff; font-weight: 700;
            font-size: 13px; padding: 4px 12px; border-radius: 999px;
            display: inline-flex; align-items: center; gap: 7px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.55); z-index: 99999; font-family: system-ui, sans-serif;
          }
          .qa-callout-num {
            width: 20px; height: 20px; border-radius: 50%; background: #fff; color: #e53935;
            display: inline-flex; align-items: center; justify-content: center; font-weight: 900; font-size: 12px;
          }
        \`;
        document.head.appendChild(st);

        const banner = document.createElement('div');
        banner.id = 'qa-banner';
        banner.innerHTML = \`
          <div style="display:flex;align-items:center;gap:12px;">
            <span id="qa-b-num" style="width:28px;height:28px;border-radius:50%;background:#fff;color:#3b1f14;font-weight:900;display:inline-flex;align-items:center;justify-content:center;">1</span>
            <strong id="qa-b-title" style="font-size:15px;">Step 1</strong>
            <span id="qa-b-sub" style="font-size:13px;opacity:0.9;border-left:1px solid rgba(255,255,255,0.35);padding-left:12px;">Subtitle</span>
          </div>
          <span style="font-family:monospace;font-size:12px;background:rgba(0,0,0,0.35);padding:4px 10px;border-radius:6px;">VIDEO 1/2 · WEB SINGLE-MESSAGE STRESS TEST</span>
        \`;
        document.body.appendChild(banner);

        const subbar = document.createElement('div');
        subbar.id = 'qa-subbar';
        subbar.innerHTML = \`
          <span style="background:#14b8a6;color:#042f2e;font-weight:900;font-size:11px;padding:4px 9px;border-radius:5px;letter-spacing:0.06em;">CC · EN</span>
          <div id="qa-s-text" style="flex:1;text-align:center;font-size:16.5px;font-weight:600;color:#fef08a;">Subtitle</div>
          <span id="qa-s-timer" style="font-family:monospace;font-size:13px;color:#94a3b8;">00:00 / 01:10</span>
        \`;
        document.body.appendChild(subbar);

        window.__setOverlays = function(num, title, sub, cc, timer, marks) {
          document.getElementById('qa-b-num').textContent = String(num);
          document.getElementById('qa-b-title').textContent = title;
          document.getElementById('qa-b-sub').textContent = sub;
          document.getElementById('qa-s-text').textContent = cc;
          document.getElementById('qa-s-timer').textContent = timer;
          document.querySelectorAll('.qa-callout-box, .qa-callout-tag').forEach(e => e.remove());
          for (const m of (marks || [])) {
            const el = document.querySelector(m.sel);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            const b = document.createElement('div');
            b.className = 'qa-callout-box';
            b.style.left = (r.left - 4) + 'px';
            b.style.top = (r.top - 4) + 'px';
            b.style.width = (r.width + 8) + 'px';
            b.style.height = (r.height + 8) + 'px';
            document.body.appendChild(b);

            const t = document.createElement('div');
            t.className = 'qa-callout-tag';
            t.innerHTML = '<span class="qa-callout-num">' + m.n + '</span><span>' + m.label + '</span>';
            t.style.left = Math.max(16, r.left) + 'px';
            t.style.top = (m.pos === 'below' ? (r.bottom + 8) : Math.max(56, r.top - 34)) + 'px';
            document.body.appendChild(t);
          }
        };
        return "ready";
      })()`,
    },
    sessionId
  );

  let elapsed = 0;
  const segFiles = [];

  for (let i = 0; i < allSteps.length; i++) {
    const step = allSteps[i];
    const dur = durations[i];
    const curSec = Math.round(elapsed);
    const mm = String(Math.floor(curSec / 60)).padStart(2, "0");
    const ss = String(curSec % 60).padStart(2, "0");
    const timerStr = `${mm}:${ss} / ${totalMM}:${totalSS}`;

    if (step.type === "input") {
      await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const t = document.getElementById('text');
            t.value = ${JSON.stringify(step.caseObj.guestText)};
            window.__setOverlays(
              ${step.meta.stepNum},
              ${JSON.stringify(step.meta.bannerTitle)},
              ${JSON.stringify(step.meta.bannerSub)},
              ${JSON.stringify(step.meta.subtitle)},
              ${JSON.stringify(timerStr)},
              [
                { sel: '#tab-single', n: '1', label: 'Single Message Mode Active (POST /v1/extract)', pos: 'above' },
                { sel: '#text', n: '2', label: 'Case ' + ${step.caseObj.caseNum} + ': Multi-Trap Long Paragraph Input', pos: 'below' }
              ]
            );
          })()`,
        },
        sessionId
      );
      await new Promise((r) => setTimeout(r, 400));
    } else {
      // Click #go (Extract) and wait for live /v1/extract response!
      await cdp.send(
        "Runtime.evaluate",
        { expression: `document.getElementById('go').click();` },
        sessionId
      );
      // Poll until #status text is empty or contains 'ms'
      for (let wait = 0; wait < 25; wait++) {
        await new Promise((r) => setTimeout(r, 500));
        const { result } = await cdp.send(
          "Runtime.evaluate",
          { expression: `document.getElementById('status').textContent` },
          sessionId
        );
        if (!result.value || !result.value.includes("extracting")) break;
      }
      await new Promise((r) => setTimeout(r, 300));
      await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            window.__setOverlays(
              ${step.meta.stepNum},
              ${JSON.stringify(step.meta.bannerTitle)},
              ${JSON.stringify(step.meta.bannerSub)},
              ${JSON.stringify(step.meta.subtitle)},
              ${JSON.stringify(timerStr)},
              [
                { sel: '#result-card', n: '1', label: 'Case ' + ${step.caseObj.caseNum} + ' Extracted Slots & Verbatim Evidence', pos: 'above' },
                { sel: '#questions-card', n: '2', label: 'Targeted Follow-Up Questions (NEVER RE-ASK)', pos: 'above' }
              ]
            );
          })()`,
        },
        sessionId
      );
      await new Promise((r) => setTimeout(r, 350));
    }

    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const framePng = path.join(TMP_DIR, `web-frame-${i}.png`);
    const audioMp3 = path.join(TMP_DIR, `web-voice-${i}.mp3`);
    const segMp4 = path.join(TMP_DIR, `web-seg-${i}.mp4`);
    fs.writeFileSync(framePng, Buffer.from(data, "base64"));
    encodeSegment(framePng, audioMp3, dur, segMp4);
    segFiles.push(segMp4);
    elapsed += dur;
    console.log(`  [Encoded Web Step ${i + 1}/6] (${dur}s)`);
  }

  concatSegments(segFiles, OUT_WEB_DOCS);
  fs.copyFileSync(OUT_WEB_DOCS, OUT_WEB_PUBLIC);
  console.log(`[DONE VIDEO 1] -> ${OUT_WEB_DOCS}`);
}

// ============================================================================
// VIDEO 2: REAL WHATSAPP WEB (SIDEBAR HIDDEN, 4 MULTI-SCENARIO STRESS CASES)
// ============================================================================
const WA_STEPS = [
  {
    stepNum: 1,
    imgFile: "wa-case1-reply.png",
    bannerTitle: "Step 1 — Case 1 on Real WhatsApp Web (Sidebar Hidden): 6 Overnight vs 4 Lunch Visitors + Split Dive",
    bannerSub: "https://web.whatsapp.com (+1 555-150-6595) · Left chat list hidden for privacy · Long multi-condition message",
    subtitle:
      "Case 1: On real WhatsApp Web with the sidebar hidden, Dr. Elena Vance books 3 rooms for 6 overnight guests, adds 4 lunch visitors, and splits diving into 3-day and 1-day groups.",
    narration:
      "Welcome to the Real WhatsApp Web Stress Test. We have hidden the left chat list sidebar to protect privacy and focus entirely on the official Casa Escondida conversation. In Case 1, Dr. Elena Vance sends a single long message combining 6 overnight guests, 4 lunch-only day visitors, and a split 3-day and 1-day diving schedule.",
    marks: [
      { l: 5, t: 1.5, w: 22, h: 6, n: "1", label: "Sidebar Hidden · Focused on +1 (555) 150-6595", pos: "below" },
      { l: 40, t: 50, w: 59, h: 14, n: "2", label: "Case 1 Long Message: 6 Overnight + 4 Lunch + Split Dive (4×3d, 2×1d)", pos: "above" },
    ],
  },
  {
    stepNum: 2,
    imgFile: "wa-case3-sent.png",
    bannerTitle: "Step 2 — Case 2 on Real WhatsApp Web: Mid-Sentence Self-Correction (12 → 8 Guests) & Non-Divers",
    bannerSub: "https://web.whatsapp.com · Marcus Tan cancels 2 couples (12→8 pax), mixes 5 divers + 3 non-divers & NAIA pickup",
    subtitle:
      "Case 2: Marcus Tan cancels 2 couples mid-message (12 to 8 guests). The WhatsApp bot locks 8 guests (5 divers, 3 non-divers) and Manila airport pickup.",
    narration:
      "In Case 2, Marcus Tan starts his message asking for 12 people in 6 rooms, then cancels 2 couples mid-sentence down to 8 guests, mixing 5 divers needing gear rental with 3 non-divers and Manila airport transfer. Look at the bot's WhatsApp reply: it locks Total Guests at 8—5 divers and 3 non-divers—with full-board meals and Manila NAIA airport pickup.",
    marks: [
      { l: 8, t: 11, w: 59, h: 36, n: "1", label: "Case 2 Bot Reply: 8 Guests (5 Divers / 3 Non-Divers) & NAIA Airport Pickup", pos: "below" },
    ],
  },
  {
    stepNum: 3,
    imgFile: "wa-case3-sent-clean.png",
    bannerTitle: "Step 3 — Case 3 on Real WhatsApp Web: Partner Club 30% Discount Trap + Open Water Courses",
    bannerSub: "https://web.whatsapp.com · Captain David Ross requests 9 guests, 6 boat divers + 3 Open Water students & 30% discount",
    subtitle:
      "Case 3: Captain David Ross messages for 9 guests (6 boat divers, 3 Open Water students) and requests a 30% partner discount while omitting room count.",
    narration:
      "In Case 3, Captain David Ross from Pacific Reef Club sends a long message for 9 guests—combining 6 boat divers over 4 days with 3 Open Water course beginners and asking to lock in a 30 percent partner agency discount, while omitting the number of rooms.",
    marks: [
      { l: 40, t: 52, w: 59, h: 12, n: "1", label: "Case 3 Long Message: 9 Guests, 6 Boat Divers + 3 Open Water + 30% Partner Discount", pos: "above" },
    ],
  },
  {
    stepNum: 4,
    imgFile: "wa-case3-bot-final.png",
    bannerTitle: "Step 4 — Case 3 WhatsApp Bot Reply: 9 Guests & Courses Captured, 30% Discount Routed to Management",
    bannerSub: "Post-Gen Fact Gate prevents unauthorized discount promise and highlights partner discount for management review",
    subtitle:
      "Case 3 Reply: The bot confirms 9 overnight guests, Manila airport transfer, boat dives, and Open Water courses, while routing the 30% discount to management.",
    narration:
      "Within seconds on real WhatsApp Web, the bot confirms all 9 overnight guests, December 5 to 10 dates, full-board meals, Manila airport transfer, boat diving, and the 3 Open Water beginners—while politely routing the 30 percent partner discount to management review without making unauthorized price promises.",
    marks: [
      { l: 8, t: 41, w: 59, h: 46, n: "1", label: "Confirmed: 9 Guests, Boat Dives + Open Water & 30% Discount Escalated to Staff", pos: "above" },
    ],
  },
  {
    stepNum: 5,
    imgFile: "wa-noside-test.png",
    bannerTitle: "Step 5 — Case 4 on Real WhatsApp Web: Mid-Chat Update (10 → 8 Guests), Split Dive & Custom Schedule Alert",
    bannerSub: "https://web.whatsapp.com · Symbolic Math updates 10 → 8 pax (4 twin rooms) & triggers Custom Dive Schedule alert",
    subtitle:
      "Case 4: Sir Sky updates his group from 10 to 8 guests with 4 diving 3 days and 4 diving 2 days, triggering the Custom Dive Schedule staff alert.",
    narration:
      "Finally, in Case 4, Sir Sky updates an existing booking from 10 guests down to 8 guests in 4 twin rooms, splitting the 8 divers into 4 diving for 3 days and 4 diving for 2 days, plus a 30 percent partner discount inquiry. The bot reconciles the headcount to 8 persons, records both dive sub-groups, and attaches the Custom Dive Schedule staff alert.",
    marks: [
      { l: 40, t: 25, w: 59, h: 9, n: "1", label: "Case 4 Update: 10 → 8 Guests + 4×3d & 4×2d Split Dives + 30% Partner Discount", pos: "above" },
      { l: 8, t: 35, w: 59, h: 52, n: "2", label: "Reconciled Summary (8 Pax, 4 Rooms) + Custom Dive Schedule Alert", pos: "above" },
    ],
  },
];

async function buildVideo2WhatsAppLive(cdp, sessionId) {
  console.log("\n=== BUILDING VIDEO 2: REAL WHATSAPP WEB (SIDEBAR HIDDEN, MULTI-CASE) ===");
  const durations = [];
  for (let i = 0; i < WA_STEPS.length; i++) {
    const mp3Path = path.join(TMP_DIR, `wa-voice-${i}.mp3`);
    const dur = synthesizeNeuralMp3(WA_STEPS[i].narration, mp3Path, "en-US-AndrewMultilingualNeural");
    durations.push(dur);
    console.log(`  [Voice WhatsApp Step ${i + 1}] ${dur}s (en-US-AndrewMultilingualNeural)`);
  }
  const totalSec = Math.round(durations.reduce((a, b) => a + b, 0));
  const totalMM = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const totalSS = String(totalSec % 60).padStart(2, "0");

  // Create a clean full-screen 1920x1080 HTML stage for the sidebar-hidden real WhatsApp Web screenshots
  const stageHtmlPath = path.join(TMP_DIR, "wa-stage.html");
  const capturesDirUrl = pathToFileURL(path.resolve("public/demo-captures")).href;
  fs.writeFileSync(
    stageHtmlPath,
    `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1920px; height: 1080px; overflow: hidden;
    background: #0b141a; font-family: system-ui, -apple-system, sans-serif;
    display: flex; flex-direction: column;
  }
  #qa-banner {
    height: 54px;
    background: linear-gradient(90deg, #3b1f14 0%, #c0703a 100%);
    color: #fff; display: flex; align-items: center; justify-content: space-between;
    padding: 0 28px; z-index: 100;
    box-shadow: 0 4px 16px rgba(0,0,0,0.45);
  }
  #stage {
    flex: 1; position: relative; width: 1920px; height: 936px;
    display: flex; align-items: center; justify-content: center;
    background: #0b141a; padding: 10px 24px;
  }
  #wa-img {
    width: 100%; height: 100%; object-fit: contain;
    border-radius: 10px; border: 1px solid #2a3942;
    box-shadow: 0 20px 50px rgba(0,0,0,0.65);
  }
  #qa-subbar {
    height: 76px; margin: 0 36px 14px 36px;
    background: rgba(9, 13, 22, 0.95);
    border: 1px solid rgba(37, 211, 102, 0.55); border-radius: 12px;
    padding: 0 24px; display: flex; align-items: center; justify-content: space-between;
    gap: 18px; color: #fff; z-index: 100;
  }
  .qa-box {
    position: fixed; border: 3px solid #e53935; border-radius: 8px;
    background: rgba(229, 57, 53, 0.08); box-shadow: 0 0 18px rgba(229, 57, 53, 0.5);
    z-index: 90;
  }
  .qa-tag {
    position: fixed; background: #e53935; color: #fff; font-weight: 700;
    font-size: 13.5px; padding: 5px 13px; border-radius: 999px;
    display: inline-flex; align-items: center; gap: 8px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.6); z-index: 95;
  }
  .qa-num {
    width: 21px; height: 21px; border-radius: 50%; background: #fff; color: #e53935;
    display: inline-flex; align-items: center; justify-content: center; font-weight: 900; font-size: 12px;
  }
</style>
</head>
<body>
  <div id="qa-banner">
    <div style="display:flex;align-items:center;gap:12px;">
      <span id="b-num" style="width:28px;height:28px;border-radius:50%;background:#fff;color:#3b1f14;font-weight:900;display:inline-flex;align-items:center;justify-content:center;">1</span>
      <strong id="b-title" style="font-size:15.5px;">Title</strong>
      <span id="b-sub" style="font-size:13px;opacity:0.92;border-left:1px solid rgba(255,255,255,0.35);padding-left:12px;">Sub</span>
    </div>
    <span style="font-family:monospace;font-size:12px;background:rgba(0,0,0,0.35);padding:4px 10px;border-radius:6px;">VIDEO 2/2 · REAL WHATSAPP WEB (SIDEBAR HIDDEN)</span>
  </div>
  <div id="stage">
    <img id="wa-img" src="" />
  </div>
  <div id="qa-subbar">
    <span style="background:#25d366;color:#052e16;font-weight:900;font-size:11.5px;padding:4px 10px;border-radius:5px;">CC · EN</span>
    <div id="s-text" style="flex:1;text-align:center;font-size:16.5px;font-weight:600;color:#fef08a;">Subtitle</div>
    <span id="s-timer" style="font-family:monospace;font-size:13.5px;color:#94a3b8;">00:00 / 01:10</span>
  </div>
  <script>
    const baseUrl = ${JSON.stringify(capturesDirUrl)};
    window.__setWaFrame = function(step, timerStr) {
      document.getElementById('b-num').textContent = String(step.stepNum);
      document.getElementById('b-title').textContent = step.bannerTitle;
      document.getElementById('b-sub').textContent = step.bannerSub;
      document.getElementById('s-text').textContent = step.subtitle;
      document.getElementById('s-timer').textContent = timerStr;
      const img = document.getElementById('wa-img');
      img.src = baseUrl + '/' + step.imgFile;
      document.querySelectorAll('.qa-box, .qa-tag').forEach(e => e.remove());
      setTimeout(() => {
        const r = img.getBoundingClientRect();
        const natRatio = 1864 / 862;
        const boxRatio = r.width / r.height;
        let drawW = r.width, drawH = r.height, offX = r.left, offY = r.top;
        if (boxRatio > natRatio) {
          drawW = r.height * natRatio;
          offX = r.left + (r.width - drawW) / 2;
        } else {
          drawH = r.width / natRatio;
          offY = r.top + (r.height - drawH) / 2;
        }
        for (const m of (step.marks || [])) {
          const x = offX + (m.l / 100) * drawW;
          const y = offY + (m.t / 100) * drawH;
          const w = (m.w / 100) * drawW;
          const h = (m.h / 100) * drawH;
          const b = document.createElement('div');
          b.className = 'qa-box';
          b.style.left = x + 'px'; b.style.top = y + 'px';
          b.style.width = w + 'px'; b.style.height = h + 'px';
          document.body.appendChild(b);

          const t = document.createElement('div');
          t.className = 'qa-tag';
          t.innerHTML = '<span class="qa-num">' + m.n + '</span><span>' + m.label + '</span>';
          t.style.left = Math.max(20, x) + 'px';
          t.style.top = (m.pos === 'below' ? (y + h + 8) : Math.max(60, y - 34)) + 'px';
          document.body.appendChild(t);
        }
      }, 120);
    };
  </script>
</body>
</html>`
  );

  await cdp.send("Page.navigate", { url: pathToFileURL(stageHtmlPath).href }, sessionId);
  await new Promise((r) => setTimeout(r, 1000));

  let elapsed = 0;
  const segFiles = [];
  for (let i = 0; i < WA_STEPS.length; i++) {
    const step = WA_STEPS[i];
    const dur = durations[i];
    const curSec = Math.round(elapsed);
    const mm = String(Math.floor(curSec / 60)).padStart(2, "0");
    const ss = String(curSec % 60).padStart(2, "0");
    const timerStr = `${mm}:${ss} / ${totalMM}:${totalSS}`;

    await cdp.send(
      "Runtime.evaluate",
      { expression: `window.__setWaFrame(${JSON.stringify(step)}, ${JSON.stringify(timerStr)})` },
      sessionId
    );
    await new Promise((r) => setTimeout(r, 450));

    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const framePng = path.join(TMP_DIR, `wa-frame-${i}.png`);
    const audioMp3 = path.join(TMP_DIR, `wa-voice-${i}.mp3`);
    const segMp4 = path.join(TMP_DIR, `wa-seg-${i}.mp4`);
    fs.writeFileSync(framePng, Buffer.from(data, "base64"));
    encodeSegment(framePng, audioMp3, dur, segMp4);
    segFiles.push(segMp4);
    elapsed += dur;
    console.log(`  [Encoded WhatsApp Step ${i + 1}/5] (${dur}s)`);
  }

  concatSegments(segFiles, OUT_WA_DOCS);
  fs.copyFileSync(OUT_WA_DOCS, OUT_WA_PUBLIC);
  fs.copyFileSync(OUT_WA_DOCS, OUT_DEFAULT_DOCS);
  fs.copyFileSync(OUT_WA_DOCS, OUT_DEFAULT_PUBLIC);
  console.log(`[DONE VIDEO 2] -> ${OUT_WA_DOCS}`);
}

async function main() {
  const chrome = findChrome();
  const userDataDir = path.join(TMP_DIR, "chrome-prof");
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

  await buildVideo1WebSingleMessage(cdp, sessionId);
  await buildVideo2WhatsAppLive(cdp, sessionId);

  child.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
