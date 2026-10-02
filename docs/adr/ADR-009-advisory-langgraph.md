# ADR-009: Move the advisory loop to LangGraph.js (phase 3)

- **Status:** Proposed (for Lead / Anthony review; no runtime code is written, and none is possible before the store moves to Postgres)
- **Date:** 2026-10-02
- **Deciders:** Lead (Duy), Anthony. Proposed by the TechNext Edge pod (`aidev1-technext`).
- **Extends:** [ADR-008](./ADR-008-advisory-agent.md)
- **Diagram:** [advisory-architecture.html](../diagrams/advisory-architecture.html), the "Phase 3 · LangGraph.js" box (dashed nodes do not exist in code yet)

---

## 1. Context

ADR-008 gives the advisory agent a hand-written loop and keeps LangGraph for later: section 4, phase 3 says that move needs "a new ADR"
(`ADR-008-advisory-agent.md:138`), and section 7 rejects LangGraph for phase 1 (`:165`). So there is a case for *not yet*, and no proposal
for *when and how*. This is that proposal.

The loop of phases 1 and 2 (ADR-008 section 3.2) has no saved state and at most 3 model steps. Two needs are coming that it cannot meet
cleanly:

1. **Mixed messages.** A guest asks a question and gives booking details in the same message. Phase 1 sends these to the booking flow and
   does not answer the question. Phase 3 should answer it and then carry on with the booking, in one reply.
2. **Staff review in the middle of a flow.** An answer the gate cannot clear is better reviewed by a person than thrown away. That means the
   flow has to stop, wait for staff (minutes or hours), and continue where it stopped. A loop inside one request cannot wait.

Both need state that outlives a request. That is what a graph with a checkpointer gives us and a 3-step loop does not.

**Order of work.** The checkpointer goes on **Postgres**, not on Upstash Redis. Our conversation and settings store moves to Postgres (the
team's `supabase/`) when the code is ported to the team repo (`docs/notes/port-to-team-repo.md:18,29`, `docs/notes/todo-before-demo.md:57`).
So this ADR is **after** that port, not before it.

## 2. When to move: measurable triggers

Move when **any one** of these holds, measured in the phase 1 shadow logs and then in phase 2 on production:

| Trigger | Proposed starting value (the Lead sets the real one) |
|---|---|
| Mixed messages are a large part of advice-like turns | at least 15% over two weeks |
| Threads that end as `advice_unanswered` and where staff then answer with something close to the logged shadow answer (so a reviewed draft would have saved them time) | at least 20 per month |
| A feature needs a third tool or a fourth step, which the loop's 3-step limit forbids | any one concrete request |

How "close to the shadow answer" is measured: compare the logged shadow answer with the reply staff actually sent in the same thread, by the
judge (`tools/judge`) or by a simple edit distance. That comparison is part of the phase 1 shadow design.

If none of the triggers fires, we stay on the loop. A graph we do not need is a dependency we carry.

## 3. Decision

- Use **`@langchain/langgraph` (JS) only**. No LangChain model adapters and no chains.
- **Every model call goes through `ExtractProvider`** (`ai/src/ports/provider.ts:79-116`, `chatWithTools` from ADR-008). So `/admin/ai`, the
  fallback model and the circuit breaker (`ai/src/infra/providers/providerFromEnv.ts:180`) stay exactly as they are. The model is still one
  setting.
- **`advise()` keeps its signature.** The graph is an internal detail of `ai/src/application/advise.ts`; callers do not learn which engine runs.
- The graph runs behind a flag, `ADVISORY_ENGINE=loop|graph`, default `loop` (section 10).

## 4. Graph specification

**State** (one object per run):

| Field | Meaning |
|---|---|
| `phone` | the thread; also the checkpointer's `thread_id` |
| `messages` | the conversation, loaded from the conversation store at the start of each turn |
| `question` | the advice part of the latest guest message |
| `bookingFacts?` | booking facts found in the same message (the ADR-008 booking-facts check) |
| `retrieved` | `{ id, text }[]` the knowledge entries the answer may cite |
| `draft?` | the proposed answer |
| `gate` | `pass`, `unsure` or `blocked` |
| `deadlineAt` | the absolute time this run must finish by |

The conversation history stays in the conversation store (`bff/src/store/conversationStore.ts`). The checkpointer holds only what is internal to
the graph (`retrieved`, `draft`, `gate`, where it is paused). There must not be two sources of truth for what the guest said.

**Nodes:**

| Node | What it does |
|---|---|
| `route` | pure question or mixed, using the same booking-facts check as ADR-008 3.1 |
| `retrieve` | calls `searchKnowledge` and `roomCapacity` (the phase 1 tools). Still no price tool |
| `answer` | one `ExtractProvider.chatWithTools` call, returning text, cited ids and `answerable` |
| `gate` | `verifyGuestFacingText(text, {})` (`ai/src/application/synthesis.ts:205`) plus `verifyAdvisoryText` (ADR-008 3.4) |
| `review` | `interrupt()`: stops the graph until staff decide. Contains nothing else (see risks) |
| `booking` | a subgraph that calls today's `converse()` / `converseWithQuotation` unchanged (`bff/src/quote/application/converseWithQuotation.ts`) |
| `reply` | assembles the one message sent to the guest |

**Edges:**

- `route` pure → `retrieve` → `answer` → `gate`.
- `route` mixed → both `retrieve` (then `answer` → `gate`) **and** `booking`, which run side by side. `reply` waits for both and puts the answer
  to the question first, then the booking reply.
- `gate` `pass` → `reply`.
- `gate` `unsure` → `review` → (approved or edited) → `reply`.
- `gate` `blocked` → hand-off with the reason `advice_unanswered` (as in ADR-008). A blocked answer is not shown to staff for review: the gate
  blocks prices and false confirmations, and those are never approved by a person in the middle of a chat.

The first guest-visible effect of a mixed message is one reply, not two. The quotation draft is still saved by the booking subgraph exactly as today.

## 5. Checkpointer: Postgres

- `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`) on the team's Supabase, **after** the store port. `thread_id` is the phone number.
- **State lifetime follows the thread.** The conversation thread lives 24 hours (`THREAD_TTL_MS`, `bff/src/store/conversationStore.ts:143`). Checkpoint rows
  must be deleted when the thread expires. As far as we know `PostgresSaver` has no expiry of its own, so a cleanup by `thread_id` is ours to write.
