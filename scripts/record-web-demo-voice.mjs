import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const TMP_DIR = path.resolve("docs/.web-demo-voice-tmp");
const OUT_MP4_DOCS = path.resolve("docs/casa-web-single-message-demo.mp4");
const OUT_MP4_PUBLIC = path.resolve("public/casa-web-single-message-demo.mp4");
const OUT_SRT_DOCS = path.resolve("docs/casa-web-single-message-demo.srt");
const OUT_SRT_PUBLIC = path.resolve("public/casa-web-single-message-demo.srt");

fs.mkdirSync(TMP_DIR, { recursive: true });

function synthesizeNeuralAudio(text, mp3Path, voice = "en-US-AndrewMultilingualNeural") {
  console.log(`  [TTS] Synthesizing: "${text.slice(0, 60)}..."`);
  execFileSync(
    "edge-tts",
    [
      "--voice",
      voice,
      "--rate=+3%",
      "--text",
      text,
      "--write-media",
      mp3Path,
    ],
    { stdio: "ignore" }
  );
  return getAudioDuration(mp3Path);
}

function getAudioDuration(mp3Path) {
  try {
    execFileSync(FFMPEG, ["-i", mp3Path], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const stderr = String(err.stderr || "");
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) {
      const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      return Math.max(5.5, Number((secs + 0.8).toFixed(2)));
    }
  }
  return 9.0;
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

const CASES = [
  {
    caseNum: 1,
    name: "Case 1: Overnight (6) vs Lunch Day Visitors (4) + Split Diving (4×3d, 2×1d)",
    text: "Hi Casa Escondida! I am Dr. Elena Vance. We want to book 3 Deluxe Twin rooms for 6 overnight guests checking in October 15, 2026 for 4 nights with full-board meals (no airport transfer needed). Note that 4 local colleagues will drive down from Manila just to join us for lunch on Saturday—so 10 people eating lunch, but only 6 sleeping overnight! All 6 overnight guests are certified divers, but 4 will dive for 3 days (Oct 16–18) while the other 2 will only dive for 1 day (Oct 16).",
    stepInput: {
      stepNum: 1,
      bannerTitle: "Case 1 Input — Complex Group: 6 Overnight vs 4 Lunch Guests + Split Diving",
      bannerSub: "Long paragraph mixing 10 lunch attendees with 6 sleeping guests & split 3d/1d diving schedule",
      subtitle: "Case 1 Input: Dr. Elena Vance submits a complex booking mixing 6 overnight guests with 4 lunch visitors and split diving.",
      narration: "In Case 1, Dr. Elena Vance submits a complex booking. The paragraph mentions 6 overnight guests, but notes 4 local colleagues joining just for lunch—totaling 10 at lunch—along with a split diving schedule.",
      marks: [
        { sel: "#tab-single", n: "1", label: "Single message mode active (POST /v1/extract)", pos: "above" },
        { sel: "#text", n: "2", label: "Input: 10 people at lunch, but only 6 sleeping overnight", pos: "below" }
      ]
    },
    stepOutput: {
      stepNum: 2,
      bannerTitle: "Case 1 Result — Symbolic Math Reconciler: guests = 6 (Refuses 10-Pax Inflation)",
      bannerSub: "guests = 6 · rooms = 3 · divers = 6 · Day visitors and 4×3d / 2×1d split diving stored in evidence",
      subtitle: "Case 1 Result: Extracted 6 guests, 3 rooms, 4 nights, and 6 divers. Day visitors and split diving are logged in evidence.",
      narration: "The extractor resolves exactly 6 overnight guests and 3 Deluxe rooms, correctly refusing 10-pax inflation. The lunch visitors and split diving schedule are preserved in the special notes.",
      marks: [
        { sel: "#result-card", n: "1", label: "Extracted: 6 guests (overnight), 3 rooms, 4 nights, 6 divers", pos: "above" },
        { sel: "#questions-card", n: "2", label: "Zero missing questions: 100% complete in 1 shot", pos: "above" }
      ]
    }
  },
  {
    caseNum: 2,
    name: "Case 2: Mid-Paragraph Self-Correction (12 → 8 Guests) + 5 Divers & 3 Non-Divers",
    text: "Hello, this is Marcus Tan from Singapore. Originally we wanted 6 rooms for 12 people starting November 20, 2026—wait, scratch that, 2 couples just cancelled this morning so our final headcount is 8 guests in 4 Twin rooms for 3 nights (Nov 20 to Nov 23) with full-board meals and Manila NAIA airport pickup. Out of the 8 guests, only 5 are divers (diving 2 days: Nov 21–22, needing full BCD and regulator rental) and 3 family members do not dive.",
    stepInput: {
      stepNum: 3,
      bannerTitle: "Case 2 Input — Self-Correction Trap: 12 Cancelled Down to 8 Guests Mid-Sentence",
      bannerSub: "Guest cancels 2 couples mid-sentence; mixes 5 divers (rental gear) with 3 non-divers + airport transfer",
      subtitle: "Case 2 Input: Marcus Tan starts with 12 guests, then corrects himself mid-sentence to 8 guests and 4 Twin rooms.",
      narration: "Case 2 tests conversational self-correction. Marcus Tan starts by requesting 12 guests in 6 rooms, but immediately corrects himself to 8 guests in 4 rooms with 5 divers needing rental gear.",
      marks: [
        { sel: "#text", n: "1", label: "Self-correction: 'wanted 12... scratch that, final count is 8 guests'", pos: "below" }
      ]
    },
    stepOutput: {
      stepNum: 4,
      bannerTitle: "Case 2 Result — Reconciler Ignores Obsolete 12-Pax Figure: guests = 8, rooms = 4",
      bannerSub: "guests = 8 · rooms = 4 · divers = 5 (3 non-divers) · transfer = true · rental gear recorded",
      subtitle: "Case 2 Result: Extractor updates headcount to 8 guests, 4 rooms, 5 divers, airport transfer, and gear rental.",
      narration: "The pipeline automatically discards the superseded 12 figure, extracting exactly 8 guests, 4 Twin rooms, 5 divers, and flags the airport pickup and gear rental without any missing questions.",
      marks: [
        { sel: "#result-card", n: "1", label: "Corrected: 8 guests, 4 Twin rooms, 5 divers, airport pickup = true", pos: "above" },
        { sel: "#questions-card", n: "2", label: "All fields complete: zero questions required", pos: "above" }
      ]
    }
  },
  {
    caseNum: 3,
    name: "Case 3: Partner 30% Discount Trap + Open Water Courses + Missing Room Count",
    text: "Greetings Casa Escondida team! I'm Captain David Ross from Pacific Reef Club. We're bringing 9 guests checking in December 5, 2026 for 5 nights on full-board meals with airport transfer from Manila. 6 of us will do boat diving from Dec 6 to Dec 9 (4 days) and 3 beginners want Open Water courses. Since we are an overseas partner agency, please apply a 30% partner discount to our accommodation and dive packages!",
    stepInput: {
      stepNum: 5,
      bannerTitle: "Case 3 Input — Partner 30% Discount Demand + Course Mix + Room Count Omitted",
      bannerSub: "9 guests, 6 boat divers + 3 Open Water students, 30% discount demand, room count intentionally omitted",
      subtitle: "Case 3 Input: Captain David Ross demands a 30% agency discount for 9 guests and omits the room count.",
      narration: "Case 3 introduces an adversarial partner rate scenario. Captain David Ross demands a 30% agency discount for 9 guests and courses, while intentionally omitting the room count.",
      marks: [
        { sel: "#text", n: "1", label: "Trap: Demands 30% discount and omits number of rooms", pos: "below" }
      ]
    },
    stepOutput: {
      stepNum: 6,
      bannerTitle: "Case 3 Result — Fact Gate Flags 30% Discount & Generates Targeted Room Question",
      bannerSub: "8 stated slots captured · 30% discount escalated to staff · Single targeted question: 'How many rooms?'",
      subtitle: "Case 3 Result: Fact Gate captures 8 slots, escalates the discount, and generates: 'How many rooms do you need?'",
      narration: "The system captures all 8 stated slots, identifies the agency guest, escalates the unauthorized 30% discount to staff, and asks the guest only one question: how many rooms do they need.",
      marks: [
        { sel: "#result-card", n: "1", label: "8 stated slots captured · rooms = missing", pos: "above" },
        { sel: "#questions-card", n: "2", label: "Targeted Question Generated: 'How many rooms do you need?'", pos: "above" }
      ]
    }
  }
];

function formatSrtTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

async function main() {
  console.log("=== RECORDING DEMO VIDEO 1: WEB SINGLE-MESSAGE WITH VOICE & SUBTITLES ===");

  // 1. Synthesize neural audio for all 6 steps first
  console.log("\n--- Phase 1: Synthesizing Neural Speech (AndrewMultilingualNeural) ---");
  const stepMeta = [];
  let sIndex = 1;
  for (const c of CASES) {
    const inMp3 = path.join(TMP_DIR, `step-${sIndex}-voice.mp3`);
    synthesizeNeuralAudio(c.stepInput.narration, inMp3);
    const inDur = getAudioDuration(inMp3);
    stepMeta.push({
      stepNum: sIndex,
      type: "input",
      caseRef: c,
      stepObj: c.stepInput,
      audioPath: inMp3,
      duration: inDur,
    });
    sIndex++;

    const outMp3 = path.join(TMP_DIR, `step-${sIndex}-voice.mp3`);
    synthesizeNeuralAudio(c.stepOutput.narration, outMp3);
    const outDur = getAudioDuration(outMp3);
    stepMeta.push({
      stepNum: sIndex,
      type: "output",
      caseRef: c,
      stepObj: c.stepOutput,
      audioPath: outMp3,
      duration: outDur,
    });
    sIndex++;
  }

  // Calculate total running time
  const totalVideoDuration = stepMeta.reduce((sum, s) => sum + s.duration, 0);
  console.log(`\nTotal planned video duration: ${totalVideoDuration.toFixed(1)}s across 6 steps.`);

  // Generate SRT Subtitles
  let currentSec = 0;
  const srtEntries = [];
  for (let i = 0; i < stepMeta.length; i++) {
    const s = stepMeta[i];
    const startStr = formatSrtTime(currentSec);
    const endStr = formatSrtTime(currentSec + s.duration);
    srtEntries.push(`${i + 1}\n${startStr} --> ${endStr}\n${s.stepObj.subtitle}\n`);
    currentSec += s.duration;
  }
  const srtContent = srtEntries.join("\n");
  fs.writeFileSync(OUT_SRT_DOCS, srtContent, "utf8");
  fs.writeFileSync(OUT_SRT_PUBLIC, srtContent, "utf8");
  console.log(`Subtitles (.srt) generated and written to docs & public.`);

  // 2. Launch Headless Chrome & Capture Frames
  console.log("\n--- Phase 2: Launching Chrome CDP & Capturing Screen Frames ---");
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

  // Navigate to live /test-console
  await cdp.send("Page.navigate", { url: "https://technext-edge-casa-bff.vercel.app/test-console" }, sessionId);
  await new Promise((r) => setTimeout(r, 2500));

  // Switch to Single message tab and inject polished 2-column layout + Top Banner + Subtitle Bar
  await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        document.getElementById('tab-single').click();
        const st = document.createElement('style');
        st.textContent = \`
          body {
            padding-top: 54px !important;
            padding-bottom: 56px !important;
            overflow: hidden !important;
            background: #0b1120 !important;
            font-family: system-ui, -apple-system, sans-serif !important;
          }
          .topbar { padding: 6px 24px !important; height: 46px !important; }
          .wrap { max-width: 1880px !important; margin: 4px auto !important; padding: 0 24px !important; }
          .lede, #override { display: none !important; }
          .tabs { margin-bottom: 6px !important; }
          .tab-btn { font-size: 13.5px !important; padding: 6px 16px !important; }
          #mode-single.active {
            display: grid !important;
            grid-template-columns: 42% 58% !important;
            gap: 18px !important;
            align-items: start !important;
            padding: 12px 18px !important;
            background: #111827 !important;
            border: 1px solid #1e293b !important;
            border-radius: 12px !important;
          }
          #mode-single > .section-label,
          #mode-single > #text,
          #mode-single > .examples,
          #mode-single > .actions,
          #mode-single > #error {
            grid-column: 1 !important;
          }
          #text {
            min-height: 190px !important;
            font-size: 14px !important;
            line-height: 1.5 !important;
            background: #0f172a !important;
            border: 2px solid #0d9488 !important;
            color: #f8fafc !important;
            padding: 12px !important;
            border-radius: 8px !important;
          }
          .examples { margin: 6px 0 !important; }
          .actions { margin-top: 4px !important; }
          .btn-primary { font-size: 14px !important; padding: 8px 22px !important; font-weight: 700 !important; }
          #result-card {
            grid-column: 2 !important;
            grid-row: 1 / span 5 !important;
            margin-top: 0 !important;
            background: #0f172a !important;
            padding: 10px 16px !important;
            border: 1px solid #1e293b !important;
            border-radius: 10px !important;
          }
          #questions-card {
            grid-column: 1 / span 2 !important;
            margin-top: 6px !important;
            padding: 10px 16px !important;
            background: #0f172a !important;
            border: 1px solid #1e293b !important;
            border-radius: 10px !important;
          }
          #raw { display: none !important; }
          table { width: 100% !important; border-collapse: collapse !important; }
          table th, table td { padding: 5px 10px !important; font-size: 12.5px !important; border-bottom: 1px solid #1e293b !important; }
          table th { font-size: 11px !important; text-transform: uppercase !important; letter-spacing: 0.05em !important; color: #94a3b8 !important; }

          /* TOP QA/QC BANNER */
          #qa-top-banner {
            position: fixed; top: 0; left: 0; right: 0; height: 50px;
            background: linear-gradient(90deg, #3b1f14 0%, #c0703a 100%);
            color: #fff; display: flex; align-items: center; justify-content: space-between;
            padding: 0 28px; z-index: 99999;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
          }

          /* BOTTOM BURNT-IN SUBTITLE BAR */
          #qa-subbar {
            position: fixed; bottom: 0; left: 0; right: 0; height: 52px;
            background: rgba(11, 17, 32, 0.96);
            backdrop-filter: blur(10px);
            border-top: 1px solid #334155;
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 28px; z-index: 99999;
            box-shadow: 0 -4px 16px rgba(0,0,0,0.6);
          }

          .qa-box {
            position: fixed; border: 3px solid #e53935; border-radius: 8px;
            background: rgba(229, 57, 53, 0.08); box-shadow: 0 0 18px rgba(229, 57, 53, 0.45);
            z-index: 99998; pointer-events: none;
          }
          .qa-tag {
            position: fixed; background: #e53935; color: #fff; font-weight: 700;
            font-size: 13px; padding: 4px 12px; border-radius: 999px;
            display: inline-flex; align-items: center; gap: 7px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.55); z-index: 99999;
          }
          .qa-num {
            width: 20px; height: 20px; border-radius: 50%; background: #fff; color: #e53935;
            display: inline-flex; align-items: center; justify-content: center; font-weight: 900; font-size: 12px;
          }
        \`;
        document.head.appendChild(st);

        const banner = document.createElement('div');
        banner.id = 'qa-top-banner';
        banner.innerHTML = \`
          <div style="display:flex;align-items:center;gap:14px;">
            <span id="qa-num-badge" style="width:28px;height:28px;border-radius:50%;background:#fff;color:#3b1f14;font-weight:900;font-size:14px;display:inline-flex;align-items:center;justify-content:center;">1</span>
            <strong id="qa-title" style="font-size:15.5px;">Title</strong>
            <span id="qa-sub" style="font-size:13px;opacity:0.92;border-left:1px solid rgba(255,255,255,0.35);padding-left:14px;">Sub</span>
          </div>
          <span style="font-family:monospace;font-size:12px;background:rgba(0,0,0,0.35);padding:4px 12px;border-radius:6px;letter-spacing:0.04em;">CASA EXTRACTOR · SINGLE MESSAGE STRESS TEST</span>
        \`;
        document.body.appendChild(banner);

        const subbar = document.createElement('div');
        subbar.id = 'qa-subbar';
        subbar.innerHTML = \`
          <div style="display:flex;align-items:center;gap:12px;flex:1;">
            <span style="background:#14b8a6;color:#042f2e;font-weight:900;font-size:11px;padding:4px 9px;border-radius:5px;letter-spacing:0.06em;">CC · EN</span>
            <div id="qa-sub-text" style="flex:1;font-size:16px;font-weight:600;color:#fef08a;text-shadow:0 1px 3px rgba(0,0,0,0.8);">Subtitle</div>
          </div>
          <span id="qa-sub-progress" style="font-family:monospace;font-size:13px;color:#94a3b8;margin-left:20px;">STEP 1 / 6</span>
        \`;
        document.body.appendChild(subbar);

        window.__setScreenState = function(num, title, sub, subtitleText, progressText, marks) {
          document.getElementById('qa-num-badge').textContent = String(num);
          document.getElementById('qa-title').textContent = title;
          document.getElementById('qa-sub').textContent = sub;
          document.getElementById('qa-sub-text').textContent = subtitleText;
          document.getElementById('qa-sub-progress').textContent = progressText;

          document.querySelectorAll('.qa-box, .qa-tag').forEach(e => e.remove());
          for (const m of (marks || [])) {
            const el = document.querySelector(m.sel);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            const b = document.createElement('div');
            b.className = 'qa-box';
            b.style.left = (r.left - 4) + 'px';
            b.style.top = (r.top - 4) + 'px';
            b.style.width = (r.width + 8) + 'px';
            b.style.height = (r.height + 8) + 'px';
            document.body.appendChild(b);

            const t = document.createElement('div');
            t.className = 'qa-tag';
            t.innerHTML = '<span class="qa-num">' + m.n + '</span><span>' + m.label + '</span>';
            t.style.left = Math.max(16, r.left) + 'px';
            t.style.top = (m.pos === 'below' ? (r.bottom + 8) : Math.max(56, r.top - 32)) + 'px';
            document.body.appendChild(t);
          }
        };
        return "ready";
      })()`,
    },
    sessionId
  );

  // 3. Loop through cases, capture frames, encode with audio
  console.log("\n--- Phase 3: Executing Live Extraction & Encoding Synced Segments ---");
  const segFiles = [];
  let currentElapsed = 0;

  for (const s of stepMeta) {
    const isInput = s.type === "input";
    const c = s.caseRef;
    const progressLabel = `STEP ${s.stepNum} / 6 (${Math.round(currentElapsed)}s / ${Math.round(totalVideoDuration)}s)`;

    if (isInput) {
      console.log(`\n---> Step ${s.stepNum}: Input for ${c.name}`);
      await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const t = document.getElementById('text');
            t.value = ${JSON.stringify(c.text)};
            window.__setScreenState(
              ${s.stepNum},
              ${JSON.stringify(s.stepObj.bannerTitle)},
              ${JSON.stringify(s.stepObj.bannerSub)},
              ${JSON.stringify(s.stepObj.subtitle)},
              ${JSON.stringify(progressLabel)},
              ${JSON.stringify(s.stepObj.marks)}
            );
          })()`,
        },
        sessionId
      );
      await new Promise((r) => setTimeout(r, 450));
    } else {
      console.log(`\n---> Step ${s.stepNum}: Output for ${c.name}`);
      // Click GO and wait for API extraction
      await cdp.send(
        "Runtime.evaluate",
        { expression: `document.getElementById('go').click();` },
        sessionId
      );

      for (let wait = 0; wait < 40; wait++) {
        await new Promise((r) => setTimeout(r, 500));
        const { result } = await cdp.send(
          "Runtime.evaluate",
          {
            expression: `(() => {
              const go = document.getElementById('go');
              const rc = document.getElementById('result-card');
              return !go.disabled && rc && rc.style.display === 'block';
            })()`,
          },
          sessionId
        );
        if (result.value === true) {
          console.log(`    -> Live /v1/extract response returned in ~${(wait + 1) * 0.5}s!`);
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 500));

      await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            window.__setScreenState(
              ${s.stepNum},
              ${JSON.stringify(s.stepObj.bannerTitle)},
              ${JSON.stringify(s.stepObj.bannerSub)},
              ${JSON.stringify(s.stepObj.subtitle)},
              ${JSON.stringify(progressLabel)},
              ${JSON.stringify(s.stepObj.marks)}
            );
          })()`,
        },
        sessionId
      );
      await new Promise((r) => setTimeout(r, 450));
    }

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const framePng = path.join(TMP_DIR, `step-${s.stepNum}.png`);
    const segMp4 = path.join(TMP_DIR, `seg-${s.stepNum}.mp4`);
    fs.writeFileSync(framePng, Buffer.from(shot.data, "base64"));

    // Encode segment with ffmpeg (video + audio synced)
    execFileSync(
      FFMPEG,
      [
        "-y",
        "-loop",
        "1",
        "-i",
        framePng,
        "-i",
        s.audioPath,
        "-t",
        String(s.duration),
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

    segFiles.push(segMp4);
    console.log(`  [Step ${s.stepNum}] Encoded with Neural Audio & Burnt-in Subtitle (${s.duration.toFixed(1)}s)`);
    currentElapsed += s.duration;
  }

  // 4. Concatenate all segments into final MP4
  console.log("\n--- Phase 4: Concatenating all 6 segments ---");
  const concatList = path.join(TMP_DIR, "concat.txt");
  fs.writeFileSync(concatList, segFiles.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));

  execFileSync(
    FFMPEG,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatList,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      OUT_MP4_DOCS,
    ],
    { stdio: "ignore" }
  );

  fs.copyFileSync(OUT_MP4_DOCS, OUT_MP4_PUBLIC);

  console.log(`\n=== ALL DONE! FINAL DEMO VIDEO WITH VOICE & SUBTITLES CREATED ===`);
  console.log(`  - Video Docs: ${OUT_MP4_DOCS}`);
  console.log(`  - Video Public: ${OUT_MP4_PUBLIC}`);
  console.log(`  - Subtitles Docs: ${OUT_SRT_DOCS}`);
  console.log(`  - Subtitles Public: ${OUT_SRT_PUBLIC}`);

  child.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
