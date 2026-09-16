# technext-edge

BFF and AI Extractor for Casa Escondida, per the [Core & Edge Blueprint](https://casa-escondida-estimator-tools.vercel.app/)
premise: Odoo is the brain, this is the edge. Drafts never enter Odoo — see
`docs/adr/` for the decisions this build is based on.

**New here? Read [docs/01-team-guide.md](docs/01-team-guide.md)** — full
handoff: prerequisites, running locally, the test console, deploying, env
vars, the eval harness, and the gotchas that already cost an afternoon once.

## 30-second version

- `packages/extractor/` — Trip schema (zod), date/house-norm post-processing,
  provider adapters (Gemini, DeepSeek), eval-ready pipeline. Real and tested.
- `apps/casa-bff/` — Hono app: `POST /v1/extract` plus a test console at `/`.
  Deployed at **https://technext-edge-casa-bff.vercel.app**.
- `packages/extractor/eval/` — scores against the Playbook's 5 thresholds.
  Ships with a researched-but-synthetic dataset; real decisions wait for
  Eloa's 30 real messages.
- `docs/adr/ADR-005a-extractor-model.md` — why Gemini is the demo default,
  not a decision, and every real finding from testing so far (DeepSeek dry
  run, the Gemini free-tier quota blocker).

**Status:** early scaffold for the Extractor pod's demo. The Draft store,
the Contract pod's generated Odoo client, and the rest of the BFF endpoints
from the Playbook do not exist here yet.

## Run it

```bash
npm install
npm test                     # extractor unit tests, no API key needed
cp .env.example .env.local   # fill in GEMINI_API_KEY
npm run dev:bff              # http://localhost:8787
```

## Deploy

Always run Vercel commands from the **repo root** — see
[docs/01-team-guide.md](docs/01-team-guide.md#5-deploying) for why and for
the full command sequence.

```bash
vercel link
vercel env add GEMINI_API_KEY production
vercel env add GEMINI_API_KEY preview
rm -rf .vercel/output && vercel build --yes --target production
vercel deploy --prebuilt --prod --yes
```
