# Task: Refactor technext-edge into Standalone AI + WhatsApp Service

## Objective
Refactor `technext-edge` into an autonomous, dedicated AI Extractor + WhatsApp channel service communicating with `tn-casa Estimator` purely via REST API and Webhooks. Eliminate mirror checks, drop the legacy local quote studio, and implement 5 architectural patterns:
1. Ports & Adapters (clean boundaries, EstimatorPort as single pricing path)
2. Anti-Corruption Layer (Zod schema validation on all Estimator responses & webhooks)
3. Strategy & Registry (dynamic AI provider registry, Anthropic Claude 3.5 Haiku, ChannelAdapter)
4. Turn Pipeline (linear pipeline steps, fix ASK_LIMIT check order)
5. State Machine & Outbox (formal conversation states, idempotent retry outbox, HMAC webhook verification)
6. Streamline `ai/` (Field Registry, modular questions rules, unified count lexicon)

## Milestones & Status
- [x] P0: Bỏ mirror, ghi lại quyết định
  - [x] Tạo nhánh `feat/p0-drop-mirror`
  - [x] Xóa `tools/ops/mirror-check.mjs` và bỏ script `mirror:check` khỏi `package.json`
  - [x] Soạn ADR mới: `docs/adr/ADR-011-separate-ai-service.md`
  - [x] Cập nhật memory & tài liệu kiến trúc liên quan
  - [x] Chạy `npm run verify` và ghi nhật ký vào `Nhat_CHANGELOG.md`
- [ ] P1: Pattern 2 · Anti-Corruption Layer + Contract
  - [ ] Tạo nhánh `feat/p1-acl-contract`
  - [ ] Tạo `contracts/src/estimator-api.ts` với Zod schema (201/422/409, GET /estimates/:id, webhook payloads)
  - [ ] Cập nhật `bff/src/estimator/client.ts` parse an toàn bằng Zod
  - [ ] Thêm fixtures mẫu vào `contracts/fixtures/estimator/` và viết contract test
  - [ ] Thêm script `contract:check`
  - [ ] Chạy `npm run verify` và ghi nhật ký
- [ ] P2: Pattern 1 · Ports & Adapters
  - [ ] Tạo nhánh `feat/p2-ports-adapters`
  - [ ] Chuyển `QuotationStore` vào `createDeps`, bỏ singleton
  - [ ] Xóa `/quotes`, `rates.ts`, logic tự tính giá trong `quotationTool.ts`
  - [ ] Thêm `ApprovalEvents` port cho webhook
  - [ ] Thêm method `createDraft(trip, extras)` vào `EstimatorPort`
  - [ ] Chạy `npm run verify` và ghi nhật ký
- [ ] P3: Pattern 4 · Pipeline cho một lượt chat & Fix ASK_LIMIT
  - [ ] Tạo nhánh `feat/p3-turn-pipeline`
  - [ ] Viết failing tests (TDD red): 9 tin xong ra draft, 10 tin trả lời 1 ý không bị cắt, 3 lần lặp chuyển người, sửa draft
  - [ ] Tách `turn.ts` thành pipeline steps `turn/steps/*.ts` + `executeOutcome()`
  - [ ] Đảo thứ tự: kiểm tra "đã xong" trước "giới hạn", `ASK_LIMIT` chỉ đếm khi chưa có nháp
  - [ ] Chạy `npm run verify` và ghi nhật ký
- [ ] P4: Pattern 3 · Strategy + Registry (+ Decorator)
  - [ ] Tạo nhánh `feat/p4-provider-registry`
  - [ ] Viết lại `providerFromEnv.ts` thành dynamic provider registry (`PROVIDERS` table)
  - [ ] Thêm `anthropic.ts` adapter cho Claude 3.5 Haiku qua fetch
  - [ ] Thêm interface `ChannelAdapter { verify, parseInbound, send }`
  - [ ] Chạy `npm run verify` và ghi nhật ký
- [ ] P5: Pattern 5 · State Machine + Outbox
  - [ ] Tạo nhánh `feat/p5-state-machine-outbox`
  - [ ] Thêm trạng thái hội thoại: `collecting | drafted | link_sent | handed_off` và transition guard
  - [ ] Xây dựng Outbox cho Estimator calls với idempotency key & retry
  - [ ] Xây dựng webhook endpoint nhận sự kiện duyệt (HMAC sha256 + timestamp)
  - [ ] Chạy `npm run verify` và ghi nhật ký
- [ ] P6: Tinh gọn gói `ai/`
  - [ ] Tạo nhánh `feat/p6-ai-refactor`
  - [ ] Tạo Field Registry
  - [ ] Tách `questions.ts` thành `rules / render / fallback / intent`
  - [ ] Gộp regex đếm khách & lặn vào `domain/lexicon.ts`
  - [ ] Chạy `npm run verify` và ghi nhật ký

## Progress Log
- 2026-10-14: Baseline verified (350 ai tests, 610 bff tests passing). Initialized task tracking.
