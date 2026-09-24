// Records ONE continuous screen capture that demonstrates the console the way a
// first-time viewer needs to see it, in this order:
//
//   PART A — Chat mode, building UP from an incomplete enquiry. The guest opens with
//            almost nothing, the assistant asks for what is missing, and the reply is
//            read back at each turn so the viewer can watch fields fill in. This shows
//            the product's actual behaviour: it asks rather than guesses.
//   PART B — Single-message mode, THREE cases, cleared between each, so the viewer sees
//            one dense message become a fully populated field table three times over.
//
// Real screen capture throughout (Chrome Page.startScreencast): every character is a
// real keystroke and every turn is a real POST to the deployed BFF. Nothing composited
// from stills.
//
// The recorder writes a mark per visible action so narration and subtitles can be pinned
// to what is on screen.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const TMP = path.resolve("docs/.two-modes-tmp");
const OUT_DOCS = path.resolve("docs/casa-two-modes-live-demo.mp4");
const OUT_PUBLIC = path.resolve("public/casa-two-modes-live-demo.mp4");
const TARGET = process.env.SCREENCAST_URL || "https://technext-edge-casa-bff.vercel.app/test";
const VIEW = { width: 1920, height: 1080 };

// PART A — a conversation that starts nearly empty and is completed over four turns.
// The opening is deliberately bare: it produces the "what date, how many nights, how
// many guests, a name" reply, which is the clearest demonstration that the assistant
// asks for what it does not have.
const CHAT_TURNS = [
  "Hi! We would like to book a room please.",
  "We are 2 people, from October 17th 2026 for 3 nights.",
  "Yes, we'd both like to dive — and one room is fine.",
  "Name is Anna Weber, and we'll need the airport pickup.",
];

