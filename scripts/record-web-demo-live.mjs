import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const FFPROBE = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe";
const TMP = path.resolve("docs/.live-web-demo-tmp");
const OUT_DOCS = path.resolve("docs/casa-web-single-message-demo.mp4");
const OUT_PUBLIC = path.resolve("public/casa-web-single-message-demo.mp4");
const OUT_SRT_DOCS = path.resolve("docs/casa-web-single-message-demo.srt");
const OUT_SRT_PUBLIC = path.resolve("public/casa-web-single-message-demo.srt");

fs.mkdirSync(TMP, { recursive: true });

// Voice matched directly against docs/demo-video/voice-samples/2-new-script-female.mp3
// (en-US-AvaMultilingualNeural at rate -8%, warm, human, natural tone picked by the team)
const VOICE = "en-US-AvaMultilingualNeural";
const VOICE_RATE = "-8%";
const VIEW = { width: 1920, height: 1080 };

function synthesizeNeuralAudio(text, mp3Path, voice = VOICE, rate = VOICE_RATE) {
  console.log(`  [TTS] Synthesizing (${voice}, rate=${rate}): "${text.slice(0, 50)}..."`);
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
    const out = execFileSync(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3Path],
      { encoding: "utf8" }
    );
    const secs = Number(out.trim());
    return Math.max(5.0, Number((secs + 0.6).toFixed(2)));
  } catch (err) {
    return 9.0;
  }
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

