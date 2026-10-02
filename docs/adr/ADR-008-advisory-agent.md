# ADR-008: An advisory agent next to the quotation flow

- **Status:** Proposed (for Lead / Anthony review; no runtime code is written)
- **Date:** 2026-10-02
- **Deciders:** Lead (Duy), Anthony. Proposed by the TechNext Edge pod (`aidev1-technext`).
- **Extends:** [ADR-006](./ADR-006-reply-contract.md), [ADR-007](./ADR-007-neuro-symbolic-synthesis.md)
- **Followed by:** [ADR-009](./ADR-009-advisory-langgraph.md) (phase 3: moving the loop to LangGraph.js)
- **Diagram:** [advisory-architecture.html](../diagrams/advisory-architecture.html) (dashed nodes do not exist in code yet)

---

## 1. Context

The bot does one job: read a booking request and turn it into a draft quotation for staff. Everything outside that job is
sent to a person and the guest gets no answer.

- `classifyEnquiry` returns `"not_booking"` for property questions (wifi, the bar, directions, an address, parking).
  `bff/src/channels/whatsapp/turn.ts:218-237` parks the thread and sends `fallbackReply("not_booking")`.
- Questions about rooms or prices are deliberately classed as `booking` (`ai/src/application/intent.ts:28-30`), so they go to the
  extractor, which has nothing to say about them.

We want the bot to be able to **advise** later (rooms, diving, hours, policies), but the quotation core has to stay exactly as
it is: it is the part that was tested, judged and demoed, and it must never give a guest a price.

Two findings from our own testing shape this proposal:

1. **A one-word regex already misroutes real enquiries.** In the judge run of 2026-10-02
   ([report](../reports/judge-claude-graded-2026-10-02.md)), a long forwarded message that happened to contain "parking" (s21) and a
   message that asked about wifi *and* gave full booking details (s22) were both handed to staff as "not a booking". Adding an
   `advice` route on top of the same regex would widen that mistake. The route has to prefer `booking` whenever the message
   carries booking facts.
2. **Our only written source of resort facts contradicts itself on two points.**
   [`resort-website-cross-check.md`](../specs/resort-website-cross-check.md) records that the website says a van takes 7 guests while the
   resort's engine splits 6+1 (section 2.2), and that "children 0-6 are free" is on the website but not modelled in the engine
   (section 2.4). A bot that answers from the website would state both as fact.

## 2. Decision

Add a third route at the gate, an **advisory agent** that answers property questions from a small, owned **knowledge store**
and hands over whenever it cannot ground an answer. Keep everything else as it is.

1. **The quotation core does not change.** Extract, precheck, write the reply, save the draft: untouched.
2. **A new route `advice`** in the gate, decided by regex in phase 1 (no model call), behind `ENABLE_ADVISORY` (default off).
3. **The agent is our own loop**, at most 3 model steps, with two read-only tools. We move to LangGraph.js only when the flow needs
   it (phase 3), not before.
4. **Answers are grounded or they are not sent.** A symbolic gate checks every advisory answer; an answer with no source becomes a
   hand-off, never a guess.
5. **Nothing about price is advisory.** There is no price tool and no price in the knowledge store.

## 3. Architecture

### 3.1 Routing at the gate (`turn.ts`)

```
Gate ─┬─ booking  → extract flow (unchanged)
      ├─ advice   → advisory agent (new, behind ENABLE_ADVISORY)
      └─ handoff  → staff (unchanged)
```

- `EnquiryIntent` (`ai/src/application/intent.ts:33`) gains `"advice"`. Phase 1 uses regex only.
- Order of precedence, first match wins:
  1. a person asked for, a complaint or a cancellation → hand-off (as today);
  2. spam and links → hand-off (as today);
  3. the message carries **booking facts** (a date, a head count, a number of nights, a room type) → `booking`, even if it also asks
     a question (this is what fixes the s21 and s22 misroutes);
  4. otherwise, if it matches a property-question pattern (most of today's `NOT_BOOKING_RE`: wifi, check-in time, directions,
     parking, the bar) → `advice`;
  5. everything else → `booking` (the existing default).
- The booking-facts check must be a cheap pure function (patterns for ISO and written dates, `\d+ (guests|people|nights)`, `standard|deluxe|suite`);
  it is the part of phase 1 that needs the most careful tests.
- Mixed messages (a booking **and** a question) keep today's behaviour in phase 1: they go to the booking flow and the question is
  not answered. Answering the question as well is phase 3.
