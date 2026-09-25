# Upstream note: their BFF does not deploy to Vercel as-is

**Status:** discovered 2026-09-25 by actually deploying it. Not their bug to guess at — it is a
concrete, reproducible blocker, and this note is what to hand them.

**Repo:** `TechNextSG/tn-casa-quotation-estimator` · `main` @ `4c48918`

## What breaks

`bff/vercel.json` exists and looks ready (`build:app`, function `api/index.ts`, rewrites), but
pushing it to Vercel produces a function that 500s. Two independent causes:

1. **Every relative import in `bff/src/*.ts` carries a `.ts` extension**
   (`import { createApp } from '../src/app.ts'`, `import { fillTrip } from './trip/fill.ts'`, …).
   `tsx` runs these locally, but Vercel's Node function tracing does not resolve `.ts`
   specifiers, so the compiled `api/index.js` is left importing `../src/app.ts` at runtime and
   dies with `ERR_MODULE_NOT_FOUND`. The fix is the standard ESM one — `.ts` → `.js` in import
   specifiers (esbuild then resolves `.js` → the `.ts` source during bundling).

2. **`api/index.ts` sets `config.runtime = 'nodejs'` but exports `handle(app)` from
   `hono/vercel`.** On the Node runtime Vercel invokes the default export as `(req, res)` and
   discards its return value; `hono/vercel`'s `handle` returns a Web `Response`. Result: the
   handler returns immediately with a `Response` that Vercel ignores, nothing is written to `res`,
   and the request times out after `maxDuration`. Vercel's own warning says the fix is to export a
   `fetch` function or named HTTP methods (`export function GET(request) { return app.fetch(request) }`)
   — which is what a working deployment has to do.

Neither of these shows up under `tsx` dev, which is why the repo can have a Vercel config that has
never actually deployed.

## What we did instead (temporary, for the demo)

We did not modify their repo. We bundled `bff/api/index.ts` with esbuild into a single
self-contained function, added a thin web-style entry that exports named `GET`/`POST`/… delegating
to the same `createApp`, and deployed that under our own Vercel team as
`tn-casa-estimator-fixture` (env `FIXTURE_MODE=1`). Their `fillTrip`, `redactForRole` and fixture
gateway run **unchanged** — the only wrapper is the export shape.

This is a demo deployment of **their** code and is for sample data only. When they deploy their own
BFF (real Odoo, after Phillip issues keys), point `ESTIMATOR_BASE_URL` at that instead; nothing
else on our side changes.
