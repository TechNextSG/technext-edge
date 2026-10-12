# Nhat_CHANGELOG

Changes by date, newest first. Each entry: what changed, what users / operators see, link to the PR.
This repo has no logbook; the notes are in `docs/`. Changes **outside the repo** (GitHub, Supabase, Vercel, local machine) go under "Infrastructure (outside the repo)".

How to write: add an entry as soon as a PR merges or something outside the repo changes. No secrets, no customer names.

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