const PHASES = [
  // 0. Intro & Controls
  {
    id: "intro",
    badge: "INTRO",
    title: "Casa Escondida AI Test Console — Overview & Controls",
    sub: "Interactive test bench for evaluating multi-turn chat and single-message extraction",
    narration: "Welcome to the Casa Escondida AI Test Console. The interface features multi-turn Chat and Single Message modes, quick test presets, and real-time conversation controls to test how the engine interacts with guests.",
    runLive: async (cdp, sessionId) => {
      await setPointers(cdp, sessionId, [
        { sel: ".tabs", n: "1", label: "Mode Switch: Chat vs Single Message", pos: "below" },
        { sel: ".examples", n: "2", label: "Quick Scenario Presets", pos: "below" },
        { sel: ".chat-input-row", n: "3", label: "Real-time Guest Chat Input", pos: "above" }
      ]);
      await sleep(6500);
      await clearPointers(cdp, sessionId);
      await sleep(800);
    }
  },

  // 1. Chat Turn 1
  {
    id: "chat-turn-1",
    badge: "CHAT 1",
    title: "Chat Mode (Turn 1) — Multi-Turn Booking: Sarah Jenkins",
    sub: "AI acknowledges dates and rooms, and asks targeted diving question without re-asking",
    narration: "First, in Chat mode, we type a natural enquiry for four guests in two rooms. The assistant acknowledges the dates and rooms, and immediately asks whether the group plans to dive.",
    runLive: async (cdp, sessionId) => {
      await setPointers(cdp, sessionId, [
        { sel: "#chat-text", n: "➔", label: "Type booking enquiry...", pos: "above" }
      ]);
      const text = "Hi, I'm Sarah Jenkins. We'd like to book 2 Deluxe rooms for 4 guests checking in Oct 17, 2026 for 3 nights on full board.";
      await typeInto(cdp, sessionId, "#chat-text", text, 32);
      await sleep(350);
      await setPointers(cdp, sessionId, [
        { sel: "#chat-send", n: "➔", label: "Send to AI Engine", pos: "above" }
      ]);
      await clickSel(cdp, sessionId, "#chat-send");
      await waitForCondition(cdp, sessionId, `document.querySelectorAll('.bubble-assistant').length >= 1`, 30);
      await setPointers(cdp, sessionId, [
        { sel: ".bubble-assistant:last-of-type", n: "AI", label: "AI acknowledges dates & rooms, asks if diving", pos: "below" }
      ]);
      await sleep(1800);
    }
  },

  // 2. Chat Turn 2
  {
    id: "chat-turn-2",
    badge: "CHAT 2",
    title: "Chat Mode (Turn 2) — Adding Diving Schedule & Airport Transfer",
    sub: "Trip state updates dynamically in memory with zero duplicate questions",
    narration: "In the second turn, the guest adds boat diving and airport pickup. The assistant updates the trip state in real time and asks to confirm how many people are diving.",
    runLive: async (cdp, sessionId) => {
      await setPointers(cdp, sessionId, [
        { sel: "#chat-text", n: "➔", label: "Guest adds diving & airport transfer...", pos: "above" }
      ]);
      const text = "Yes, 2 of us will do boat diving from Oct 18 to Oct 19, and we need airport pickup from Manila.";
      await typeInto(cdp, sessionId, "#chat-text", text, 32);
      await sleep(350);
      await setPointers(cdp, sessionId, [
        { sel: "#chat-send", n: "➔", label: "Send update", pos: "above" }
      ]);
      await clickSel(cdp, sessionId, "#chat-send");
      await waitForCondition(cdp, sessionId, `document.querySelectorAll('.bubble-assistant').length >= 2`, 30);
      await setPointers(cdp, sessionId, [
        { sel: ".bubble-assistant:last-of-type", n: "AI", label: "AI records transfer, asks for diver count", pos: "below" }
      ]);
      await sleep(1800);
    }
  },

  // 3. Chat Turn 3
  {
    id: "chat-turn-3",
    badge: "CHAT 3",
    title: "Chat Mode (Turn 3) — Slot Completion & Handover Gate",
    sub: "All required variables satisfied · System executes completion gate",
    narration: "Once the guest confirms two divers, all required fields are satisfied. The completion banner triggers, locking the trip state for staff quotation.",
    runLive: async (cdp, sessionId) => {
      await setPointers(cdp, sessionId, [
        { sel: "#chat-text", n: "➔", label: "Confirming 2 divers & pickup...", pos: "above" }
      ]);
      const text = "Exactly 2 divers. Manila pickup for all 4 of us, arriving at 11 AM. Thanks!";
      await typeInto(cdp, sessionId, "#chat-text", text, 32);
      await sleep(350);
      await setPointers(cdp, sessionId, [
        { sel: "#chat-send", n: "➔", label: "Send confirmation", pos: "above" }
      ]);
      await clickSel(cdp, sessionId, "#chat-send");
      await waitForCondition(cdp, sessionId, `(() => { const b = document.getElementById('done-banner'); return b && b.style.display !== 'none'; })()`, 30);
      await setPointers(cdp, sessionId, [
        { sel: "#done-banner", n: "✓", label: "All 8 slots satisfied · Trip state locked", pos: "above" }
      ]);
      await sleep(2200);
    }
  },

  // 4. Mode Switch
  {
    id: "switch",
    badge: "SWITCH",
    title: "Mode Switch — Single Message Unstructured Stress Benchmarks",
    sub: "Testing complex, multi-variable single paragraphs without conversational back-and-forth",
    narration: "Now, we switch to Single Message mode. Here, the engine is stress-tested against dense, unstructured paragraphs with self-corrections, traps, and missing variables in one single pass.",
    runLive: async (cdp, sessionId) => {
      await setPointers(cdp, sessionId, [
        { sel: "#tab-single", n: "➔", label: "Switch to Single Message Mode", pos: "below" }
      ]);
      await sleep(900);
      await clickSel(cdp, sessionId, "#tab-single");
      await sleep(600);
      await setPointers(cdp, sessionId, [
        { sel: "#text", n: "➔", label: "Unstructured single paragraph input", pos: "below" }
      ]);
      await sleep(1600);
      await clearPointers(cdp, sessionId);
    }
  },

  // 5. Single Case 1: Elena Vance
  {
    id: "single-1",
    badge: "CASE 1",
    title: "Single Message (Case 1) — Overnight (6) vs Lunch Visitors (4)",
    sub: "Symbolic Math Reconciler captures 6 guests and stores day visitors in evidence",
    narration: "In Case 1, Dr. Elena Vance sends a booking mixing six overnight guests with four lunch-only visitors. The reconciler captures exactly six sleeping guests, refusing ten-pax inflation.",
    runLive: async (cdp, sessionId) => {
      const text = "Hi Casa Escondida! I am Dr. Elena Vance. We want to book 3 Deluxe Twin rooms for 6 overnight guests checking in October 15, 2026 for 4 nights with full-board meals (no airport transfer needed). Note that 4 local colleagues will drive down from Manila just to join us for lunch on Saturday—so 10 people eating lunch, but only 6 sleeping overnight! All 6 overnight guests are certified divers, but 4 will dive for 3 days (Oct 16–18) while the other 2 will only dive for 1 day (Oct 16).";
      await pasteInto(cdp, sessionId, "#text", text);
      await sleep(400);
      await setPointers(cdp, sessionId, [
        { sel: "#go", n: "➔", label: "Run Extraction", pos: "above" }
      ]);
      await clickSel(cdp, sessionId, "#go");
      await waitForCondition(cdp, sessionId, `(() => { const go = document.getElementById('go'); const rc = document.getElementById('result-card'); return !go.disabled && rc && rc.style.display === 'block'; })()`, 30);
      await setPointers(cdp, sessionId, [
        { sel: "#result-card", n: "✓", label: "Extracted: 6 overnight guests (4 lunch visitors excluded)", pos: "above" }
      ]);
      await sleep(2000);
    }
  },

  // 6. Single Case 2: Marcus Tan
  {
    id: "single-2",
    badge: "CASE 2",
    title: "Single Message (Case 2) — Mid-Sentence Self-Correction (12 → 8)",
    sub: "Reconciler ignores obsolete 12 figure and captures rental gear",
    narration: "In Case 2, Marcus Tan corrects himself mid-sentence from twelve down to eight guests. The system cleanly ignores the obsolete figure, recording eight guests, five divers, and rental gear.",
    runLive: async (cdp, sessionId) => {
      const text = "Hello, this is Marcus Tan from Singapore. Originally we wanted 6 rooms for 12 people starting November 20, 2026—wait, scratch that, 2 couples just cancelled this morning so our final headcount is 8 guests in 4 Twin rooms for 3 nights (Nov 20 to Nov 23) with full-board meals and Manila NAIA airport pickup. Out of the 8 guests, only 5 are divers (diving 2 days: Nov 21–22, needing full BCD and regulator rental) and 3 family members do not dive.";
      await pasteInto(cdp, sessionId, "#text", text);
      await sleep(400);
      await setPointers(cdp, sessionId, [
        { sel: "#go", n: "➔", label: "Run Extraction", pos: "above" }
      ]);
      await clickSel(cdp, sessionId, "#go");
      await waitForCondition(cdp, sessionId, `(() => { const go = document.getElementById('go'); const rc = document.getElementById('result-card'); return !go.disabled && rc && rc.style.display === 'block'; })()`, 30);
      await setPointers(cdp, sessionId, [
        { sel: "#result-card", n: "✓", label: "Self-correction: 8 guests captured (12 cancelled ignored)", pos: "above" }
      ]);
      await sleep(2000);
    }
  },

  // 7. Single Case 3: David Ross
  {
    id: "single-3",
    badge: "CASE 3",
    title: "Single Message (Case 3) — 30% Partner Discount & Missing Rooms",
    sub: "Fact Gate escalates discount and generates targeted room question",
    narration: "In Case 3, Captain David Ross demands an unauthorized thirty percent partner discount and omits the room count. The fact gate flags the discount and generates a single question asking for room count.",
    runLive: async (cdp, sessionId) => {
      const text = "Greetings Casa Escondida team! I'm Captain David Ross from Pacific Reef Club. We're bringing 9 guests checking in December 5, 2026 for 5 nights on full-board meals with airport transfer from Manila. 6 of us will do boat diving from Dec 6 to Dec 9 (4 days) and 3 beginners want Open Water courses. Since we are an overseas partner agency, please apply a 30% partner discount to our accommodation and dive packages!";
      await pasteInto(cdp, sessionId, "#text", text);
      await sleep(400);
      await setPointers(cdp, sessionId, [
        { sel: "#go", n: "➔", label: "Run Extraction", pos: "above" }
      ]);
      await clickSel(cdp, sessionId, "#go");
      await waitForCondition(cdp, sessionId, `(() => { const go = document.getElementById('go'); const rc = document.getElementById('result-card'); return !go.disabled && rc && rc.style.display === 'block'; })()`, 30);
      await setPointers(cdp, sessionId, [
        { sel: "#questions-card", n: "!", label: "Fact Gate: 30% discount flagged · Missing room count asked", pos: "above" }
      ]);
      await sleep(2200);
    }
  }
];

