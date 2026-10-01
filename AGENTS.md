# AGENTS.md — Workspace Engineering & Discipline Guidelines

This workspace follows the synthesized principles of elite agentic engineering: **Superpowers** (strict workflow & TDD), **Ponytail** (YAGNI & minimalist code), **UI/UX Pro Max** (modern design tokens), and **Impeccable** (security & code quality gates).

---

## 1. The Ponytail Rule: Minimalist Code & Zero Reinvention (YAGNI)
> *"The best code is the code you never had to write."*

- **Reuse first:** Before writing any new utility, helper, or model, search the codebase (`packages/extractor/src/`, `apps/casa-bff/src/`) and existing npm dependencies.
- **Strict YAGNI:** Implement only what is strictly necessary to solve the user's explicit request. Never add speculative abstractions, premature generalizations, or unused helper methods.
- **Tight diffs:** Keep code changes surgical, minimal, and closely targeted. Avoid touching unrelated files or modifying formatting of untouched blocks.

---

## 2. The Superpowers Discipline: TDD & Workflow Rigor
> *"Never rush into code without a clear contract and a failing test."*

- **Stage 1 — Clarify & Contract:** Understand inputs, outputs, edge cases, and API error formats before writing code.
- **Stage 2 — Test-Driven Development (Red-Green-Refactor):**
  - For any logic, bug fix, or endpoint enhancement, identify or write a failing test first in the relevant test suite (e.g. `packages/extractor/test/` or `apps/casa-bff/test/`).
  - Write the minimal code to make the test pass (Green).
  - Clean up and optimize without altering external behavior (Refactor).
- **Stage 3 — Non-Negotiable Verification:** Run `npm run verify` (or project test suite) to ensure zero regressions before reporting completion.

---

## 3. UI/UX Pro Max Standards
> *"Interfaces must look polished, purposeful, and production-ready."*

- **Design System Tokens:** Use consistent color palettes (primary, surface, muted, borders, accents), readable typography scales, and unified border radii.
- **State Completeness:** Every interactive component must handle 4 states cleanly: `Loading / In-flight`, `Success / Populated`, `Empty / Zero data`, and `Error / Fallback`.
- **Accessibility & Contrast:** Maintain high contrast ratios, meaningful ARIA attributes, and clear hover/focus/active visual feedback.
- **Responsive & Ergonomic:** Test mobile viewports and sticky touch targets (e.g., sticky WhatsApp docks or bottom CTA bars).

---

## 4. The Impeccable Gate: Security & Reliability Review
> *"Act as the strictest reviewer before any change is finalized."*

- **Zero Secret Leaks:** Never hardcode tokens, API keys, or private webhook secrets. Never output sensitive tokens into client-facing URLs, query params, or unmasked server logs.
- **Structured Error Envelopes:** No raw `500 Internal Server Error` strings or unhandled HTML crash pages. Always return structured JSON envelopes (`{ ok: false, reason, detail }`).
- **Resilient Transport:** Handle timeouts, circuit-breakers for 3rd-party APIs (Odoo/Meta/LLMs), and fallback safely without blocking guest flows.
- **Data Integrity:** Prevent race conditions, duplicate mutations, or cross-contamination of sessions/cookies across distinct quotations.
