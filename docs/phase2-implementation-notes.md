# Phase 2 Engineering Log: Naturalness Scorer, Odoo Handoff Adapter & ADR-007

**Date:** 2026-09-23  
**Author:** `aidev1-technext`  
**Reviewer / Lead:** Sky  
**Objective:** Pre-build and verify all Phase 2 engineering infrastructure ahead of external dependencies from Phillip (Odoo schema) and Eloa (30 real guest transcripts):
1. Objective Conversational Naturalness & Non-Redundancy Scorer (`scoreReplyNaturalness`).
2. Tri-State Odoo Quotation & Staff Handoff Adapter (`buildOdooHandoffPayload`).
3. Formal Architecture Decision Record (`ADR-007-neuro-symbolic-synthesis.md`) ready for Lead sign-off.

---

## 1. Summary of Phase 2 Deliverables (English Primary)

| # | Phase 2 Deliverable | Technical Design & Business Value | Target File |
| :-: | :--- | :--- | :--- |
| **1** | **Objective Naturalness Scorer (`scoreReplyNaturalness`)** | Scores every reply on a **0 – 100 scale** across 4 deterministic dimensions:<br>• **35% `noReAskScore`**: Penalizes any re-asking of `divers`/`diveFrom`/`diveTo` when `diveNotes` is already recorded.<br>• **25% `nuanceAckScore`**: Verifies explicit readback of `diveNotes` & `specialRequests`.<br>• **25% `factGateScore`**: Enforces `verifySynthesizedReply` (0% price hallucination, 0% count mismatch).<br>• **15% `conciergeWarmthScore`**: Verifies polite 5-star hospitality opening and structured summary.<br>$\rightarrow$ **Ready for Eloa's 30 transcripts:** Instant automated grading the moment transcripts arrive. | [`packages/extractor/src/naturalness.ts`](file:///e:/technext-edge/packages/extractor/src/naturalness.ts) |
| **2** | **Tri-State Odoo Handoff Adapter (`buildOdooHandoffPayload`)** | Transforms a validated `Trip` into an `OdooHandoffEnvelope` with 3 deterministic routing modes:<br>• `incomplete_enquiry`: Still collecting required fields on WhatsApp.<br>• `auto_estimate_ready`: Standard `retail` booking with exact integer counts — ready for direct Odoo Estimate API call.<br>• `manual_staff_review`: Booking includes partner/agency discount (`agent`/`instructor` 30% discount) or custom split-day diving (`diveNotes`) — routes with `manualReviewReasons` & `staffAlerts` for 1-click staff confirmation. | [`packages/extractor/src/odooHandoff.ts`](file:///e:/technext-edge/packages/extractor/src/odooHandoff.ts) |
| **3** | **Architecture Decision Record [`ADR-007`](file:///e:/technext-edge/docs/adr/ADR-007-neuro-symbolic-synthesis.md)** | Formalizes the 2-Layer Neuro-Symbolic Synthesis architecture (`synthesizeHospitalityReply` + `verifySynthesizedReply` + `NEVER RE-ASK` + `DIVE_CLAUSE_AFTER_NOUN`), extending `ADR-005a` and `ADR-006` for Sky / Anthony sign-off. | [`docs/adr/ADR-007-neuro-symbolic-synthesis.md`](file:///e:/technext-edge/docs/adr/ADR-007-neuro-symbolic-synthesis.md) |

---

## 2. Automated Verification & Test Suite (`235 / 235 Green`)

- **Command:** `npm run verify` (`tsc --noEmit` + `vitest run`)
- **Result:** **16 / 16 Test Files Passed — 235 / 235 Unit Tests Passed (100% Green)**.
- **Phase 2 Unit Tests in [`packages/extractor/test/questions.test.ts`](file:///e:/technext-edge/packages/extractor/test/questions.test.ts#L599-L675):**
  1. `Phase 2 Naturalness Scorer: awards 100/100 to warm non-redundant replies and penalizes re-asking`
  2. `Phase 2 Odoo Handoff Adapter: distinguishes auto_estimate_ready vs manual_staff_review`