- With `ENABLE_ADVISORY` off, `advice` behaves exactly like today's `not_booking` (park + fixed reply).
- No answer in the knowledge store, a timeout, or a blocked answer → park with the new reason `advice_unanswered`. The guest gets
  the same fixed hand-off message as today.

### 3.2 The advisory agent (`ai/src/application/advise.ts`, new)

- A hand-written loop of at most 3 model steps. The budget comes from the time left of the turn deadline
  (`WHATSAPP_TURN_TIMEOUT_MS`, 20 s), computed the way `synthesisBudgetMs` is (`turn.ts:240`).
- Each step the model either calls a tool or answers. The answer is structured: text, the ids of the entries it used, and an
  `answerable` flag.
- **Port change.** `ExtractProvider` (`ai/src/ports/provider.ts:79-116`) has only one-shot calls (`call`, `generateText`). Add an optional
  `chatWithTools?(messages, tools)` and implement it in `gemini.ts` and `deepseek.ts`. Wrap it with `createResilientProvider`
  (`ai/src/infra/providers/providerFromEnv.ts:180`) so the fallback model and the circuit breaker apply as for every other method.
  This is the main new code.
- **Tools (phase 1, read-only):**
  - `searchKnowledge(query)` returns knowledge entries with their `id`.
  - `roomCapacity(type)` reads `DEFAULT_ROOM_CAPS` / `roomCapsFromRates()` (`ai/src/domain/houseNorms.ts:22,29`), the same numbers the
    booking flow uses to split rooms.
- **There is no price tool for guests.** The price a guest receives is Odoo's, produced by the team estimator and published by a
  staff member (`bff/src/quote/domain/rates.ts:3-9`). The remote `EstimatorPort.sendEstimate` mints a new scenario on the team
  side on every call (`bff/src/estimator/port.ts:195-199`), so it must not be used to answer a question. A guest who asks for a price is told a quotation will come
  from the team, or is moved into the booking flow.

### 3.3 Knowledge store (`contracts/knowledge/*.json`, new)

- One entry per fact: `id`, `topic`, `text`, `source` (URL or document), `owner`, `reviewedAt`.
- Phase 1: the store is small, so it goes straight into the prompt. No vector database.
- **Seed only what two sources agree on, or what the resort confirms in writing.**
  - Two sources agree today (`resort-website-cross-check.md`, sections 1 and 7): 24 rooms (16 Standard, 4 Deluxe, 4 Suite); room
    capacity (rate card and engine); a 50% non-refundable down payment.
  - One source only (the website), so seed after the resort confirms: check-in from 14:00 and check-out 12:00, front desk open until
    21:00 (section 2.6), and the balance due one month before travel.
- **Do not seed until the resort settles it:** van capacity (website 7, engine 6) and van price; "children 0-6 free" (website only,
  not in the engine); day use 8:00-17:00 (website only, not in the engine).
- **Missing and blocking phase 1:** dive package descriptions, seasons and weather, the cancellation policy, a FAQ. The resort has to
  supply these; without them the agent can only answer about rooms and hours.
- No price figures anywhere in the store.

### 3.4 The advice gate

Every advisory answer must pass two checks by code before it is sent:

1. `verifyGuestFacingText(text, {})` (`ai/src/application/synthesis.ts:205`): no price, no false booking confirmation. It is called
   **without** `roomTypes`: the judge report found that option blocks an answer that lists several room types
   ([report](../reports/judge-claude-graded-2026-10-02.md), the note on s17 and s20).
2. A new `verifyAdvisoryText`: the answer must cite ids of entries the agent actually retrieved, and every number or clock time in the
   answer must appear in a cited entry. A statement with no source is blocked.

A blocked answer is a hand-off (`advice_unanswered`), not a retry with the model.

### 3.5 Judging (`tools/judge`)

- New criteria: `grounded_in_knowledge`, `answers_the_question`, and `knows_when_to_hand_off` (or reuse `handoff_judgement`). They are
  added to `rubric.json` and to `CRITERION_IDS` (`tools/judge/schema.mjs:4`). Changing the rubric means calibrating again.
- 15-20 advisory scenarios in `scenarios.json`, including the error paths: a question the store cannot answer, a price question, a
  question mixed with a booking, Chinese.
- An `advice` branch in `lib/simulate.mjs`, mirroring the gate.

## 4. Phases

