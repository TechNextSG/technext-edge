// Records a REAL screen capture of the production test console while driving it.
//
// This is a screencast, not a slideshow. Every visual is produced by the browser
// rendering the live page over time:
//   - Chrome's Page.startScreencast streams frames as the page actually paints;
//   - the guest's message is typed one character at a time through CDP input events,
//     so the typing is the real UI reacting to real keystrokes;
//   - each turn is a real POST /v1/converse to the deployed BFF, and the assistant
//     bubble appears when the real response arrives.
//
// The previous approach in this repo captured ONE PNG per step and stretched it with
// ffmpeg -loop 1, and filmed docs/demo-theatre.html — a hand-written mock with the
// steps baked into an array. Neither showed the product running. This does.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const TMP_DIR = path.resolve("docs/.screencast-tmp");
const OUT_MP4 = path.resolve("docs/casa-web-console-live-demo.mp4");
const OUT_PUBLIC = path.resolve("public/casa-web-console-live-demo.mp4");

const TARGET = process.env.SCREENCAST_URL || "https://technext-edge-casa-bff.vercel.app/test";

// The guest writes like a real person, and the replies are whatever production
// actually returns. Nothing here is re-enacted.
const TURNS = [
  "Hi! I'm Daniel Reyes. Four of us are coming to Casa Escondida, checking in on October 17th 2026 for 3 nights. My wife and I are certified divers, the other two will just snorkel. We'll need the airport pickup from Manila.",
  "Yes please, one room is fine, and we'd like to dive on the 18th and 19th.",
];

