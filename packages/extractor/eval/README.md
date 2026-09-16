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
node eval/runner.mjs                        # synthetic
node eval/runner.mjs eval/dataset.real.json  # once Eloa's data exists
```

Calls the live deployed endpoint (`EVAL_BASE_URL`, defaults to production) —
this spends real provider tokens, not a mock. Full results (including every
field of every response) are written to `eval/results.<timestamp>.json` for
later comparison across providers; those files are git-ignored.
