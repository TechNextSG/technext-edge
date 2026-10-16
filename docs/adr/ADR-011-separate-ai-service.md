Status: superseded 15/10/2026 by tn-casa docs/superpowers/plans/2026-10-13-whatsapp-channel.md

# ADR-011: Standalone AI + WhatsApp Service Communicating with Estimator via API

- **Status:** superseded 15/10/2026 by tn-casa docs/superpowers/plans/2026-10-13-whatsapp-channel.md
> **Note (15/10/2026):** Theo quyết định của Anthony & Lead Duy, AI chạy chung với BFF trong repo `tn-casa-quotation-estimator` (gọi qua function call nội bộ `@casa/ai`). `technext-edge` chỉ giữ vai trò demo/POC, không triển khai production độc lập.
- **Date:** 2026-10-14
- **Deciders:** Lead (Duy), Edge Pod (`aidev1-technext`), Product Stakeholders.
- **Supersedes / Replaces:** Previous assumptions regarding monorepo workspace consolidation; drops mirror checks (`mirror:check`).
- **Related:** [ADR-005a](./ADR-005a-extractor-model.md), [ADR-006](./ADR-006-reply-contract.md), [ADR-010](./ADR-010-staff-handoff.md).

---

## 1. Context & Architectural Decision

### 1.1 Decision
Instead of merging the AI Extractor and WhatsApp channel into the monolithic `tn-casa-quotation-estimator` repository, **`technext-edge` is established as an independent, standalone service**.

- **`technext-edge` owns:**
  - Inbound & outbound WhatsApp channel integration (Meta Cloud API webhooks & messaging).
  - Conversation orchestration, state management (`wa_conversations`), and turn loops.
  - Neuro-symbolic AI extraction (`ai/`) and field parsing.
  - Anti-corruption layer client invoking Estimator REST endpoints.
- **`tn-casa-quotation-estimator` owns:**
  - Pricing rules, room inventory, rate calculation, and seasonal packages.
  - Staff Trips UI, manual booking overrides, and Odoo CRM/ERP synchronization.
  - Issuing verified guest links (`/share`) and signed approval webhooks.

### 1.2 Inter-Service Communication Topology

```
Guest ⇄ Meta WhatsApp ⇄ [technext-edge: channels + ai + store wa_* (KV/Postgres)]
                             │  POST/PATCH /api/estimates, /extras, /commit (Service Key)  ==>  [tn-casa Estimator] ==> Odoo
                             │  <== 201 {id, ...} | 422 {code, fields}
                             │  <== Webhook HMAC {event: approved|archived, url}   (Staff Save + Share in Trips)
                             └─ GET /api/estimates/:id  (fallback polling if webhook missed)
```

---

## 2. Key Removals

1. **Eliminate Code Mirroring (`mirror:check`)**:
   - Previously, `ai/` and `contracts/` were byte-mirrored from `tn-casa-quotation-estimator`.
   - `tools/ops/mirror-check.mjs` and `npm run mirror:check` are deleted.
   - `ai/` and `contracts/` are first-class code owned in this repository.
   - API compatibility is rigorously guaranteed via **Contract Tests** and Zod schemas rather than byte copying.
   - `check:boundaries` (`contracts <- ai <- bff`) is retained to preserve architectural layering.

2. **Eliminate Local Quotation Studio & Self-Pricing**:
   - Drop `/quotes` routes and views (`routes/quotes/*`, `views/editor/*`).
   - Remove `rates.ts` and self-pricing logic in `quote/application/quotationTool.ts`.
   - Estimator API is the **single source of truth for all pricing**.
   - Simulated estimator is restricted strictly to local dev and test environments.

---

## 3. The Five Architectural Patterns

To resolve technical debt, eliminate tight coupling, and establish long-term maintainability, the refactor implements 5 software design patterns:

### Pattern 1: Ports & Adapters (Hexagonal Architecture)
- **Dependency Inversion**: Dependencies like `QuotationStore` are passed explicitly via `createDeps` instead of module-level singletons.
- **Single Pricing Port**: `EstimatorPort` is the sole gateway for pricing operations, encapsulating remote HTTP calls and simulated test implementations.
- **Webhook Port**: Introduce `ApprovalEvents` port to consume staff approval notifications cleanly.
- **Composite Method**: `EstimatorPort.createDraft(trip, extras)` encapsulates the multi-step `POST /api/estimates` + `/extras` + `/commit` sequence under an authorized service key.