// PART B — three single-message cases. Each is one dense enquiry typed into the box,
// extracted, and then cleared before the next one.
const SINGLE_CASES = [
  {
    id: "case1",
    label: "3 guests · two divers",
    text: "Hi there, 3 of us would like 3 nights from October 24 2026, 2 rooms, full board. Two of us are divers and want to dive on the 25th and 26th. We need the airport pickup. Name: Lucia Ferrari.",
  },
  {
    id: "case2",
    label: "10 guests · split dive schedule",
    text: "Hello, Marco Silva from Blue Compass Dive Club. 5 twin rooms for 10 guests, checking in Oct 10 2026 for 4 nights, full board, with airport transfer from Manila. 6 of us dive Oct 11 to 14, the other 4 dive Oct 11 and 12. We are a partner agency asking about the partner rate.",
  },
  {
    id: "case3",
    label: "4 guests · family, 2 divers",
    text: "Hi, we are 4 guests in 2 rooms for 3 nights from Nov 21 2026. My husband and I are certified divers, the two children will just snorkel. Full board please, and we need the airport transfer. Name: Rachel Lim.",
  },
];

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
    this.readPipe.on("error", () => {});
  }
  on(method, fn) { this.handlers.set(method, fn); }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // A closed socket must reject this call, not crash the process.
      try {
        this.writePipe.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0", (err) => {
          if (err) { this.pending.delete(id); reject(err); }
        });
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function encodeFrames(frames, outPath, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < frames.length; i++) {
    const f = path.join(dir, `f${String(i).padStart(6, "0")}.jpg`);
    fs.writeFileSync(f, Buffer.from(frames[i].data, "base64"));
    files.push(f);
  }
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    lines.push(`file '${files[i].replace(/\\/g, "/")}'`);
    const next = frames[i + 1] ? frames[i + 1].atMs : frames[i].atMs + 800;
    lines.push(`duration ${(Math.max(1, next - frames[i].atMs) / 1000).toFixed(4)}`);
  }
  lines.push(`file '${files[files.length - 1].replace(/\\/g, "/")}'`);
  const list = path.join(dir, "list.txt");
  fs.writeFileSync(list, lines.join("\n"));
  execFileSync(FFMPEG, [
    "-y", "-f", "concat", "-safe", "0", "-i", list,
    "-fps_mode", "vfr",
    "-vf", `scale=${VIEW.width}:${VIEW.height}:force_original_aspect_ratio=decrease,pad=${VIEW.width}:${VIEW.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-movflags", "+faststart", outPath,
  ], { stdio: "ignore" });
}

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const chrome = findChrome();
  if (!chrome) throw new Error("Could not find Chrome");
  const child = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--window-size=${VIEW.width},${VIEW.height}`,
    `--user-data-dir=${path.join(TMP, "profile")}`,
    "--remote-debugging-pipe", "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] });

  const cdp = new Cdp(child);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const page = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false }, sessionId);

  console.log(`[demo] ${TARGET}`);
  await cdp.send("Page.navigate", { url: TARGET + "?r=" + Date.now() }, sessionId);
  await sleep(4500);

  // REC badge; its blinking dot also keeps the compositor painting so the screencast
  // yields a usable frame rate while waiting on the API.
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const st = document.createElement('style');
      st.textContent = '@keyframes recBlink{0%,49%{opacity:1}50%,100%{opacity:.15}}';
      document.head.appendChild(st);
      const d = document.createElement('div');
      d.id = 'rec-dot';
      d.style.cssText = 'position:fixed;top:10px;right:14px;z-index:99999;font:600 12px/1 system-ui;color:#fff;background:rgba(220,38,38,.92);padding:6px 11px;border-radius:999px;display:flex;align-items:center;gap:7px';
      d.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#fff;animation:recBlink 1.1s steps(1,end) infinite"></span>REC · live production capture';
      document.body.appendChild(d);
      return 'ok';
    })()`,
  }, sessionId);
  await sleep(900);

  const frames = [];
  const t0 = Date.now();
  cdp.on("Page.screencastFrame", (params, sid) => {
    frames.push({ atMs: Date.now() - t0, data: params.data });
    cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sid).catch(() => {});
  });
  await cdp.send("Page.startScreencast",
    { format: "jpeg", quality: 92, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 }, sessionId);

  const marks = [];
  const mark = (name) => {
    marks.push({ name, atMs: Date.now() - t0 });
    console.log(`  [t] ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  };
  const apiCalls = [];
  cdp.on("Network.responseReceived", (p) => {
    const url = p.response?.url || "";
    if (url.includes("/v1/converse") || url.includes("/v1/extract")) {
      apiCalls.push({ endpoint: url.split("/").pop(), status: p.response.status, atMs: Date.now() - t0 });
      console.log(`  [api] ${p.response.status} ${url.split("/").pop()}`);
    }
  });

  const box = async (sel) => {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if(!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`,
    }, sessionId);
    return result.value === "null" ? null : JSON.parse(result.value);
  };
  const clickAt = async (b) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 }, sessionId);
  };
  const clickSel = async (sel) => {
    await cdp.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(sel)})?.click()` }, sessionId);
  };
  const innerText = async (sel) => {
    const { result } = await cdp.send("Runtime.evaluate",
      { expression: `(document.querySelector(${JSON.stringify(sel)})?.innerText ?? '').trim()` }, sessionId);
    return String(result.value ?? "");
  };
  const typeInto = async (sel, text, cps = 20) => {
    await cdp.send("Runtime.evaluate", {
      expression: `(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.focus(); t.value=''; return document.activeElement === t; })()`,
    }, sessionId);
    await sleep(220);
    for (const ch of text) {
      await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch }, sessionId);
      await sleep(1000 / cps + Math.random() * 12);
    }
    await sleep(500);
    const { result } = await cdp.send("Runtime.evaluate",
      { expression: `document.querySelector(${JSON.stringify(sel)}).value` }, sessionId);
    if (String(result.value ?? "").length < 10) {
      console.log(`  [warn] typing into ${sel} was dropped; setting the field directly`);
      await cdp.send("Runtime.evaluate", {
        expression: `(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.focus(); t.value=${JSON.stringify(text)}; t.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`,
      }, sessionId);
      await sleep(450);
    }
  };

  // ================= PART A — Chat mode, building up =================
  mark("A-chat-tab");
  await clickSel("#tab-chat");
  await sleep(1500);
  // Start from a genuinely empty console so the opening frame reads as "nothing recorded
  // yet", and so the first turn is short. A pre-filled textarea (the last session's text
  // persists in the browser profile) both misrepresents the opening state and stretches
  // the first turn's typing window into dead air.
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const t = document.getElementById('chat-text');
      if (t) { t.focus(); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); }
      document.getElementById('reset-chat')?.click();
      return 'cleared';
    })()`,
  }, sessionId);
  await sleep(800);

  for (let i = 0; i < CHAT_TURNS.length; i++) {
    const before = await innerText("#chat-meta");
    mark(`A-t${i + 1}-select`);
    const inputBox = await box("#chat-text");
    if (inputBox) await clickAt(inputBox);
    await sleep(450);
    mark(`A-t${i + 1}-typing`);
    await typeInto("#chat-text", CHAT_TURNS[i]);
    mark(`A-t${i + 1}-send`);
    const sendBox = await box("#chat-send");
    if (sendBox) await clickAt(sendBox);

    let arrived = false;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await sleep(300);
      const m = await innerText("#chat-meta");
      if (m && m !== before) { arrived = true; break; }
    }
    mark(`A-t${i + 1}-reply${arrived ? "" : "-FAILED"}`);
    if (!arrived) console.log(`  [warn] chat turn ${i + 1}: no reply within 45s`);
    // Bounded by the reply text: a long summary needs longer on screen than a question.
    const replyLen = (await innerText("#chat-log")).length;
    await sleep(replyLen > 1200 ? 9000 : 6500);
  }
  mark("A-done");

  // ================= PART B — Single-message mode, three cases =================
  mark("B-single-tab");
  await clickSel("#tab-single");
  await sleep(1700);

  for (let c = 0; c < SINGLE_CASES.length; c++) {
    const kase = SINGLE_CASES[c];
    mark(`B-c${c + 1}-select`);
    const box1 = await box("#text");
    if (box1) await clickAt(box1);
    await sleep(400);
    // Clear the previous case first so the viewer sees each one start from empty.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => { const t = document.getElementById('text'); t.focus(); t.value=''; t.dispatchEvent(new Event('input',{bubbles:true})); return 'cleared'; })()`,
    }, sessionId);
    await sleep(350);
    mark(`B-c${c + 1}-typing`);
    await typeInto("#text", kase.text, 26);
    mark(`B-c${c + 1}-extract`);
    const goBox = await box("#go");
    if (goBox) await clickAt(goBox);

    let shown = false;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await sleep(300);
      const r = await cdp.send("Runtime.evaluate", {
        expression: `getComputedStyle(document.getElementById('result-card')).display !== 'none'`,
      }, sessionId);
      if (r?.result?.value === true) { shown = true; break; }
    }
    mark(`B-c${c + 1}-result${shown ? "" : "-FAILED"}`);
    if (!shown) console.log(`  [warn] single-message case ${c + 1}: no result card`);
    await sleep(8500);
  }
  mark("end");

  // Read the session state BEFORE killing Chrome; doing it after produced an EPIPE crash.
  const state = {
    chat: await innerText("#chat-log").catch(() => ""),
    result: await innerText("#result-card").catch(() => ""),
    questions: await innerText("#questions-card").catch(() => ""),
  };
  fs.writeFileSync(path.join(TMP, "final-state.json"), JSON.stringify(state, null, 1), "utf8");

  try { await cdp.send("Page.stopScreencast", {}, sessionId); } catch {}
  child.kill();

  const silent = path.join(TMP, "silent.mp4");
  if (frames.length < 2) throw new Error(`screencast produced only ${frames.length} frames`);
  encodeFrames(frames, silent, path.join(TMP, "frames"));
  fs.copyFileSync(silent, OUT_DOCS);
  fs.copyFileSync(silent, OUT_PUBLIC);

  const timing = { id: "two-modes", marks, apiCalls, frameCount: frames.length, durationMs: frames[frames.length - 1].atMs };
  fs.writeFileSync(path.join(TMP, "timing.json"), JSON.stringify(timing, null, 1));

  console.log(`\n[demo] frames=${frames.length} duration=${(timing.durationMs / 1000).toFixed(1)}s`);
  console.log(`[demo] api calls: ${apiCalls.length} (${apiCalls.map((c) => c.status).join(",")})`);
  console.log(`[demo] wrote ${OUT_DOCS} (${(fs.statSync(OUT_DOCS).size / 1048576).toFixed(2)} MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
