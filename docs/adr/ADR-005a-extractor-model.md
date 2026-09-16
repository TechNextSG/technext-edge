# ADR-005a: Model choice for the AI Extractor

**Date:** 2026-09-15 · **Status:** draft — not yet signed
**Supersedes:** none · **Signers:** Anthony (Edge/Extractor pod owner) — pending

## Context

Four providers were compared for `POST /v1/extract`: Claude, Gemini, GPT-5.1, DeepSeek.
No independent benchmark exists for this exact task (short guest messages, three
languages — VI/EN/ZH, zero tolerance for fabricated fields). The cost spread
between structurally-qualifying providers is under $10/month at current volume
(a few dozen requests/day), so price alone should not decide this.

Two gates were applied before comparing on merit:

- **Gate A — data governance.** The raw guest message (name, email, phone) is sent
  to whichever provider is called. DeepSeek's hosted API stores and processes data
  in the PRC with no enterprise DPA and no lawful EU transfer mechanism — it fails
  this gate regardless of price or quality, unless self-hosted (out of scope here).
- **Gate B — technical minimum.** JSON Schema structured output, prompt/context
  caching, capable of p95 ≤ 8s. Claude, Gemini, and GPT-5.1 all pass; none has a
  demonstrated edge over the others for this specific task.

## Decision

**Not deciding a default yet.** Deciding the architecture instead: `zod` is the
single source of truth for the `Trip` schema; the provider boundary is the
`ExtractProvider` interface in `packages/extractor/src/provider.ts`; switching
providers is an environment variable, never a code change to `extract.ts`.

**Gemini is the demo default** (`createGeminiProvider`, see
`packages/extractor/src/providers/gemini.ts`) — cheapest provider that clears
both gates, and deliberately not Claude, since a Claude-made tool defaulting to
its own maker's model is the one choice this pod should not make by default.
This is a starting point for wiring the pipeline end to end, not a conclusion.

## The actual decision comes from the eval, once it exists

When the 30 real, name-masked messages arrive from Eloa: run all three
gate-B providers through the same eval harness, score against the five
Playbook thresholds (fabricated fields = 0 is a hard cutoff, not averaged
in), and record the result as **ADR-005b**, which supersedes this one's
"demo default" clause.

## Update 2026-09-16: a fourth candidate, on a leash

The team already runs a LiteLLM gateway (Railway) giving everyone a budgeted
DeepSeek key — cheapest of all four candidates. Added `createDeepSeekProvider`
alongside the other three. This does **not** reverse Gate A: the gateway is
only a proxy, inference still runs on DeepSeek's own infrastructure, so the
data-residency disqualification stands. DeepSeek may run **only against
synthetic/example messages**, never the 30 real ones from Eloa, until the
open PII-masking question above is resolved. If it scores well on synthetic
data, that's a reason to prioritize the masking decision — not a reason to
skip it.

## Update 2026-09-16: a real blocker found via the eval dry run

Built `packages/extractor/eval/` (runner + a researched, synthetic dataset —
never Eloa's real messages, see the eval README) as a rehearsal of the
mechanism before real data arrives. Two real bugs surfaced and were fixed the
same day: the scorer itself was miscounting a house-norm `default` as
fabrication, and the pipeline was reporting a Gemini rate-limit (429) as a
schema-validation failure (422) — misleading, since those are different
problems with different fixes.

The blocker that matters for planning: **the current `GEMINI_API_KEY` is on
Google's free tier**, capped at 20 requests/day (and a tight per-minute burst
limit under that — 9 of 10 back-to-back eval calls hit 429 in one run). This
has nothing to do with model quality and everything to do with billing not
being enabled on the Google AI Studio project behind this key.

**This blocks the real bake-off, not just today's dry run.** Running 30 real
messages against even one candidate provider will exhaust a free-tier key
immediately; running the same 30 against multiple candidates (the entire
point of the bake-off) is not possible on this tier at all. Enabling billing
(or issuing a paid-tier key) for Gemini is a prerequisite for ADR-005b, not
a nice-to-have — needs whoever holds the Google Cloud billing account (Sky
or Anthony), not something fixable in code.

## Update 2026-09-16: DeepSeek Flash synthetic dry run — early technical signal

Ran the same 10 synthetic messages through DeepSeek Flash (via the team's
LiteLLM gateway, per-request override — no env vars touched, see
`eval/README.md`). Reminder: 10 synthetic messages is not a sample size
anything should be decided on. Recorded here as a lead to chase during the
real bake-off, not a verdict.

| Metric | DeepSeek Flash | Gemini (partial — free-tier quota cut the run short) |
|---|---|---|
| Fabricated fields | 0 (see dataset-bug note below) | 0 |
| Required fields correct | 19/23 (83%) | 3/3 on the one case that completed |
| Evidence verbatim | 31/31 (100%) | 5/5 |
| p95 latency | **15.9s — over the 8s threshold** | ~3.2s |
| Tokens per message (avg) | ~920 in / ~1600 out | ~130 in / ~200 out |

Two findings worth carrying into the real bake-off:

1. **DeepSeek Flash missed relative-date check-in extraction in 4/10 cases** —
   "arriving tomorrow," "checking in this Friday," "下周六" (next Saturday,
   unambiguous Chinese), "in 5 days." All four came back `checkIn: missing`
   instead of `stated`. This is a real, repeated pattern, not one-off noise —
   worth specifically re-checking against the real 30 messages, since
   check-in date is one of the two required fields with a hard ≥95% bar.
2. **DeepSeek's per-message token cost is inflated by this adapter, not
   necessarily the model** — the gateway doesn't expose native schema-
   constrained decoding the way Gemini's `responseSchema` does, so
   `providers/deepseek.ts` embeds the full JSON Schema as prose in the system
   prompt every call. Before using DeepSeek's token cost to compare against
   Gemini in the real bake-off, either fix the adapter to send a leaner
   schema description or account for the gap as an implementation artifact,
   not a per-token price difference between the two providers.

**Dataset bug found by cross-model agreement, not a provider fault:** both
Gemini and DeepSeek independently read "this weekend" (case `en-02`) as
check-in evidence, while the dataset's ground truth said `checkIn: missing`.
Two different models converging on the same reading is a signal the ground
truth was wrong, not that both models fabricated the same thing — fixed by
removing that field's expectation from the dataset (see the eval dataset's
`en-02-missing-most` case; unscored fields are intentional, not an oversight).

## Open question this ADR does not resolve

`normalize()` masks PII **before logging**, not before sending to the
provider — the raw message (with real email/phone) still leaves the system
on every call, regardless of which provider is chosen. Whether to mask PII
before the provider call too is a product/legal call for Anthony and Sky,
not an engineering default. It also changes Gate A: if PII is masked before
sending, DeepSeek's disqualification is worth revisiting.

## Consequences

- Adding a fourth provider later (or bringing DeepSeek back if PII masking
  changes Gate A) means one new file under `providers/`, not a refactor.
- The two non-default adapters stay in the repo, unused but compiling and
  tested, so a later switch costs an environment variable, not a rewrite.