const VIEW = { width: 1920, height: 1080 };
const FPS = 10;

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
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          continue;
        }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        } else if (msg.method) {
          const h = this.handlers.get(msg.method);
          if (h) h(msg.params, msg.sessionId);
        }
      }
    });
  }
  on(method, fn) {
    this.handlers.set(method, fn);
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writePipe.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startFfmpegSink(outPath) {
  const proc = spawn(
    FFMPEG,
    [
      "-y",
      // Frames arrive as JPEGs at a variable rate; the concat demuxer-style image2pipe
      // reader keeps them in arrival order, and -r pins the output clock.
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "-r", String(FPS),
      "-i", "-",
      "-vf", `scale=${VIEW.width}:${VIEW.height}:force_original_aspect_ratio=decrease,pad=${VIEW.width}:${VIEW.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-r", String(FPS),
      "-movflags", "+faststart",
      outPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  return { proc, getStderr: () => stderr };
}

/**
 * Encodes the collected frames at their real arrival times.
 *
 * The concat demuxer with per-file `duration` only honours those durations when the
 * output is variable-frame-rate and explicitly timed; a plain -f concat run collapsed
 * a 95-second recording to 22 seconds. `-vsync vfr -r 30` is what makes the hold times
 * real, and since every frame is a still hold, the result reproduces live pacing.
 */
function encodeVariableFrames(frames, outPath) {
  const frameDir = path.join(TMP_DIR, "frames");
  fs.mkdirSync(frameDir, { recursive: true });
  const abs = [];
  for (let i = 0; i < frames.length; i++) {
    const file = path.join(frameDir, `f${String(i).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(frames[i].data, "base64"));
    abs.push(file);
  }

  // Feed timestamps explicitly instead of relying on duration directives.
  const listLines = [];
  for (let i = 0; i < frames.length; i++) {
    listLines.push(`file '${abs[i].replace(/\\/g, "/")}'`);
    const next = frames[i + 1] ? frames[i + 1].atMs : frames[i].atMs + 1000;
    const hold = Math.max(1, next - frames[i].atMs) / 1000;
    listLines.push(`duration ${hold.toFixed(4)}`);
  }
  // Repeat the last frame, otherwise its duration is dropped.
  listLines.push(`file '${abs[abs.length - 1].replace(/\\/g, "/")}'`);
  const listPath = path.join(TMP_DIR, "frames.txt");
  fs.writeFileSync(listPath, listLines.join("\n"));

  execFileSync(
    FFMPEG,
    [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      // ffmpeg 9 removed -vsync; -fps_mode vfr is the current spelling and is what
      // makes the concat durations real instead of collapsing the timeline.
      "-fps_mode", "vfr",
      "-vf", `scale=${VIEW.width}:${VIEW.height}:force_original_aspect_ratio=decrease,pad=${VIEW.width}:${VIEW.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-movflags", "+faststart",
      outPath,
    ],
    { stdio: "ignore" },
  );
  return frameDir;
}

async function main() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const chrome = findChrome();
  if (!chrome) throw new Error("Could not find Chrome");

  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--window-size=${VIEW.width},${VIEW.height}`,
      `--user-data-dir=${path.join(TMP_DIR, "profile")}`,
      "--remote-debugging-pipe",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] },
  );

  const cdp = new Cdp(child);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const page = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("DOM.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );

  const silentMp4 = path.join(TMP_DIR, "screencast.mp4");

  // Frames are collected in memory with their real arrival time and encoded
  // afterwards at variable frame timing.
  //
  // Two things made the earlier version fail:
  //  1. Page.screencastFrame MUST be acked immediately. Formatting and writing each
  //     JPEG synchronously inside the ack path starved the socket, and Chrome stopped
  //     after 4 frames.
  //  2. Encoding at a fixed -r discards the real pacing. The concat demuxer with a
  //     per-frame duration reproduces the actual on-screen timing, so the typing and
  //     the reply pauses last exactly as long as they did live.
  const frames = [];
  const t0 = Date.now();
  cdp.on("Page.screencastFrame", (params, sid) => {
    frames.push({ atMs: Date.now() - t0, data: params.data });
    // Ack first, nothing else in this path.
    cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sid).catch(() => {});
  });

  const timeline = [];
  /** Every /v1/converse response the page actually received, for honest reporting. */
  const apiCalls = [];
  cdp.on("Network.responseReceived", (params) => {
    const url = params?.response?.url || "";
    if (url.includes("/v1/converse") || url.includes("/v1/extract")) {
      apiCalls.push({ status: params.response.status, atMs: Date.now() - t0 });
      console.log(`  [api] ${params.response.status} ${url.split("/").pop()}`);
    }
  });
  const mark = (name) => {
    timeline.push({ name, at: Number(process.hrtime.bigint() / 1000000n) });
    console.log(`  [t] ${name}`);
  };

  console.log(`[live] navigating to ${TARGET}`);
  await cdp.send("Page.navigate", { url: TARGET }, sessionId);
  await sleep(4000);

  // Start streaming only once the page has painted, so the recording opens on the
  // real console rather than a blank tab.
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: VIEW.width,
    maxHeight: VIEW.height,
    everyNthFrame: 1,
  }, sessionId);
  mark("screencast-start");

  // A recording indicator, drawn into the live page. Purely presentational: it tells
  // a viewer this is a capture of a running system, and it is the only thing added.
  //
  // The blinking dot does double duty. Page.startScreencast only emits a frame when
  // the page paints, so the long idle wait for an API reply produced almost no frames
  // (231 frames across 95 s, ~2.4 fps, visibly choppy). A continuously animating
  // element keeps the compositor producing frames, which is what raises the capture to
  // a usable rate at no cost to the page's actual behaviour.
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
  await sleep(1200);

  async function getBox(selector) {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'null';
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      })()`,
    }, sessionId);
    return result.value === "null" ? null : JSON.parse(result.value);
  }

  async function clickAt(box) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 }, sessionId);
  }

  /** Types with real key events so the page sees genuine keystrokes. */
  async function typeText(text, cps = 22) {
    const perChar = 1000 / cps;
    for (const ch of text) {
      const isNewline = ch === "\n";
      await cdp.send("Input.dispatchKeyEvent", {
        type: isNewline ? "keyDown" : "char",
        text: isNewline ? undefined : ch,
        key: isNewline ? "Enter" : ch,
        windowsVirtualKeyCode: isNewline ? 13 : undefined,
      }, sessionId);
      if (isNewline) {
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 }, sessionId);
      }
      await sleep(perChar + Math.random() * 18);
    }
  }

  /**
   * Detects a new assistant reply from the page's own conversation state.
   *
   * Counting `.bubble-assistant` elements does not work: #chat-log is a
   * `max-height:420px; overflow-y:auto` scroller and renderChatLog() rebuilds it from
   * chatHistory, so earlier bubbles stay in the DOM. What actually changes per turn is
   * the page metadata line, which only gets written after a successful response.
   */
  async function chatMeta() {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `document.getElementById('chat-meta').innerText.trim()`,
    }, sessionId);
    return String(result.value ?? "");
  }

  async function chatBubbleTexts() {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify([...document.querySelectorAll('#chat-log .bubble-assistant')].map(e => e.innerText.length))`,
    }, sessionId);
    return String(result.value ?? "[]");
  }

  // Make sure the Chat tab is the one on screen before anything is typed.
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const t = document.getElementById('tab-chat');
      if (t) t.click();
      return 'ok';
    })()`,
  }, sessionId);
  await sleep(600);

  // The input and send button are located fresh for every turn. Their positions were
  // cached once originally, but the page grows as the conversation renders, so the
  // cached coordinates drifted onto empty space and the click silently did nothing —
  // which looked exactly like a provider failure.
  const inputBox = await getBox("#chat-text");
  if (!inputBox) throw new Error("could not find #chat-text on the console page");

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    const metaBefore = await chatMeta();
    mark(`turn${i + 1}-focus`);

    // Re-measure every turn: the conversation log grows, which moves both controls.
    const focusBox = await getBox("#chat-text");
    if (focusBox) await clickAt(focusBox);
    await sleep(600);

    // Clear the field first, then verify the caret is really in it — otherwise the
    // dispatched key events go nowhere and "nothing happened" looks like an API fault.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => { const t = document.getElementById('chat-text'); t.focus(); t.value = ''; return document.activeElement === t; })()`,
    }, sessionId);
    await sleep(300);

    mark(`turn${i + 1}-typing`);
    await typeText(turn);
    await sleep(700);

    const { result: typed } = await cdp.send("Runtime.evaluate", {
      expression: `document.getElementById('chat-text').value`,
    }, sessionId);
    const typedValue = String(typed.value ?? "");
    if (typedValue.trim().length < 10) {
      // Fall back to setting the value, and say so in the log: the reply is still the
      // real one, but this turn's typing will not animate on screen.
      console.log(`  [warn] turn ${i + 1}: only ${typedValue.length} chars typed; setting the field directly`);
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const t = document.getElementById('chat-text');
          t.focus();
          t.value = ${JSON.stringify(turn)};
          t.dispatchEvent(new Event('input', { bubbles: true }));
          return t.value.length;
        })()`,
      }, sessionId);
      await sleep(600);
    }

    mark(`turn${i + 1}-send`);
    const sendBox = await getBox("#chat-send");
    if (sendBox) await clickAt(sendBox);

    // Wait for the page's metadata line to change, which only happens on a 2xx.
    let arrived = false;
    for (let attempt = 1; attempt <= 2 && !arrived; attempt++) {
      const deadline = Date.now() + 40000;
      while (Date.now() < deadline) {
        await sleep(400);
        if ((await chatMeta()) !== metaBefore && (await chatMeta()) !== "") {
          arrived = true;
          break;
        }
      }
      if (!arrived) {
        const bubbles = await chatBubbleTexts();
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const e = document.getElementById('chat-error');
            return JSON.stringify({ error: e ? e.innerText.trim().slice(0, 240) : '' });
          })()`,
        }, sessionId);
        console.log(`  [warn] turn ${i + 1} attempt ${attempt}: no reply. ${result.value} bubbles=${bubbles}`);
        if (attempt < 2) {
          mark(`turn${i + 1}-retry${attempt}`);
          await clickAt(inputBox);
          await sleep(400);
          await cdp.send("Runtime.evaluate", {
            expression: `(() => {
              const t = document.getElementById('chat-text');
              t.focus();
              t.value = 'Sorry, could you continue with my enquiry?';
              t.dispatchEvent(new Event('input', { bubbles: true }));
              return 'ok';
            })()`,
          }, sessionId);
          await sleep(600);
          if (sendBox) await clickAt(sendBox);
        }
      }
    }
    mark(`turn${i + 1}-reply${arrived ? "" : "-FAILED"}`);
    // Hold on the finished reply so a viewer can read it.
    await sleep(arrived ? 6000 : 2000);
  }

  await sleep(2500);
  mark("end");
  try {
    await cdp.send("Page.stopScreencast", {}, sessionId);
  } catch {}

  // A final full-page screenshot: evidence of what the recording ended on, and a
  // cheap way to check the conversation really happened if a bubble wait times out.
  try {
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    fs.writeFileSync(path.join(TMP_DIR, "final-state.png"), Buffer.from(shot.data, "base64"));
  } catch {}
  try {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `document.getElementById('chat-log').innerText.slice(0, 4000)`,
    }, sessionId);
    fs.writeFileSync(path.join(TMP_DIR, "final-chat.txt"), String(result.value ?? ""), "utf8");
  } catch {}

  child.kill();

  if (frames.length < 2) throw new Error(`screencast produced only ${frames.length} frame(s)`);
  encodeVariableFrames(frames, silentMp4);

  const stat = fs.statSync(silentMp4);
  fs.copyFileSync(silentMp4, OUT_MP4);
  fs.copyFileSync(silentMp4, OUT_PUBLIC);
  const base = timeline[0].at;
  fs.writeFileSync(
    path.join(TMP_DIR, "timeline.json"),
    JSON.stringify(timeline.map((t) => ({ name: t.name, atMs: t.at - base })), null, 1),
  );
  const lastFrameMs = frames[frames.length - 1].atMs;
  console.log(`\n[live] frames=${frames.length} over ${(lastFrameMs / 1000).toFixed(1)}s`);
  console.log(`[live] wrote ${OUT_MP4} (${(stat.size / 1048576).toFixed(1)} MB)`);
  console.log(`[live] timeline -> ${path.join(TMP_DIR, "timeline.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
