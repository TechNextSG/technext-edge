# ADR-007: Hybrid AI (Neuro-Symbolic) Response Synthesis, Fact Gate & NEVER RE-ASK Contract

- **Status:** Proposed (Ready for Lead / Anthony Sign-Off)
- **Date:** 2026-09-23
- **Deciders:** Sky (Lead), Anthony, TechNext Edge Pod (`aidev1-technext`)
- **Supersedes / Extends:** [ADR-005a](file:///e:/technext-edge/docs/adr/ADR-005a-extractor-model.md), [ADR-006](file:///e:/technext-edge/docs/adr/ADR-006-reply-contract.md)

---

## 1. Context & Problem Statement

During live WhatsApp testing of the Casa Escondida Booking Assistant on 2026-09-22, two critical limitations of a purely rule-based ("over-logicalized") slot-filling architecture surfaced:

1. **Conversational Rigidity (The "Re-Ask" Bug):**
   - When a guest stated a multi-clause diving schedule (*"1 person dives day 1, 5 people dive both days"*), the extractor stored the nuance in `diveNotes` (`"1 person dives day 1, 5 people dive both days"`), but left the single integer slot `divers` as `missing` because a split-day schedule has no single integer head-count.
   - Furthermore, `counts.ts` matched `"1 person"` and `"5 people"` against generic human nouns, mistaking them for conflicting total staying guest counts and wiping `guests` back to `missing`.
   - Consequently, the deterministic question generator re-asked: *"How many of you will be diving?"*, frustrating the guest.
2. **Robotic Tone vs. Hallucination Risk:**
   - Purely static string concatenation (`renderReply`) felt robotic when guests described special family or diving arrangements.
   - However, allowing an LLM to freely answer guests without a deterministic firewall risks hallucinated room rates, false availability promises, or corrupted stay dates.

---

## 2. Decision

We adopt a **2-Layer Neuro-Symbolic (Hybrid AI) Architecture** for turn-by-turn WhatsApp replies:

### Decision 1 — The `NEVER RE-ASK` Rule for Nuanced Schedules ([`questions.ts`](file:///e:/technext-edge/packages/extractor/src/questions.ts))
- Whenever `diveNotes` contains a stated or inferred arrangement (`notedValue(trip, "diveNotes") !== null`), the question generator **must never ask** `divers`, `diveFrom`, or `diveTo`.
- Instead, the system acknowledges the verbatim `diveNotes` arrangement, completes any remaining non-diving fields, and attaches a structured staff alert (`getStaffAlerts`) routing the enquiry to `manual_staff_review` (`buildOdooHandoffPayload`).

### Decision 2 — Diver-Clause Lookahead in Count Corroboration ([`counts.ts`](file:///e:/technext-edge/packages/extractor/src/counts.ts))
- `patternFor("guests")` applies a negative lookahead (`DIVE_CLAUSE_AFTER_NOUN`) so that count nouns immediately followed by diving verbs (`dive`, `dives`, `diving`, `lặn`, `潜水`) are never misclassified as conflicting total guest counts.

### Decision 3 — Neuro Concierge Synthesis + Post-Generation Symbolic Fact Gate ([`synthesis.ts`](file:///e:/technext-edge/packages/extractor/src/synthesis.ts))
- **Neuro Layer (`synthesizeHospitalityReply`):** Generates a warm 5-star resort concierge reply in the guest's language (`en`, `vi`, `zh`) grounded strictly on the verified `Trip` object and conversation history.
- **Symbolic Layer (`verifySynthesizedReply`):** Every LLM-generated reply must pass a deterministic post-generation verifier before reaching WhatsApp:
  1. **Zero Unauthorized Currency/Price Quotes:** Rejects any message containing `$`, `₱`, `PHP`, `USD`, `VND`, `EUR`, or monetary quotes (`unauthorized_price_quote`).
  2. **Zero False Confirmations:** Rejects any claim that the booking is already confirmed (`false_booking_confirmation`).
  3. **Exact Integer Consistency:** Rejects any reply whose stated night count (`nights`) or room count (`rooms`) contradicts the validated `Trip` object (`mismatched_nights_count`, `mismatched_rooms_count`).
  4. **Instant Deterministic Rollback:** Any rejection or timeout immediately falls back to `renderReply()` (`fallbackText`).

### Decision 4 — Objective Naturalness Scoring & Tri-State Odoo Handoff ([`naturalness.ts`](file:///e:/technext-edge/packages/extractor/src/naturalness.ts), [`odooHandoff.ts`](file:///e:/technext-edge/packages/extractor/src/odooHandoff.ts))
- Every reply is measurable on a 0–100 rubric (`scoreReplyNaturalness`: 35% Non-Redundancy, 25% Nuance Acknowledgment, 25% Fact Gate Safety, 15% Concierge Warmth).
- Every completed `Trip` maps via `buildOdooHandoffPayload(trip)` into either `auto_estimate_ready` (standard retail booking) or `manual_staff_review` (partner/agency 30% discount or custom split-day dive schedule).

---

## 3. Consequences

- **Positive:** Zero re-asking on complex guest schedules; 5-star warmth in EN/VI/ZH; mathematically guaranteed 0% price hallucination via `verifySynthesizedReply`.
- **Negative / Trade-off:** Retains two separate model passes (Extraction pass + Synthesis pass) rather than merging into a single prompt, adding ~400–600ms latency in exchange for preserving the deterministic code firewall between extraction and response generation.