// Helper functions for CDP live interaction
async function clickSel(cdp, sessionId, sel) {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el) { el.click(); return true; }
      return false;
    })()`
  }, sessionId);
}

async function typeInto(cdp, sessionId, sel, text, cps = 28) {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el) { el.focus(); el.value = ''; }
    })()`
  }, sessionId);
  await sleep(150);

  // Type smoothly
  for (const ch of text) {
    await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch }, sessionId);
    await sleep(Math.round(1000 / cps + Math.random() * 8));
  }
  await sleep(200);

  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    })()`
  }, sessionId);
}

async function pasteInto(cdp, sessionId, sel, text) {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el) {
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`
  }, sessionId);
}

async function waitForCondition(cdp, sessionId, expression, maxTries = 40) {
  for (let i = 0; i < maxTries; i++) {
    const { result } = await cdp.send("Runtime.evaluate", { expression }, sessionId);
    if (result && result.value) return true;
    await sleep(400);
  }
  return false;
}

function setupPageGuideUI() {
  const st = document.createElement("style");
  st.textContent = `
    body {
      padding-top: 14px !important;
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

    /* CLEAN REAL-TIME POINTERS & DOCK SUBTITLES */
    .pointer-glow-target {
      outline: 2.5px solid #22d3ee !important;
      outline-offset: 4px !important;
      box-shadow: 0 0 20px rgba(34, 211, 238, 0.45) !important;
      transition: all 0.25s ease !important;
    }

    .pointer-wrapper {
      position: fixed;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
      filter: drop-shadow(0 6px 16px rgba(0,0,0,0.65));
      animation: pointerFloat 1.3s ease-in-out infinite alternate;
    }

    .pointer-arrow-icon {
      font-size: 22px;
      line-height: 1;
      color: #22d3ee;
      text-shadow: 0 0 12px rgba(34, 211, 238, 0.85);
      margin: 2px 0;
    }

    .pointer-pill {
      background: rgba(15, 23, 42, 0.96);
      border: 1.5px solid #22d3ee;
      border-radius: 999px;
      padding: 6px 16px;
      font-size: 13.5px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    }

    .pointer-badge {
      background: #22d3ee;
      color: #042f2e;
      font-size: 11.5px;
      font-weight: 900;
      padding: 2px 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    @keyframes pointerFloat {
      0% { transform: translateY(0); }
      100% { transform: translateY(-6px); }
    }

    /* FLOATING TOP STATUS BADGE */
    #video-top-tag {
      position: fixed;
      top: 14px;
      right: 24px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 999px;
      padding: 6px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 999998;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    }
    @keyframes liveDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

    /* FLOATING DOCK SUBTITLE BAR */
    #video-subbar {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: min(88%, 1300px);
      min-height: 64px;
      background: rgba(10, 15, 29, 0.94);
      backdrop-filter: blur(14px);
      border: 1.5px solid rgba(34, 211, 238, 0.45);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px 32px;
      z-index: 999998;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.8);
    }
    #video-sub-text {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.34;
      color: #ffffff;
      text-align: center;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.95);
      letter-spacing: 0.01em;
    }
  `;
  document.head.appendChild(st);

  const topTag = document.createElement("div");
  topTag.id = "video-top-tag";
  topTag.innerHTML =
    '<span style="width:8px;height:8px;border-radius:50%;background:#ef4444;box-shadow:0 0 8px #ef4444;animation:liveDot 1.2s infinite ease-in-out;"></span>' +
    '<span style="font-weight:800;color:#fff;font-size:12px;letter-spacing:0.05em;">LIVE SCREENCAST</span>' +
    '<span style="color:#94a3b8;font-size:12px;border-left:1px solid #334155;padding-left:8px;">BFF Edge · Console</span>';
  document.body.appendChild(topTag);

  const subbar = document.createElement("div");
  subbar.id = "video-subbar";
  subbar.innerHTML =
    '<div style="display:flex;align-items:center;gap:16px;width:100%;">' +
    '<span style="background:#0d9488;color:#ffffff;font-weight:900;font-size:12.5px;padding:4px 10px;border-radius:6px;letter-spacing:0.06em;flex-shrink:0;">CC · EN</span>' +
    '<div id="video-sub-text" style="flex:1;text-align:center;">Welcome to Casa Escondida...</div>' +
    '</div>';
  document.body.appendChild(subbar);

  window.__showPointers = function (marks) {
    window.__clearPointers();
    for (const m of marks || []) {
      const el = document.querySelector(m.sel);
      if (!el) continue;
      el.classList.add("pointer-glow-target");
      const r = el.getBoundingClientRect();
      const w = document.createElement("div");
      let pos = m.pos || "above";
      if (pos === "below" && r.bottom + 60 > window.innerHeight - 90) pos = "above";
      else if (pos === "above" && r.top < 60) pos = "below";

      w.className = "pointer-wrapper " + (pos === "below" ? "pos-below" : "pos-above");
      const badge = m.n || "➔";
      if (pos === "below") {
        w.innerHTML =
          '<div class="pointer-arrow-icon">▲</div>' +
          '<div class="pointer-pill"><span class="pointer-badge">' + badge + '</span><span>' + m.label + '</span></div>';
        const cx = Math.max(160, Math.min(window.innerWidth - 160, r.left + r.width / 2));
        w.style.left = cx + "px";
        w.style.transform = "translateX(-50%)";
        w.style.top = (r.bottom + 8) + "px";
      } else {
        w.innerHTML =
          '<div class="pointer-pill"><span class="pointer-badge">' + badge + '</span><span>' + m.label + '</span></div>' +
          '<div class="pointer-arrow-icon">▼</div>';
        const cx = Math.max(160, Math.min(window.innerWidth - 160, r.left + r.width / 2));
        w.style.left = cx + "px";
        w.style.transform = "translateX(-50%)";
        w.style.top = Math.max(12, r.top - 52) + "px";
      }
      document.body.appendChild(w);
    }
  };

  window.__clearPointers = function () {
    document.querySelectorAll(".pointer-wrapper").forEach((e) => e.remove());
    document.querySelectorAll(".pointer-glow-target").forEach((e) => e.classList.remove("pointer-glow-target"));
  };

  window.__setSubtitle = function (text) {
    const el = document.getElementById("video-sub-text");
    if (el) el.textContent = text;
  };
}

