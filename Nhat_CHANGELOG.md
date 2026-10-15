# Nhat_CHANGELOG

Changes by date, newest first. Each entry: what changed, what users / operators see, link to the PR.
This repo has no logbook; the notes are in `docs/`. Changes **outside the repo** (GitHub, Supabase, Vercel, local machine) go under "Infrastructure (outside the repo)".

How to write: add an entry as soon as a PR merges or something outside the repo changes. No secrets, no customer names.

---

## 2026-10-15

### P6: Modular AI Engine & Field Registry (feat/p6-ai-refactor)
- **Centralized Field Registry (`ai/src/domain/fieldRegistry.ts`)**:
  - Established a single source of truth table (`FIELD_REGISTRY`) defining every trip property (schema type, bilingual labels in English and Chinese, default question prompts, handoff necessity, gating conditions, and fact-gate auditing rules).
  - Eliminates multi-file shotgun surgery when adding new trip fields: summary labels, missing-field phrases, handoff checks, and question generation now derive automatically from the registry.
- **Decomposed Questions Architecture (`ai/src/application/questions/`)**:
  - Split monolithic ~1,200-line `questions.ts` into 4 cohesive submodules:
    - `rules.ts`: field question rules, handoff eligibility contract (`isReadyForHandoff`, `HANDOFF_REQUIRED_FIELDS`, `NEVER_ASKED_FIELDS`), dive window estimation detection, and staff alert generation.
    - `render.ts`: deterministic reply rendering (`renderReply`, `renderSummary`, `renderAckAndQuestions`, `summaryLines`, `ackParts`, date and range formatting).
    - `fallback.ts`: static outage apologies, human handoff notices, partner invitation links, and changed-money-value notices (`ASK_LIMIT`, `STALL_LIMIT`).
    - `intent.ts`: fast regular-expression intent classification for human requests (`wantsHuman`) and agency declines (`declinesPartner`).
  - Preserved backward-compatible facade at `ai/src/application/questions.ts` re-exporting all interfaces and functions.
- **Unified Count & Diving Lexicon (`ai/src/domain/lexicon.ts`)**:
  - Consolidated regex patterns for guest nouns (`GUEST_NOUNS`), diver nouns (`DIVER_NOUNS`), room nouns (`ROOM_NOUNS`), night nouns (`NIGHT_NOUNS`), number words (`LATIN_NUMBER_WORDS`, `HAN_NUMBER_WORDS`), and diving clause guards.
  - De-duplicated count extraction between extraction corroboration (`counts.ts`) and post-generation fact-gating (`synthesis.ts`).
