#!/usr/bin/env node
// Turns the recording of a *live* run into two files that let the same 30 messages be
// re-checked offline, with no provider call and no API key:
//
//   eval/fixtures.mock-30.json        — what the model answered, per case, to feed back
//                                       into extract() through a stub provider
//   eval/baseline.deepseek-flash.json — what the pipeline made of it at the time, to
//                                       compare the current pipeline against
//
// Why this exists: eval/runner.mjs spends provider tokens and needs a deployed endpoint,
// so it runs when someone decides to run it — which is exactly the wrong shape for a
// regression gate. The pipeline's own rules (dates resolved in code, house norms,
// evidence enforced) are deterministic, so once a model's answer is on disk they can be
// re-run on every `npm test`. test/evalReplay.test.ts is that gate.
//
// The recording is results.1789702974010.json: deepseek-flash through the local
// apps/casa-bff on 2026-09-18T03:42:54Z (Manila 2026-09-18, the date every date in this
// file is anchored to). results-deepseek.log next to it is that run's own report —
// required fields 63/87, fabricated 0, evidence verbatim 135/135, and a `checkIn`
// mismatch on 19 of the 30 cases, which is the bug the current dates.ts fixes.
//
// Two rules keep the replay honest:
//
//   1. A field the model got wrong is replayed wrong. The recording stores the
//      post-processed trip, and everything the model itself claimed (stated/inferred,
//      with its evidence) is copied straight back in — including vi-09's `guests: 8`
//      for a message that says 4, and vi-07's `transport: true` for "xe tụi mình tự đi".
//      A fixture that quietly corrected those would be measuring the person who wrote
//      the fixture, not the pipeline. Absolute accuracy of this file is therefore *not*
//      the point, and the live run stays the source of truth for model quality.
//   2. Fields code owns are never replayed: language (detected), checkOut (arithmetic),
//      transportType (from the transport boolean), and every `default`, which is a house
//      norm the pipeline applies because the model said nothing. Omitting them lets the
//      same code paths produce them again, which is what makes the comparison against
//      the baseline meaningful instead of circular.
//
// One gap this file cannot close by itself: the pre-fix pipeline deleted a check-in
// before the runner could record it, so for those cases the model's own date and quote
// are simply not in the recording (they score `evidence n/n` in the log and still read
// `checkIn: missing`). LOST_CHECKINS below restores them by hand, marked
// `provenance: "authored"` in the output, from the guest's own words in
// dataset.mock-30.json. Read that table as "what a model returns for this phrase", not
// as a measurement — and note that for every in-table phrase the resolver decides the
// date anyway, so the authored value cannot make the test pass on its own.
//
// Usage:
//   node eval/make-fixtures.mjs [path/to/results.<timestamp>.json]

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATASET_PATH = path.join(__dirname, "dataset.mock-30.json");
const DEFAULT_RECORDING = path.join(__dirname, "results.1789702974010.json");
const FIXTURES_PATH = path.join(__dirname, "fixtures.mock-30.json");
const BASELINE_PATH = path.join(__dirname, "baseline.deepseek-flash.json");
// manilaToday() at the moment that run happened. Every relative date in LOST_CHECKINS
// is expressed against it, and the replay test freezes its clock to it.
const RECORDED_TODAY = "2026-09-18";

// Fields extract.ts computes itself. A model that "stated" one of these was answered by
// postProcess, not by the model.
const CODE_OWNED_FIELDS = ["language", "checkOut", "transportType"];



// The 19 cases whose check-in the pre-fix pipeline dropped (results-deepseek.log lines
// "mismatch on checkIn: expected stated, got missing"). `evidence` is quoted from the
// dataset's own message text, so it survives enforceVerbatimEvidence; `value` is what a
// model returns for that phrase, anchored to RECORDED_TODAY. Which half of dates.ts decides
// the field is marked per case, and it is what test/evalReplay.test.ts reads:
//
//   `resolver` the phrase table reads the quote itself, so the model's own date is never
//              consulted: yearless N月N日, 周/星期, "từ ngày 15/10", "từ thứ Sáu tuần sau",
//              the weekend forms, and — since the table was taught them — "arriving
//              tomorrow" (a day-offset word inside a quote) and the English month+day forms
//              "starting Oct 10th", "Nov 2", "coming Dec 1st".
//   `resolver-language`
//              the same, for the two pairs with no year on them that used to be the model's
//              own call: "05/12" (vi-09) and "12/10" (vi-10) are two valid calendar dates
//              whichever way they are read, and the guest's language — detected from the same
//              message, the detection that fills trip.language — leaves exactly one reading
//              (dates.ts numericPairReadings). Both messages are Vietnamese, so both are
//              day/month. No case is left to `model` any more; test/evalReplay.test.ts
//              asserts that, because it is the point.
const LOST_CHECKINS = {
  "en-03-trap-unrelated-number": { evidence: "arriving tomorrow", value: "2026-09-19", decidedBy: "resolver" },
  "en-06-padi-open-water": { evidence: "starting Oct 10th", value: "2026-10-10", decidedBy: "resolver" },
  "en-07-fun-diving-package": { evidence: "starting Nov 2", value: "2026-11-02", decidedBy: "resolver" },
  "en-08-family-non-divers": { evidence: "coming Dec 1st", value: "2026-12-01", decidedBy: "resolver" },
  "vi-04-khoa-hoc-lan-ow": { evidence: "từ ngày 15/10", value: "2026-10-15", decidedBy: "resolver" },
  "vi-05-dai-ly-dat-doan": { evidence: "từ ngày 20/11", value: "2026-11-20", decidedBy: "resolver" },
  "vi-06-gia-dinh-nghi-duong": { evidence: "từ thứ Sáu tuần sau", value: "2026-09-25", decidedBy: "resolver" },
  "vi-07-cuoi-tuan-lan-bien": { evidence: "check in thứ Bảy tới", value: "2026-09-19", decidedBy: "resolver" },
  "vi-09-bay-so-dien-thoai": { evidence: "từ ngày 05/12", value: "2026-12-05", decidedBy: "resolver-language" },
  "vi-10-thue-xe-rieng": { evidence: "từ 12/10", value: "2026-10-12", decidedBy: "resolver-language" },
  "zh-01-complete": { evidence: "下周六", value: "2026-09-26", decidedBy: "resolver" },
  "zh-03-trap-phone-wechat": { evidence: "10月12日", value: "2026-10-12", decidedBy: "resolver" },
  "zh-04-padi-ow-course": { evidence: "11月5号", value: "2026-11-05", decidedBy: "resolver" },
  "zh-05-fun-dive-club": { evidence: "10月20日", value: "2026-10-20", decidedBy: "resolver" },
  "zh-06-agency-booking": { evidence: "11月15日", value: "2026-11-15", decidedBy: "resolver" },
  "zh-07-family-trip": { evidence: "12月10日", value: "2026-12-10", decidedBy: "resolver" },
  "zh-08-relative-date": { evidence: "下周五", value: "2026-09-25", decidedBy: "resolver" },
  "zh-09-room-only": { evidence: "10月24日", value: "2026-10-24", decidedBy: "resolver" },
  "zh-10-trap-price-inquiry": { evidence: "11月8日", value: "2026-11-08", decidedBy: "resolver" },
};

