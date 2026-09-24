# Casa Escondida — Customer Demo Video (Shooting Script)

Target length **2:45**. English voiceover + English subtitles (`narration.en.srt`).
Guest messages below are **verbatim** — type them exactly. Assistant replies were
captured from the live production system on 2026-09-24 and are reproduced here so
subtitles and narration can be timed before shooting.

## Method

Record the **voiceover first**, then cut the footage to it. This is the only way the
subtitle timings stay exact — `narration.en.srt` is already laid out on that grid.

- **WhatsApp (Scenes 1–4):** screen-record the phone. Do not automate the account.
- **Web (Scene 5):** Playwright `recordVideo` + `slowMo: 300`, same as
  `qa-workspace/templates/_TEMPLATE.spec.mjs` in the QA/QC repo. Convert `.webm` → `.mp4`.
- **Assembly:** any editor. Burn subtitles in (customers often watch muted).

---

## Scene 1 — Hook (0:00–0:22) · cues 1–2

On screen: WhatsApp chat, empty. Guest starts typing.

## Scene 2 — The messy first message (0:22–1:19) · cues 3–9

**Type this:**

> Hi! I'm Daniel Reyes. Planning a family trip to Casa Escondida for 5 of us, checking in on October 17th for 3 nights. Only my wife and I are certified divers - my mother and our two kids will just snorkel. We'll fly into Manila and need the airport pickup.

**Expected reply (captured live):**

> Thanks, Daniel Reyes!
> I've noted down your stay starting Oct 17 for 3 nights, 5 guests, an airport transfer, diving and your name, Daniel Reyes.
> To complete your enquiry, could you let me know:
> 1. Which day does your diving start? (within your stay: Oct 17 – 20, 2026)
> 2. And which day does it end? (within your stay: Oct 17 – 20, 2026)
> 3. One-way or return transfer?

Extracted behind the scenes: `guests=5`, `divers=2`, `nights=3`, `checkIn=2026-10-17`.

> ⚠️ **Blocker A — see below.** Question 3 must be removed before shooting.

## Scene 3 — Guest answers (1:19–1:38) · cues 10–11

**Type this:**

> Yes please, two rooms is fine, and we'd like to dive on the 18th and 19th.

**Expected reply (captured live, abridged on screen):**

> I've updated your inquiry details. It's wonderful that you and your wife get to enjoy some diving on the 18th and 19th while the rest of the family enjoys snorkeling…
> • **Guests:** 5 (2 divers, 3 snorkelers)
> • **Rooms:** 2
> • **Diving Schedule:** Oct 18 & 19

## Scene 4 — Final summary (1:38–2:01) · cues 12–14

**Type this:**

> Return transfer please, thanks!

**Expected reply (captured live):** full summary block ending with

> Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.

Hold on that last line — cues 13–14 land on it.

## Scene 5 — Staff review on the web (2:01–2:31) · cues 15–18

Open the quotation editor, show the pre-filled table (rooms, nights, full board,
2 dive places), edit one line, approve, then open the guest-facing `/q/...` link.

> ⚠️ **Blocker B — see below.** This scene cannot be recorded yet.

## Scene 6 — Close (2:31–2:45) · cues 19–20

Casa Escondida logo card.

---

## Blockers to clear before shooting

**A. The assistant asks about the airport transfer twice.**
Turn 1 already derived `transportType=roundtrip` from "need the airport pickup",
then asked "One-way or return transfer?" anyway — and asked it *again* in turn 2.
On camera this reads as the assistant not listening, which is the exact criticism
the video is meant to answer. Fix before shooting.

**B. No quotation link is produced.**
`converse.ts:69` gates the quotation behind `ENABLE_HONO_QUOTATION_TOOL === "true"`.
That variable is not set in production, so all three turns completed with no quote
draft and no link. Scene 5 needs it switched on in Vercel, followed by a redeploy.

**C. Intermittent `provider_rate_limited`.**
Two of five dry-run conversations failed on turn 1 with HTTP 502 /
`provider_rate_limited`. Run one throwaway conversation immediately before shooting;
if it fails, wait rather than record.

**D. Quote links can silently show the wrong guest's numbers.**
`quotationStore.ts:115` falls back to the seeded QT-1010-SKY quote, relabelled with
the requested ID, when a cold serverless instance is hit. Record Scenes 4 and 5 back
to back and check every figure against the chat before cutting.

---

## Update 2026-09-24 — new production findings (before recording)

Verified live against production after the DeepSeek key rotation. Two bugs found,
**both independent of DeepSeek/Gemini availability** — they occur even on HTTP 200.

**Bug 1 — `guests` intermittently comes back `missing`.**
Message: *"there's 7 of us... 3 of us are certified divers..."* — reworded from
"a group of 7" specifically to hit the existing `COLLECTIVE_OF` / "of us" regex in
`counts.ts`. Still failed 5/20 runs (25%) even with that safer phrasing. Root cause is
upstream of the deterministic regex: the model's own JSON extraction pass sometimes
never emits a `guests` value at all (`state: "missing", evidence: null`), so there is
nothing for `corroborateCount` to confirm. Not a code-side fix — needs prompt-level
investigation in `providers/gemini.ts` / `deepseek.ts`.

**Bug 2 (new) — `guestType` is unstable on an identical message.**
Same exact input, same run: `guestType` came back `"agent"` (correct — "Manila Dive
Club" + "our usual partner rate"), `"retail"` (wrong — loses the 30% partner discount),
and `null`, across different calls. Confirms the earlier concern that guest-type
classification isn't reliable; now with reproduced evidence.

**Recommendation:** do not record with a message that depends on `guests` or
`guestType` landing correctly on the first take. Either (a) pick a message where the
number is trivial enough the model rarely misses it (e.g. small groups, 2–3 guests),
or (b) record several takes and keep the one where the assistant's summary is fully
correct — same principle as scene 5's "record and verify before cutting" note above.
