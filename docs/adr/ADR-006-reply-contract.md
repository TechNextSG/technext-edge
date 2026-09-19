# ADR-006: The reply contract — one deterministic message per guest turn

**Date:** 2026-09-18 · **Status:** proposed — awaiting sign-off
**Supersedes:** ADR-005a's "transcript cap" clause (2026-09-17 update) — that clause
described an 8-turn cap that no longer exists in the code; `converse.ts` now caps by
size (`MAX_TRANSCRIPT_CHARS`), and this ADR is the document that should have replaced
it · **Signers:** Anthony (Edge/Extractor pod owner) — pending

## Context

The reply layer is the only part of this pipeline a guest ever sees. Up to
2026-09-18 it was the least designed part of it: `renderFormMessage()` returned the
same *form* on every turn — a list of everything recorded, then every open field,
numbered — and the final turn was a fixed closing sentence. Three failures came out
of that, all visible in one WhatsApp transcript:

1. **No greeting.** A guest who wrote "hi" got "Please fill in what's still missing"
   and seven numbered questions, three of them about fields Casa had defaulted
   itself (rooms, meals, transport). A first reply that interrogates is not a
   concierge.
2. **A closing that showed nothing.** The last message said "I have everything I
   need — dates, guests, rooms, meals, transport, and your contact name are all
   noted" — naming fields the guest may never have mentioned, and printing not one
   value. The guest had no way to check a single fact before a human quoted them.
3. **The wrong language, or a machine's language.** Language was detected over the
   whole transcript, which includes the assistant's own replies; a Vietnamese reply
   from the bot made the *guest* Vietnamese from then on. And one accent was enough
   to trigger Vietnamese, so an English guest with a typo ("i dont ned airport") was
   answered in Vietnamese.

A fourth problem was structural: nothing in `docs/adr/` recorded any of this, while
the roadmap referenced "ADR-006" as though it existed.

## Decision

**1. One reply per guest message, and code writes every word of it.** A model
extracts facts; it never writes a guest-facing sentence. `questions.ts` owns the
wording, in en/vi/zh. Reasons, in order of weight: a model sentence can promise a
price or a room and this bot must not; the same trip must render the same words
(determinism is what makes the eval and the tests possible); no second provider call
(latency, cost, one more failure mode); and every string is assertable without a
judge.

**2. Three reply kinds, chosen by the trip itself** (`greeting`, `questions`,
`summary`, returned as `replyKind`):

- `greeting` — nothing the guest said has been extracted yet. Introduces Casa and
  asks for the four things a quote needs (dates, nights, guests, a name).
- `questions` — something was recorded but the enquiry is incomplete. Reads back
  *only the guest's own words* as prose, then asks the rest numbered in the
  backend's priority order.
- `summary` — nothing left to ask. Reads the whole booking back, flags assumptions,
  names the human follow-up, and commits to nothing.

`done` stays exactly `questions.length === 0`, so the summary and the question list
can never disagree.

