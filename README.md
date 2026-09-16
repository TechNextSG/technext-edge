# technext-edge

BFF and AI Extractor for Casa Escondida, per the [Core & Edge Blueprint](../casa-escondida-tools)
premise: Odoo is the brain, this is the edge. Drafts never enter Odoo — see
`docs/adr/` for the signed decisions this repo builds on.

**Status:** early scaffold for the Extractor pod's demo. `packages/extractor/`
is real and tested; `apps/casa-bff/` exposes it over HTTP but the Draft store,
Contract pod's generated Odoo client, and the other BFF endpoints from the
Playbook do not exist here yet.

## Layout

```
packages/
  extractor/     Trip schema (zod), date/house-norm post-processing, provider
                 adapters, eval-ready pipeline. See its own tests for the
                 guarantees it makes (never fabricates, evidence is verbatim,
                 dates are never trusted from the model).
apps/
  casa-bff/      Hono app, one route: POST /v1/extract.
docs/adr/        ADR-005a: why Gemini is the demo default and not a decision.
api/index.ts     Vercel entry point — lives at the repo root, not inside
                 apps/casa-bff, so a root-level `vercel deploy` uploads the
                 whole workspace (packages/extractor included) instead of
                 just the app subtree. See vercel.json for the /v1 rewrite.
```

## Run it

```bash
npm install
npm test                 # extractor unit tests, no API key needed
cp .env.example .env.local   # fill in GEMINI_API_KEY
npm run dev:bff          # http://localhost:8787/v1/extract
```

## Deploy

Always run Vercel commands from the **repo root** — the deploy target is a
monorepo and the entry point (`api/index.ts`) depends on `packages/extractor`
outside `apps/casa-bff`.

```bash
vercel link               # first time only — links to technext-edge-casa-bff
vercel env add GEMINI_API_KEY production
vercel env add GEMINI_API_KEY preview
vercel deploy             # preview
vercel deploy --prod      # production
```

## Before this becomes the real Extractor pod deliverable

1. Swap `packages/extractor/src/schema.ts` for the type generated from
   Phillip's frozen `contracts/casa/estimate-api.v1.yaml` — it is a
   placeholder guess right now, flagged inline.
2. Confirm the real 4 house-norm fields and their default values with
   Jett/Eloa — `houseNorms.ts` is guessed.
3. Run the eval harness (not built yet) against the 30 real messages once
   Eloa provides them, across the Gemini adapter here plus a Claude and a
   GPT-5.1 adapter (same `ExtractProvider` interface) — then write ADR-005b.
