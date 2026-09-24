---
name: demo-video-producer
description: >-
  Record, narrate, and subtitle product demo videos (1080p MP4 + SRT) with
  frame-accurate neural TTS synchronization. Supports two workflows: (1) Live
  automated Chrome CDP screencasts directly on real web apps with real-time
  neon pointer indicators and zero native CSS distortion, and (2) Post-production
  neural voiceover dubbing and non-intrusive bottom-dock burned-in subtitles
  (.ass/libass) onto existing screen recordings (e.g. WhatsApp Web, OBS, Game DVR).
  Use whenever the user asks to record a demo video, add voiceover/subtitles to a
  video, fix audio-visual sync drift, or produce narrated walkthroughs.
---

# Demo Video Producer Skill (`demo-video-producer`)

Produce broadcast-grade, 100% action-synchronized product demo videos (`.mp4` + `.srt`) using **Edge Neural TTS (`edge-tts`)**, **Chrome DevTools Protocol (`Page.startScreencast`)**, and **FFmpeg (`libx264` + `libass`)**.

---

## Golden Rules (Lessons Learned)

1. **Always Record on the Authentic UI**:
   - Never replace a live web app's CSS (`body`, `.topbar`, layout containers) with fake dark-mode overrides or static screenshot slideshows.
   - Only inject purely floating, `pointer-events: none` overlays (`.pointer-wrapper` neon pills and `#video-subbar` subtitle dock).
2. **Zero Cumulative Sync Drift**:
   - **NEVER** add arbitrary padding (`+ 0.6s`) or minimum duration floors (`Math.max(5.0, secs)`) inside `getAudioDuration()`. Always return the exact floating-point duration from `ffprobe`.
   - Break scripts into **Atomic Action-Paired Cues**:
     - *Bad*: One 18-second audio clip that talks about typing a query, waiting for the API, and reading the result all at once (causes the voice to talk about the answer 5 seconds before it appears).
     - *Good*: Cue A speaks *while typing*; `await waitForReply()`; Cue B starts speaking *only after* the reply bubble or result card renders on screen.
3. **FFmpeg 9 Concat Compatibility**:
   - When encoding variable-duration frame lists (`concat` demuxer with `duration` directives), use `-fps_mode vfr` **without** `-r 24` so FFmpeg does not drop or compress frame timestamps.
4. **Non-Obscuring Subtitle Dock for Existing Recordings**:
   - When dubbing a pre-recorded video (e.g. `1920x1032` window capture where chat inputs sit at the bottom), pad the canvas to `1920x1080` (`pad=1920:1080:0:0:color=#0b141a`) so the extra `48px` strip at the bottom serves as a dedicated subtitle dock—never covering chat messages or input controls.

---

## Workflow 1: Dub & Subtitle an Existing Recording (Mode B)

Use this when the user provides a pre-recorded `.mp4` (from Windows Game DVR, OBS, or WhatsApp Web) and wants synchronized voiceover + subtitles.

### Step 1: Probe & Extract Timeline Keyframes
1. Probe exact dimensions and duration:
   ```powershell
   ffprobe -v error -show_entries format=duration -show_entries stream=width,height -of default=noprint_wrappers=1 "input.mp4"
   ```
2. Extract 1 frame every 2 seconds (`fps=0.5`) into a scratch folder:
   ```powershell
   ffmpeg -y -i "input.mp4" -vf "fps=0.5,scale=960:-1" "tmp_timeline/frame_%02d.jpg"
   ```
   *(Note: `frame_N.jpg` corresponds to `(N - 1) * 2 + 1` seconds).*
3. Inspect key frames with `view_file` to log the exact second (`startSec` and `maxEndSec`) of every user action and system response.

### Step 2: Build Cues & Run `scripts/dub-existing-video.mjs`
Create a cues JSON file (or edit [scripts/dub-existing-video.mjs](./scripts/dub-existing-video.mjs)) where each cue specifies:
```json
[
  {
    "id": "01-intro",
    "startSec": 0.3,
    "maxEndSec": 8.7,
    "text": "Welcome to our live WhatsApp Business integration..."
  }
]
```
Run the helper script:
```powershell
node .agents/skills/demo-video-producer/scripts/dub-existing-video.mjs --input "path/to/raw.mp4" --cues "path/to/cues.json" --out "docs/output-demo.mp4"
```
- If any synthesized cue exceeds `maxEndSec - startSec`, the script automatically increases `--rate` (e.g. from `-6%` to `+4%`) so narration never bleeds into the next visual event.
- Uses `tpad=stop_mode=clone:stop_duration=3.5` so the final screen state stays visible while the closing narration finishes.

---

## Workflow 2: Live Automated Web Screencast (Mode A)

Use this when recording a live web console or interactive UI directly via headless Chrome CDP.

### Step 1: Configure Atomic Actions in [scripts/record-live-url.mjs](./scripts/record-live-url.mjs)
Define each step in the `ACTIONS` array as a single visual event paired with a single sentence:
```js
{
  id: "04-chat1-type",
  text: "First, in Chat mode, we type Sarah Jenkins's booking enquiry for four guests.",
  run: async (cdp, sid) => {
    await showArrow(cdp, sid, "#chat-text", "Typing booking enquiry...", "above");
    await typeText(cdp, sid, "#chat-text", "Hi, I'm Sarah...", 32);
    await clickEl(cdp, sid, "#chat-send");
    await waitForCondition(cdp, sid, "document.querySelectorAll('.bubble-assistant').length >= 1");
  }
},
{
  id: "05-chat1-reply",
  text: "The assistant acknowledges dates and rooms, and asks whether the group plans to dive.",
  run: async (cdp, sid) => {
    await showArrow(cdp, sid, ".bubble-assistant:last-of-type", "AI reply received", "below", "AI");
    await sleep(1800);
  }
}
```

### Step 2: Execute & Verify
1. Run the script (`node scripts/record-live-url.mjs`).
2. Verify the output `.mp4` duration with `ffprobe` and extract 2 verification frames (`ffmpeg -ss <sec> -i out.mp4 -frames:v 1 verify.jpg`) to confirm pointer alignment and subtitle legibility.
