# Phase 1 Engineering Log: Resolving the "Logicalized Model" Flaw via Hybrid AI

**Date:** 2026-09-23  
**Author:** `aidev1-technext`  
**Reviewer / Lead:** Sky  
**Objective:** Eliminate conversational rigidity ("over-logicalized" slot-filling behavior where the bot re-asks details the guest already stated on WhatsApp), implement the Post-Generation Symbolic Fact Gate (`verifySynthesizedReply`), and surface partner/agency & split-day diving alerts (`getStaffAlerts`).

---

## 1. Summary of 5 Engineering Fixes (English Primary)

| # | Component | Legacy "Logicalized" Flaw | Hybrid AI (Neuro-Symbolic) Fix Implemented | Target File |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **`NEVER RE-ASK` Rule for Split-Day Diving** | When a guest wrote *"1 person dives day 1, 5 people dive both days"*, the extractor stored the text in `diveNotes` while leaving the single integer slot `divers` as `missing`. The question generator then robotically re-asked: *"How many of you will be diving?"* | Added **`NEVER RE-ASK`** guardrail: Whenever `diveNotes` contains a stated or inferred arrangement, `generateQuestions(trip)` skips `divers`, `diveFrom`, and `diveTo`, routing the verbatim note to human staff. | [`packages/extractor/src/questions.ts`](file:///e:/technext-edge/packages/extractor/src/questions.ts#L77-L106) |
| **2** | **Diver-Clause Lookahead (`DIVE_CLAUSE_AFTER_NOUN`)** | When a guest wrote *"6 of us... 1 person dives day 1, 5 people dive both days"*, `counts.ts` matched `"1 person"` and `"5 people"` as total staying guest counts, misclassified `6` vs `1` vs `5` as conflicting, and **wiped `guests: 6` back to `missing`**! | Added negative lookahead `DIVE_CLAUSE_AFTER_NOUN` to `patternFor("guests")`: Excludes human count nouns (`person`, `people`, `người`, `bạn`) when immediately followed by diving verbs (`dive`, `dives`, `diving`, `lặn`, `潜水`). Preserves `guests: 6`. | [`packages/extractor/src/counts.ts`](file:///e:/technext-edge/packages/extractor/src/counts.ts#L123-L139) |
| **3** | **Preserve Narrative Notes (`diveNotes`, `specialRequests`)** | `enforceVerbatimEvidence` previously wiped `diveNotes` and `specialRequests` to `null` if the LLM summarized a guest's nuance without an exact substring match in `evidence`. | Downgrades non-empty `diveNotes`, `specialRequests`, and `guestNames` to `state: "inferred"` instead of wiping them to `null`. | [`packages/extractor/src/extract.ts`](file:///e:/technext-edge/packages/extractor/src/extract.ts#L493-L511) |
| **4** | **Post-Generation Symbolic Fact Gate (`verifySynthesizedReply`)** | The Neuro layer (`synthesizeHospitalityReply`) generated warm concierge replies without a deterministic post-check against price hallucinations or count drift. | Built **`verifySynthesizedReply(text, trip)`**: Blocks 100% of currency quotes (`$`, `₱`, `PHP`, `USD`, `VND`), false booking confirmations, or mismatched `nights`/`rooms` integers. Automatically rolls back to `fallbackText` on any violation. | [`packages/extractor/src/synthesis.ts`](file:///e:/technext-edge/packages/extractor/src/synthesis.ts#L38-L74) |
| **5** | **Partner Discount & Custom Schedule Alerts (`getStaffAlerts`)** | `guestType: "agent"` or `"instructor"` was stored silently in JSON without alerting reservation staff to verify the 30% agency discount. | Built **`getStaffAlerts(trip, lang)`**: Appends explicit `📋 Partner / Agency Rate (30% agency discount)` and `📋 Custom Dive Schedule` banners directly onto the handoff summary. | [`packages/extractor/src/questions.ts`](file:///e:/technext-edge/packages/extractor/src/questions.ts#L567-L607) |

---

## 2. Automated Verification & Test Suite (`235 / 235 Green`)

- **Command:** `npm run verify` (`tsc --noEmit` + `vitest run`)
- **Result:** **16 / 16 Test Files Passed — 235 / 235 Unit Tests Passed (100% Green)**.
- **Key Test Scenarios in [`packages/extractor/test/questions.test.ts`](file:///e:/technext-edge/packages/extractor/test/questions.test.ts#L487-L596):**
  1. `NEVER RE-ASK: skips asking divers/diveFrom/diveTo when diveNotes already records split-day schedule`
  2. `Post-Generation Fact Gate: rejects LLM replies that invent prices or contradict verified counts`
  3. `Staff Alerts: flags travel agency / partner enquiries for 30% discount confirmation`

---

## 3. Bản Tóm Tắt Tiếng Việt (Vietnamese Reference)
- **Triệt tiêu lỗi hỏi lặp (`NEVER RE-ASK`):** Khi khách đã khai lịch lặn lẻ ngày vào `diveNotes`, bot tuyệt đối không hỏi lại câu *"How many of you will be diving?"* (`divers`).
- **Chống xóa nhầm tổng số khách (`counts.ts`):** Tách các cụm `"1 person dives"`, `"5 people dive"`, `"1 người lặn"` ra khỏi bộ đếm `guests`, giữ nguyên vẹn số khách lưu trú.
- **Khóa an toàn sau khi AI viết câu (`verifySynthesizedReply`):** Chặn 100% ký hiệu tiền tệ (`$`, `₱`, `PHP`, `USD`) hoặc lệch số đêm/số phòng.