/** The model's own claims, as the recording stored them, minus everything code owns. */
function modelClaimsOf(trip) {
  const model = {};
  for (const [field, f] of Object.entries(trip)) {
    if (CODE_OWNED_FIELDS.includes(field)) continue;
    if (f.state === "default" || f.state === "derived") continue;
    if (f.value === null) continue; // missing: the model said nothing about this field
    model[field] = { value: f.value, state: f.state, evidence: f.evidence };
  }
  return model;
}

const recordingPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_RECORDING;
const [dataset, recording] = await Promise.all([
  readFile(DATASET_PATH, "utf8").then(JSON.parse),
  readFile(recordingPath, "utf8").then(JSON.parse),
]);

const runs = new Map(recording.results.map((r) => [r.id, r]));
const cases = [];
const baselineCases = [];
const authored = [];

for (const item of dataset) {
  const run = runs.get(item.id);
  if (!run) {
    throw new Error(`${item.id} is in the dataset but not in the recording — refusing to write a partial fixture`);
  }

  const model = modelClaimsOf(run.trip);
  const lost = LOST_CHECKINS[item.id];
  if (lost) {
    model.checkIn = { value: lost.value, state: "stated", evidence: lost.evidence };
    authored.push(`${item.id} (${lost.decidedBy})`);
  }

  cases.push({
    id: item.id,
    provenance: lost ? `authored-checkIn:${lost.decidedBy}` : "recorded",
    model,
  });
  baselineCases.push({ id: item.id, trip: run.trip });
}

const unused = Object.keys(LOST_CHECKINS).filter((id) => !authored.some((a) => a.startsWith(`${id} `)));
if (unused.length) throw new Error(`LOST_CHECKINS names cases the dataset does not have: ${unused.join(", ")}`);

const provider = recording.results[0]?.provider ?? "unknown";
const relative = (p) => path.relative(process.cwd(), p);

await writeFile(
  FIXTURES_PATH,
  `${JSON.stringify(
    {
      provenance: {
        dataset: path.basename(DATASET_PATH),
        recording: path.basename(recordingPath),
        provider,
        ranAt: recording.ranAt,
        recordedToday: RECORDED_TODAY,
        generatedBy: "eval/make-fixtures.mjs",
        note: "What the model answered for each case, to replay through extract() offline. Model mistakes are preserved on purpose; fields code owns (language, checkOut, transportType, and every house-norm default) are omitted so the pipeline produces them again. `authored-checkIn` marks the 19 cases whose date the pre-fix code deleted before the recording could store it, and the tag after the colon says which half of dates.ts decides it: `resolver`, or `resolver-language` for the two ambiguous pairs (05/12, 12/10) the guest's own detected language settles.",
      },
      cases,
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  BASELINE_PATH,
  `${JSON.stringify(
    {
      provenance: {
        recording: path.basename(recordingPath),
        provider,
        ranAt: recording.ranAt,
        recordedToday: RECORDED_TODAY,
        generatedBy: "eval/make-fixtures.mjs",
        note: "The trip that run produced for every case, so test/evalReplay.test.ts can assert the current pipeline still produces it — apart from the check-in dates this work recovers and the dive fields a later rule deliberately tightened. Extracted values only; no guest text.",
      },
      cases: baselineCases,
    },
    null,
    2,
  )}\n`,
);

console.log(`fixtures : ${relative(FIXTURES_PATH)} (${cases.length} cases)`);
console.log(`baseline : ${relative(BASELINE_PATH)} (${baselineCases.length} cases, provider ${provider})`);
console.log(`replayed : ${relative(recordingPath)}`);
console.log(`check-in restored by hand (${authored.length}):\n  ${authored.join("\n  ")}`);
