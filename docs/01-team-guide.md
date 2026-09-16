# Team guide — technext-edge

Full handoff for anyone touching this repo: what it is, how to run it, how to
test it, how to deploy it, and the gotchas that already cost an afternoon
once. Read this before non-trivial edits; skim [README.md](../README.md)
first if you just want the repo running in 5 minutes.

## 1. What this is, in one paragraph

This is the **Edge** layer from the [Core & Edge Blueprint](https://casa-escondida-estimator-tools.vercel.app/):
Odoo owns prices, folios, invoices; this repo is everything outside that. Today
it holds exactly one working piece — the **AI Extractor** (`packages/extractor/`)
behind a minimal BFF (`apps/casa-bff/`), exposed as `POST /v1/extract`. The
Draft store, the Contract pod's generated Odoo client, and the rest of the BFF
endpoints from the Playbook do not exist here yet. See `docs/adr/` for the
decisions this build is actually based on — the [Blueprint](https://casa-escondida-estimator-tools.vercel.app/)
and [Playbook](https://casa-escondida-estimator-tools.vercel.app/) sites hold
the reasoning behind them.

## 2. Prerequisites

- Node ≥ 18 (developed against Node 22)
- The Vercel CLI (`npm i -g vercel`) — keep it current; an old CLI talking to
  a newer backend silently breaks `vercel inspect`/`vercel logs` (see §6).
- Access to the `aidev1-technexts-projects` Vercel scope, or your own scope if
  you're standing up a separate deployment.
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/) for
  local runs — **the free tier caps at 20 requests/day and a tight per-minute
  burst limit** (see ADR-005a). Fine for a handful of manual tests, not
  enough for a real eval run.

## 3. Running it locally

```bash
git clone https://github.com/TechNextSG/technext-edge.git
cd technext-edge
npm install
npm test                     # extractor unit tests — no API key needed, no network
```

To actually call a model:

```bash
cp .env.example .env.local   # fill in GEMINI_API_KEY
npm run dev:bff              # http://localhost:8787
```

Open `http://localhost:8787/` for the test console (see §4), or curl it:

```bash
curl -s localhost:8787/v1/extract -H 'content-type: application/json' \
  -d '{"text":"4 of us, next Saturday, 3 nights"}'
```

## 4. The test console (`GET /`)

A plain page — **not the real estimator UI** (that belongs to the Edge UI
pod) — for trying extraction without curl or Postman. Live at
**https://technext-edge-casa-bff.vercel.app/**. Visual identity matches
`apps/estimate-tool` in `casa-escondida-tools` (same fonts/tokens) on purpose.

It's behind Vercel's Deployment Protection (SSO wall) — anyone hitting the
bare URL without a session sees a login page, not the app. To get in, open
this once per browser (sets a cookie for that browser):

```
https://technext-edge-casa-bff.vercel.app/?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true
```

Ask in the team channel for the current bypass secret (`vercel project
protection <project-name> --json` shows it if you have project access). It's
an infra token, not a user credential, but still don't paste it somewhere
public — rotate it (`vercel project protection disable/enable ... --protection-bypass`)
if it ever looks exposed.

The **provider override** panel on the page lets you paste your own key and
pick a different provider (Gemini / DeepSeek Flash / DeepSeek Pro) for one
request, without touching any Vercel config. The key goes straight from your
browser to this server and nowhere else — kept in that tab's session storage
only, cleared when the tab closes.

## 5. Deploying

**Always run Vercel commands from the repo root**, never from `apps/casa-bff/`.
The deploy entry point is `api/index.ts` at the root — it imports
`packages/extractor` by relative path, so a deploy triggered from inside
`apps/casa-bff/` uploads only that subtree and 404s on the extractor package
during install (this happened; see the commit history around 2026-09-16 if
you want the play-by-play).

```bash
vercel link                       # first time only
vercel env add GEMINI_API_KEY production
vercel env add GEMINI_API_KEY preview

rm -rf .vercel/output
vercel build --yes --target production
vercel deploy --prebuilt --prod --yes
```

Building locally first (`vercel build` then `--prebuilt`) is the reliable
path — a plain `vercel deploy --prod` works too but gives you nothing to
inspect if something goes wrong mid-build. If a deploy sits at "Building…"
for what feels like too long, don't assume it's slow — check `vercel logs
<deployment-url>` first; a 429/quota error, a bad commit-author check, and a
genuine hang all look identical from the outside (see §6).

## 6. Environment variables

| Variable | Where | Required | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | Production + Preview | if `EXTRACTOR_PROVIDER` is unset or `gemini` | Free tier is not enough for a real eval run — see ADR-005a. |
| `GEMINI_MODEL` | optional | no | Defaults to `gemini-2.5-flash`. Verify against [ai.google.dev](https://ai.google.dev/gemini-api/docs/models) before changing — names in this family move fast. |
| `EXTRACTOR_PROVIDER` | optional | no | `gemini` (default) \| `deepseek-flash` \| `deepseek-pro`. Picks the server's default provider. |
| `DEEPSEEK_GATEWAY_KEY` | optional | if `EXTRACTOR_PROVIDER` is a DeepSeek value | Your personal LiteLLM gateway key (Railway) — ask Anthony for one. $12 budget per person, shared across everything you use it for, not just this repo. |
| `DEBUG_EXTRACT` | optional, dev only | no | `1` includes zod issues / stack traces in error responses. Remove after debugging — don't leave it on. |

You don't need to touch env vars at all to try a different provider for one
request — see the per-request override in §4 and §7.

## 7. Running the eval harness

`packages/extractor/eval/` scores against the Playbook's five thresholds
(fabrication, required-field accuracy, verbatim evidence, latency; question-
targeting needs a human pass, not wired up). Full details in
[`eval/README.md`](../packages/extractor/eval/README.md) — the two rules that
matter most:

- **`dataset.synthetic.json` decides nothing.** It's researched but made up.
  Real decisions wait for `dataset.real.json` (Eloa's 30 real, name-masked
  messages — gitignored once it exists, since it'll carry real guest text).
- **Every result gets read against the actual thresholds, not vibes.** A
  fabricated field is an automatic disqualifier regardless of how good
  everything else looks.

```bash
export EVAL_BYPASS_SECRET=<bypass secret from §4>
node packages/extractor/eval/runner.mjs                    # server's default provider

# test a specific provider without touching Vercel config:
export EVAL_PROVIDER_API_KEY=<your key for that provider>
node packages/extractor/eval/runner.mjs --provider deepseek-flash
```

(PowerShell: `$env:EVAL_BYPASS_SECRET="..."` instead of `export`.)

## 8. Known gotchas, so you don't rediscover them

- **`vercel.json` needs `"framework": null`.** Without it, Vercel's Hono
  auto-detection expects an `index.ts`/`app.ts` at the repo root or `src/`
  and fails with "No entrypoint found" — conflicts with the `api/` +
  rewrites layout used here.
- **Root `package.json` needs `"type": "module"`.** Without it, the deployed
  function's ESM `import` syntax gets loaded as CommonJS and crashes with
  `SyntaxError: Cannot use import statement outside a module` — even on
  `GET /healthz`, which doesn't touch the extractor at all.
- **Vercel's function bundler doesn't reliably resolve the npm-workspace
  symlink at runtime.** `@technext-edge/extractor` typechecks and builds
  fine locally, then 404s at runtime with `ERR_MODULE_NOT_FOUND` in the
  deployed Lambda. `apps/casa-bff/src/app.ts` imports the package by
  relative path into `packages/extractor/src` instead — sidesteps the
  symlink resolution entirely.
- **The git commit's author matters, even for a plain `vercel deploy`
  (no GitHub integration configured).** Vercel checks commit-author
  permissions against the project owner on Hobby plans; a mismatched local
  git identity gets silently stuck ("Deployment Blocked — commit author did
  not have contributing access"), which looks identical to a hung build from
  the outside. Make sure `git config user.email` matches an account that
  actually has access before you spend twenty minutes debugging a "stuck"
  deploy that was never building at all.
- **A transport failure (rate limit, 5xx) and a validation failure (model's
  JSON doesn't match the schema) are different problems** — `extract()`
  throws different error types for each, and `app.ts` maps them to different
  HTTP statuses (429 vs 422). If you're extending the pipeline, keep that
  distinction; collapsing them back into one generic error is what made a
  Gemini quota error read as "the model can't parse this message" during the
  eval dry run.

## 9. Before this becomes the real Extractor pod deliverable

1. Swap `packages/extractor/src/schema.ts` for the type generated from
   Phillip's frozen `contracts/casa/estimate-api.v1.yaml` — it's a
   placeholder guess right now, flagged inline in the file.
2. Confirm the real 4 house-norm fields and their default values with
   Jett/Eloa — `houseNorms.ts` is guessed.
3. Get billing enabled on the Gemini API key (see §2, ADR-005a) — the free
   tier cannot run a 30-message × multiple-provider bake-off at all.
4. Once Eloa's 30 real messages exist, drop them into
   `packages/extractor/eval/dataset.real.json` and run the same harness —
   the result becomes ADR-005b.
