# BFF quotation contract — vendored reference

The extractor does not own the `Trip` shape that leaves this service. The BFF in
`TechNextSG/tn-casa-quotation-estimator` parses it with its own schema, and Odoo prices it.
This directory holds a faithful, machine-checkable copy of the parts of that contract the
extractor has to satisfy, so drift is caught by a test instead of by a 422 in production.

## Provenance

| | |
|---|---|
| Repo | `TechNextSG/tn-casa-quotation-estimator` (private) |
| Branch | `main` |
| Commit | `4c489188d9388fcd26c7fb3713b5dbeb31146966` (2026-09-22) |
| `contracts/src/trip.zod.ts` | sha256 `3d93bf47637fe494…` |
| `contracts/src/odoo/types.ts` | sha256 `954e9e9f5d416b1e…` |
| Handover doc | `Schema và hợp đồng API cho kênh AI (P5)`, 2026-09-25, branch `feat/p2-booking` |

## What was deliberately NOT vendored, and why

`contracts/src/trip.zod.ts` is the authoritative zod schema, and it is **not** copied in
here. Two reasons, both practical:

1. **zod major-version skew.** `contracts/package.json` pins `zod ^4.6.5`; this repo is on
   `zod ^3.23.8`. Vendoring their schema would make this repo depend on a second zod major,
   or force an upgrade of the whole extractor, for a test-only concern.
2. **It is not the shape the extractor produces anyway.** Every field in their
   `TripSchema` carries a `.default()`, so `TripSchema.parse({})` succeeds and fills
   `transportType: 'none'`, `diver: true`, `meals: true`, and the rest. It is a
   *gap-filling* schema; the missing-required-field rule lives in their `fillTrip` /
   `validateTrip`, not in the schema. Using it as the extractor's contract would erase the
   difference between "the guest has not answered" and "the guest said the default", which
   is the one distinction this pipeline exists to preserve.

So `contract-spec.mjs` is a transcription of the two authoritative sources above. It is
data, not logic, and `contract-parity.test.ts` fails if the extractor and this
transcription disagree — which is the drift that matters.

## The rule the extractor must follow

From the handover doc, §3: the extractor sets a field to "missing" and asks the guest
rather than filling a default, and it writes `diver: false` explicitly for a non-diver.
Their schema defaults `diver` to `true`, so an absent `diver` is read as "this guest
dives" and is priced accordingly.

## Behaviour snapshot (added 2026-09-30)

The pin above covers the *shape* of a Trip. What the engine does with one — its validation
codes and room capacity — is pinned separately in `contract-spec.mjs` (`ISSUE_CODES`,
`ROOM_RATE_TIERS`, `ROOM_CAPS`), transcribed from `Stage1_Estimator_Tools@5fe2806`. The deployed
fixture (`tn-casa-estimator-fixture`) builds from `Stage1@dac70e6`, which has the capacity rules
(`85e1e20`, `6bb725e`, `0d3b0cd`), `retailFor` (`188d451`) and `label` (`e0c4173`), and lacks the
share gate 403 (`97dd313`) and `divers-over-guests` (`09b1b6d`).

The customer's AI-channel flow `docs/flows/F08-ai-channel.md` (our channel's contract) is pinned at
`ds/ai-room-type-required@17209ea` (2026-09-28, not merged yet); its sample label is
"Sample data — not a live quote". The branch stays watched until it merges.

Run `npm run upstream:check` before touching anything that prices a trip; after handling what it
reports, update this snapshot and the pins.
