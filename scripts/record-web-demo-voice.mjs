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

// Voice matched directly against docs/demo-video/voice-samples/2-new-script-female.mp3
// (en-US-AvaMultilingualNeural at rate -8%, warm, human, natural tone picked by the team)
const VOICE = "en-US-AvaMultilingualNeural";
const VOICE_RATE = "-8%";

function synthesizeNeuralAudio(text, mp3Path, voice = VOICE, rate = VOICE_RATE) {
  console.log(`  [TTS] Synthesizing (${voice}, rate=${rate}): "${text.slice(0, 60)}..."`);
  execFileSync(
    "edge-tts",
    [
      "--voice",
      voice,
      `--rate=${rate}`,
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

// ============================================================================
// DEMO SCENARIO SCRIPT (PART 1: INTRO & CHAT, PART 2: SWITCH, PART 3: SINGLE)
// ============================================================================

const STEPS = [
  // --- PART 1: OVERVIEW & CONTROLS ---
  {
    stepId: "intro",
    badge: "INTRO",
    title: "Casa Escondida AI Test Console — Overview & Controls",
    sub: "Interactive test bench for evaluating multi-turn chat and single-message extraction",
    narration: "Welcome to the Casa Escondida AI Test Console. The interface features multi-turn Chat and Single Message modes, quick test presets, and real-time conversation controls to test how the engine interacts with guests.",
    marks: [
      { sel: ".tabs", n: "1", label: "Mode Switch: Multi-turn Chat vs Single-shot Extraction", pos: "above" },
      { sel: ".examples", n: "2", label: "Quick Scenario Presets: EN Starter, EN Agency, Reset", pos: "above" },
      { sel: ".chat-input-row", n: "3", label: "Interactive Conversation Input: Type & Send real messages", pos: "below" }
    ],
    execute: async (cdp, sessionId) => {
      // Show default chat view with markers on buttons
      await new Promise(r => setTimeout(r, 600));
    }
  },

  // --- PART 2: CHAT MODE (3 REAL CONVERSATIONAL TURNS) ---
  {
    stepId: "chat-turn-1",
    badge: "CHAT 1",
    title: "Chat Mode (Turn 1) — Multi-Turn Booking: Sarah Jenkins",
    sub: "AI acknowledges dates and rooms, and asks targeted diving question without re-asking",
    narration: "First, in Chat mode, we type a natural enquiry for four guests in two rooms. The assistant acknowledges the dates and rooms, and immediately asks whether the group plans to dive.",
    marks: [
      { sel: ".bubble-guest", n: "1", label: "Guest enquiry: 4 guests, 2 Deluxe rooms, Oct 17 for 3 nights", pos: "above" },
      { sel: ".bubble-assistant", n: "2", label: "AI confirms dates & rooms, and asks missing diving question", pos: "below" }
    ],
    execute: async (cdp, sessionId) => {
      const text = "Hi, I'm Sarah Jenkins. We'd like to book 2 Deluxe rooms for 4 guests checking in Oct 17, 2026 for 3 nights on full board.";
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.getElementById('chat-text').value = ${JSON.stringify(text)};
          document.getElementById('chat-send').click();
        })()`
      }, sessionId);

      // Wait for assistant reply bubble to appear
      for (let w = 0; w < 40; w++) {
        await new Promise(r => setTimeout(r, 500));
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const bubbles = document.querySelectorAll('.bubble-assistant');
            return bubbles.length >= 1;
          })()`
        }, sessionId);
        if (result.value) {
          console.log(`    -> Chat Turn 1 live response rendered in ~${(w + 1) * 0.5}s!`);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 600));
    }
  },

  {
    stepId: "chat-turn-2",
    badge: "CHAT 2",
    title: "Chat Mode (Turn 2) — Adding Diving Schedule & Airport Transfer",
    sub: "Trip state updates dynamically in memory with zero duplicate questions",
    narration: "In the second turn, the guest adds boat diving and airport pickup. The assistant updates the trip state in real time and asks to confirm how many people are diving.",
    marks: [
      { sel: ".bubble-guest:last-of-type", n: "1", label: "Guest adds: boat diving Oct 18–19 and airport pickup", pos: "above" },
      { sel: ".bubble-assistant:last-of-type", n: "2", label: "AI updates diving & transfer, asks for exact diver count", pos: "below" }
    ],
    execute: async (cdp, sessionId) => {
      const text = "Yes, 2 of us will do boat diving from Oct 18 to Oct 19, and we need airport pickup from Manila.";
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.getElementById('chat-text').value = ${JSON.stringify(text)};
          document.getElementById('chat-send').click();
        })()`
      }, sessionId);

      for (let w = 0; w < 40; w++) {
        await new Promise(r => setTimeout(r, 500));
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const bubbles = document.querySelectorAll('.bubble-assistant');
            return bubbles.length >= 2;
          })()`
        }, sessionId);
        if (result.value) {
          console.log(`    -> Chat Turn 2 live response rendered in ~${(w + 1) * 0.5}s!`);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 600));
    }
  },

  {
    stepId: "chat-turn-3",
    badge: "CHAT 3",
    title: "Chat Mode (Turn 3) — Slot Completion & Handover Gate",
    sub: "All required variables satisfied · System executes completion gate",
    narration: "Once the guest confirms two divers, all required fields are satisfied. The completion banner triggers, locking the trip state for staff quotation.",
    marks: [
      { sel: ".bubble-assistant:last-of-type", n: "1", label: "Final confirmation of all 8 reservation slots", pos: "below" },
      { sel: "#done-banner", n: "2", label: "Enquiry Complete: Done = true · Ready for staff quotation", pos: "above" }
    ],
    execute: async (cdp, sessionId) => {
      const text = "Exactly 2 divers. Manila pickup for all 4 of us, arriving at 11 AM. Thanks!";
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.getElementById('chat-text').value = ${JSON.stringify(text)};
          document.getElementById('chat-send').click();
        })()`
      }, sessionId);

      for (let w = 0; w < 40; w++) {
        await new Promise(r => setTimeout(r, 500));
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const banner = document.getElementById('done-banner');
            return banner && banner.style.display !== 'none';
          })()`
        }, sessionId);
        if (result.value) {
          console.log(`    -> Chat Turn 3 completion banner rendered in ~${(w + 1) * 0.5}s!`);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 600));
    }
  },

  // --- PART 3: MODE SWITCH ---
  {
    stepId: "switch-mode",
    badge: "SWITCH",
    title: "Mode Switch — Single Message Unstructured Stress Benchmarks",
    sub: "Testing complex, multi-variable single paragraphs without conversational back-and-forth",
    narration: "Now, we switch to Single Message mode. Here, the engine is stress-tested against dense, unstructured paragraphs with self-corrections, traps, and missing variables in one single pass.",
    marks: [
      { sel: "#tab-single", n: "1", label: "Single message mode active (POST /v1/extract)", pos: "above" },
      { sel: "#text", n: "2", label: "Unstructured single paragraph input benchmarking", pos: "below" }
    ],
    execute: async (cdp, sessionId) => {
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.getElementById('tab-single').click();
        })()`
      }, sessionId);
      await new Promise(r => setTimeout(r, 600));
    }
  },

  // --- PART 4: SINGLE MESSAGE STRESS TESTS (3 CASES) ---
  {
    stepId: "single-case-1",
    badge: "CASE 1",
    title: "Single Message (Case 1) — Overnight (6) vs Lunch Visitors (4)",
    sub: "Symbolic Math Reconciler captures 6 guests and stores day visitors in evidence",
    narration: "In Case 1, Dr. Elena Vance sends a booking mixing six overnight guests with four lunch-only visitors. The reconciler captures exactly six sleeping guests, refusing ten-pax inflation.",
    marks: [
      { sel: "#result-card", n: "1", label: "Extracted: 6 guests (overnight), 3 rooms, 4 nights, 6 divers", pos: "above" },
      { sel: "#questions-card", n: "2", label: "Zero missing questions: 100% complete in 1 shot", pos: "above" }
    ],
    execute: async (cdp, sessionId) => {
      const text = "Hi Casa Escondida! I am Dr. Elena Vance. We want to book 3 Deluxe Twin rooms for 6 overnight guests checking in October 15, 2026 for 4 nights with full-board meals (no airport transfer needed). Note that 4 local colleagues will drive down from Manila just to join us for lunch on Saturday—so 10 people eating lunch, but only 6 sleeping overnight! All 6 overnight guests are certified divers, but 4 will dive for 3 days (Oct 16–18) while the other 2 will only dive for 1 day (Oct 16).";
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.getElementById('text').value = ${JSON.stringify(text)};
          document.getElementById('go').click();
        })()`
      }, sessionId);

      for (let w = 0; w < 40; w++) {
        await new Promise(r => setTimeout(r, 500));
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const go = document.getElementById('go');
            const rc = document.getElementById('result-card');
            return !go.disabled && rc && rc.style.display === 'block';
          })()`
        }, sessionId);
        if (result.value) {
          console.log(`    -> Case 1 extraction response arrived in ~${(w + 1) * 0.5}s!`);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 600));
    }
  },

  {
    stepId: "single-case-2",
    badge: "CASE 2",
    title: "Single Message (Case 2) — Mid-Sentence Self-Correction (12 → 8)",
    sub: "Reconciler ignores obsolete 12 figure and captures rental gear",
    narration: "In Case 2, Marcus Tan corrects himself mid-sentence from twelve down to eight guests. The system cleanly ignores the obsolete figure, recording eight guests, five divers, and rental gear.",
    marks: [
      { sel: "#result-card", n: "1", label: "Corrected: 8 guests, 4 Twin rooms, 5 divers, airport pickup = true", pos: "above" },
      { sel: "#questions-card", n: "2", label: "All fields complete: zero questions required", pos: "above" }
    ],
    execute: async (cdp, sessionId) => {
      const text = "Hello, this is Marcus Tan from Singapore. Originally we wanted 6 rooms for 12 people starting November 20, 2026—wait, scratch that, 2 couples just cancelled this morning so our final headcount is 8 guests in 4 Twin rooms for 3 nights (Nov 20 to Nov 23) with full-board meals and Manila NAIA airport pickup. Out of the 8 guests, only 5 are divers (diving 2 days: Nov 21–22, needing full BCD and regulator rental) and 3 family members do not dive.";
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.getElementById('text').value = ${JSON.stringify(text)};
          document.getElementById('go').click();
        })()`
      }, sessionId);

      for (let w = 0; w < 40; w++) {
        await new Promise(r => setTimeout(r, 500));
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const go = document.getElementById('go');
            const rc = document.getElementById('result-card');
            return !go.disabled && rc && rc.style.display === 'block';
          })()`
        }, sessionId);
        if (result.value) {
          console.log(`    -> Case 2 extraction response arrived in ~${(w + 1) * 0.5}s!`);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 600));
    }
  },

  {
    stepId: "single-case-3",
    badge: "CASE 3",
    title: "Single Message (Case 3) — 30% Partner Discount & Missing Rooms",
    sub: "Fact Gate escalates discount and generates targeted room question",
    narration: "In Case 3, Captain David Ross demands an unauthorized thirty percent partner discount and omits the room count. The fact gate flags the discount and generates a single question asking for room count.",
    marks: [
      { sel: "#result-card", n: "1", label: "8 stated slots captured · 30% discount escalated to staff", pos: "above" },
      { sel: "#questions-card", n: "2", label: "Targeted Question Generated: 'How many rooms do you need?'", pos: "above" }
    ],
    execute: async (cdp, sessionId) => {
      const text = "Greetings Casa Escondida team! I'm Captain David Ross from Pacific Reef Club. We're bringing 9 guests checking in December 5, 2026 for 5 nights on full-board meals with airport transfer from Manila. 6 of us will do boat diving from Dec 6 to Dec 9 (4 days) and 3 beginners want Open Water courses. Since we are an overseas partner agency, please apply a 30% partner discount to our accommodation and dive packages!";
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.getElementById('text').value = ${JSON.stringify(text)};
          document.getElementById('go').click();
        })()`
      }, sessionId);

      for (let w = 0; w < 40; w++) {
        await new Promise(r => setTimeout(r, 500));
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const go = document.getElementById('go');
            const rc = document.getElementById('result-card');
            return !go.disabled && rc && rc.style.display === 'block';
          })()`
        }, sessionId);
        if (result.value) {
          console.log(`    -> Case 3 extraction response arrived in ~${(w + 1) * 0.5}s!`);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 600));
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
  console.log("=== COMPREHENSIVE WEB DEMO: OVERVIEW + 3 CHAT TURNS + 3 SINGLE CASES ===");

  // 1. Synthesize audio for all steps
  console.log("\n--- Phase 1: Synthesizing Neural Audio (AvaMultilingualNeural -8%) ---");
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    const mp3 = path.join(TMP_DIR, `cue-${i}-${s.stepId}.mp3`);
    synthesizeNeuralAudio(s.narration, mp3);
    s.audioPath = mp3;
    s.duration = getAudioDuration(mp3);
  }

  const totalDuration = STEPS.reduce((sum, s) => sum + s.duration, 0);
  console.log(`\nTotal planned video duration: ${totalDuration.toFixed(1)}s across ${STEPS.length} steps.`);

  // Write SRT
  let currentSec = 0;
  const srtEntries = [];
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    const startStr = formatSrtTime(currentSec);
    const endStr = formatSrtTime(currentSec + s.duration);
    srtEntries.push(`${i + 1}\n${startStr} --> ${endStr}\n${s.narration}\n`);
    currentSec += s.duration;
  }
  const srtContent = srtEntries.join("\n");
  fs.writeFileSync(OUT_SRT_DOCS, srtContent, "utf8");
  fs.writeFileSync(OUT_SRT_PUBLIC, srtContent, "utf8");

  // 2. Launch Chrome CDP
  console.log("\n--- Phase 2: Launching Chrome CDP ---");
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

  // Inject styles, top banner, and large subtitle bar
  await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const st = document.createElement('style');
        st.textContent = \`
          body {
            padding-top: 48px !important;
            padding-bottom: 96px !important;
            overflow: hidden !important;
            background: #0b1120 !important;
            font-family: system-ui, -apple-system, sans-serif !important;
          }
          .topbar { padding: 4px 24px !important; height: 44px !important; }
          .wrap { max-width: 1880px !important; margin: 6px auto !important; padding: 0 24px !important; }
          .lede, #override { display: none !important; }
          .tabs { margin-bottom: 6px !important; }
          .tab-btn { font-size: 14px !important; padding: 6px 18px !important; }
          
          #mode-chat.active {
            max-width: 1380px !important;
            margin: 6px auto !important;
            padding: 16px 24px !important;
            background: #111827 !important;
            border: 1px solid #1e293b !important;
            border-radius: 12px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 12px !important;
          }
          .chat-log {
            min-height: 250px !important;
            max-height: 380px !important;
            overflow-y: auto !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
          }
          .bubble {
            max-width: 78% !important;
            padding: 10px 16px !important;
            border-radius: 12px !important;
            font-size: 14.5px !important;
            line-height: 1.5 !important;
          }
          .bubble-guest {
            align-self: flex-end !important;
            background: #0d9488 !important;
            color: #fff !important;
            border-bottom-right-radius: 4px !important;
          }
          .bubble-assistant {
            align-self: flex-start !important;
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            color: #f8fafc !important;
            border-bottom-left-radius: 4px !important;
          }
          .chat-input-row {
            display: flex !important;
            gap: 10px !important;
          }
          #chat-text {
            flex: 1 !important;
            min-height: 52px !important;
            font-size: 14px !important;
            background: #0f172a !important;
            border: 2px solid #0d9488 !important;
            color: #fff !important;
            border-radius: 8px !important;
            padding: 10px 14px !important;
          }
          #chat-send {
            padding: 0 24px !important;
            font-size: 14px !important;
            font-weight: 700 !important;
          }
          .done-banner {
            margin-top: 4px !important;
            padding: 8px 14px !important;
            border-radius: 8px !important;
            background: #064e3b !important;
            color: #a7f3d0 !important;
            font-size: 13.5px !important;
            font-weight: 700 !important;
            border: 1px solid #059669 !important;
          }

          #mode-single.active {
            display: grid !important;
            grid-template-columns: 42% 58% !important;
            gap: 16px !important;
            align-items: start !important;
            padding: 10px 16px !important;
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
            min-height: 175px !important;
            font-size: 13.5px !important;
            line-height: 1.48 !important;
            background: #0f172a !important;
            border: 2px solid #0d9488 !important;
            color: #f8fafc !important;
            padding: 10px !important;
            border-radius: 8px !important;
          }
          .examples { margin: 4px 0 !important; }
          .actions { margin-top: 4px !important; }
          .btn-primary { font-size: 13.5px !important; padding: 7px 20px !important; font-weight: 700 !important; }
          #result-card {
            grid-column: 2 !important;
            grid-row: 1 / span 5 !important;
            margin-top: 0 !important;
            background: #0f172a !important;
            padding: 8px 14px !important;
            border: 1px solid #1e293b !important;
            border-radius: 10px !important;
          }
          #questions-card {
            grid-column: 1 / span 2 !important;
            margin-top: 4px !important;
            padding: 8px 14px !important;
            background: #0f172a !important;
            border: 1px solid #1e293b !important;
            border-radius: 10px !important;
          }
          #raw { display: none !important; }
          table { width: 100% !important; border-collapse: collapse !important; }
          table th, table td { padding: 4px 8px !important; font-size: 12px !important; border-bottom: 1px solid #1e293b !important; }
          table th { font-size: 10.5px !important; text-transform: uppercase !important; letter-spacing: 0.05em !important; color: #94a3b8 !important; }

          /* TOP QA/QC BANNER */
          #qa-top-banner {
            position: fixed; top: 0; left: 0; right: 0; height: 46px;
            background: linear-gradient(90deg, #3b1f14 0%, #c0703a 100%);
            color: #fff; display: flex; align-items: center; justify-content: space-between;
            padding: 0 24px; z-index: 99999;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
          }

          /* BOTTOM BURNT-IN LARGE SUBTITLE BAR */
          #qa-subbar {
            position: fixed; bottom: 0; left: 0; right: 0; height: 88px;
            background: rgba(8, 14, 26, 0.98);
            backdrop-filter: blur(14px);
            border-top: 2px solid #22d3ee;
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 32px; z-index: 99999;
            box-shadow: 0 -8px 30px rgba(0,0,0,0.85);
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
            <span id="qa-num-badge" style="min-width:28px;padding:0 8px;height:28px;border-radius:999px;background:#fff;color:#3b1f14;font-weight:900;font-size:13.5px;display:inline-flex;align-items:center;justify-content:center;">INTRO</span>
            <strong id="qa-title" style="font-size:15.5px;">Title</strong>
            <span id="qa-sub" style="font-size:13px;opacity:0.92;border-left:1px solid rgba(255,255,255,0.35);padding-left:14px;">Sub</span>
          </div>
          <span style="font-family:monospace;font-size:12px;background:rgba(0,0,0,0.35);padding:4px 12px;border-radius:6px;letter-spacing:0.04em;">CASA EXTRACTOR · BENCHMARK WALKTHROUGH</span>
        \`;
        document.body.appendChild(banner);

        const subbar = document.createElement('div');
        subbar.id = 'qa-subbar';
        subbar.innerHTML = \`
          <div style="display:flex;align-items:center;gap:18px;flex:1;max-width:1700px;">
            <span style="background:#0d9488;color:#ffffff;font-weight:900;font-size:13.5px;padding:6px 14px;border-radius:6px;letter-spacing:0.06em;box-shadow:0 2px 8px rgba(13,148,136,0.5);flex-shrink:0;">CC · EN</span>
            <div id="qa-sub-text" style="flex:1;font-size:22px;font-weight:700;line-height:1.32;color:#ffffff;text-shadow:0 2px 6px rgba(0,0,0,0.95);letter-spacing:0.01em;">Subtitle</div>
          </div>
          <span id="qa-sub-progress" style="font-family:monospace;font-size:13.5px;color:#cbd5e1;background:rgba(255,255,255,0.08);padding:6px 14px;border-radius:6px;margin-left:24px;flex-shrink:0;">INTRO</span>
        \`;
        document.body.appendChild(subbar);

        window.__setScreenState = function(badge, title, sub, subtitleText, progressText, marks) {
          document.getElementById('qa-num-badge').textContent = String(badge);
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

  // 3. Loop through steps, execute, capture, encode
  console.log("\n--- Phase 3: Executing Steps and Encoding Synced Segments ---");
  const segFiles = [];
  let currentElapsed = 0;

  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    const progressLabel = `STEP ${i + 1} OF ${STEPS.length} (${Math.round(currentElapsed)}s / ${Math.round(totalDuration)}s)`;
    console.log(`\n---> [Step ${i + 1}/${STEPS.length}] ${s.title}`);

    // Execute page logic
    await s.execute(cdp, sessionId);

    // Apply overlays
    await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          window.__setScreenState(
            ${JSON.stringify(s.badge)},
            ${JSON.stringify(s.title)},
            ${JSON.stringify(s.sub)},
            ${JSON.stringify(s.narration)},
            ${JSON.stringify(progressLabel)},
            ${JSON.stringify(s.marks)}
          );
        })()`,
      },
      sessionId
    );
    await new Promise((r) => setTimeout(r, 450));

    // Capture screenshot
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const framePng = path.join(TMP_DIR, `step-${i}.png`);
    const segMp4 = path.join(TMP_DIR, `seg-${i}.mp4`);
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
    console.log(`  [Step ${i + 1}] Encoded with Neural Audio & Burnt-in Subtitle (${s.duration.toFixed(1)}s)`);
    currentElapsed += s.duration;
  }

  // 4. Concatenate all segments into final MP4
  console.log("\n--- Phase 4: Concatenating all segments ---");
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

  console.log(`\n=== ALL DONE! FINAL COMPREHENSIVE DEMO VIDEO CREATED ===`);
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
