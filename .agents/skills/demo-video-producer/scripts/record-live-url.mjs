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

const VOICE = "en-US-AvaMultilingualNeural";
const VOICE_RATE = "-8%";
const VIEW = { width: 1920, height: 1080 };

function synthesizeNeuralAudio(text, mp3Path) {
  const dir = path.dirname(mp3Path);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`  [TTS] Synthesizing: "${text.slice(0, 55)}..."`);
  execFileSync(
    "edge-tts",
    [
      "--voice",
      VOICE,
      `--rate=${VOICE_RATE}`,
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
    const secs = parseFloat(out.trim());
    return Number.isFinite(secs) ? secs : 5.0;
  } catch (err) {
    return 5.0;
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

async function showArrow(cdp, sessionId, sel, label, pos = "above", n = "Γ₧ö") {
  await cdp.send("Runtime.evaluate", {
    expression: `window.__showPointer(${JSON.stringify(sel)}, ${JSON.stringify(label)}, ${JSON.stringify(pos)}, ${JSON.stringify(n)})`,
  }, sessionId);
}

async function clearArrow(cdp, sessionId) {
  await cdp.send("Runtime.evaluate", {
    expression: `window.__clearPointer()`,
  }, sessionId);
}

async function setSubtitle(cdp, sessionId, text) {
  await cdp.send("Runtime.evaluate", {
    expression: `window.__setSubtitle(${JSON.stringify(text)})`,
  }, sessionId);
}

async function clickEl(cdp, sessionId, sel) {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el) { el.click(); return true; }
      return false;
    })()`
  }, sessionId);
}

async function typeText(cdp, sessionId, sel, text, cps = 32) {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el) { el.focus(); el.value = ''; }
    })()`
  }, sessionId);
  await sleep(150);

  for (const ch of text) {
    await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch }, sessionId);
    await sleep(Math.round(1000 / cps + Math.random() * 8));
  }
  await sleep(150);

  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    })()`
  }, sessionId);
}

async function pasteText(cdp, sessionId, sel, text) {
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
    await sleep(350);
  }
  return false;
}

// Injected overlay functions - purely floating, ZERO interference with native page CSS
function setupFloatingOverlays() {
  const st = document.createElement("style");
  st.textContent = `
    .pointer-glow-target {
      outline: 3px solid #22d3ee !important;
      outline-offset: 4px !important;
      box-shadow: 0 0 20px rgba(34, 211, 238, 0.5) !important;
      transition: all 0.2s ease !important;
    }

    .pointer-wrapper {
      position: fixed;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
      filter: drop-shadow(0 6px 16px rgba(0,0,0,0.7));
      animation: pointerBounce 1.3s ease-in-out infinite alternate;
    }

    .pointer-arrow-icon {
      font-size: 24px;
      line-height: 1;
      color: #22d3ee;
      text-shadow: 0 0 14px rgba(34, 211, 238, 0.9);
      margin: 2px 0;
    }

    .pointer-pill {
      background: rgba(15, 23, 42, 0.96);
      border: 1.5px solid #22d3ee;
      border-radius: 999px;
      padding: 6px 18px;
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      box-shadow: 0 4px 18px rgba(0,0,0,0.55);
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

    @keyframes pointerBounce {
      0% { transform: translateY(0); }
      100% { transform: translateY(-7px); }
    }

    #video-subbar {
      position: fixed;
      bottom: 18px;
      left: 50%;
      transform: translateX(-50%);
      width: min(88%, 1320px);
      min-height: 64px;
      background: rgba(11, 17, 32, 0.95);
      backdrop-filter: blur(16px);
      border: 1.5px solid rgba(34, 211, 238, 0.45);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px 32px;
      z-index: 999998;
      box-shadow: 0 10px 35px rgba(0, 0, 0, 0.85);
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

  const subbar = document.createElement("div");
  subbar.id = "video-subbar";
  subbar.innerHTML =
    '<div style="display:flex;align-items:center;gap:16px;width:100%;">' +
    '<span style="background:#0d9488;color:#ffffff;font-weight:900;font-size:12.5px;padding:4px 10px;border-radius:6px;letter-spacing:0.06em;flex-shrink:0;">CC ┬╖ EN</span>' +
    '<div id="video-sub-text" style="flex:1;text-align:center;">Casa Extractor Test Console</div>' +
    '</div>';
  document.body.appendChild(subbar);

  window.__showPointer = function (sel, label, pos = "above", badge = "Γ₧ö") {
    window.__clearPointer();
    const el = document.querySelector(sel);
    if (!el) return;
    el.classList.add("pointer-glow-target");
    const r = el.getBoundingClientRect();
    const w = document.createElement("div");

    if (pos === "below" && r.bottom + 65 > window.innerHeight - 85) pos = "above";
    else if (pos === "above" && r.top < 65) pos = "below";

    w.className = "pointer-wrapper " + (pos === "below" ? "pos-below" : "pos-above");
    if (pos === "below") {
      w.innerHTML =
        '<div class="pointer-arrow-icon">Γû▓</div>' +
        '<div class="pointer-pill"><span class="pointer-badge">' + badge + '</span><span>' + label + '</span></div>';
      const cx = Math.max(160, Math.min(window.innerWidth - 160, r.left + r.width / 2));
      w.style.left = cx + "px";
      w.style.transform = "translateX(-50%)";
      w.style.top = (r.bottom + 8) + "px";
    } else {
      w.innerHTML =
        '<div class="pointer-pill"><span class="pointer-badge">' + badge + '</span><span>' + label + '</span></div>' +
        '<div class="pointer-arrow-icon">Γû╝</div>';
      const cx = Math.max(160, Math.min(window.innerWidth - 160, r.left + r.width / 2));
      w.style.left = cx + "px";
      w.style.transform = "translateX(-50%)";
      w.style.top = Math.max(12, r.top - 54) + "px";
    }
    document.body.appendChild(w);
  };

  window.__clearPointer = function () {
    document.querySelectorAll(".pointer-wrapper").forEach((e) => e.remove());
    document.querySelectorAll(".pointer-glow-target").forEach((e) => e.classList.remove("pointer-glow-target"));
  };

  window.__setSubtitle = function (text) {
    const el = document.getElementById("video-sub-text");
    if (el) el.textContent = text;
  };
}

