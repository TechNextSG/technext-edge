# technext-edge

BFF and AI Extractor for Casa Escondida, per the [Casa Escondida Estimator Tools source plan](https://casa-escondida-estimator-tools.vercel.app/).

## Source plan

The canonical project decisions live in the three documents published at the
source-plan site:

- [Core & Edge Blueprint](https://casa-escondida-estimator-tools.vercel.app/casa-core-edge-blueprint) — system architecture and responsibilities.
- [Edge Playbook](https://casa-escondida-estimator-tools.vercel.app/casa-edge-playbook) — BFF, extractor, control gates, data model and evaluation rules.
- [Delivery Plan](https://casa-escondida-estimator-tools.vercel.app/casa-delivery-plan) — stages, gates, environments and ownership.

When this repository conflicts with those documents, treat the signed/current
source plan as authoritative and record the implementation decision in
`docs/adr/`.

premise: Odoo is the brain, this is the edge. Drafts never enter Odoo — see
`docs/adr/` for the decisions this build is based on.

**New here? Read [docs/guides/01-team-guide.md](docs/guides/01-team-guide.md)** — full
handoff: prerequisites, running locally, the test console, deploying, env
vars, the eval harness, and the gotchas that already cost an afternoon once.
[docs/README.md](docs/README.md) indexes the rest of `docs/` (`adr/`, `guides/`,
`specs/`, `notes/`, `diagrams/`, `site/`, `archive/`).

## Layout

Three workspaces, one dependency direction:

```text
contracts  <-  ai  <-  bff
```

```text
contracts/        @casa/contracts — the team estimator's Odoo contract (OpenAPI types, typed client, fixtures).
ai/               @casa/ai — guest message in, Trip and reply out. No pricing, no Odoo.
  src/
    domain/           Trip schema, dates, counts, house norms, conversation — no I/O
    application/      extract, normalize, intent, questions, synthesis, naturalness, converse, odooHandoff
    ports/            the provider interface
    infra/providers/  DeepSeek and Gemini adapters, env/settings factory
    index.ts          the package's only public import surface
  test/             vitest suite      eval/   Playbook threshold harness
bff/              @casa/bff — the Hono app (the studio and the WhatsApp channel)
  src/
    env.ts            every environment variable, named once; the only file that reads process.env
    app.ts            error handler, security headers, and the app.route() lines
    deps.ts           builds the stores, estimator, provider holder and guards (everything injectable for tests)
    auth/             keys (staff/admin key, sameSecret), session (signed cookie), rate-limit, guards
    crypto/           secretBox: encrypts the keys saved from the admin dashboard
    store/            persistence: kv.ts (the one KV client), quotation, conversation and settings stores
    quote/            the quotation domain: priced draft, rates, validity window, trip diff, inquiry lead
    estimator/        the pricing/booking engine behind one port: client (real), simulated, refusalCopy
    channels/whatsapp/  Meta's Cloud API (meta.ts) and the per-phone turn loop (turn.ts)
    ai/               the process-wide provider holder and providerFor
    routes/           HTTP only, one sub-app per file; quotes/ is seven sub-apps plus service.ts
    views/            server-rendered pages; the staff editor is views/editor/{model,markup,styles,client}.ts
  test/             grouped like src: auth, store, estimator, channels, routes, views, quote
  scripts/          WhatsApp and journey scripts, run from bff/
api/index.ts      Vercel entry point; imports bff/src/app.ts
public/           robots.txt only: Vercel publishes this folder, so it must exist and stay nearly empty
docs/site/media/  demo videos and captures (kept out of the deployment by .vercelignore)
docs/             adr | guides | specs | notes | diagrams | demo
tools/
  ops/              upstream-check, mirror-check, check-boundaries, cleanup-quotations
  live-eval/        scenario runs against a live provider key (not in CI); outside ai/ because ai/ is a mirror
```

`ai/` and `contracts/` are **byte-copies of the team repo** (`TechNextSG/tn-casa-quotation-estimator`): change them
there, then copy them back. `npm run mirror:check` fails when they differ; pins and the rules are in
[docs/notes/upstream-provenance.md](docs/notes/upstream-provenance.md).

Rules, enforced by `npm run check:boundaries` (part of `npm run verify` and CI) and `bff/test/layers.test.ts`:

- A package imports only the packages to its left in the chain above.
- Across packages, import the barrel `<pkg>/src/index.ts`, never a file inside it.
- Imports stay relative (`../../ai/src/index.ts`), not `@casa/*`: the workspace symlink did not
  resolve in the Vercel bundle (see the note at the top of `bff/src/app.ts`).
- Inside `bff/src`: `process.env` only in `env.ts`; `auth/`, `crypto/` and `quote/` import nothing but `env`; `store/` may use `quote/`
  and `crypto/` and nothing above; `views/` may name store types but never call a store.

Inside a package, imports flow `infra → application → domain`; nothing in `domain/` imports
`application/`.

## 30-second version

- `ai/` — Trip schema (Zod), date & room-capacity processing, LLM provider adapters (Gemini, DeepSeek), fact-gated reply synthesis.
- `bff/` — Edge BFF built on Hono:
  - **Quotation Studio:** 5 workflow queue tabs (`/quotes`), live trip editor, 72h countdown soft-hold, resort bank details, and A4 print Ops Sheet (`/quotes/:id/ops`).
  - **Dual Estimator Port:** `ESTIMATOR_MODE=remote` (connects to upstream Odoo fixture) and `simulated` (in-process local calculation).
  - **WhatsApp Channel:** Meta Cloud API webhook (`/v1/channels/whatsapp/webhook`), phone-level concurrency locks, and handoff inbox.
- `contracts/` — The team estimator's contract, mirrored byte for byte.
- `AGENTS.md` — Workspace engineering discipline (Superpowers, Ponytail, UI/UX Pro Max, Impeccable).

**Live Deployments:**
- **Production (Remote Mode):** [https://technext-edge-casa-bff.vercel.app](https://technext-edge-casa-bff.vercel.app)
- **Simulation (In-Process Mode):** [https://technext-edge-casa-bff-sim.vercel.app](https://technext-edge-casa-bff-sim.vercel.app)

**Status:** Production-ready Edge BFF. Fully tested with **956 automated tests across 61 test suites (100% passing)**, architecture boundary enforcement, and zero secret leakage.

## Run & Verify

```bash
npm install
npm run verify               # Non-negotiable gate: boundary check + typecheck + 956 unit & contract tests
npm test                     # Fast unit tests only
cp .env.example .env.local   # Fill in local API keys (Gemini, KV, etc.)
npm run dev:bff              # Start local Hono BFF at http://localhost:8787
npm run whatsapp:sim --workspace bff   # Simulate a signed Meta webhook
npm run whatsapp:check --workspace bff # Verify WhatsApp Graph credentials
npm run whatsapp:threads --workspace bff  # Inspect threads waiting for staff handoff
```

## Deploy

Always run Vercel commands from the **repo root** — see
[docs/guides/01-team-guide.md](docs/guides/01-team-guide.md#5-deploying) for why and for
the full command sequence.

```bash
vercel link
vercel env add GEMINI_API_KEY production
vercel env add GEMINI_API_KEY preview
rm -rf .vercel/output && vercel build --yes --target production
vercel deploy --prebuilt --prod --yes
```