async function main() {
  console.log("=== STARTING FULL LIVE RECORDING DEMO (SCREENCAST + AUDIO + SUBTITLES) ===");

  // 1. Synthesize audio clips
  console.log("\n--- Phase 1: Synthesizing Neural Speech (AvaMultilingualNeural -8%) ---");
  for (let i = 0; i < PHASES.length; i++) {
    const p = PHASES[i];
    const mp3 = path.join(TMP, `cue-${i}-${p.id}.mp3`);
    synthesizeNeuralAudio(p.narration, mp3);
    p.audioPath = mp3;
    p.audioDuration = getAudioDuration(mp3);
  }

  // 2. Launch Chrome CDP
  console.log("\n--- Phase 2: Launching Chrome CDP ---");
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

  console.log("  Navigating to live test-console...");
  await cdp.send("Page.navigate", { url: "https://technext-edge-casa-bff.vercel.app/test-console" }, sessionId);
  await sleep(2500);

  // Inject UI Styles and Pointer Guidance System
  await cdp.send(
    "Runtime.evaluate",
    { expression: `(${setupPageGuideUI.toString()})()` },
    sessionId
  );

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
    { format: "jpeg", quality: 88, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 },
    sessionId
  );

  // 4. Run through all phases with live interaction
  console.log("\n--- Phase 4: Executing Live Interactive Phases ---");
  const audioTimeline = [];
  let currentElapsed = 0;

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

    // Run live action (typing, clicking, waiting for reply)
    const actionStart = Date.now();
    await p.runLive(cdp, sessionId);
    const actionTook = (Date.now() - actionStart) / 1000;

    // Hold on screen until audio narration completes
    const remaining = Math.max(0, p.audioDuration - actionTook);
    if (remaining > 0) {
      await sleep(Math.round(remaining * 1000));
    }
    await clearPointers(cdp, sessionId);
  }

  // Stop screencast
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

  // 5. Encode Frames into Silent MP4
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

  // 6. Build Audio Track
  console.log("\n--- Phase 7: Building Audio Track Synced to Live Timeline ---");
  // Build complex filter to delay and mix all audio clips at their exact start times
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
    { stdio: "ignore" }
  );

  // 7. Combine Video + Audio into Final MP4
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
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      OUT_DOCS,
    ],
    { stdio: "ignore" }
  );

  fs.copyFileSync(OUT_DOCS, OUT_PUBLIC);

  console.log(`\n=== SUCCESS! TRUE LIVE SCREENCAST VIDEO CREATED ===`);
  console.log(`  - Video Docs: ${OUT_DOCS}`);
  console.log(`  - Video Public: ${OUT_PUBLIC}`);
  console.log(`  - Subtitles Docs: ${OUT_SRT_DOCS}`);
  console.log(`  - Subtitles Public: ${OUT_SRT_PUBLIC}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
