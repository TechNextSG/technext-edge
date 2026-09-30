# docs

Everything the handoff needs, grouped by what kind of document it is. Read the
folders top-down — `adr/` first if you are changing anything the ADRs decide.

| Folder | What lives there |
| --- | --- |
| [`adr/`](adr/) | Architecture decision records. Numbered, append-only; a decision is changed by a new ADR, not by editing an old one. |
| [`guides/`](guides/) | How to run, test, demo and deploy this thing. Written for a person arriving today. |
| [`specs/`](specs/) | Contracts and upstream references: the API schema, the architecture spec, what the resort's own site claims, what we found in their BFF. |
| [`notes/`](notes/) | Engineering logs — what was tried, what broke, what the fix was. Chronological, not normative. |
| [`diagrams/`](diagrams/) | Draw.io sources and their PNG exports (flow, component, sequence diagrams). |
| [`demo/`](demo/) | Demo artefacts: shooting script, staged HTML pages, subtitle file, screen captures, the walkthrough screenshots, the sprint tracker. |

The published documentation site is **not** in here — it is served from
[`public/`](../public/), which is the only directory the deployment publishes
from. Pages that used to sit in this folder's root now live there.

## guides/

| Document | Use it to |
| --- | --- |
| [01-team-guide.md](guides/01-team-guide.md) | Start here: prerequisites, running locally, the test console, deploying, env vars, the eval harness, the gotchas. |
| [manual-test-production.md](guides/manual-test-production.md) | Run the full WhatsApp → bot → studio → guest-link path against production, step by step. |
| [whatsapp-manual-test.md](guides/whatsapp-manual-test.md) | Drive the WhatsApp channel by hand and record which cases pass. |
| [live-demo-script.md](guides/live-demo-script.md) | Perform the ~8 minute live demo. |
| [recording-script.md](guides/recording-script.md) | Self-record the ~6 minute video version with Snipping Tool, one screen at a time. |
| [error-codes.md](guides/error-codes.md) | Look up the studio's error codes — the contract between the server and `/quotes/:id`. |
| [simulated-estimator.md](guides/simulated-estimator.md) | Run the estimator/Odoo simulator, and find the path to the real one. |

## specs/

| Document | Contents |
| --- | --- |
| [ai-hono-odoo-architecture-spec.md](specs/ai-hono-odoo-architecture-spec.md) | AI → Hono BFF (submit / compute / studio) → Odoo ERP via GAIS. |
| [06-p5-bff-schema-contract.md](specs/06-p5-bff-schema-contract.md) | Schema and API contract for the AI channel (P5). |
| [resort-website-cross-check.md](specs/resort-website-cross-check.md) | The resort website ↔ our engine ↔ the rate card, item by item. |
| [upstream-note-bff-vercel-deploy.md](specs/upstream-note-bff-vercel-deploy.md) | Why their BFF does not deploy to Vercel as-is, and what that costs. |
| [upstream-patch-fixture-sample.md](specs/upstream-patch-fixture-sample.md) | `POST /api/estimates` should carry the `sample` flag — the patch we send upstream. |

## notes/

| Document | Contents |
| --- | --- |
| [phase1-implementation-notes.md](notes/phase1-implementation-notes.md) | Resolving the "logicalized model" flaw via hybrid AI. |
| [phase2-implementation-notes.md](notes/phase2-implementation-notes.md) | Naturalness scorer, Odoo handoff adapter, ADR-007. |

## adr/

- [ADR-005a](adr/ADR-005a-extractor-model.md) — model choice for the AI extractor, and every finding from testing so far.
- [ADR-006](adr/ADR-006-reply-contract.md) — the reply contract: one deterministic message per guest turn.
- [ADR-007](adr/ADR-007-neuro-symbolic-synthesis.md) — neuro-symbolic synthesis, fact gate and the never-re-ask contract.

## Conventions

- **Decisions** go in `adr/` as a new numbered record; never edit a shipped ADR
  to change what it says.
- **Runbooks and demos** go in `guides/` — one document per activity, in the
  order the reader performs it.
- **Anything that describes an external contract** (their schema, their BFF,
  the resort's published rates) goes in `specs/`, so "what we decided" and
  "what we were told" never mix.
- **Published pages** are built into [`public/`](../public/). Do not add a
  second copy here; `apps/casa-bff/test/publicAssets.test.ts` fails the build if
  a document served from `public/` has a duplicate anywhere else.
