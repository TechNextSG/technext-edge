# tools/judge: LLM-as-a-judge for the bot's replies

Offline only. It never runs in the WhatsApp path, `/api/extract` or any deployed code, and it is not part of `npm run verify`
because it needs keys and costs money.

`ai/eval/` scores **extraction** (one message in, fields out) with code. This scores the **replies over several turns**:
does the bot re-ask what it was told, promise something, sound natural, answer in the right language, hand over to staff at
the right moment. Use it for one decision: **"is model B / this prompt better than what we run now?"** before touching
`/admin/ai`.

It lives here, not in `ai/`, because `ai/` is a byte mirror of the team repo (`npm run mirror:check`). It uses only the public
exports of `ai/src/index.ts` (`converse`, `buildProvider`, `choiceFromName`, `keyFor`, `verifyGuestFacingText`, ...). When the
Lead agrees, port it to the team repo's `ai/eval/` as its own small PR.

## What it does

1. **Writes replies.** For each scenario in `scenarios.json` (28 invented conversations, no PII) it plays the guest's turns one
   by one with the *candidate* model. The decisions around `converse()` mirror `bff/src/channels/whatsapp/turn.ts`
   (escalate and not-a-booking go to staff before the model is asked, a thread that keeps leaving the same questions open is
   handed over, a partner is invited to sign in). If `turn.ts` changes order, change `lib/simulate.mjs` too. The BFF's
   impossible-room review is not simulated, so scenario `s26` does not score handoff.
2. **Checks by code** (`lib/codechecks.mjs`), no model, no cost: no money in any reply, no link (except the partner invitation),
   reply language (English, or Chinese for a Chinese guest), the existing fact gate `verifyGuestFacingText` on the last written
   reply, and whether the thread went to staff when the scenario expects it. These are reported separately. **The judge never
   overrides them.**
3. **Judges the soft criteria** (`rubric.json`, versioned): `asks_only_missing`, `no_promises`, `faithful_to_facts`,
   `tone_and_clarity`, `handoff_judgement`, each 1-5 with a described meaning for every level. The judge writes the reason
   first, then the score. Each transcript is scored 3 times; the score is the median, and runs more than 1 point apart are
   flagged `unstable`. A malformed answer is retried once, then counted `invalid`.
4. **Pairwise** (`--pairwise A,B`): both models play the same scenarios and the judge picks the better one per criterion, **twice
   with A and B swapped**. A verdict counts only when both orders agree; otherwise it is `inconsistent` (the judge followed
   position, not quality).

The judge must be from a **different vendor** than the candidate (gemini vs deepseek). With candidates from both vendors no
judge can satisfy that; `--allow-self-preference` lets the run happen and the summary prints a warning.

The `generateText` call the judge uses has no temperature setting, so steadiness comes from repeating and taking the median,
not from asking for low temperature.

## Run it

```bash
# 1. what would it cost? (nothing is called)
npm run judge -- --dry-run --candidate gemini:gemini-3.8-flash --judge deepseek:deepseek-flash

# 2. one candidate, scored
npm run judge -- --candidate gemini:gemini-3.8-flash --judge deepseek:deepseek-flash

# 3. two candidates compared (raise the cap: the estimate is a worst case)
npm run judge -- --pairwise gemini:gemini-3.8-flash,gemini:gemini-3.1-flash-lite --judge deepseek:deepseek-flash --max-calls 450
```

Other flags: `--only s01,s13` (some scenarios), `--runs 3` (judge repeats), `--max-calls 300` (hard cap; a run that is expected
to exceed it refuses to start, and one that reaches it stops), `--delay-ms 2000` (space the calls out on a rate-limited key),
`--out <dir>`.

Keys come from the environment (or `.env.local`): `GEMINI_API_KEY`, `DEEPSEEK_GATEWAY_KEY`, `DEEPSEEK_BASE_URL`. They are read
by the CLI only and never written to a file.

A run writes `tools/judge/results/<timestamp>/` (gitignored): `meta.json`, `transcripts.json` (replies and machine checks),
`scores.json`, `summary.md`. The summary names the judge model, the rubric version and a hash of the judge prompt.

## Calibrate before you believe it

A judge is a model with opinions. Check it against a person first.

```bash
# a sample of 30 transcripts, spread over the scenarios
npm run judge:calibrate -- template --run tools/judge/results/<run>
# open tools/judge/labels.template.json, score each transcript 1-5 per criterion with rubric.json beside you,
# WITHOUT reading summary.md, and save it as tools/judge/labels.human.json (commit it: it is invented data)
npm run judge:calibrate -- compare --run tools/judge/results/<run>
npm run judge -- --summarize tools/judge/results/<run>     # rewrite summary.md with the calibration status
```

`compare` prints, per criterion, exact agreement, agreement within ±1, Spearman and weighted Cohen's kappa, and writes
`tools/judge/calibration.json`. **A criterion is trusted only when its weighted kappa is at least 0.6**, for that judge model
and that rubric version. Anything else shows as `uncalibrated` in `summary.md` and must not decide a model change. Change the
judge model or edit the rubric and you calibrate again.

## Reading summary.md

- **Calibration table first.** If a criterion says uncalibrated, its numbers are orientation, not evidence.
- **Machine checks.** Any failure here is a real finding regardless of the judge. Rows tagged `[known gap]` are bugs already on the list.
- **Scores by criterion**, **weakest scenarios**, **reliability** (how many transcripts were invalid, how many scores unstable).
- **Pairwise**: wins per criterion; `inconsistent` is a sign the criterion is too subtle for this judge.

## Rule before changing a model on /admin/ai

Run the judge on the current model and the new one, run `--pairwise`, calibrate, and read `summary.md`. A change is justified
only by calibrated criteria plus clean machine checks.

## Real guest data

By default only the invented scenarios run. A scenario file that is not marked `"synthetic": true` is refused unless you pass
`--allow-real` **and** set `JUDGE_REAL_OK=1`; its text is then masked with `maskForLogging` (phones, emails) before it goes to
the judge. Which provider may see real guest messages is a team decision (Q-021, with Anthony; Q-029 in the team repo).

## Tests

`npm run test:judge` (no keys, no network): parsing, medians, `unstable`, retry and `invalid`, the A/B swap, the call cap, the
real-data guard, kappa and Spearman on hand-worked numbers, the simulated channel decisions and the machine checks.
