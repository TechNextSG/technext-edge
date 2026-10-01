# The team estimator — what this repo mirrors, and how drift is caught

The system of record is `TechNextSG/tn-casa-quotation-estimator` (private): its BFF parses a `Trip` and Odoo prices
it. This repo is the personal studio that simulates the integration and runs the WhatsApp channel. Where the two
disagree, the team repo wins.

## What is a byte-copy

`ai/` and `contracts/` are **mirrored, never edited here**. A change goes into the team repo first (a PR there) and is
copied back. `npm run mirror:check` compares both directories with the team checkout (`diff` ignoring line endings)
and fails on any difference, any file only on one side, or a leftover local file.

| Directory | Compared to | Pin |
|---|---|---|
| `contracts/` | `origin/main` | `3a3c2068c9ab2da2306821c8087b4755c1f250df` (2026-10-01) |
| `ai/` | `pr/ai-9-eval-tools` (stack of PRs 8 to 15 that replaced PR 5; PR 5 is a draft, reference only) until merged, then `origin/main` | `8bd3971` (`pr/ai-9-eval-tools`; `ai/src` and `ai/test` equal PR 5 at `6f5eab0`) |

When the stack merges: set `AI_REF` default in `tools/ops/mirror-check.mjs` to `origin/main`, re-copy, update the table. The stack adds `docs/flows/F12-ai-channel.md` and a shared `clientIp` in the team repo; neither is mirrored here.

Dependencies follow the team repo: zod 4, `.ts` import suffixes, vitest 5. `bff/` and `quotation/` still compile with
the looser options in `tsconfig.bff.json`; `ai/` and `contracts/` compile with the team's `tsconfig.base.json`.

## Behaviour snapshot

What the engine does with a Trip — its validation codes and room capacity — is not in a package, so it is pinned by
reading. Transcribed from `Stage1_Estimator_Tools@5fe2806` (an ancestor of `main`):

- the `TripIssueCode` union (`bff/src/trip/validate.ts`) — this side has a sentence for each in
  `bff/src/services/refusalCopy.ts`, listed in `bff/test/refusalCopy.test.ts`;
- room capacity per type — `DEFAULT_ROOM_CAPS` in `ai/src/domain/houseNorms.ts` (standard 2, deluxe 4, suite 4);
- the F10 website enquiry `toInquiryLead` prepares (`quotation/test/customerRules.test.ts`), assumed there ("waiting for
  Phillip", B-043).

The deployed fixture (`tn-casa-estimator-fixture`) builds from `Stage1@dac70e6`, which has the capacity rules
(`85e1e20`, `6bb725e`, `0d3b0cd`), `retailFor` (`188d451`) and `label` (`e0c4173`), and lacks the share gate 403
(`97dd313`) and `divers-over-guests` (`09b1b6d`).

The team's AI-channel flow (`docs/flows/F08-ai-channel.md` on `ds/ai-room-type-required@17209ea`, 2026-09-28, not merged;
on `main` the number F08 is the agent profile, so it will be renumbered) is the contract of our channel. Its sample label
is "Sample data — not a live quote". The branch stays watched until it merges.

## Pins read by `npm run upstream:check`

| Commit | `3a3c2068c9ab2da2306821c8087b4755c1f250df` |
|---|---|

The commit above is the mirror pin (`contracts/`); the report counts "commits past" it; the behaviour snapshot is
transcribed from `Stage1_Estimator_Tools@5fe2806`, and the ds branch is pinned at `ds/ai-room-type-required@17209ea`.

Run `npm run upstream:check` before touching anything that prices a trip, and `npm run mirror:check` before and after
copying `ai/` or `contracts/`. After handling what they report, update this file.