**3. A house norm is shown, never asked.** `BASELINE` is `["missing"]` only: a
`default` (house norm) or `derived` (code computing it from the guest's answers) is
never a question the guest owes an answer to. Assumptions appear in the summary
flagged `(assumed)`, which is where a guest expects to correct them. Derived dates
are not flagged — `checkOut = checkIn + nights` is arithmetic, not a guess.

**4. Ask what money depends on; never infer it.** `diver` was inferred by a keyword
regex, and the dive window was then derived as the whole stay — dive revenue priced
off a word nobody confirmed. The regex is gone: `diver` is a question like any other
field, and the window is asked only once the guest has confirmed diving. Regexes stay
where being wrong is cheap — `guestType` (who is booking) is still read from phrasing,
because a false positive costs a human a glance, not a quote.

**5. Evidence and language are read from the guest's words only.** `guestTextOf()`
strips the assistant's turns out of the transcript before `enforceVerbatimEvidence()`
and `detectLanguage()` run. Without it, the bot's own "Meals: full board" came back as
a guest-stated fact on the next turn with the bot's sentence as its evidence, and the
conversation stayed locked in the bot's language.

**6. The summary hands off to a human and says so.** "Nothing is booked yet" is part
of the contract, not politeness: this is the first message a guest could mistake for a
confirmation, and only a human can confirm availability and price.

## Consequences

- Every reply is deterministic and testable: `test/questions.test.ts` asserts the
  three kinds, the assumption flags and the date formatting per language, and the
  whole suite runs as `npm run verify` (12 files, 91 tests) with no judge involved.
- Adding a language means extending the tables in `questions.ts`. ZH is kept for now
  — it was already in the tables and Chinese guests are a real segment — so dropping
  it would be a product decision, not a code one.
- The reply formats dates per language (`Sep 19 – 21, 2026`, `19–21/09/2026`,
  `2026年9月19–21日`). Date *resolution* stays in `dates.ts`, model-free, and now
  understands the Vietnamese digit weekdays guests actually type (`thứ 7`, `thu 7`).
- **Extended later the same day (see the update below):** a provider failure or timeout
  used to send the guest *nothing*. It now sends one static apology and parks the
  thread for a human; nothing yet shows a receptionist what a conversation is *missing*
  (roadmap L3, "assumed state for money-affecting defaults") — that part is still open.
- `transportType` is still derived as `roundtrip` from the transport boolean and then
  asked about (`askOn` includes `derived`). Asking is a symptom-level fix; the roadmap
  keeps the underlying "price depends on a value code guessed" item open.

## Update 2026-09-18: what this changed in the code

- `questions.ts` — `RULES` gains `diver`; `BASELINE` becomes `["missing"]`;
  `renderFormMessage()` is replaced by `renderReply()` (greeting / acknowledgment plus
  questions / summary) with per-language date and night formatting.
- `extract.ts` — the `isDiving` regex and the derived dive window are deleted;
  language, `guestType` and the evidence haystack all read `guestText`.
- `normalize.ts` — `detectLanguage()` rewritten to be conservative (Vietnamese letters
  and words, not a single accent), `guestTextOf()` added.
- `converse.ts` — `closingReply()` deleted; the outcome now carries `replyKind`.

## Update 2026-09-18 (2): the two messages that are not replies

The three kinds above all read a `Trip`. This adds the two moments where there is no
`Trip` to read, because the failure to speak was the worse failure: the guest waiting
on a provider outage used to receive *nothing at all*, which from their phone is
indistinguishable from being ignored.

**7. A turn that fails still answers the guest.** Two static sentences live in
`questions.ts` next to the other guest-facing wording, because nothing else is allowed
to write to a guest either:

- `fallbackReply("apology", lang)` — the model failed or the turn ran out of time:
  "something went wrong on our side, a person will reply here".
- `fallbackReply("handoff", lang)` — the thread is parked for a human (see 8).

Language comes from `detectLanguage()` over the **guest's** turns (point 5 again), so a
Vietnamese guest is apologized to in Vietnamese. They promise no time, no price, and no
room; asking the guest to retype anything would be the one thing worse than the outage.

**8. A thread can stop being the bot's to answer.** Three triggers, all deterministic
and all read before a model call except the last: a turn failed; the guest asked for a
person (`wantsHuman()` — explicit phrases only, because "human resources conference" is
an enquiry); or the bot has already replied `ASK_LIMIT = 8` times and the enquiry is
still incomplete. The thread is then *parked* in `conversationStore`:

- no model is called on that thread again, so the bot cannot talk over the human who
  now owns it — this is the whole point, and it is what the tests assert
  (`provider.call` does not increase);
- the guest is told once per `HOLD_REPEAT_MS` (10 min), not at every "ok" they type;
- the park expires with the thread (24h), and a person can hand it back with
  `POST /v1/channels/whatsapp/threads/:phone/resume`, guarded by `x-verify-token`.

**Consequence for the delivery contract:** the webhook's response body now reports
`handoffs` alongside `replied`, `duplicates` and `failed`. `replied: 1, failed: 1` means
"the turn failed and the guest still heard something" — which is a different outcome
from the two counted fields alone, and the one this update exists to produce. A claim is
now kept whenever anything reached the guest (a reply, a holding message, or an apology),
so Meta's redelivery is a `duplicate` instead of a second message.

**Still open after this:** the store is still in-process (a redeploy forgets which
threads are parked), nothing surfaces a parked thread except that JSON view, and the
claim TTL / thread lock items in roadmap L2 are untouched.

## Update 2026-09-19: an absent Tier-2 field is a question, not silence

The first live run of this contract on a real phone (2026-09-19) produced a transcript
that caught a hole in Decision 4. The guest wrote his dates once. The reply that asked
**"Would you like to go diving during your stay?"** and the reply that did not were both
sent to him within the same minute, and both were honest readings of the same message.

Cause, reproduced against the live provider the same day: `diver` (and the other Tier-2
Odoo fields) are *optional* in the Trip schema, so a provider is free to leave the key
out of its tool arguments — measured twice out of four calls on identical text. With no
key there is no `state`, and `generateQuestions()` skipped a state-less field, so the
question silently disappeared. Nothing failed: no schema error, no retry, no log line.
The same shape of hole existed for a state only code may set — a model labelling its own
guess `default` would have had it shown to the guest as a house norm (or skipped as one).

**9. Absence and code-only states are normalized to `missing` before anything asks.** In
`extract.ts`, a key that is absent (or not an object) and any state in
`CODE_ONLY_STATES` = `["default", "derived"]` become `missing` — the one state that
turns into a question. House norms are still applied to exactly `HOUSE_NORM_FIELDS`
right after, so a model's `default` on `meals` is replaced by the norm rather than
trusted. `generateQuestions()` reads a missing key as `missing` too, because it is
public API (the test console draws its form from it, the eval builds trips by hand).

**Dive fields are `stated` or a question.** `diver`, `diveFrom` and `diveTo` survive
post-processing only as `stated`. An `inferred` answer ("we might dive") or a derived
window is exactly what Decision 4 removed from the regex, and being non-missing it would
never have been asked about; it now becomes `missing` again, so the guest's own reply is
the only thing that fills it.

Evidence: `extract.test.ts` (a Tier-2 key omitted entirely, a `default` a model invented,
an `inferred` dive answer) and `questions.test.ts` (an absent key still asked about).
`npm run verify` → 12 files, 108 tests.

**Still open:** roadmap L136 — two messages seconds apart still run as two independent
turns (the live transcript above is that pattern: a message, then "hi" one second later).