// 16 ATOMIC, TIGHTLY SYNCHRONIZED ACTION-CUES
const ACTIONS = [
  // Scene 0: Overview & Controls
  {
    id: "01-welcome",
    text: "Welcome to the Casa Extractor test bench on our live Edge environment.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, ".topbar", "Casa Extractor ┬╖ Live Edge Environment", "below", "1");
      await sleep(1500);
    }
  },
  {
    id: "02-modes",
    text: "Here, we can switch between multi-turn Chat and Single Message extraction modes.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, ".tabs", "Mode Switch: Chat vs Single Message", "below", "2");
      await sleep(1500);
    }
  },
  {
    id: "03-controls",
    text: "The bench provides quick scenario presets and real-time conversation controls.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, ".examples", "Quick Scenario Presets & Input Controls", "below", "3");
      await sleep(1500);
      await clearArrow(cdp, sid);
    }
  },

  // Scene 1: Chat Turn 1
  {
    id: "04-chat1-type",
    text: "First, in Chat mode, we type Sarah Jenkins's booking enquiry for four guests in two rooms.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, "#chat-text", "Typing Sarah Jenkins's booking enquiry...", "above");
      const text = "Hi, I'm Sarah Jenkins. We'd like to book 2 Deluxe rooms for 4 guests checking in Oct 17, 2026 for 3 nights on full board.";
      await typeText(cdp, sid, "#chat-text", text, 32);
      await sleep(300);
      await showArrow(cdp, sid, "#chat-send", "Click Send to dispatch to AI engine", "above");
      await clickEl(cdp, sid, "#chat-send");
      await waitForCondition(cdp, sid, `document.querySelectorAll('.bubble-assistant').length >= 1`, 30);
    }
  },
  {
    id: "05-chat1-reply",
    text: "The assistant acknowledges dates and rooms, and immediately asks whether the group plans to dive.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, ".bubble-assistant:last-of-type", "AI acknowledges dates & rooms, asks if diving", "below", "AI");
      await sleep(1800);
    }
  },

  // Scene 2: Chat Turn 2
  {
    id: "06-chat2-type",
    text: "In the second turn, the guest adds boat diving for two, plus Manila airport pickup.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, "#chat-text", "Adding boat diving and airport pickup...", "above");
      const text = "Yes, 2 of us will do boat diving from Oct 18 to Oct 19, and we need airport pickup from Manila.";
      await typeText(cdp, sid, "#chat-text", text, 32);
      await sleep(300);
      await showArrow(cdp, sid, "#chat-send", "Send update to assistant", "above");
      await clickEl(cdp, sid, "#chat-send");
      await waitForCondition(cdp, sid, `document.querySelectorAll('.bubble-assistant').length >= 2`, 30);
    }
  },
  {
    id: "07-chat2-reply",
    text: "The engine updates diving and transfer, then asks to confirm the exact diver headcount.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, ".bubble-assistant:last-of-type", "AI updates state in real time, asks for diver count", "below", "AI");
      await sleep(1800);
    }
  },

  // Scene 3: Chat Turn 3
  {
    id: "08-chat3-type",
    text: "Sarah confirms two divers and an eleven AM arrival at Manila airport.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, "#chat-text", "Confirming 2 divers and 11 AM pickup...", "above");
      const text = "Exactly 2 divers. Manila pickup for all 4 of us, arriving at 11 AM. Thanks!";
      await typeText(cdp, sid, "#chat-text", text, 32);
      await sleep(300);
      await showArrow(cdp, sid, "#chat-send", "Send confirmation", "above");
      await clickEl(cdp, sid, "#chat-send");
      await waitForCondition(cdp, sid, `(() => { const b = document.getElementById('done-banner'); return b && b.style.display !== 'none'; })()`, 30);
    }
  },
  {
    id: "09-chat3-reply",
    text: "All required fields are satisfied. The completion banner locks the trip state for staff quotation.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, "#done-banner", "All 8 slots satisfied ┬╖ Trip state locked for quotation", "above", "Γ£ô");
      await sleep(2200);
    }
  },

  // Scene 4: Mode Switch
  {
    id: "10-switch",
    text: "Now, we switch to Single Message mode to benchmark dense unstructured paragraphs.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, "#tab-single", "Click to switch to Single Message mode", "below");
      await sleep(700);
      await clickEl(cdp, sid, "#tab-single");
      await sleep(600);
      await showArrow(cdp, sid, "#text", "Single message unstructured input benchmarking", "below");
      await sleep(1200);
      await clearArrow(cdp, sid);
    }
  },

  // Scene 5: Case 1: Elena Vance
  {
    id: "11-case1-input",
    text: "Case 1 tests Dr. Elena Vance: six overnight guests mixing with four lunch visitors.",
    run: async (cdp, sid) => {
      const text = "Hi Casa Escondida! I am Dr. Elena Vance. We want to book 3 Deluxe Twin rooms for 6 overnight guests checking in October 15, 2026 for 4 nights with full-board meals (no airport transfer needed). Note that 4 local colleagues will drive down from Manila just to join us for lunch on SaturdayΓÇöso 10 people eating lunch, but only 6 sleeping overnight! All 6 overnight guests are certified divers, but 4 will dive for 3 days (Oct 16ΓÇô18) while the other 2 will only dive for 1 day (Oct 16).";
      await pasteText(cdp, sid, "#text", text);
      await sleep(300);
      await showArrow(cdp, sid, "#go", "Click Extract", "above");
      await clickEl(cdp, sid, "#go");
      await waitForCondition(cdp, sid, `(() => { const go = document.getElementById('go'); const rc = document.getElementById('result-card'); return !go.disabled && rc && rc.style.display === 'block'; })()`, 30);
    }
  },
  {
    id: "12-case1-result",
    text: "The reconciler captures exactly six sleeping guests, refusing ten-pax inflation.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, "#result-card", "Extracted: 6 overnight guests (4 lunch visitors excluded)", "above", "Γ£ô");
      await sleep(2200);
    }
  },

  // Scene 6: Case 2: Marcus Tan
  {
    id: "13-case2-input",
    text: "Case 2 tests a mid-sentence cancellation from twelve down to eight guests.",
    run: async (cdp, sid) => {
      const text = "Hello, this is Marcus Tan from Singapore. Originally we wanted 6 rooms for 12 people starting November 20, 2026ΓÇöwait, scratch that, 2 couples just cancelled this morning so our final headcount is 8 guests in 4 Twin rooms for 3 nights (Nov 20 to Nov 23) with full-board meals and Manila NAIA airport pickup. Out of the 8 guests, only 5 are divers (diving 2 days: Nov 21ΓÇô22, needing full BCD and regulator rental) and 3 family members do not dive.";
      await pasteText(cdp, sid, "#text", text);
      await sleep(300);
      await showArrow(cdp, sid, "#go", "Click Extract", "above");
      await clickEl(cdp, sid, "#go");
      await waitForCondition(cdp, sid, `(() => { const go = document.getElementById('go'); const rc = document.getElementById('result-card'); return !go.disabled && rc && rc.style.display === 'block'; })()`, 30);
    }
  },
  {
    id: "14-case2-result",
    text: "The system cleanly ignores the cancelled figure, recording eight guests and five divers.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, "#result-card", "Self-correction: 8 guests captured (12 cancelled ignored)", "above", "Γ£ô");
      await sleep(2200);
    }
  },

  // Scene 7: Case 3: David Ross
  {
    id: "15-case3-input",
    text: "Case 3 tests a demand for an unauthorized thirty percent partner discount.",
    run: async (cdp, sid) => {
      const text = "Good day, Captain David Ross here. We are 10 divers checking in Dec 5, 2026 for 5 nights. All 10 need unlimited shore diving and 3 also want PADI Open Water courses. We demand a 30% partner discount based on our veteran status. Please confirm the rate.";
      await pasteText(cdp, sid, "#text", text);
      await sleep(300);
      await showArrow(cdp, sid, "#go", "Click Extract", "above");
      await clickEl(cdp, sid, "#go");
      await waitForCondition(cdp, sid, `(() => { const go = document.getElementById('go'); const rc = document.getElementById('result-card'); return !go.disabled && rc && rc.style.display === 'block'; })()`, 30);
    }
  },
  {
    id: "16-case3-result",
    text: "The fact gate flags the discount and generates a targeted question asking for the room count.",
    run: async (cdp, sid) => {
      await showArrow(cdp, sid, "#questions-card", "Fact Gate: 30% discount flagged ┬╖ 1 missing room question", "above", "!");
      await sleep(2400);
    }
  }
];

