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
