# Porting technext-edge into the team repo

technext-edge is the personal studio; `tn-casa-quotation-estimator` (the team estimator) is the system of record. This is
what has moved, what has not, and what must never move. Written 2026-10-01; the numbers drift, the order does not.

## Already the team's

| Piece | Where | State |
|---|---|---|
| `contracts/` | both repos, byte-identical | `npm run mirror:check` |
| `ai/` (extractor, providers, `odooHandoff`) | both repos, byte-identical | Team PR #5 (`feat/ai-layered-fix`) — **not merged**; mirror compares against that branch until it is |
| `POST /api/extract` (the F08 AI channel, behind `EXTRACT_ENABLED`) | team repo only | PR #5 |

## Not moved yet (in this repo only)

| Piece | Here | What the move involves |
|---|---|---|
| WhatsApp channel (webhook, signature, turn loop, phone lock) | `bff/src/routes/whatsapp.ts`, `channels/whatsapp/`, `store/conversationStore.ts` | New route group in their `bff/`; the store becomes Postgres (their `supabase/`), not Redis. The turn loop (`channels/whatsapp/turn.ts`) is the part worth keeping verbatim |
| Admin AI dashboard + KV settings | `routes/admin.ts`, `store/settingsStore.ts`, `auth/secretBox.ts`, `views/adminAiPage.ts` | Settings table in Postgres; key encryption stays. Decide first whether they want a dashboard at all (Q-021 is about which model may see guest text) |
| Handoff inbox | `routes/handoff.ts`, `views/handoffPage.ts` | Depends on the conversation store |
| `toInquiryLead` (F10) | `bff/src/quote/application/inquiryLead.ts` | Their inquiry route does not exist yet (B-043, waiting for Phillip) |

## Folder map (here -> team repo)

| Here (`bff/src/`) | Team repo (`bff/src/`) |
|---|---|
| `env.ts` | `env.ts` (add the WhatsApp and AI variables) |
| `auth/` (keys, session, rate-limit, guards, secretBox) | `auth/` (Odoo login there; webhook secret checks and the admin key are the additions) |
| `store/` (KV) | `store/` (Postgres; conversation and settings are new tables) |
| `estimator/` | `odoo/` + `model/` (the real engine; the simulation does not move) |
| `channels/whatsapp/` | new folder |
| `ai/providerHolder.ts` | new, or folded into the extract route |
| `quote/` | not ported (their draft store and `trip/` do this) |
| `routes/*` (sub-apps) | `routes/` |

## Never moves

The studio exists to simulate the integration: `/quotes`, the editor, `estimator/simulated.ts`, `quote/` (the local
priced draft), the ops sheet, `/q/:slug`, the demo sign-in. In the team repo the real estimator, their `/quote/<token>` page
and Odoo do those jobs. Do not port them; port the *calls* the studio makes (`compute`, `share`, `submit`) only as tests.

## Order

1. Merge PR #5 (needs Anthony on Q-021 and `EXTRACT_ENABLED`). Renumber its flow doc: on `main` the number F08 is now the
   agent profile (F10 is the inquiry), so the AI channel needs a new number; its ledger codes (Q-021, D-064, L-044) also clash
   with `main`'s Q-021…Q-028. `git merge origin/main` into the branch conflicts only in docs/ledgers, `bff/.env.example` and
   `scripts/suites.json`.
2. Re-run `npm run mirror:check` here; update the pins in `upstream-provenance.md`.
3. WhatsApp channel, then handoff, then (if wanted) the dashboard — each its own PR with their test layout (`bff/test/p5/`).

## What still differs by design

- `bff/` here compiles with looser TypeScript options (`tsconfig.studio.json`); theirs uses the strict base.
- Imports are relative (`../../ai/src/index.ts`) because the workspace symlink failed in this repo's Vercel bundle.
- Roles: the studio has `staff` and `admin`; a role in the team estimator comes from the Odoo login, never from a form.