async function main() {
  console.log("=== STARTING PERFECTLY SYNCHRONIZED LIVE RECORDING DEMO ===");
  console.log("Target: https://technext-edge-casa-bff.vercel.app/test-console (Pure Native UI)\n");

  // 1. Synthesize Audio for all 16 atomic cues
  console.log("--- Phase 1: Synthesizing Audio Cues (en-US-AvaMultilingualNeural -8%) ---");
  for (let i = 0; i < ACTIONS.length; i++) {
    const a = ACTIONS[i];
    const mp3 = path.join(TMP, `cue-${String(i).padStart(2, "0")}-${a.id}.mp3`);
    synthesizeNeuralAudio(a.text, mp3);
    a.audioPath = mp3;
    a.audioDuration = getAudioDuration(mp3);
    console.log(`  [Cue ${i + 1}/${ACTIONS.length}] ${a.id}: ${a.audioDuration.toFixed(2)}s`);
  }

  // 2. Launch Chrome CDP directly on production URL
  console.log("\n--- Phase 2: Launching Chrome CDP on https://technext-edge-casa-bff.vercel.app/test-console ---");
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

  // Inject only the floating pointer & subtitle dock (ZERO alteration to page styling)
  await cdp.send(
    "Runtime.evaluate",
    { expression: `(${setupFloatingOverlays.toString()})()` },
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
    { format: "jpeg", quality: 90, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 },
    sessionId
  );

  // 4. Run through all 16 atomic actions with EXACT audio timing
  console.log("\n--- Phase 4: Executing Synchronized Live Actions ---");
  const audioTimeline = [];

  for (let i = 0; i < ACTIONS.length; i++) {
    const a = ACTIONS[i];
    const cueStartMs = Date.now() - t0;
    console.log(`\n---> [Step ${i + 1}/${ACTIONS.length}] ${a.id} (audio: ${a.audioDuration.toFixed(2)}s)`);

    await setSubtitle(cdp, sessionId, a.text);

    audioTimeline.push({
      startSec: cueStartMs / 1000,
      duration: a.audioDuration,
      audioPath: a.audioPath,
      text: a.text,
    });

    const actionStart = Date.now();
    await a.run(cdp, sessionId);
    const actionTook = (Date.now() - actionStart) / 1000;

    // Synchronize: hold until audio narration has completed before advancing
    const remaining = Math.max(0, a.audioDuration - actionTook);
    if (remaining > 0) {
      await sleep(Math.round(remaining * 1000));
    }
    await sleep(200); // comfortable brief breath between cues
    await clearArrow(cdp, sessionId);
  }

  // 5. Stop screencast
  console.log("\n--- Phase 5: Stopping Screencast & Flushing Frames ---");
  await sleep(1000);
  await cdp.send("Page.stopScreencast", {}, sessionId);
  child.kill();

  console.log(`  Total live frames captured: ${frames.length}`);
  const totalVideoSec = (Date.now() - t0) / 1000;
  console.log(`  Total live recording duration: ${totalVideoSec.toFixed(2)}s`);

  // 6. Write accurate SRT matching the exact live timestamps
  const srtEntries = [];
  for (let i = 0; i < audioTimeline.length; i++) {
    const a = audioTimeline[i];
    const startStr = formatSrtTime(a.startSec);
    const endStr = formatSrtTime(a.startSec + a.duration);
    srtEntries.push(`${i + 1}\n${startStr} --> ${endStr}\n${a.text}\n`);
  }
  const srtContent = srtEntries.join("\n");
  fs.writeFileSync(OUT_SRT_DOCS, srtContent, "utf8");
  fs.writeFileSync(OUT_SRT_PUBLIC, srtContent, "utf8");

  // 7. Encode frames into silent MP4
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

  // 8. Build Audio Track
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

  // 9. Mux Video + Audio
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

  console.log(`\n=== SUCCESS! PERFECTLY SYNCHRONIZED DEMO CREATED ===`);
  console.log(`  - Video Docs: ${OUT_DOCS}`);
  console.log(`  - Video Public: ${OUT_PUBLIC}`);
  console.log(`  - Subtitles Docs: ${OUT_SRT_DOCS}`);
  console.log(`  - Subtitles Public: ${OUT_SRT_PUBLIC}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