### Pattern 2: Anti-Corruption Layer (ACL) & Contract Tests
- **Zod Schema Contracts**: Define strict Zod validation in `contracts/src/estimator-api.ts` for all upstream Estimator responses (201 Created, 422 Unprocessable, 409 Conflict, GET by ID, and signed Webhook events).
- **Safe Parsing**: Replace unsafe `as Record<string, unknown>` type assertions in `bff/src/estimator/client.ts` with Zod schema parsing. Schema mismatches fail fast into structured `{ ok: false, reason: "unexpected" }` envelopes with sanitized debug logs.
- **Contract Verification**: Use real production fixtures in `contracts/fixtures/estimator/` to test against actual upstream schemas continuously.

### Pattern 3: Strategy & Registry Pattern (AI Providers & Channels)
- **Provider Registry**: Replace hardcoded `switch-case` in `ai/src/infra/providers/providerFromEnv.ts` with a dynamic `PROVIDERS` lookup table and factory registry.
- **Anthropic Provider Adapter**: Add native fetch adapter for Anthropic Claude 3.5 Haiku, adhering to strict data residency and compliance guidelines (D-129 production gate).
- **Channel Adapter Interface**: Introduce `ChannelAdapter { verify, parseInbound, send }` allowing WhatsApp, Web Chat, or other future channels to plug in uniformly without touching core conversation logic.

### Pattern 4: Pipeline Pattern (WhatsApp Turn Loop & ASK_LIMIT Fix)
- **Linear Turn Pipeline**: Refactor the monolithic `bff/src/channels/whatsapp/turn.ts` (~250 lines) into discrete, composable steps under `turn/steps/*.ts` (e.g., `verifyClaimLock`, `checkReset`, `checkHumanGate`, `converseAi`, `checkDone`, `checkLimits`).
- **Unified Outcome Execution**: Route all exit branches to a single `executeOutcome(outcome)` handler (pause, append message, send reply, mark told, update draft).
- **Bug Fix (ASK_LIMIT vs. Done)**: Reverse the evaluation order: check `isComplete / done` **before** evaluating turn count limits. Ensure `ASK_LIMIT` only restricts question counts when **no draft exists yet**, preventing incomplete inquiries from aborting prematurely while allowing guests to revise existing drafts freely.

### Pattern 5: State Machine & Outbox Pattern
- **Explicit Conversation State Machine**: Replace ad-hoc flags with formal states:
  ```
  collecting ─(ready + 201)→ drafted ─(staff Save + Share)→ link_sent
      │  └──────────────┬──────────────┘
      └→ handed_off ←───┘ (human request, complaint, stall, error, archived)
  ```
- **State Transition Guard**: Ensure state transitions only occur through a single transition function (`transitionTo(nextState, context)`).
- **Secure Webhook Verification**: Inbound staff approval webhooks verify HMAC-SHA256 signatures and timestamp freshness, guaranteeing idempotent, exactly-once processing.

> [!NOTE]
> **Giả định về Webhook Fixture:** Payload và fixture của webhook duyệt (`POST /v1/estimator/webhook`, `contracts/fixtures/estimator/webhook-approved.json`) hiện tại là **giả định thiết kế** (assumed contract) do phía `tn-casa` chưa cài đặt endpoint phát webhook này. Ngay khi `tn-casa` triển khai webhook thực tế, fixture và contract schema sẽ được cập nhật đồng bộ.

---

## 4. Consequences & Verification

- **Decoupling**: Changes in `tn-casa-quotation-estimator` internal models no longer break `technext-edge` builds; contract tests flag breaking API changes early.
- **Safety & Maintainability**: Redundant pricing code is deleted, preventing pricing discrepancies. Turn processing logic is modular and easy to unit test.
- **Zero Regressions**: Verification suite (`npm run verify`: `check:boundaries`, `typecheck`, `test`) remains green across all milestone PRs.
