// Records REAL screen captures of the production console, one per scenario.
//
// Same machinery as scripts/record-live-screencast.mjs (Chrome Page.startScreencast,
// real per-character typing, real POST /v1/converse), but parameterised over a list of
// scenarios and emitting a timing map so narration and subtitles can be laid onto the
// real event times afterwards.
//
// Nothing here composites a still image. Every frame is the browser painting the live
// page as the conversation actually happens.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const TMP_ROOT = path.resolve("docs/.live-scenarios-tmp");
const TARGET = process.env.SCREENCAST_URL || "https://technext-edge-casa-bff.vercel.app/test";
const VIEW = { width: 1920, height: 1080 };

const SCENARIOS_FILE = path.resolve("docs/demo-video/live-scenarios.json");

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

/** Writes frames at their real arrival times. See the note on -fps_mode below. */
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
    // ffmpeg 9 removed -vsync; -fps_mode vfr is what makes the hold times real.
    "-fps_mode", "vfr",
    "-vf", `scale=${VIEW.width}:${VIEW.height}:force_original_aspect_ratio=decrease,pad=${VIEW.width}:${VIEW.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-movflags", "+faststart", outPath,
  ], { stdio: "ignore" });
}

async function main() {
  const doc = JSON.parse(fs.readFileSync(SCENARIOS_FILE, "utf8"));
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });

  const chrome = findChrome();
  if (!chrome) throw new Error("Could not find Chrome");

  const child = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--window-size=${VIEW.width},${VIEW.height}`,
    `--user-data-dir=${path.join(TMP_ROOT, "profile")}`,
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

  const results = [];

  for (const sc of doc.scenarios) {
    console.log(`\n=== ${sc.id}: ${sc.label} ===`);
    await cdp.send("Page.navigate", { url: TARGET + "?s=" + sc.id + "&r=" + Date.now() }, sessionId);
    await sleep(4500);

    // Chat tab, then a blinking REC dot. The dot also keeps the compositor painting so
    // the screencast yields a usable frame rate while waiting on the API.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        document.getElementById('tab-chat')?.click();
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
      // Ack immediately; doing work here starves the socket and Chrome stops streaming.
      cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sid).catch(() => {});
    });
    await cdp.send("Page.startScreencast",
      { format: "jpeg", quality: 92, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 }, sessionId);

    const marks = [];
    const mark = (name) => { marks.push({ name, atMs: Date.now() - t0 }); console.log(`  [t] ${name}`); };
    const apiCalls = [];
    cdp.on("Network.responseReceived", (p) => {
      if ((p.response?.url || "").includes("/v1/converse")) {
        apiCalls.push({ status: p.response.status, atMs: Date.now() - t0 });
        console.log(`  [api] ${p.response.status} converse`);
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
    const meta = async () => {
      const { result } = await cdp.send("Runtime.evaluate",
        { expression: `document.getElementById('chat-meta').innerText.trim()` }, sessionId);
      return String(result.value ?? "");
    };

    mark("start");
    for (let i = 0; i < sc.turns.length; i++) {
      const turn = sc.turns[i];
      const metaBefore = await meta();
      // Re-measure every turn: the log grows and moves both controls.
      const inputBox = await box("#chat-text");
      if (inputBox) await clickAt(inputBox);
      await sleep(500);
      await cdp.send("Runtime.evaluate", {
        expression: `(() => { const t = document.getElementById('chat-text'); t.focus(); t.value=''; return document.activeElement === t; })()`,
      }, sessionId);
      await sleep(250);

      mark(`t${i + 1}-type-start`);
      for (const ch of turn.guest) {
        await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch }, sessionId);
        await sleep(1000 / 20 + Math.random() * 16);
      }
      await sleep(600);

      const { result: typed } = await cdp.send("Runtime.evaluate",
        { expression: `document.getElementById('chat-text').value` }, sessionId);
      if (String(typed.value ?? "").trim().length < 10) {
        console.log(`  [warn] t${i + 1}: keystrokes missed; setting field directly (no typing animation this turn)`);
        await cdp.send("Runtime.evaluate", {
          expression: `(() => { const t=document.getElementById('chat-text'); t.focus(); t.value=${JSON.stringify(turn.guest)}; t.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`,
        }, sessionId);
        await sleep(500);
      }

      mark(`t${i + 1}-send`);
      const sendBox = await box("#chat-send");
      if (sendBox) await clickAt(sendBox);

      let arrived = false;
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        await sleep(350);
        const m = await meta();
        if (m && m !== metaBefore) { arrived = true; break; }
      }
      mark(`t${i + 1}-reply${arrived ? "" : "-FAILED"}`);
      if (!arrived) console.log(`  [warn] t${i + 1}: no reply within 45s`);
      await sleep(arrived ? 6000 : 2000);
    }

    await sleep(2000);
    mark("end");
    try { await cdp.send("Page.stopScreencast", {}, sessionId); } catch {}

    const dir = path.join(TMP_ROOT, sc.id);
    const silent = path.join(dir, "silent.mp4");
    encodeFrames(frames, silent, path.join(dir, "frames"));

    const outDocs = path.resolve("docs", sc.file);
    const outPublic = path.resolve("public", sc.file);
    fs.copyFileSync(silent, outDocs);
    fs.copyFileSync(silent, outPublic);

    const timing = {
      id: sc.id,
      label: sc.label,
      file: sc.file,
      marks: marks.map((m) => ({ name: m.name, atMs: m.atMs })),
      apiCalls,
      frameCount: frames.length,
      durationMs: frames.length ? frames[frames.length - 1].atMs : 0,
    };
    fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(timing, null, 1));
    results.push(timing);
    console.log(`  frames=${frames.length} duration=${(timing.durationMs / 1000).toFixed(1)}s -> ${sc.file}`);
    cdp.handlers.delete("Page.screencastFrame");
  }

  child.kill();
  fs.writeFileSync(path.join(TMP_ROOT, "all-timings.json"), JSON.stringify(results, null, 1));
  console.log("\n[live] all scenarios recorded");
  for (const r of results) console.log(`  ${r.id}: ${r.apiCalls.length} api call(s), ${(r.durationMs / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