| Phase | Content | Gate to leave the phase |
|---|---|---|
| 0 | This ADR, the diagram, a draft knowledge store built from the website cross-check. Lead approves the scope; the resort approves the content. | Lead agrees to the scope |
| 1 | `advice` intent, `advise.ts`, `chatWithTools`, the advice gate. Runs in **shadow**: the agent runs and its answer is logged, the guest still gets the hand-off. | Judge: `grounded_in_knowledge` has weighted kappa >= 0.6 against human labels, and no price leaks |
| 2 | `ENABLE_ADVISORY=true` on production for pure advice questions. | Watch the rate of `advice_unanswered` and staff feedback |
| 3 | Mixed messages (answer the question, then continue the booking). When the flow needs saved multi-step state, or a staff approval in the middle, move the loop to `@langchain/langgraph` (each node calls `ExtractProvider`). | A new ADR |

Code for `ai/` goes through PRs on `TechNextSG/tn-casa-quotation-estimator` and is mirrored here (`npm run mirror:check`). Until the Lead
agrees, only documents change in this repository.

## 5. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| The bot states a wrong fact | The knowledge sources disagree (section 1) | Seed only agreed facts; every entry has an owner and a review date; answers must cite an entry; no source means hand-off |
| Model quota | A booking turn already uses up to 6 model calls. Measured on production, the free Gemini key failed about 37% of calls (429 / 503). Advice adds up to 3 more per question. | The budget is part of the 20 s deadline; shadow phase measures the real extra load; a paid key or quota is a decision for the Lead |
| Misrouting | A booking read as advice loses the guest's details | Booking facts win over advice (3.1); the router is tested on the judge's s21 and s22 first |
| A guest takes the bot's word as the resort's policy | Wrong hours or capacity would be a promise | Only owned entries; wording says "our team will confirm" for anything not in the store |
| Scope creep | "Advice" slides into prices and availability | There is no price or availability tool; the gate blocks both |
| Real guest data reaches a provider | Q-021 is still open | Shadow logs follow the same masking as the judge (`maskForLogging`); no change to what providers see until Q-021 is answered |

## 6. What does not change

The extractor, the precheck, the reply contract, the fact gate on booking replies, the draft and its staff review, the studio, the
hand-off inbox and the rule that the bot never quotes a price.

## 7. Alternatives considered

- **One agent for everything, including booking.** Rejected: the quotation core is deterministic where it matters (counts, rooms,
  dates) and tested; making it model-driven would lose that.
- **A vector database now.** Rejected for phase 1: the knowledge is small enough to read in the prompt, and a retrieval layer adds a
  service and a place for stale facts to hide.
- **LangGraph.js now.** Rejected for phase 1: the flow is a short loop with no saved state. Its value starts with multi-step memory or a
  human approval in the middle (phase 3).
- **Let the model answer from its own knowledge.** Rejected: that is exactly the hallucination ADR-007 exists to prevent.

## 8. Open questions for the Lead / Anthony

1. **Scope.** The resort and diving only, or the wider area (other dive sites, getting to Anilao)?
2. **Ownership.** Who writes and approves the knowledge store, and how often is it reviewed?
3. **Public price ranges.** May advice mention the price ranges on the resort's website? Our proposal is **no**: prices come only from a
   quotation.
4. **Providers.** Which provider may see real guest messages? (Q-021, still open; Q-029 in the team repo.)
5. **Open facts.** Van capacity and price, free children, and day use need the resort's answer before they can be advised (section 3.3).

## 9. References checked on 2026-10-02

| Reference | Where |
|---|---|
| Not-booking branch in the gate | `bff/src/channels/whatsapp/turn.ts:218-237` |
| Turn deadline budget | `bff/src/channels/whatsapp/turn.ts:240` |
| Intent note and type | `ai/src/application/intent.ts:28-30`, `ai/src/application/intent.ts:33` |
| Provider port | `ai/src/ports/provider.ts:79-116` |
| Resilient wrapper | `ai/src/infra/providers/providerFromEnv.ts:180` |
| Room capacity | `ai/src/domain/houseNorms.ts:22`, `ai/src/domain/houseNorms.ts:29` |
| Fact gate | `ai/src/application/synthesis.ts:205` |
| Rate card scope | `bff/src/quote/domain/rates.ts:3-9` |
| Judge criteria | `tools/judge/schema.mjs:4` |
| Estimator send creates a scenario | `bff/src/estimator/port.ts:195-199` |
