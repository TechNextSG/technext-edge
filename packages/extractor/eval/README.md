# Eval harness

## Two datasets, never mixed

- `dataset.synthetic.json` — messages I wrote from general research on how
  guests phrase dive-trip enquiries (WhatsApp/Messenger booking patterns),
  not real Casa data. Includes a couple of deliberate "fabrication traps"
  (an unrelated number sitting near the real guest count) to pressure-test
  the zero-fabrication rule.
- `dataset.real.json` — **does not exist yet.** When Eloa hands over the 30
  real, name-masked messages, put them here in the same shape (see below)
  and re-run `runner.mjs` unchanged.

**Do not use synthetic results to decide a model.** Playbook and ADR-005a
are explicit that the ten made-up PoC samples (and, by the same logic, these
synthetic ones) exist to exercise the pipeline, not to report numbers. This
harness is a rehearsal: prove the mechanism works, so the day real data
shows up nothing about the *process* needs debugging — only the dataset
file changes.

## Case shape

```json
{
  "id": "unique-short-slug",
  "note": "why this case exists, for a human reading the file",
  "text": "the guest message, verbatim",
  "expected": {
    "fieldName": { "state": "stated" | "missing" | "default" | "inferred" | "derived", "value": <optional, exact match if present> }
  }
}
```

Only list the fields you have an opinion about — omit ones you don't want
scored for that case. Omit `value` when only the state matters (e.g. for
`checkIn`, where the resolved date depends on "today").

## What this scores today, and what it doesn't

Scored automatically:
- **Fabricated fields** (hard 0 threshold) — any field the ground truth
  marks `missing` that the model returned as non-null.
- **Required fields correct** (`checkIn`/`nights`/`guests`/`rooms`, ≥95%
  threshold) — state and value both match, only counted where the ground
  truth says the message actually stated it.
- **Evidence is a verbatim substring** (100% threshold) — re-checked
  client-side even though the server already enforces this in code.
- **p95 latency** (≤8s threshold).

Not scored — needs a human or an LLM judge, not wired up yet:
- **Missing-field questions target the right field** (≥90% threshold). The
  runner prints the questions array per case; score this by eye until a
  judge pass exists.

## Running it

```bash
export EVAL_BYPASS_SECRET=<the Vercel deployment-protection bypass secret>
node eval/runner.mjs                        # synthetic, server's default provider
node eval/runner.mjs eval/dataset.real.json  # once Eloa's data exists
```

Calls the live deployed endpoint (`EVAL_BASE_URL`, defaults to production) —
this spends real provider tokens, not a mock. Full results (including every
field of every response) are written to `eval/results.<timestamp>.json` for
later comparison across providers; those files are git-ignored.

### Testing a specific provider without touching Vercel env vars

```bash
export EVAL_PROVIDER_API_KEY=<your key for that provider>
node eval/runner.mjs --provider deepseek-flash
node eval/runner.mjs --provider gemini eval/dataset.real.json
```

`--provider` sends that name plus `EVAL_PROVIDER_API_KEY` as a per-request
override (see `apps/casa-bff/src/app.ts`) — the deployment's own configured
default is untouched, so this is safe to run against production without a
redeploy or without affecting anyone else using the test page at the same
time. The key never goes anywhere but straight into that one HTTP request;
it's never written to the results file or logged.

## Offline replay — the same 30 messages, no provider and no key

`runner.mjs` is the bake-off: it spends real tokens against a deployment, which is
why it runs when someone decides to run it. The pipeline's own rules (dates resolved
in code, house norms, evidence enforcement) are deterministic, so once a model's
answers are on disk they can be re-run on every `npm test`. That is what
`test/evalReplay.test.ts` does, and it is the gate a date regression has to get past.

Two generated files make that possible, both written by `eval/make-fixtures.mjs` from a
recording of a live run — `results.1789702974010.json`, deepseek-flash through the local
bff on 2026-09-18, whose own report is `results-deepseek.log`:

| file | what it is |
| --- | --- |
| `fixtures.mock-30.json` | what the model answered, per case, fed back into `extract()` through a stub provider |
| `baseline.deepseek-flash.json` | what that run's pipeline made of it, to compare the current pipeline against |

Rules the generator holds to, so that the replay means something:

- **A field the model got wrong is replayed wrong.** The recorded answers go back in as
  they were, mistakes included (vi-09's `guests: 8` for a message that says 4, vi-07's
  `transport: true` for "xe tụi mình tự đi"). Correcting them would measure whoever
  wrote the fixture.
- **Fields code owns are omitted**, so the pipeline produces them again: `language`,
  `checkOut`, `transportType`, and every `default` house norm.
- **19 check-ins are restored by hand**, marked `provenance: "authored-checkIn:*"`. The
  pre-fix pipeline deleted those dates *before* the runner could record them, so the
  model's own date and quote are not on disk — the log shows those cases scoring
  `evidence n/n` while their `checkIn` read `missing`. They are written from the guest's
  own words in `dataset.mock-30.json`: a claim about what a model returns for that
  phrase, not a measurement. For every in-table phrase the resolver decides the date
  anyway, so those values cannot make a test pass on their own.

Regenerate them from the same recording or a newer one:

```bash
node eval/make-fixtures.mjs                       # default recording
node eval/make-fixtures.mjs results.<timestamp>.json
```

With the recorded answers, the replay asserts offline that the current pipeline:

- reproduces that run field for field, apart from the dates it recovers and the dive
  fields a later rule deliberately tightened — and never moves a date that run had
  already resolved;
- recovers all 19 deleted dates as the day the guest actually wrote, and adds exactly
  those 19 to the required-field score (63/87 → 82/87), with fabricated fields still 0
  and evidence still verbatim 100% — scored by `eval/score.mjs`, the live runner's own
  scoring code, shared so the two cannot drift apart;
- keeps every date a guest wrote when a model reports it, and asks only about the two
  messages that carry no date at all;
- refuses a week-late date outright and never records one as `stated`;
- refuses a date nothing in the guest's words supports ("khoảng cuối tháng này").

None of that is a model score: it is the score of *that* run's answers. The ≥95%
required-field threshold above still belongs to the live bake-off, because the recorded
answers contain that model's own mistakes.

