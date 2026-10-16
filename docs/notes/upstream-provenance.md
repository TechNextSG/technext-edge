# The team estimator — API Contract & Upstream Alignment

Per **[ADR-011](../adr/ADR-011-separate-ai-service.md)**, `technext-edge` is an independent, dedicated AI Extractor + WhatsApp Channel service.
It communicates with `TechNextSG/tn-casa-quotation-estimator` strictly over HTTP REST API (`POST/PATCH /api/estimates`, `/extras`, `/commit`, `GET /api/estimates/:id`) and signed Webhooks.

## Code Ownership & Contract Testing

`ai/` and `contracts/` are **owned in this repository**. The previous byte-mirror requirement (`mirror:check`) has been retired.
API compatibility with `tn-casa-quotation-estimator` is strictly enforced through **Zod schemas and automated Contract Tests** (Anti-Corruption Layer).
Where the two services interact:
1. `contracts/src/estimator-api.ts` defines the authoritative contract for upstream API payloads.
2. `contracts/fixtures/estimator/` preserves real response fixtures from the estimator.
3. Upstream drift is verified via contract tests rather than byte-level file mirroring.

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
