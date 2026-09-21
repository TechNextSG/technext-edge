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

## Update 2026-09-17: the Delivery Plan settles this — Anthropic, not Gemini

Anthony published the Casa Delivery Plan (six stages, resource table) on
2026-09-16. Two things in it directly override this ADR's "not deciding a
default" stance and its open PII question:

1. **The resourced path for the extractor is an Anthropic API key, TechNext
   org, held by Anthony** — listed for preview, staging, *and* production,
   plus eval in CI. Gemini appears nowhere in the plan. Continuing to build
   against a personal Google AI Studio free-tier key (the source of
   yesterday's whole quota saga) was never the sanctioned path — it was a
   reasonable placeholder chosen before this plan existed, not a mistake at
   the time, but it should stop being the default now that an org key is
   coming.
2. **The PII-masking open question below is answered, and more strictly
   than this ADR anticipated**: *"Guest data runs only on Anthropic and
   Odoo. DeepSeek and the Hermes beta work on synthetic or internal data,
   even when names are masked."* This isn't conditional on Gate A's data-
   residency reasoning being revisited — it's a flat exclusion. DeepSeek
   stays exactly where it already sits in this repo (synthetic-only, per-
   request override, never the default), but now permanently, not pending
   a masking decision. The DeepSeek gateway budget line in the Delivery
   Plan itself confirms the same scope: *"third column in the eval
   comparison... not for guest messages, even masked."*

**Consequence for this repo:** once Anthony issues the Anthropic key,
`EXTRACTOR_PROVIDER` should default to a Claude adapter (not yet written —
see roadmap) rather than `gemini`. Gemini and GPT-5.1 were Gate-B-qualifying
candidates for a bake-off that, per this plan, was never going to happen
against real guest data anyway — Anthropic is the only provider resourced
to touch it. Keep the Gemini adapter in the repo (costs nothing to leave
it), but stop spending further effort tuning it.

## Open question this ADR does not resolve (superseded above)

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

## Update 2026-09-17: latency — timeouts and a transcript cap, not a model change

Testing the new `converse()` multi-turn flow surfaced real latency numbers
worth acting on: Gemini ~3.2s/call, DeepSeek Flash ~11-16s/call, and no
timeout anywhere — a hung request would wait indefinitely, past Vercel's own
function limit, with no chance for the retry-once path to help. Fixed
(infrastructure only, does not touch the model-choice question above):

- **Per-provider request timeouts** via `AbortController`: Gemini 8s (the
  Playbook's own p95 target; real p95 is ~3.2s so there's headroom), DeepSeek
  20s (its own measured p95 on a *successful* call is already ~15.9s — an 8s
  cap would misclassify normal latency as a hang). Traced through
  `extract.ts`: a timeout is thrown before the block that produces
  `AttemptFailure`, so it's already treated exactly like the earlier
  rate-limit case — drives the existing retry-once path, never mis-wrapped
  as a schema-validation error. No change needed in `extract.ts` itself.
- **Transcript cap in `converse()`**: capped at the newest 8 turns,
  independent of the BFF's own 20-turn wire-format cap. Real guest
  enquiries run 2-4 turns, so this only bites on pathological input — kept
  the "resend everything, re-extract from scratch" design exactly as-is
  (decided against incremental merging: real conversations are short enough
  that per-turn slowdown isn't worth the added complexity/bug surface).
- **DeepSeek's own latency is architectural, not something in our control**:
  routes through the team's LiteLLM gateway (Railway) to DeepSeek's actual
  inference infrastructure — likely real cross-region hop latency on top of
  inference time. Not worth further optimization effort given DeepSeek was
  never the production path (see the update above — Anthropic is).
- Also fixed the same day: DeepSeek's adapter now uses forced tool-calling
  instead of embedding the full JSON Schema as prose in the prompt (DeepSeek
  has no `response_format: json_schema` — confirmed against their docs —
  but does support strict schema-enforced tool calls), cutting input tokens
  that were inflating both cost and latency.

## Update 2026-09-20: quality/flow check via real production conversations

Ran real (non-eval) multi-turn conversations against production `/v1/converse`
in both Vietnamese and English — greeting → dense multi-field answer → dive
follow-up → summary — to judge the flow experientially, not just by eval
score. Findings, all observed live:

- **Held up:** per-field state model, house-norm defaults surfaced only in
  the summary (never asked about), the No-Fly PADI/DAN advisory firing
  correctly when `diveTo === checkOut`, transport negation (`"driving
  ourselves, no pickup needed"` → `transport: false, stated`, not `missing`
  or wrongly `true`), guest-count arithmetic on "2 adults and 2 kids", and
  the closing line always disclaiming nothing is booked yet (ADR-001).
  Latency stayed 3.8-5.1s per turn across 4 turns — no creep from resending
  the full transcript, consistent with the 2026-09-17 update's conclusion
  that this only matters on pathological input.
- **Minor flow nit (not fixed, low priority):** when `diver: true` and the
  stay is short (2-3 nights), `diveFrom`/`diveTo` are still asked as two
  separate questions with no default to the stay's own `checkIn`/`checkOut`
  — costs a guest an entire extra turn confirming "yes, the whole stay" on
  what is very likely the common case. Would be a `postProcess` default
  (state `default`, not asked, same mechanism `checkOut` already uses),
  scoped in `questions.ts` around the `diveFrom`/`diveTo` rules
  (`when: (trip) => trip.diver?.value === true`). Flagged, not built.

## Update 2026-09-20: `guests` extraction fails on bare "group of N ... only M"

The English-language test above surfaced a real, reproducible bug: a guest
message giving both a party/group size and a smaller staying count, with no
filler words between the two numbers, comes back `guests: missing` instead
of extracting the staying count — even though this exact shape
(`"4 are day visitors, 2 staying overnight"`) is the system prompt's *own*
worked example in `gemini.ts`/`deepseek.ts`.

**Reproduced 4/4 by hand, then formalized into eval** — added
`en-06`..`en-09` to `dataset.synthetic.json` (digit vs. spelled-out group
size, clause order reversed, near-verbatim restatement of the prompt's own
example). All four fail identically. Pulled the required-fields score for
the 14-case synthetic set from ~97-98% to **89%** (below the ≥95% Playbook
threshold) — entirely attributable to these four cases; 0 fabrication
throughout, so the failure mode is the safe one (asks again) not the
dangerous one (wrong value shipped).

**Isolated the trigger by hand-varying the sentence:**

| Message shape | `guests` result |
|---|---|
| `"group of 6 but only 4 ... staying overnight ... 2 ... visiting for the day"` | `missing` |
| `"group of 6 but only 4 are joining"` | `missing` |
| `"group of six but only 4 are joining"` (word, not digit) | `missing` |
| `"only 4 ... joining, out of a group of 6"` (reordered) | `missing` |
| `"4 of us are joining this trip"` (no group-size number at all) | `4, stated` |
| eval's existing `en-03`: `"group of certified divers (12 dives logged each) but only 2 ... joining"` | `2, stated` |

Not "group of" in general (`en-03` has it and passes) — specifically when
**both numbers are bare guest-count digits with nothing distinguishing them**
does the model give up and return `missing` rather than pick either one
(itself evidence the zero-fabrication training/prompting is working — it
would rather ask again than guess between two candidates).

**Why neither existing dataset caught this:** neither `dataset.synthetic.json`
(10 cases, pre-fix) nor `dataset.mock-30.json` (30 cases) had a bare case in
this shape — only variants with filler text separating the two numbers. The
prompt's own example was never actually eval-tested. Gap in the eval, not a
false pass by the tool.

**Attempted fix: a worked example in the prompt — did not work.** Added a
concrete input→output example to both `gemini.ts` and `deepseek.ts`'s system
prompts (same rule, same duplication reasoning as the existing `transport`
rule comment). Re-ran the eval against a preview deployment built from that
commit: **all four cases failed identically**, including on `gemini-2.5-flash`
(the preview resolved a different model than production's
`gemini-3.1-flash-lite`, confirming this isn't one model's quirk). One more
sentence of prose is not enough to move this behavior — logged as attempted
and ruled out, not left silently unresolved.

**Considered and rejected: a deterministic regex fallback in `postProcess`.**
Would parse `"group of N ... only M (staying/joining/overnight)"` directly
from the guest's text and force `guests: M` when the model returns `missing`
and the pattern matches. Rejected for three reasons:

1. It's the same category of fix the `transport` rule's own comment already
   argues against for this class of problem: *"Negation is the one thing a
   keyword rule cannot do and this model can, so nothing in code tries."*
   `checkOut = checkIn + nights` (the existing `postProcess` precedent) is
   arithmetic on already-clean structured fields — parsing free text for
   "which number means what" is a different kind of problem, the kind this
   pipeline uses a model specifically to avoid hand-rolling.
2. A regex miss is worse than the current failure: `missing` today costs one
   extra clarifying turn (safe). A wrong regex match would silently write
   `guests: stated` with regex-derived evidence straight into the summary/
   estimate, skipping the guest confirmation the current safe failure
   provides.
3. English-only pattern — would need separate regexes per language (VI/ZH
   phrase this differently) to reach parity, and still wouldn't generalize
   to phrasings not yet seen, unlike (in principle) the model.

**Current status: known limitation, not fixed.** Safe-failure mode (asks
again, does not fabricate), low expected frequency in real guest messages
(two bare numbers with zero separating words). Left as `en-06`..`en-09` in
the eval dataset so any future prompt or provider change is checked against
it automatically instead of being re-discovered by hand.

**Wanted to test DeepSeek on this before ruling out prompt-only fixes
further — blocked by infrastructure, not the model.** The team's LiteLLM
gateway (`https://litellm-production-7402.up.railway.app`) returns
`404 "Application not found"` on every path including `/` and `/health` —
a Railway "this app doesn't exist" response, not an auth failure (which
would be 401/403). Confirmed the supplied gateway key is not the problem by
hitting the gateway directly. **Also surfaced in the process:** production's
`EXTRACTOR_PROVIDER` currently resolves requests through Gemini directly
(`google:gemini-3.1-flash-lite`), not `deepseek-flash` as this document's
own "Policy: DeepSeek is primary/default" comment in `providerFromEnv.ts`
describes — every conversation test run against production this session
came back with a `google:gemini-*` provider id. Plausible explanation:
someone switched production to Gemini when the gateway went down, as a
stopgap — not confirmed with anyone on the team, flagged here rather than
assumed.

A session-scoped monitoring check (fires every 3h, auto-expires after 7
days from 2026-09-20 — session-only, does not survive a restart) watches
for the gateway coming back, re-runs the eval through DeepSeek including
`en-06`..`en-09` when it does, and reports back. Per the user's standing
instruction, once confirmed healthy, production's `EXTRACTOR_PROVIDER`
should be switched back to `deepseek-flash` — that step needs a live
session (a production env var change + redeploy is not something a
background check is permitted to do unattended).

## Update 2026-09-20: BUG-EXT-07 is worse than first scoped — it regresses an already-stated field, not just a fresh message

Real WhatsApp testing (sandbox, live) surfaced a second trigger for the same
underlying weakness, and this one is more concerning than the original
bare-count phrasing:

**Sequence, verbatim from the sandbox log:**
1. Guest states everything up front, `guests` comes back `3, stated`
   correctly. Bot renders a full summary.
2. Guest follows up: *"Baby for not fee, isn't? I have an added person"*
   (asking whether an infant is free, mentioning one more person, no exact
   final count given).
3. Bot's next reply **drops back to asking "How many guests in total?"** —
   `guests` is no longer 3, it is `missing`.

**Reproduced via `/v1/converse` directly** (not just observed once on
WhatsApp) — same history, same follow-up message, `guests` comes back
`{value: null, state: "missing"}` even though "3 guests" is still verbatim
present in the guest's own first message, unchanged, in the same
transcript passed to the model.

**Why this is worse than the original bare-count case:** that one failed
to extract a number on the *first* attempt (guest never had a confirmed
value to lose). This one **discards an already-`stated`, already-confirmed
value** because a later message introduces an unresolved arithmetic
question (3, plus an unspecified "added person" — is that 4? does a baby
count at all?) that the model can't reconcile against the earlier number,
and instead of keeping 3 and asking a targeted follow-up ("so is it 4 with
the extra person?"), it wipes the field back to `missing` entirely, forcing
the guest to restate a number they already gave.

**Why this is a bigger real-world risk than `en-06`..`en-09`:** the
original trigger ("group of 6 but only 4 are staying") is an unusual
sentence shape guests rarely produce unprompted. "Does my baby count as a
guest" / "I have one more person now" is an extremely ordinary follow-up
question at a family resort — far more likely to occur in a live demo or
real guest conversation than the original bare-count phrasing.

**Same root cause, same disposition:** this is the same class of failure
already documented above (model can't reconcile two guest-count signals,
resolves the conflict by discarding rather than asking a targeted
clarifying question) — not a new bug, but evidence the known limitation is
broader and more likely to surface than first scoped. Flagged in
`docs/demo-checklist.html` as a phrase to avoid during the 2026-09-21
demo. Not fixed pre-demo, same reasoning as the original case (regex
fallback rejected for the same three reasons above; prompt-only fix
already failed once on the simpler case). Worth a dedicated eval case
(a `stated` guest count followed by an ambiguous addendum, in a second
turn) once there is time to design one properly — not added tonight to
avoid rushing eval-dataset changes right before the demo.

## Update 2026-09-21: a third trigger (long email), and proof the model itself is not the bottleneck

**Third independent real-world trigger, same failure class.** Tested a long,
realistic multi-paragraph booking email (not a short chat message) against
production `/v1/extract`. The email states *"We are a group of five in
total: myself, my husband, and our three children (two teenagers and one
who is only 6 years old, so she won't be diving with us...)"* — an
unambiguous total, no split between staying/visiting. `guests` still came
back `missing`. Same email also lost `diveTo` (stated "October 16th and
17th", only the 16th was captured). Reproduced identically on real WhatsApp
(sandbox), not just via the API. Three independent triggers now confirmed
for the same weakness: bare group-vs-staying counts (`en-06`..`en-09`), a
follow-up question about an added person/baby, and a family booking email
that mentions children's ages/diving eligibility near the guest total. The
common thread: any second signal that touches "how many people" or "who
counts," even when not actually in conflict with the stated total, risks
the model discarding `guests` back to `missing`.

**Diagnostic: is this the model's limitation, or ours?** Called Gemini
directly (same model, `gemini-3.1-flash-lite`, same API key) with the
Jennifer email and a plain unconstrained question — no JSON schema, no
`stated/inferred/missing` framework, no verbatim-evidence requirement, just
*"how many total guests are in this booking?"* — and got a correct, instant
**"5"**, no hesitation.

**Conclusion: the model's reading comprehension is not the bottleneck.**
The failure is induced by this pipeline's own extraction contract — the
requirement that every field be classified into one of three states with
verbatim evidence for `stated`, evaluated inside a long, multi-rule system
prompt covering dates/transport/diver/guests all at once. Under that
constraint, the model appears to become more conservative around a
nested/complex sentence than it is when simply asked to answer a direct
question in free text — plausibly because reconciling "5 in total" against
"one won't be diving" *inside a rigid classification task* reads as an
inconsistency worth flagging as `missing`, where the same content read as
a plain comprehension question does not require that reconciliation at
all.

**Answering the standing question this raises for the project's direction:**
this is not evidence that structuring the model's output was a mistake.
The zero-fabrication contract exists for a reason no free-form answer can
give: a verifiable, machine-checkable claim about *why* the model believes
something (verbatim evidence), a field-by-field confidence level the
pipeline's own code can act on deterministically (ask vs. default vs.
trust), and a guarantee — enforced in code, not just prompted for — that a
guessed value can never reach a guest or an estimate silently. A free-form
"5" has none of that: it cannot be traced, corroborated, or defaulted, and
a wrong free-form answer looks identical to a right one. Losing that would
be the real regression.

What this finding does show: the *specific shape* of today's contract (one
long multi-field system prompt, one classification pass, evidence required
up front) has a real, now three-times-confirmed blind spot on nested
guest-count phrasing. The fix belongs at the contract-design level, not by
discarding the contract — candidates worth trying later (not attempted
tonight, pre-demo freeze in effect): a two-pass approach (a plain
comprehension read first, then a second pass that maps the model's own
free-form understanding into the strict schema with evidence), splitting
the single do-everything system prompt into smaller per-field passes, or a
few-shot example built from exactly this email shape. None of these are a
step back from structured extraction — they are ways to get the model's
demonstrated comprehension *through* the same verifiable contract instead
of working around it.
