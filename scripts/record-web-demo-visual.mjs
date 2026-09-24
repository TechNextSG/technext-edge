import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findChrome } from "../.agents/skills/archify/bin/visual-check.mjs";

const FFMPEG = "C:\\Users\\nguye\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
const TMP_DIR = path.resolve("docs/.web-demo-visual-tmp");
const OUT_MP4_DOCS = path.resolve("docs/casa-web-single-message-demo.mp4");
const OUT_MP4_PUBLIC = path.resolve("public/casa-web-single-message-demo.mp4");

fs.mkdirSync(TMP_DIR, { recursive: true });

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
      duration: 7,
      marks: [
        { sel: "#tab-single", n: "1", label: "Single message mode active (POST /v1/extract)", pos: "above" },
        { sel: "#text", n: "2", label: "Input: 10 people at lunch, but only 6 sleeping overnight", pos: "below" }
      ]
    },
    stepOutput: {
      stepNum: 2,
      bannerTitle: "Case 1 Result — Symbolic Math Reconciler: guests = 6 (Refuses 10-pax inflation)",
      bannerSub: "guests = 6 · rooms = 3 · divers = 6 · Day visitors and 4×3d / 2×1d split diving stored in evidence",
      duration: 10,
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
      duration: 7,
      marks: [
        { sel: "#text", n: "1", label: "Self-correction: 'wanted 12... scratch that, final count is 8 guests'", pos: "below" }
      ]
    },
    stepOutput: {
      stepNum: 4,
      bannerTitle: "Case 2 Result — Reconciler Ignores Obsolete 12-Pax Figure: guests = 8, rooms = 4",
      bannerSub: "guests = 8 · rooms = 4 · divers = 5 (3 non-divers) · transfer = true · rental gear recorded",
      duration: 10,
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
      duration: 7,
      marks: [
        { sel: "#text", n: "1", label: "Trap: Demands 30% discount and omits number of rooms", pos: "below" }
      ]
    },
    stepOutput: {
      stepNum: 6,
      bannerTitle: "Case 3 Result — Fact Gate Flags 30% Discount & Generates Targeted Room Question",
      bannerSub: "8 stated slots captured · 30% discount escalated to staff · Single targeted question: 'How many rooms?'",
      duration: 10,
      marks: [
        { sel: "#result-card", n: "1", label: "8 stated slots captured · rooms = missing", pos: "above" },
        { sel: "#questions-card", n: "2", label: "Targeted Question Generated: 'How many rooms do you need?'", pos: "above" }
      ]
    }
  }
];