- **To verify in a spike, not assumed:**
  - connecting from a Vercel serverless function through the Supabase pooler: transaction mode and prepared statements, and the pool size per
    function instance;
  - the tables `PostgresSaver.setup()` creates and where those migrations live in the team repo's `supabase/migrations/`. This repository has no
    `supabase/` folder; the store port brings it.
- Nothing is proposed on Redis. The Redis store is the part that goes away with the port.

## 6. Interrupt and resume, with `/handoff`

- `review` calls `interrupt()`. The thread appears in `/handoff` (`bff/src/routes/handoff.ts:22`) with the proposed answer and a pause reason
  `advice_review`.
- Staff approve, edit or reject. **A new staff route** resumes the graph with `Command({ resume })`. It is a new route on purpose: the existing
  `POST /handoff/:phone/resume` (`handoff.ts:30`) means "give the thread back to the bot", which is a different thing and must keep working. Like the
  existing routes it checks the staff session and `staffWriter` first (`handoff.ts:31-33`).
- The resume runs inside `store.withPhoneLock` (`bff/src/store/conversationStore.ts:44`, used for the turn at `bff/src/channels/whatsapp/turn.ts:163`) so it
  cannot interleave with a guest turn.
- **The approved or edited text still passes the gate** before it is sent. Staff cannot approve a price into the chat by accident.
- **If the guest writes again while a review is pending, the guest wins.** The new message is processed as a new turn and the pending interrupt is
  dropped. The staff page shows the review as superseded.
- A reply to the guest has to leave within the WhatsApp 24-hour customer-service window, which is also the thread TTL. A review that is still open
  near that limit is closed and the thread goes to a normal hand-off.

## 7. Time and limits

- `recursionLimit` set from the node count (a small number), so a routing mistake cannot loop.
- An `AbortSignal` tied to the turn deadline. The guest turn already races `WHATSAPP_TURN_TIMEOUT_MS`, default 20 s
  (`bff/src/channels/whatsapp/meta.ts:62`, `turn.ts:186-188`). `deadlineAt` in the state is how nodes know how much is left, the same way
  `synthesisBudgetMs` works today (`turn.ts:240`).
- **A resume happens outside the guest turn**, so it has its own deadline (proposed: 20 s from the staff click), not whatever was left.
- Measure the extra latency of the graph against the loop in shadow before anyone depends on it.

## 8. Dependency and the team repo

- **Pin the version.** `@langchain/langgraph` is expected to need `@langchain/core` as a peer. We use none of its model classes, but it still ships;
  that is the cost to measure.
- **Measure** the bundle size of `api/index.js` (`npm run build`) and the cold start on Vercel before and after. The benchmark tooling is `tools/live-eval/benchmark.mjs`, and
  `docs/reports/benchmark-latency-2026-10-01.html` shows what it measured; a true overnight cold start has not been measured yet.
- **License:** MIT as far as we know; check when the dependency is added.
- `ai/` is a mirror of the team repo (`npm run mirror:check`). Adding a dependency to `ai/` is a change to the team repo's `ai/package.json`, so it
  needs the team's agreement and goes through a PR there.

## 9. Observability

- **LangSmith stays off.** It sends traces to a third party, and which provider may see real guest messages is still an open question (Q-021, Q-029 in
  the team repo). The tracing switches (`LANGSMITH_TRACING`, `LANGCHAIN_TRACING_V2`) must never be set; a test should fail if either is present.
