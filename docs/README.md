# docs

Everything the handoff needs, grouped by what kind of document it is. Read the
folders top-down — `adr/` first if you are changing anything the ADRs decide.
For the code layout itself start with [ARCHITECTURE.md](ARCHITECTURE.md); for what moves to the team repo and in
what order, [notes/port-to-team-repo.md](notes/port-to-team-repo.md).

| Folder | What lives there |
| --- | --- |
| [`adr/`](adr/) | Architecture decision records. Numbered, append-only; a decision is changed by a new ADR, not by editing an old one. |
| [`guides/`](guides/) | How to run, test, demo and deploy this thing. Written for a person arriving today. |
| [`specs/`](specs/) | Contracts and upstream references: the API schema, the architecture spec, what the resort's own site claims, what we found in their BFF. |
| [`notes/`](notes/) | Engineering logs — what was tried, what broke, what the fix was. Chronological, not normative. |
| [`diagrams/`](diagrams/) | Archify and draw.io diagrams of the repo, the message flow and the extractor pod. |
| [`site/`](site/) | `site/media/`: demo videos and screen captures. Not deployed (`.vercelignore`). |
| [`archive/`](archive/) | Finished or superseded material kept for reference: the September demo kit (`demo-2026-09/`) and old implementation notes (`notes/`). |

There is no documentation site any more: the app serves no documentation pages, and `public/` holds only `robots.txt`
(Vercel publishes that folder, so it must exist). The demo videos and captures are in [`site/media/`](site/media/),
kept out of the deployment by `.vercelignore`. This folder is the documentation.

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
- [ADR-008](adr/ADR-008-advisory-agent.md) — **proposed**: an advisory agent next to the quotation flow, answering from a small knowledge store ([diagram](diagrams/advisory-architecture.html)).
- [ADR-009](adr/ADR-009-advisory-langgraph.md) — **proposed**: when and how to move the advisory loop to LangGraph.js (phase 3), with a Postgres checkpointer; waits for the store port.

## Conventions

- **Decisions** go in `adr/` as a new numbered record; never edit a shipped ADR
  to change what it says.
- **Runbooks and demos** go in `guides/` — one document per activity, in the
  order the reader performs it.
- **Anything that describes an external contract** (their schema, their BFF,
  the resort's published rates) goes in `specs/`, so "what we decided" and
  "what we were told" never mix.
- **Nothing here is served.** The app publishes no documentation pages; a document is read in the repo.
