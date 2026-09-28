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

## Update 2026-09-27 — rebuilt from `Stage1_Estimator_Tools@dac70e6`, and it works end to end

The old fixture was built from `main@4c48918`, where `POST /api/estimates` returned no `id` and set
no `ubg_sid`. That is why publishing was impossible: there was no scenario to commit or share. The
fixture is now rebuilt from the current Stage1 branch, and `POST /api/estimates` returns both — so
`PATCH`, `commit` and `share` all work and the guest link opens.

**How to rebuild it** (nothing of theirs is committed or modified; the wrapper lives outside the
repo at `E:\casa-estimator-fixture`):

```powershell
# 1. their code, at the branch we want to demo
cd E:\casa-stage1-walk
git fetch origin --prune
git checkout -B stage1-fixture origin/Stage1_Estimator_Tools
npm install
npm run build:app -w bff                     # -> bff/app/dist (their SPA, serves /quote/<token>)

# 2. bundle the function (esbuild resolves their `.ts` specifiers at build time)
cd E:\casa-estimator-fixture
npx esbuild entry.ts --bundle --platform=node --format=esm --target=node22 --outfile=api/index.js
Copy-Item E:\casa-stage1-walk\bff\app\dist\* -Destination . -Recurse -Force

# 3. deploy into the existing project, so the alias does not change
npx vercel link --yes --project tn-casa-estimator-fixture --scope aidev1-technexts-projects
npx vercel deploy --prod --yes
```

Three things that are easy to get wrong, all of them found by deploying and reading the logs:

1. **`SESSION_SECRET` is required even in fixture mode** (`bff/src/env.ts`: *"Bắt buộc ở MỌI chế độ,
   kể cả FIXTURE_MODE=1"*). Missing it is a 500 with `Thiếu hoặc sai biến môi trường: SESSION_SECRET`
   on every route. It is set as a Secret on the project; `FIXTURE_MODE=1` is the only other variable.
2. **The entry must export HTTP methods and NOT a default export.** With both, Vercel prefers the
   default, calls it as `(req, res)`, discards the returned `Response` and the request times out —
   its own runtime log says so. Reached that way, Hono also fails with
   `c.req.raw.headers.get is not a function`.
3. **No `DATABASE_URL` means the in-RAM store**: their own warning is logged on every cold start
   ("mọi bản nháp, phiên bản, link chia sẻ … sẽ MẤT khi tiến trình khởi động lại"). Fine for a demo
   session; a long-lived fixture would want Postgres.

### What their repo still needs (two small fixes, both in `bff/`)

- every relative import in `bff/src/*.ts` carries a `.ts` extension — Vercel's function tracer does
  not resolve those, so their own `api/index.ts` 500s with `ERR_MODULE_NOT_FOUND` when deployed as-is;
- `api/index.ts` sets `config.runtime = 'nodejs'` while exporting `handle(app)` from `hono/vercel`,
  which the Node runtime ignores. Either drop the `config` (so it runs on the Edge runtime, where
  `handle` is right) or export named HTTP methods.

Both are one-line-per-file changes, and neither shows up under `tsx` locally — which is exactly why
this note exists instead of a guess.

### One more thing to know before demoing the price

Their fixture gateway **does not compute prices**: `bff/src/odoo/fixture.ts` says *"Không có logic giá
ở đây"* and returns a captured response cloned, chosen by trip shape (`pickCompute`). So with
`ESTIMATOR_MODE=remote` a room-type or dive-day edit changes the **payload and the frozen revision**
but not the number (the couple stays 31,200). To show the money following the trip, run our
`simulated` port, which implements their `rates.json` arithmetic.

**The trap that follows from it, found by walking the demo.** `pickCompute` sends any retail enquiry
with diving and no course to `compute.retail-couple.json`, which is *a specific booking*: 2 guests
named Ana and Ben, 20–22 Nov 2026, room "Standard A", ₱31,200. A demo message about four guests in a
deluxe room therefore produced a guest link showing two strangers on other dates — the screen
contradicting the conversation at the exact moment the conversation was what was being demonstrated.

So the demo message is written to the **same shape as the capture** (2 guests, 20–22 Nov, 2 nights,
Ana travelling with Ben). Everything then agrees — label `Ana — 2 nights`, guests Ana and Ben, the
right dates, and the frozen revision carries `rooms: r1:deluxe` because that is what our payload says
— **except one line**: the priced line still reads `Standard A — 2 nights, ₱7,600`, because the
gateway replays a capture instead of pricing the trip.

That one remaining difference is the honest thing to say out loud, and it is worth more than a demo
that appears to match: *"the revision carries the deluxe room the guest asked for; the price line is
still the captured standard one, because this gateway does not recompute. On real Odoo this line is
Deluxe — ₱3,600 more per night."*