- Use our **own trace**, the pattern the quotation tool already uses: `HonoToolCallTrace` (`bff/src/quote/domain/quotationDraft.ts:184`, built at
  `bff/src/quote/application/converseWithQuotation.ts:34`). Every logged phone number or message goes through `maskForLogging` (as at
  `turn.ts:394,403`).

## 10. Tests, comparison and rollback

- **Graph unit tests with a fake provider**, covering every edge: pass, `unsure`, `blocked`, mixed, the deadline, and resume (including the guest writing again
  while a review is pending).
- **`tools/judge --pairwise`** to compare loop and graph on the advisory scenarios. Today `--pairwise` compares two *models*, so it needs a small
  extension: a candidate can name its engine (for example `gemini:<model>@graph`). The judge's calibration (kappa >= 0.6 per criterion) applies as before.
- **Rollback:** `ADVISORY_ENGINE=loop|graph`, default `loop`. Switching back needs no data migration, because the loop keeps no state.

## 11. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| A node re-runs on resume | After an interrupt, the paused node starts again from its beginning. A side effect before `interrupt()` would repeat | `review` holds only the `interrupt()`; every side effect (saving a draft, sending a message) lives in its own node |
| Two sources of truth | The conversation store and the checkpointer could disagree about what was said | History stays in the conversation store; the checkpointer holds graph-internal state only |
| Personal data in checkpoint tables | Phone numbers and message text land in Postgres | Delete by `thread_id` at the thread TTL; same masking rules as the logs |
| Serverless and Postgres connections | Many function instances, few pooled connections | The spike in section 5 comes first; no phase 3 work starts until it passes |
| More moving parts for a small team | A graph is harder to debug than a loop | The triggers in section 2: do not move without a measured need; keep `ADVISORY_ENGINE=loop` as the default |
| Staff become a bottleneck | A review that waits for a person can miss the 24-hour window | Section 6: close the review and fall back to a hand-off; measure the share of reviews staff actually answer |

## 12. Alternatives considered

- **Keep the loop and hand-roll state in Postgres.** Rejected once interrupts are needed: we would rebuild checkpointing, resume and fan-out by hand.
  It is the better choice if only mixed messages are ever needed and review never is.
- **Python LangGraph.** Rejected: a second runtime next to a Node function, no shared `contracts/` types, and a second thing to deploy.
- **A Redis checkpointer.** Not proposed: the Redis store is replaced by Postgres in the port, so building on it would be built twice.

## 13. Open questions for the Lead / Anthony

1. **The thresholds** in section 2: what share of mixed messages, and what volume of reviewable `advice_unanswered` threads, justify the move?
2. **The Supabase timeline.** This ADR waits for the store port, which waits for the team's production plan (`docs/notes/anthony-decisions-2026-09-30.md:14`, decision 2).
   Without a date there is no phase 3.
3. **Is staff review in `/handoff` wanted at all?** It adds work for the front desk (open until 21:00 according to the website, not yet confirmed by the resort) and a 24-hour limit. If the answer is no, the case for the
   graph rests on mixed messages alone, and the "hand-roll state in Postgres" alternative gets stronger.
4. **Dependency ownership.** Who agrees to add `@langchain/langgraph` to the team repo's `ai/`?

## 14. References checked on 2026-10-02

| Reference | Where |
|---|---|
| "needs a new ADR" and "LangGraph.js now" rejection | `docs/adr/ADR-008-advisory-agent.md:138`, `:165` |
| Provider port and `ExtractProvider` | `ai/src/ports/provider.ts:79-116` |
| Resilient wrapper (fallback, breaker) | `ai/src/infra/providers/providerFromEnv.ts:180` |
| Fact gate | `ai/src/application/synthesis.ts:205` |
| Booking flow wrapper | `bff/src/quote/application/converseWithQuotation.ts` |
| Tool trace type and its use | `bff/src/quote/domain/quotationDraft.ts:184`, `bff/src/quote/application/converseWithQuotation.ts:34` |
| Phone lock | `bff/src/store/conversationStore.ts:44`, `bff/src/channels/whatsapp/turn.ts:163` |
| Thread TTL (24 h) | `bff/src/store/conversationStore.ts:143` |
| Turn deadline | `bff/src/channels/whatsapp/meta.ts:62`, `bff/src/channels/whatsapp/turn.ts:186-188` |
| Reply budget | `bff/src/channels/whatsapp/turn.ts:240` |
| Masking in logs | `bff/src/channels/whatsapp/turn.ts:394,403` |
| `/handoff` list and the existing resume | `bff/src/routes/handoff.ts:22`, `:30-36` |
| Store moves to Postgres with the port | `docs/notes/port-to-team-repo.md:18,29`, `docs/notes/todo-before-demo.md:57` |
| Supabase timeline question | `docs/notes/anthony-decisions-2026-09-30.md:14` |
| Benchmark tooling and report | `tools/live-eval/benchmark.mjs`, `docs/reports/benchmark-latency-2026-10-01.html` |