- **Verification**:
  - Added [fieldRegistry.test.ts](file:///e:/technext-edge/ai/test/fieldRegistry.test.ts) (5 tests) and [questionsDecomposed.test.ts](file:///e:/technext-edge/ai/test/questionsDecomposed.test.ts) (10 tests).
  - 100% verified across all suites: 63 test files, 840 tests passed, 0 failures.

### P5: Pattern 5 · State Machine & Outbox (feat/p5-state-machine-outbox)
- **Explicit Conversation State Machine (`bff/src/store/conversationState.ts`)**:
  - Implemented formal 4-state lifecycle: `collecting | drafted | link_sent | handed_off`.
  - State transitions are strictly gated via pure transition function `transitionConversationState(current, event)`:
    - `collecting` ──(`DRAFT_CREATED`)──> `drafted`
    - `drafted` ──(`STAFF_APPROVED`)──> `link_sent`
    - `collecting | drafted | link_sent` ──(`HANDOFF_REQUESTED | STAFF_ARCHIVED | TURN_ERROR | RESET`)──> `handed_off` / `collecting`
  - Integrated `getState(phone)` and `transitionState(phone, event)` into `ConversationStore` (both in-memory and Redis implementations).
- **Estimator Outbox with Deterministic Idempotency & Retry (`bff/src/estimator/outbox.ts`)**:
  - Implemented `createEstimatorOutbox`: executes upstream Estimator draft creation with message-id idempotency key.
  - Automatically deduplicates concurrent/duplicate deliveries, retrying transient network errors while immediately halting on business refusals (422 / 409).
- **Secure Webhook Receiver for Estimator (`bff/src/routes/estimatorWebhook.ts`)**:
  - Mounted at `POST /v1/estimator/webhook` with HMAC-SHA256 signature verification (`x-signature-256`) and timestamp freshness check (<= 5 minutes).
  - Handles `approved`: validates payload with Zod schema (`EstimatorWebhookPayloadSchema`), marks quotation as `confirmed_by_hono`, transitions state to `link_sent`, and sends WhatsApp confirmation link to guest.
  - Handles `archived`: cancels quotation, transitions conversation to `handed_off`.
  - Idempotent execution: ignores already-processed events.
- **Verification**:
  - Added unit test suites [conversationState.test.ts](file:///e:/technext-edge/bff/test/domain/conversationState.test.ts), [outbox.test.ts](file:///e:/technext-edge/bff/test/estimator/outbox.test.ts), and [estimatorWebhook.test.ts](file:///e:/technext-edge/bff/test/routes/estimatorWebhook.test.ts).
  - Added comprehensive end-to-end integration test [pattern5Flow.test.ts](file:///e:/technext-edge/bff/test/channels/whatsapp/pattern5Flow.test.ts) covering the full lifecycle from WhatsApp enquiry -> draft created -> staff approval webhook -> link dispatched -> subsequent clarification.
  - 100% verified across all suites: 61 test files, 825 tests passed.

### P4: Pattern 3 · Strategy & Registry + Decorator (feat/p4-provider-registry)
- **Declarative Provider Registry (`PROVIDERS` in `ai/src/infra/providers/providerFromEnv.ts`)**:
  - Replaced rigid hard-coded switch statements with an extensible, tabular registry mapping provider keys (`anthropic`, `gemini`, `deepseek`) to their creator factory, environment key requirements, supported model catalogs, and user-facing labels.
  - Adding a new provider now only requires registering an entry in `PROVIDERS` without touching downstream routing logic.
- **Anthropic Claude Adapter (`ai/src/infra/providers/anthropic.ts`)**:
  - Implemented high-performance, native fetch-based adapter for Claude models (`claude-3-5-haiku-20241022`, `claude-3-5-haiku-latest`).
  - Supports structured extraction via tool calling (`extract_trip`) and natural hospitality text synthesis (`generateText`).
- **Production Compliance Gate (D-129)**:
  - Enforced enterprise safety rule: when `NODE_ENV === "production"`, primary AI provider must strictly be Anthropic Claude unless explicitly permitted via `ALLOW_NON_ANTHROPIC_IN_PRODUCTION="true"`.
- **Channel Adapter Interface (`bff/src/channels/channelAdapter.ts`)**:
  - Introduced generic channel abstraction: `{ verify(req), parseInbound(req), send(message) }`.
  - Implemented concrete `createWhatsAppChannelAdapter` in `bff/src/channels/whatsapp/adapter.ts` with webhook signature verification, inbound message normalization, and outbound dispatch.
- **Verification**:
  - Added [anthropic.test.ts](file:///e:/technext-edge/ai/test/providers/anthropic.test.ts), [providerRegistry.test.ts](file:///e:/technext-edge/ai/test/providers/providerRegistry.test.ts), and [channelAdapter.test.ts](file:///e:/technext-edge/bff/test/channels/channelAdapter.test.ts).
  - 100% verified across all suites: 57 test files, 803 tests passed.

### P3: Pattern 4 · Turn Pipeline & ASK_LIMIT Fixes (feat/p3-turn-pipeline)
- **Modular Turn Pipeline (`channels/whatsapp/turn/`)**: Decomposed monolithic `turn.ts` into discrete, composable pipeline steps executing `(ctx) => Continue | Stop(outcome)`:
  - `steps/stepReset.ts`: Detects explicit reset commands, clears state, cancels active drafts.
  - `steps/stepHumanGate.ts`: Manages parked threads, explicit human requests, cancellations, and non-booking intent.
  - `steps/stepConverse.ts`: AI model extraction and natural hospitality synthesis.
  - `steps/stepDoneCheck.ts`: Handles partner self-serve links and creates/updates quotation drafts when complete facts are provided. **Runs before limits check**.
  - `steps/stepLimits.ts`: Handles repetitive stalling (STALL_LIMIT=3) and enforces `ASK_LIMIT` strictly when **no draft exists yet**.
  - `steps/stepAskNext.ts`: Continues conversational interrogation with changed-value notices.
- **Unified Outcome Executor (`executeOutcome.ts`)**: Replaced 4 duplicated pause/append/send/markTold blocks with a single centralized handler for `reset`, `silence`, `handoff`, and `reply` outcomes.
- **ASK_LIMIT Bug Fix**:
  - Inverted legacy execution order so that completed enquiries on turn >= ASK_LIMIT immediately mint drafts instead of being aborted with `asking_limit`.
  - Re-anchored `ASK_LIMIT` check so that existing drafts can be revised repeatedly without being blocked.
- **Comprehensive TDD Verification**:
  - Added [turnPipeline.test.ts](file:///e:/technext-edge/bff/test/channels/whatsapp/turnPipeline.test.ts) covering all 4 critical cases:
    1. Turn 9 completion produces draft without premature termination.
    2. Multi-turn step-by-step disclosure across 10 messages is never interrupted.
    3. 3 uninformative repetitions trigger stalled human handoff.
    4. Established drafts can be updated multiple times past ASK_LIMIT.
  - Full suite verified: 54 test files, 783 passed across all packages.

### P2: Pattern 1 · Ports & Adapters (feat/p2-ports-adapters)
- **QuotationStore Dependency Injection**: Injected `QuotationStore` through `createDeps` in `bff/src/deps.ts`, eliminating the module-level singleton and allowing clean mock/in-memory substitution across all tests.
- **Single Pricing Authority via EstimatorPort**:
  - Removed internal quote studio (`/quotes`, `bff/src/routes/quotes/*`, `bff/src/views/editor/*`, and related editor snapshots), eliminating ~38,000 lines of dead studio code.
  - Removed self-calculating rates (`bff/src/quote/domain/rates.ts`) and manual pricing logic from `quotationTool.ts`. Pricing is now solely sourced from Estimator.
  - Decoupled `simulatedEstimator` from `quote/`, extracting isolated rates into `bff/src/estimator/simulatedRates.ts` solely for local testing and dev mode.
- **Inbound ApprovalEvents Port**: Added `ApprovalEventsPort` in `bff/src/ports/approvalEvents.ts` to receive signed staff approval (`approved`) and cancellation (`archived`) webhooks from `tn-casa`.
- **High-level `createDraft` Workflow**: Added `createDraft(trip, extras)` to `EstimatorPort`, `estimatorClient`, and `simulatedEstimator`, atomically coordinating estimate creation, optional extras payload, and revision freeze (`commit`), transmitting `ESTIMATOR_SERVICE_KEY`.
- **Route & Auth Re-anchoring**:
  - Updated staff authentication navigation to default to `/handoff` (with `/admin` and `/docs`) now that `/quotes` is retired.
  - Verified full test suite (53 test files, 779 passed) and regenerated route table snapshot.

---

## 2026-10-14

### P1: Pattern 2 · Anti-Corruption Layer & Contract Verification (feat/p1-acl-contract)
- Added `contracts/src/estimator-api.ts`: Strict Zod validation schemas for Estimator API (201 Success, 422 Refusal, 409 Conflict, 200 Commit, 200 Share, 200 Extras, GET /estimates/:id, and signed staff approval/archive webhooks).
- Exported all schemas and safe parse helpers from `contracts/src/index.ts`.
- Created real response fixtures under `contracts/fixtures/estimator/` (`estimate-201.json`, `refusal-422.json`, `conflict-409.json`, `commit-200.json`, `share-200.json`, `extras-200.json`, `get-estimate-200.json`, `webhook-approved.json`, `webhook-archived.json`).
- Updated `bff/src/estimator/client.ts`: Replaced unsafe `as Record<string, unknown>` type assertions with Zod schema parsing. Schema mismatches fail into structured `{ ok: false, reason: "unexpected" }` envelopes with sanitized logs via `maskSensitive` (masking guest emails, phone numbers, bearer tokens, cookies).
- Implemented `getEstimate(id, session)` on client and `EstimatorPort` for webhook catch-up / reconciliation.
- Added contract tests in `contracts/test/estimator-api.test.ts` and automated verification script `npm run contract:check` (`tools/ops/contract-check.mjs`).

### P0: Standalone AI Service & Mirror Retired (feat/p0-drop-mirror)
- Removed `tools/ops/mirror-check.mjs` and dropped `mirror:check` script from `package.json`.
- Added **[ADR-011](docs/adr/ADR-011-separate-ai-service.md)**: Formalized decision that `technext-edge` is an autonomous AI + WhatsApp service calling Estimator strictly over REST API and Webhooks. Outlined 5-pattern refactor plan.
- Updated documentation and README to reflect first-class ownership of `ai/` and `contracts/` in this repository, replacing file mirroring with Zod contract tests.

- Added `docs/diagrams/erd-pre-migration-database.architecture.json` & `.html`: Interactive standalone pre-migration database ERD diagram with 10 tables, complete foreign key relations, dark/light themes, and export utilities.
- Added `docs/ai-extractor-executive-briefing.html`: Standalone single-page executive briefing report with official TechNext branding & vector assets, seamless bilingual VI/EN mode, interactive architecture pipeline, turn loop & anchor point state machine gates, Zod data contracts, and token cost economics (~18 VNĐ / booking). Redundant checkpoints and sidebar quote metrics stripped for high-level management presentation.
- Saved official TechNext corporate mark to `docs/assets/technext-logo.png` and embedded directly as self-contained base64 asset.

### Infrastructure (outside the repo)
- Vercel project `tn-casa-quotation-estimator` (static site, noindex): published live to production at `https://tn-casa-quotation-estimator.vercel.app`.
  - Architecture updated across all hub pages: confirmed decision to **keep `technext-edge` as an independent standalone repo/service**, communicating with `tn-casa-quotation-estimator` via standard HTTP REST API (`POST /api/estimates`) instead of merging into a monorepo workspace.
  - Added direct route for the single-page executive briefing: `https://tn-casa-quotation-estimator.vercel.app/ai-extractor-executive-briefing`
  - Added direct route for the pre-migration ERD database diagram: `https://tn-casa-quotation-estimator.vercel.app/erd-pre-migration-database`
  - Hub homepage updated with prominent bilingual feature cards linking directly to both deliverables.
- The older Artifact of the same meeting still describes the previous in-BFF design and has not been updated.

---

## 2026-10-12

### Guest-data model question now points at Q-038
- `docs/` and `tools/judge/` mention the team repo's Q-038 instead of Q-021 / Q-029. Docs and comments only; nothing runs differently. Pushed to `main`.

### Infrastructure (outside the repo)
- Team-repo work done from this machine: the AI channel PR stack #8 to #15, #31, #32 rebased onto the team `main`; see the team repo's `Nhat_CHANGELOG.md` (PR #35).

## 2026-10-08

### ERD and draft migration for the AI channel on Postgres
- `docs/specs/db/20261009000000_ai_channel.sql`, its test and `docs/specs/erd-ai-channel-postgres.md`, plus interactive ERD and architecture diagrams under `docs/diagrams/`. Docs only; no migration is applied anywhere.

## 2026-10-02

### Advisory agent proposal and staff hand-off (ADR-008, ADR-009, ADR-010)
- Proposals with diagrams: advisory architecture, LangGraph.js for phase 3, staff hand-off (notify + reply). Nothing is built; the decision is waiting on Anthony.

### LLM judge tool and first graded run (`tools/judge/`)
- Generate-only, paced runs over 28 scenarios; a first graded run is in `docs/reports/judge-claude-graded-2026-10-02.md`. Operators run it with their own model key; no key is stored in the repo.
