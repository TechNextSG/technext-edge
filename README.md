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

- `ai/` — Trip schema (zod), date/house-norm post-processing,
  provider adapters (Gemini, DeepSeek), eval-ready pipeline. Real and tested.
- `bff/src/quote/` — the priced draft the studio edits. A simulation of the team estimator's numbers, never the source of truth.
- `contracts/` — the team estimator's contract, mirrored byte for byte.
- `bff/` — Hono app: `POST /v1/extract`, `POST /v1/converse`, the
  WhatsApp inbound webhook at `/v1/channels/whatsapp/webhook`, plus a staff-only test
  console at `/test`. Deployed at **https://technext-edge-casa-bff.vercel.app**.
- `ai/eval/` — scores against the Playbook's 5 thresholds.
  Ships with a researched-but-synthetic dataset; real decisions wait for
  Eloa's 30 real messages.
- [`docs/adr/ADR-005a-extractor-model.md`](docs/adr/ADR-005a-extractor-model.md)
  — why Gemini is the demo default, not a decision, and every real finding
  from testing so far (DeepSeek dry run, the Gemini free-tier quota blocker).

**Status:** early scaffold for the Extractor pod's demo. The WhatsApp inbound
channel is wired end to end (verify, signature, extract, reply) but its
conversation memory is in-process, so it is demo-ready and not yet
production-ready. The Draft store, the Contract pod's generated Odoo client,
and the rest of the BFF endpoints from the Playbook do not exist here yet.

## Run it

```bash
npm install
npm test                     # extractor unit tests, no API key needed
cp .env.example .env.local   # fill in GEMINI_API_KEY
npm run dev:bff              # http://localhost:8787
npm run whatsapp:sim --workspace bff   # fake a signed Meta webhook at it
npm run whatsapp:check --workspace bff # with real WHATSAPP_* creds: verify them against Graph
npm run whatsapp:check --workspace bff -- --exchange-token  # 24h dashboard token in, ~60 day token written to .env.local
npm run whatsapp:threads --workspace bff  # threads waiting on a person; -- --resume <phone> hands one back to the bot
npm run whatsapp:webhook --workspace bff  # what Meta calls today; -- --url <https://…> points it there (tunnel or prod)
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
