# Nhat_CHANGELOG

Changes by date, newest first. Each entry: what changed, what users / operators see, link to the PR.
This repo has no logbook; the notes are in `docs/`. Changes **outside the repo** (GitHub, Supabase, Vercel, local machine) go under "Infrastructure (outside the repo)".

How to write: add an entry as soon as a PR merges or something outside the repo changes. No secrets, no customer names.

---

## 2026-10-14

### Architecture Diagrams & Executive Briefing
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