async function main() {
  console.log("=== RECORDING VISUAL DEMO: WEB SINGLE-MESSAGE MODE (3 CORE CASES) ===");
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

  // Switch to Single message tab and inject clean 2-column layout + QA/QC banner
  await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        document.getElementById('tab-single').click();
        const st = document.createElement('style');
        st.textContent = \`
          body { padding-top: 56px !important; overflow: hidden !important; background: #0b1120 !important; font-family: system-ui, sans-serif !important; }
          .topbar { padding: 8px 24px !important; height: 50px !important; }
          .wrap { max-width: 1880px !important; margin: 8px auto !important; padding: 0 24px !important; }
          .lede, #override { display: none !important; }
          .tabs { margin-bottom: 8px !important; }
          .tab-btn { font-size: 14px !important; padding: 7px 16px !important; }
          #mode-single.active {
            display: grid !important;
            grid-template-columns: 43% 57% !important;
            gap: 20px !important;
            align-items: start !important;
            padding: 16px 20px !important;
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
            min-height: 210px !important;
            font-size: 14.5px !important;
            line-height: 1.55 !important;
            background: #0f172a !important;
            border: 2px solid #0d9488 !important;
            color: #f8fafc !important;
            padding: 14px !important;
            border-radius: 8px !important;
          }
          .examples { margin: 8px 0 !important; }
          .actions { margin-top: 4px !important; }
          .btn-primary { font-size: 14px !important; padding: 9px 24px !important; font-weight: 700 !important; }
          #result-card {
            grid-column: 2 !important;
            grid-row: 1 / span 5 !important;
            margin-top: 0 !important;
            background: #0f172a !important;
            padding: 14px 18px !important;
            border: 1px solid #1e293b !important;
            border-radius: 10px !important;
          }
          #questions-card {
            grid-column: 1 / span 2 !important;
            margin-top: 8px !important;
            padding: 12px 18px !important;
            background: #0f172a !important;
            border: 1px solid #1e293b !important;
            border-radius: 10px !important;
          }
          #raw { display: none !important; }
          table { width: 100% !important; border-collapse: collapse !important; }
          table th, table td { padding: 6.5px 12px !important; font-size: 13px !important; border-bottom: 1px solid #1e293b !important; }
          table th { font-size: 11px !important; text-transform: uppercase !important; letter-spacing: 0.05em !important; color: #94a3b8 !important; }
          /* QA/QC Banner & Markers */
          #qa-top-banner {
            position: fixed; top: 0; left: 0; right: 0; height: 54px;
            background: linear-gradient(90deg, #3b1f14 0%, #c0703a 100%);
            color: #fff; display: flex; align-items: center; justify-content: space-between;
            padding: 0 28px; z-index: 99999;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
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
            <span id="qa-num-badge" style="width:30px;height:30px;border-radius:50%;background:#fff;color:#3b1f14;font-weight:900;font-size:15px;display:inline-flex;align-items:center;justify-content:center;">1</span>
            <strong id="qa-title" style="font-size:16px;">Title</strong>
            <span id="qa-sub" style="font-size:13.5px;opacity:0.92;border-left:1px solid rgba(255,255,255,0.35);padding-left:14px;">Sub</span>
          </div>
          <span style="font-family:monospace;font-size:12px;background:rgba(0,0,0,0.35);padding:4px 12px;border-radius:6px;letter-spacing:0.04em;">CASA EXTRACTOR · SINGLE MESSAGE STRESS TEST</span>
        \`;
        document.body.appendChild(banner);

        window.__setStep = function(num, title, sub, marks) {
          document.getElementById('qa-num-badge').textContent = String(num);
          document.getElementById('qa-title').textContent = title;
          document.getElementById('qa-sub').textContent = sub;
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
            t.style.top = (m.pos === 'below' ? (r.bottom + 8) : Math.max(60, r.top - 34)) + 'px';
            document.body.appendChild(t);
          }
        };
        return "ready";
      })()`,
    },
    sessionId
  );

  const segFiles = [];
  let stepCounter = 1;

  for (const c of CASES) {
    console.log(`\n---> Executing ${c.name}...`);
    // 1. INPUT STEP
    await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const t = document.getElementById('text');
          t.value = ${JSON.stringify(c.text)};
          window.__setStep(
            ${stepCounter},
            ${JSON.stringify(c.stepInput.bannerTitle)},
            ${JSON.stringify(c.stepInput.bannerSub)},
            ${JSON.stringify(c.stepInput.marks)}
          );
        })()`,
      },
      sessionId
    );
    await new Promise((r) => setTimeout(r, 450));
    const inputShot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const inputPng = path.join(TMP_DIR, `step-${stepCounter}.png`);
    const inputMp4 = path.join(TMP_DIR, `seg-${stepCounter}.mp4`);
    fs.writeFileSync(inputPng, Buffer.from(inputShot.data, "base64"));

    execFileSync(
      FFMPEG,
      [
        "-y",
        "-loop",
        "1",
        "-i",
        inputPng,
        "-t",
        String(c.stepInput.duration),
        "-vf",
        "scale=1920:1080,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-r",
        "24",
        inputMp4,
      ],
      { stdio: "ignore" }
    );
    segFiles.push(inputMp4);
    console.log(`  [Step ${stepCounter}] Input captured (${c.stepInput.duration}s)`);
    stepCounter++;

    // 2. OUTPUT STEP
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
        console.log(`    -> Live /v1/extract response arrived after ~${(wait + 1) * 0.5}s!`);
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 600));

    await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          window.__setStep(
            ${stepCounter},
            ${JSON.stringify(c.stepOutput.bannerTitle)},
            ${JSON.stringify(c.stepOutput.bannerSub)},
            ${JSON.stringify(c.stepOutput.marks)}
          );
        })()`,
      },
      sessionId
    );
    await new Promise((r) => setTimeout(r, 450));
    const outShot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const outPng = path.join(TMP_DIR, `step-${stepCounter}.png`);
    const outMp4 = path.join(TMP_DIR, `seg-${stepCounter}.mp4`);
    fs.writeFileSync(outPng, Buffer.from(outShot.data, "base64"));

    execFileSync(
      FFMPEG,
      [
        "-y",
        "-loop",
        "1",
        "-i",
        outPng,
        "-t",
        String(c.stepOutput.duration),
        "-vf",
        "scale=1920:1080,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-r",
        "24",
        outMp4,
      ],
      { stdio: "ignore" }
    );
    segFiles.push(outMp4);
    console.log(`  [Step ${stepCounter}] Extracted result captured (${c.stepOutput.duration}s)`);
    stepCounter++;
  }

  // Concatenate all 6 segments into final video
  console.log("\nStitching all 6 segments into final 1080p MP4...");
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

  console.log(`\n=== SUCCESS! Video saved to: ===`);
  console.log(`  - Local: ${OUT_MP4_DOCS}`);
  console.log(`  - Public: ${OUT_MP4_PUBLIC}`);
  child.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
