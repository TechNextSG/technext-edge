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
vercel deploy --prebuilt --prod --yes --scope aidev1-technexts-projects
```

**`deploy` needs `--scope aidev1-technexts-projects`; reads do not.** Without it the CLI
answers `Error: Not authorized` while `vercel whoami` and `vercel project ls` both succeed
on the same login (measured 2026-09-19) — the read side resolves the team from
`.vercel/project.json`, the write side wants it named. It fails after printing
`Deploying technext-edge-casa-bff`, so it reads like a permissions problem on the project
and is not one.

Building locally first (`vercel build` then `--prebuilt`) is the reliable
path — a plain `vercel deploy --prod` works too but gives you nothing to
inspect if something goes wrong mid-build. If a deploy sits at "Building…"
for what feels like too long, don't assume it's slow — check `vercel logs
<deployment-url>` first; a 429/quota error, a bad commit-author check, and a
genuine hang all look identical from the outside (see §6).

**Rebuild before every `--prebuilt` deploy, and read the build's TypeScript output.**
`vercel build` writes `.vercel/output` and exits `0` even when its type-check fails,
and `vercel deploy --prebuilt` then ships whatever is in that directory. Skip the
rebuild and you deploy the *previous* source under a new URL — which is exactly what
happened here: production served a build with no `/v1/converse`, no `/v1/health` and
no WhatsApp route until 2026-09-18, and nothing in the deploy output said so. The
error itself was one line (`Promise.prototype.finally` missing from the lib Vercel
type-checks with, because it does not read this repo's `tsconfig.json`), so:

```powershell
Remove-Item -Recurse -Force .vercel/output
npx vercel build --yes --target production 2>&1 | Select-String 'error TS'
npx vercel deploy --prebuilt --prod --yes --scope aidev1-technexts-projects
```

A non-empty `error TS` line means the build is not the build you think it is. Fix the
code rather than deploying around it — `npm run typecheck` at the repo root uses this
repo's tsconfig and can be green while the deployment build is not.

## 6. Environment variables

| Variable | Where | Required | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | Production + Preview | if `EXTRACTOR_PROVIDER` is unset or `gemini` | Free tier is not enough for a real eval run — see ADR-005a. |
| `GEMINI_MODEL` | optional | no | Defaults to `gemini-2.5-flash`. Verify against [ai.google.dev](https://ai.google.dev/gemini-api/docs/models) before changing — names in this family move fast. |
| `EXTRACTOR_PROVIDER` | optional | no | `gemini` (default) \| `deepseek-flash` \| `deepseek-pro`. Picks the server's default provider. |
| `DEEPSEEK_GATEWAY_KEY` | optional | if `EXTRACTOR_PROVIDER` is a DeepSeek value | Your personal LiteLLM gateway key (Railway) — ask Anthony for one. $12 budget per person, shared across everything you use it for, not just this repo. |
| `DEBUG_EXTRACT` | optional, dev only | no | `1` includes zod issues / stack traces in error responses. Remove after debugging — don't leave it on. |
| `WHATSAPP_VERIFY_TOKEN` | Production + Preview | only for the WhatsApp channel | A string you invent, then paste into the Meta app dashboard *and* here. Meta never issues it — it just echoes it back on the one-time GET handshake. |
| `WHATSAPP_APP_SECRET` | Production + Preview | only for the WhatsApp channel | Meta app secret. Verifies `X-Hub-Signature-256` on every inbound message; with it unset the webhook 500s rather than trusting whoever finds the public URL. |
| `WHATSAPP_ACCESS_TOKEN` | Production + Preview | only for the WhatsApp channel | **System user token** (never expires) for the phone number — §6 explains how to mint one. Without it the webhook still acks Meta but cannot reply to the guest. |
| `WHATSAPP_PHONE_NUMBER_ID` | Production + Preview | only for the WhatsApp channel | The WhatsApp Business phone number's **ID**, not the number. |
| `WHATSAPP_APP_ID` | optional, dev only | no | Read only by `scripts/whatsapp-check.mjs`: paired with the app secret it calls `debug_token`, the only way to confirm the access token never expires — and it is what `--exchange-token` needs. |

You don't need to touch env vars at all to try a different provider for one
request — see the per-request override in §4 and §7.

### The WhatsApp webhook (`/v1/channels/whatsapp/webhook`)

`apps/casa-bff/src/whatsapp.ts` is the entire Meta Cloud API integration — no
SDK, one HMAC check on the way in and one POST to `graph.facebook.com` on the way
out. Configuring it is **three** things in the dashboard, and the third is easy to
leave off because nothing complains until a guest is already waiting:

- **Callback URL**: `https://technext-edge-casa-bff.vercel.app/v1/channels/whatsapp/webhook`
- **Verify token**: the same string you put in `WHATSAPP_VERIFY_TOKEN`
- **Đính kèm chứng thực máy khách** / *attach client credentials*: **on**. Left off,
  Meta sends the POSTs unsigned and the HMAC check below answers `401` to every one of
  them — the app looks configured, the handshake passed, and no message is ever seen.

Both halves are wired to production now (2026-09-18): `vercel env ls production` lists
the four `WHATSAPP_*` variables, the URL above answers the handshake, and
`whatsapp:sim --url https://technext-edge-casa-bff.vercel.app` ends 8/8. Meta is
pointed there, so a phone test needs no laptop and no tunnel; reach for the tunnel
only while iterating on `apps/casa-bff/src/`, then point Meta back. Three commands
cover both directions:

```bash
npm run whatsapp:webhook --workspace apps/casa-bff                                        # what Meta calls today
npm run whatsapp:webhook --workspace apps/casa-bff -- --url https://abc.trycloudflare.com  # a tunnel, for local work
npm run whatsapp:webhook --workspace apps/casa-bff -- --url https://technext-edge-casa-bff.vercel.app
```

That script is the API behind the three dashboard fields below, and it exists because
a free tunnel URL changes on every restart. It reads the current subscription, posts
the new callback URL **keeping the same field list** (a POST to that endpoint replaces
it), reads it back, and subscribes the WABA when `--waba-id`/`WHATSAPP_WABA_ID` is set.
Meta runs the handshake inside the POST, so a URL that cannot answer fails right there,
while the server is still up to fix it. Two traps it encodes, both worth more than the
script: `POST /<app id>/subscriptions` answers `400 Unsupported post request. Object
with ID … does not exist` when its parameters arrive as a form body — the same call with
them in the query string answers `{"success":true}`; and `vercel env add` does **not**
strip quotes, unlike Node's `.env.local` parsing, so the quoted `WHATSAPP_ACCESS_TOKEN`
described below is stored *with* its `"` and every send on that deployment answers
`401 #190`. Pipe the value through Node rather than copying the line:

```powershell
node -e "process.loadEnvFile('.env.local'); process.stdout.write(process.env.WHATSAPP_ACCESS_TOKEN)" |
  npx vercel env add WHATSAPP_ACCESS_TOKEN production --force
```

Reading that back from inside the deployment is what `GET
/v1/channels/whatsapp/status` is for (below) — presence is not validity, and a quoted
token is present.

Meta calls the GET half once to prove you own the URL, then POSTs each message
with an `X-Hub-Signature-256` header that must match `WHATSAPP_APP_SECRET`. A
POST failing that check is answered `401` before anything is extracted or sent —
the endpoint is public, so the signature is the only thing deciding who gets to
make the extractor answer as Casa.

Saving that callback URL does **not** subscribe this app to the WhatsApp Business
Account, and an app that is not subscribed is never handed a message: the dashboard
shows a green, saved, verified webhook while every guest message goes somewhere else.
It is a second, separate call — the one place `curl` is still the shortest path,
because the id in the URL is the WABA's, not the phone number's:

```bash
curl -sS -X POST "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN"      # {"success":true}
```

That block has a trap of its own. `WHATSAPP_ACCESS_TOKEN` in `.env.local` is written
**quoted** — `WHATSAPP_ACCESS_TOKEN="EAA…"`, the way Vercel CLI left it — and it is the
one value there anyone copies by hand. Node's `process.loadEnvFile` strips those quotes,
so the app and both scripts read the token correctly, but the same token pasted into
`curl` or `Invoke-WebRequest` carries the `"` and Meta answers
`401 {"message":"Authentication Error","code":190}` — the answer an expired token gives,
down to the hint `whatsapp:check` prints for it. Strip the quotes before believing a
fresh token is dead, or let Node read the file itself:

```powershell
node --env-file=.env.local -e "console.log(process.env.WHATSAPP_ACCESS_TOKEN.length)"
```

Both halves are readable, so a silent webhook can be split into "never configured"
and "never subscribed" without waiting for a guest to be ignored — `whatsapp:check`
reads them when it is handed the ids to look them up with:

```bash
npm run whatsapp:check --workspace apps/casa-bff -- --app-id <app id> --app-secret <32 hex> --waba-id <waba id>
# FAIL the app has a whatsapp_business_account webhook subscription  -> callback URL/verify token never saved, or client credentials left off
# FAIL the app is subscribed to WABA <id> (inbound messages reach this server)  -> the POST above
```

Neither failure can reach `whatsapp:sim`, which signs and sends its own request: the
simulator stays 8/8 with a callback URL that points nowhere. Read those two lines, not
the simulated score, whenever replies stop arriving.

Four things worth knowing before you demo it:

- **Free-form replies only last 24h.** Text sent more than 24h after the guest's
  last message needs a pre-approved template, which this adapter does not send
  yet. Longer silences need the template work first.
- **Conversation memory is in-process** (`conversationStore.ts`) and therefore
  per serverless instance — fine for a demo, not for guests relying on it. The
  Redis/Key Value backing store behind that same interface is the next step.
  Handoff state (below) is in the same map, so a redeploy forgets it too.
- **A failed reply still returns 200 to Meta on purpose.** Meta redelivers any
  non-2xx for days, so the handler dedupes by message id and reports failures in
  the response body (`{ received, replied, duplicates, failed, handoffs }`) and the
  logs. Please don't "fix" that into a 500 — it turns one hiccup into a double
  reply. A turn also has a deadline (`WHATSAPP_TURN_TIMEOUT_MS`, default 20s): a
  turn that outlives it is abandoned, and — since 2026-09-18 — the guest is sent a
  static apology while its claim stays taken, so Meta's redelivery is a duplicate
  rather than a second message. §8 has the incident behind the deadline itself.
- **No guest is left in silence, and that costs a thread.** When a turn fails, when
  the guest asks for a person, or when the bot has asked `ASK_LIMIT` times and the
  enquiry is still incomplete, the thread is *parked*: the guest gets one static
  sentence saying a person has it, and **no model is called on that thread again**
  until someone hands it back — deliberately, so a bot cannot talk over the human.
  Read the list and hand one back with:

  ```bash
  npm run whatsapp:threads --workspace apps/casa-bff                     # who is waiting
  npm run whatsapp:threads --workspace apps/casa-bff -- --resume 639171234567
  ```

  The same two things over HTTP are `GET /v1/channels/whatsapp/threads` and
  `POST /v1/channels/whatsapp/threads/<phone>/resume`, both guarded by
  `x-verify-token` (the verify token — no new secret). `GET
  /v1/channels/whatsapp/status` answers the other half of "why is nothing arriving":
  whether *this deployment's* credentials can still read the phone number back from
  Graph, which is a different question from whether the values are present.

To exercise all of that without a Meta app, `apps/casa-bff/scripts/whatsapp-sim.mjs`
signs requests exactly like Meta does — start the server with any dummy values,
then run the simulator:

```powershell
$env:WHATSAPP_APP_SECRET='local-app-secret'; $env:WHATSAPP_VERIFY_TOKEN='local-verify-token'; npm run dev:bff
npm run whatsapp:sim --workspace apps/casa-bff      # 8 checks, exit 0 when all pass
```

It asserts the handshake (right and wrong verify token), a missing signature, a
body that does not match its signature, a read receipt, a guest message, a
redelivered `wamid`, and a follow-up on the same thread. `replied: 0, failed: 1`
is the expected local result with a dummy access token: the turn ran, the send to
Meta was refused, and the log line shows Meta's own error.

Add `-- --from 84359386414` **and** a real `WHATSAPP_ACCESS_TOKEN` /
`WHATSAPP_PHONE_NUMBER_ID` and the replies go out on that phone's WhatsApp: that run ends
`replied: 2, failed: 0`, which means Meta **accepted** both replies — not that they were
delivered, which only the `statuses` webhook says (step 7). The sending half needs no
public URL, only the receiving half does. Two things have to be true first, and both
only surface at the send: the number has to be **registered** for Cloud API (`133010`
until it is) and, while that number is still Meta's test number, the recipient has to
be on its **allowed list** (`131030` until it is).
`whatsapp:check` reads the first one back (`platform_type`), so a green line there
retires `133010` for good; the allowed list is dashboard-only with no read API at all,
which is how a `131030` hides behind an otherwise perfect run. They are steps 4 and 6 of
[The demo morning](#the-demo-morning) respectively, and step 6 carries the picker path
plus the one code worth telling `131030` apart from. For the full loop without deploying,
run `ngrok http 8787` and hand the tunnel URL to Meta — and redo that every session,
because the free URL changes on every restart, which is the whole reason the next
command exists:

```bash
npm run whatsapp:webhook --workspace apps/casa-bff -- --url https://<tunnel>
```

It sets the callback URL, reads it back, and finishes with the subscription in the
section above — a tunnel on its own routes nothing. (It also puts the URL back:
`-- --url https://technext-edge-casa-bff.vercel.app` is the honest state, because a
dead tunnel left in Meta's config loses guest messages silently.)

### Getting the credentials — and why the token has to be a system user token

The Meta dashboard hands out a **temporary access token** (24h) first, because it
is the shortest path to a first "hello world". It is the wrong thing to put in
Vercel: nothing announces the expiry, the webhook keeps acking Meta, and guests
just quietly stop getting replies until someone reads the log and finds Meta's
`code 190`. Mint a token that does not expire instead:

0. **First pick the business portfolio that will own the WhatsApp assets — this
   is the one irreversible choice in the list.** A WABA belongs to exactly one
   portfolio and Meta does not let you move it afterwards, and a system user
   token can only carry assets from the portfolio the system user lives in
   (which is the entire reason step 2 exists). So:
   - If the app-creation wizard stops at the **Doanh nghiệp** step saying no business
     portfolio exists yet ("Chưa có doanh nghiệp nào"), that is this same decision
     arriving early, not an error: create the portfolio right there
     (`business.facebook.com/create` — free, self-serve) and refresh the wizard.
     It does not have to be *verified*; verification is a separate, later step that
     gates live sending and higher messaging limits, not the test number.
   - If Meta refuses to create a portfolio because the email domain already has
     one ("Chúng tôi tìm thấy một hoặc nhiều tài khoản Trình quản lý kinh doanh
     khác có cùng miền email …"), that is not an error to work around — get
     added to the existing portfolio instead (`business.facebook.com/settings` →
     **Users → People → Add** by its admin, role **Admin**, because creating
     system users and assigning apps needs it).
   - Whatever portfolio you create the WABA in is where it stays, so don't build
     it under a personal portfolio "just to test" — a later move means creating
     the WABA again and re-registering the phone number (a number can only be
     registered to one WABA at a time).
   - The app has to be in that same portfolio too; `--app-id` in the check below
     is what proves the token really carries both.
1. `business.facebook.com/settings` → **Users → System users → Add** — name it
   something like `casa-bff-bot`, role **Employee** (Admin only if it also needs
   to manage other people's access).
2. **Assign assets** → **WhatsApp Accounts** → pick the one from API Setup →
   **Manage** (full control) → Save. Skipping this is the classic failure: the
   token looks healthy, then the first send dies with `code 200`.
3. **Generate new token** → pick the app → expiration **Never** → tick
   `business_management`, `whatsapp_business_messaging`,
   `whatsapp_business_management` → Generate. Meta shows the value once.
4. Paste it into `WHATSAPP_ACCESS_TOKEN`. The other two come from the app
   dashboard: `WHATSAPP_PHONE_NUMBER_ID` is the ID next to the "From" picker
   (not the number) and `WHATSAPP_APP_SECRET` is under App settings → Basic.

Before testing anything, check the credentials against the real Graph API —
`whatsapp:check` proves the token works, that `expires_at=0` (never expires), that
it carries `whatsapp_business_messaging`, and that it is actually scoped to the
WhatsApp account:

```bash
npm run whatsapp:check --workspace apps/casa-bff -- --app-id <App ID> --app-secret <app secret>
```

Exit code 0 means the sending half will work; each failure prints Meta's own error
code plus the one-line meaning of that code. `--app-id`/`--app-secret` are optional
but they enable the `debug_token` half, without which the run cannot tell a durable
token from a 24h one.

If a demo lands before the portfolio access does, `--exchange-token` is the bridge: it
trades the 24h token from API Setup for a long-lived one (~60 days) and writes it into
`.env.local` for you, never printing it. It still fails the *never expires* line above —
deliberately, with the exact date the token dies printed beside it — so treat it as a
stopgap: a refreshed credential is not an owned one. The exchange needs the App ID and
app secret, cannot revive an already-expired token, and has to be run again before that
date.

Put all four values — plus `WHATSAPP_APP_ID`, which `whatsapp:check` wants for
`debug_token` and `--exchange-token` cannot run without — in the **repo-root**
`.env.local`. `npm run dev` loads
`apps/casa-bff/.env.local` first and the root one second, and the app-local file is the
one `vercel env pull` rewrites — it has already wiped this block once.

A system user token has no expiry date but is not immortal: resetting the app
secret, deleting the system user, or unassigning the WhatsApp account all kill it.


### The demo morning

In this order, because each step is what makes the next one meaningful:

1. All four values, plus `WHATSAPP_APP_ID`, in the **repo-root** `.env.local` —
   step 2 cannot exchange anything without the App ID.
2. `npm run whatsapp:check --workspace apps/casa-bff -- --exchange-token` — expect
   `~60 days` plus the line naming the file it wrote. The *never expires* line failing
   here is expected, not a bug.
3. **Restart the dev server.** `tsx watch` reloads on `src/` changes but reads
   `.env.local` exactly once, at boot, so a token written after it started is invisible
   to the running process; saving any file in `apps/casa-bff/src/` restarts it for free.
4. **Register the number for Cloud API — this one is API-only.** There is no button for
   it in WhatsApp Manager, and a healthy token says nothing about it: until the number
   is registered every send answers `400 (#133010) Account not registered`, which looks
   exactly like a credentials problem and is not one.

   ```bash
   npm run whatsapp:check --workspace apps/casa-bff -- --register --pin 202609
   ```

   That flag *is* the documented `POST /<phone-number-id>/register` call, run with the
   token from the env file instead of one pasted into a shell — the same reason
   `--exchange-token` writes the token rather than printing it. Without the flag the
   script still reads the registration back, as
   `the number is registered for Cloud API (platform_type CLOUD_API)` — the check that
   would have caught this before the first send did.

   The PIN is the number's 6-digit two-step verification PIN — if the number already has
   two-step verification, it is that existing PIN, not a new one; otherwise this call
   sets it, so record it. Meta allows 10 registration requests per number per 72h and
   then answers `133016`, so don't retry a rejected call in a loop. The call needs
   `whatsapp_business_management` + `whatsapp_business_messaging`; the token minted in
   step 3 of the section above carries both. `{"success":true}` is the answer, and the
   independent proof it took is `GET /<phone-number-id>?fields=platform_type` flipping
   `NOT_APPLICABLE` → `CLOUD_API`.
5. **Turn the receiving half on — every session, not just the first one.** `ngrok http
   8787`, then in the app's dashboard: Callback URL
   `<tunnel>/v1/channels/whatsapp/webhook`, the verify token from `.env.local`,
   **attach client credentials on**, subscribe `messages`, Save — the server has to be
   running while it verifies, or the Save fails. A saved URL still routes nothing until
   the app is subscribed to the WABA (the section above explains why that is a
   separate call), so both halves get read back before anything is demoed:

   ```bash
   npm run whatsapp:check --workspace apps/casa-bff -- --app-id <app id> --app-secret <32 hex> --waba-id <waba id>
   ```

   The free tunnel URL changes on every restart and Meta keeps pointing at the dead one,
   so this step is redone with it rather than at 08:50 on the day.

   Reading that subscription back by hand has a trap of its own:
   `GET /<app id>/subscriptions` with the Bearer token answers `400 (#190) Application
   Secret required`, because that call is authenticated with `app_id|app_secret` as the
   token — exactly what the command above does, so let it make the call instead of
   pasting a Bearer token in.

   Beside `messages` in that tab there is also a **Test** link, which hands one synthetic
   payload to the callback URL with no phone, no guest and no allowed list involved — the
   cheapest look at the inbound half there is; if your build of the dashboard does not
   show it, the local simulator covers the same ground. Judge it in the inspector, not on
   that page: a `200` on `POST /v1/channels/whatsapp/webhook` is proof, a `401` says
   nothing either way (a synthetic payload's signature is not something to lean on, while
   the simulator signs its requests the way Meta does and a real guest message is always
   signed). Note the app's mode while you are there — the test number sends in both
   **Development** and **Live**, so either is fine for Monday, but a mode nobody wrote
   down is the kind of thing that gets noticed mid-demo.
6. **Next, the guest's phone messages the business number.** This is the only real test
   of the half the simulator cannot see, and it is what opens the 24h window: Meta allows
   a free-form reply only within 24h of the guest's last message (code 131047 otherwise),
   so a demo that opens with us talking into an empty thread cannot work. This is the
   likeliest way the demo dies, and the WABA does have approved templates
   (`hello_world`, plus the `jaspers_market_*` set) — but `whatsapp.ts` has no code
   path that sends one, so opening the window means a manual Graph call the demo would
   then have to explain away. Treat it as a rescue, not a plan. And only what Meta
   delivered itself counts: a green simulated run proves the code path, never an open
   window, because the clock starts at the guest's last real message.
   What good looks like: `POST /v1/channels/whatsapp/webhook` in the ngrok inspector or
   the dev-server log, answered `200` with `received: 1`. That one line proves the
   callback URL, the verify token, client credentials and the subscription all landed,
   which no pass/fail word from `whatsapp:sim` can, because the simulator delivers its
   own request — `replied: 0, failed: 1` beside it still means the inbound half works.
   A refused send hides one level below that: the turn logs `whatsapp turn failed …
   Error: WhatsApp send failed: 400 {"error":…}` on the server's **stderr**, while
   stdout only shows the listen line and the response body just counts it (`failed: 1`).
   The simulator's closing note blames a dummy `WHATSAPP_ACCESS_TOKEN` even when the
   token is real, so on a run that should have worked, read that stderr line for the code
   that actually refused it.
   If that number is still the **test number** Meta hands out, the guest has to be on
   its allowed list first, or every send to it dies with `131030` — the reply to a guest
   who just opened the window included. The list has no page of its own: it lives in the
   **"To" picker** on the API Setup / Connect on WhatsApp panel, and *clicking that empty
   field* is what reveals **Manage phone number list** (it can also be reached by typing
   the number and pressing Send, which answers `131030` and offers the same thing). The
   picker starts on `US +1` — switch it to the recipient's country, `+84`, and drop that
   number's leading 0 (`84359386414`, not `0359386414`). Five numbers at most, and
   each is confirmed by a code Meta sends **to that phone**, which is why the first
   number listed should be your own: it is the only one whose code you can read in the
   next minute. The guest's number waits until the guest confirms it is the right one.

   Do not retype those digits from memory — read them back off Meta. Send the dashboard's
   own `hello_world` sample from that picker and Meta POSTs a **status** update to the
   callback URL, visible in the ngrok inspector or the dev-server log, whose
   `statuses[].recipient_id` is Meta's own spelling of the number: E.164 without the `+`
   (`84359386414` for `+84 359 386 414`), which is the format the send has to use. It
   arrives within seconds as `sent`, then `delivered`, then `read`, so a `read` also
   proves the picker accepted the number. No API returns the allowed list itself, which
   makes this the only read-back there is — and a `recipient_id` that disagrees with
   what you typed into the "To" field is exactly the typo the demo send dies of.

   A send is the only thing that can tell you, and the two codes are not the same
   problem — `whatsapp:check` cannot see the list at all, so neither code shows up there:

   - `131030` — not on the list yet, or on it as a different number than the one being
     sent to (country code and all). It comes back **synchronously**, as a `400` on the
     send, so the reply never even earns a `wamid`.
   - `131047` — **on** the list, and the only thing left is the closed 24h window. It
     arrives **asynchronously**: the send answers `200` with a `wamid`, and seconds later
     a `statuses` webhook reports it `failed` with `"Message failed to send because more
     than 24 hours have passed since the customer last replied to this number."` The
     guest messages first and the same send goes through — worth telling apart because
     this one is a good result that reads like a bad one.

   That split is why a send's `200` proves nothing on its own: the list is checked before
   the message is accepted (`131030` is synchronous and fatal), the window only after it
   (`131047` exists only in the status webhook). `131030` is also the one error Meta
   localises, so it comes back in the dashboard's language
   (`Số điện thoại của người nhận không nằm trong danh sách cho phép`).
7. **Only then the simulator**, once the window above is open — it tests the send path
   and nothing else:
   `npm run whatsapp:sim --workspace apps/casa-bff -- --from <your number> --text "..."`
   — 8/8 with `replied: 2, failed: 0` means Meta **accepted** both replies, and the
   simulator's closing line stops short of claiming more for exactly that reason.
   Delivery is a second verdict, arriving a second or two later as another `statuses`
   webhook: `sent`, then `delivered`, then `read`, or `failed` carrying
   `errors[0].code 131047`. Read those before believing the demo works — 8/8 with
   `replied: 2` and no status of its own is the silent third outcome in §8.
   `8/8` with `failed: 1` is the other trap: every check passes because the webhook
   answered 200 by design, while the send to Meta was refused. Read `failed`, then the
   status webhooks, not the score.
8. Demoing the deployed URL rather than localhost means repeating steps 1–2 as Vercel
   env vars and redeploying: the webhook route does not exist on prod until then, and
   Meta's callback URL has to point at `/v1/channels/whatsapp/webhook` on that host.

Rehearsing all of this without a real token still proves most of it, because an env var
beats the file (`process.loadEnvFile` never overwrites one already set) — so a second
server with a throwaway secret exercises the whole inbound path on its own port:

```powershell
cd apps/casa-bff
$env:WHATSAPP_APP_SECRET='sim-app-secret'; $env:WHATSAPP_VERIFY_TOKEN='sim-verify-token'; $env:PORT=8791
npm run dev                                                                          # second terminal; leaves 8787 alone
npm run whatsapp:sim -- --url http://localhost:8791 --secret sim-app-secret --verify-token sim-verify-token
```

That run stops at 5/8 with `server_misconfigured` on the three message checks — the sim
now names the missing variables when it does — and `POST /v1/extract` against the same
port proves the extractor and its provider key are alive independently of Meta.

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
- **A stalled WhatsApp turn used to be the one failure with no trace on the wire.**
  The inbound `wamid` is claimed *before* the turn runs (`claimMessage` in `app.ts`, so an
  at-least-once redelivery can never double-message a guest). When such a turn never
  returned, that claim stayed taken: Meta's redelivery was answered
  `{"received":1,"replied":0,"duplicates":1,"failed":0}`, no send was attempted, so no
  `statuses` webhook followed either, and the guest never heard back — leaving only a
  pending request in the ngrok inspector and the turn's own stderr line (this is the
  15:33 `"hi"` of the 2026-09-18 demo run). Both halves of that are closed now: a turn has
  a hard deadline and releases its claim when it fails before anything was sent, so that
  redelivery is a retry the guest actually gets. Per-call timeouts were never the missing
  piece — DeepSeek already aborts at 20s, Gemini at 8s, each Graph POST at
  `WHATSAPP_TIMEOUT_MS` (10s); nothing bounded the turn *as a whole*, which is what the
  deadline does, and nothing gave the claim back, which is what `releaseMessage` does. Two
  guards keep it honest: the abandoned turn checks an `expired` flag before it appends or
  sends, so it cannot reply behind the retry's back; and the claim is *not* released once
  a send is in flight — from there the only safe assumption is that the guest has it.
  The trace of a failed turn is therefore immediate rather than absent: `failed: 1` in the
  response body plus a `whatsapp turn failed` stderr line (or `WhatsApp turn exceeded …ms`
  when the deadline was the cause). Grep for those two.

- **A priced value used to be guessed by code, and the guess handed to the guest as a fact.**
  `transportType` was written by `postProcess` as `roundtrip, derived` whenever the guest
  asked for a transfer without saying which kind — "we need the airport pickup" does not
  distinguish one way from a return, and the transfer is a priced line, so the estimate sat
  on a value code had invented. It then asked the guest to confirm it, which is a symptom
  fix, not a correction. Fixed 2026-09-24: only a declined transfer is still derived (`none`,
  which needs no question); a wanted transfer with no stated type stays `missing`, so the
  guest's own answer is what gets priced. **If you add a field that money depends on, code
  must not fill it in** — leave it `missing` and add a question rule.
- **"Ready to hand off" and "nothing left to ask" used to be the same expression**, so a
  field that stopped being asked silently stopped being required. `done` is now
  `isReadyForHandoff(trip)`, backed by `HANDOFF_REQUIRED_FIELDS` and `NEVER_ASKED_FIELDS` in
  `questions.ts`, with the question list and the handoff check read off one open-question
  pass. **Applicability is the part to get right:** a required field is only checked when
  its own rule applies to this trip. The three dive fields are the reason — they are
  required for a diving enquiry, but their rules are gated on `diver === true` and on
  `diveNotes` being absent, so treating them as unconditionally required makes a
  non-diving guest, or the split-day schedule the NEVER-RE-ASK guardrail exists to serve,
  impossible to hand off at all. That mistake was made and caught by test on 2026-09-24.
  Adding a required field without deciding whether the guest is asked about it fails the
  coverage test in `questions.test.ts`.

- **An optional field the model leaves out used to delete its own question.** The
  Tier-2 Odoo fields (`diver`, `diveFrom`, `diveTo`, `transportType`) are optional in
  the Trip schema, so a provider can return a tool call that simply has no `diver` key
  in it — measured against the live provider on 2026-09-19: the same guest message came
  back with `diver: missing` on one call and with no `diver` key on the next, so one
  reply asked "would you like to go diving" and the other dropped the question, with no
  error and no log line. `extract.ts` now normalizes a key that is absent (and any state
  only code may set, `default`/`derived`) to `missing` before anything asks, and the
  three dive fields survive only as `stated`. If you add a priced or optional field, ask
  what its *absent* state does — silence is this pipeline's default failure mode, and it
  leaves no trace.

- **A date range is an answer, and asking for the night count anyway reads as not
  listening.** `nights` was a plain question with no gate, so a guest who wrote
  "Oct 17 to Oct 20" was asked "How many nights will you be staying?" on the very next
  turn — measured 9/9 against the live DeepSeek API, because the model correctly reports
  `checkOut: stated` and `nights: missing` (the guest never wrote a number). A range
  states both ends, so `deriveNightsFromRange()` now reads the count off it, and the
  `nights` rule is gated on the stay not already being a closed range. The count is
  derived only when it is `missing`: a night count the guest *did* state always wins,
  because a range that disagrees with it is a real contradiction and the arithmetic must
  not hide it from the fact gate. **If you add a field the guest can imply by writing a
  range, give it a `when` gate rather than a default** — and note the direction matters:
  deriving in the other direction (`checkOut` from `checkIn + nights`) will overwrite a
  check-out the guest actually wrote whenever both are present.

- **Two containers is the normal case, so an in-process lock protects nothing.** On
  Vercel each concurrent request can land in a different instance, and `withPhoneLock` in
  `redisStore.ts` was a promise chain — one process's chain cannot see another process at
  all, so the lock that exists to stop two containers reading the same thread and both
  replying did nothing on the deployment it was written for. It now also takes a Redis
  key (`SET phonelock:<phone> <token> NX PX 30000`, released by compare-and-delete on the
  token). It never throws: if Redis cannot answer, or a holder never lets go, the turn
  runs *unlocked* rather than failing, because the message has already been claimed and
  the holder writes `markDone` — asking Meta to redeliver would be dropped as a duplicate
  and the guest's text lost in silence. When you add anything that assumes "only one of
  these runs at a time", check which promise you are actually relying on.

- **The production store fallback is silent, so it now says so.** With no
  `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or the `UPSTASH_*` names), production falls back
  to an in-memory store: threads vanish on cold start and the phone lock cannot hold
  across instances. That is a deployment-configuration failure with no symptom — nothing
  errors, the webhook answers, and the only clue is a guest being asked something they
  already told you. `createConversationStoreFromEnv()` logs a `console.error` naming the
  consequence and the fix when it falls back under `VERCEL_ENV=production`. It does not
  throw, deliberately: degraded memory beats no service. **Check the function logs for
  `NO KV CONFIGURED IN PRODUCTION` after any deploy.**

## 9. Before this becomes the real Extractor pod deliverable

1. `packages/extractor/src/schema.ts` is no longer a guess about the *shape* of the Odoo
   payload — the BFF contract is vendored in `packages/extractor/bff-contract/` at commit
   `4c48918` and `test/bffContractParity.test.ts` fails if the two copies drift. What is
   still missing is the same thing this item was always about: nobody has confirmed the
   values that go *into* it. Two placeholder flags remain in the file —
   `HOUSE_NORM_FIELDS` (see item 2) and the comment at the top, which is now about which
   `estimate-api` version the vendored copy corresponds to rather than about the shape.
   The extraction shape (`Trip` with `{value, state, evidence}`) is deliberately NOT that
   contract and should not be replaced by it: the BFF's schema assigns a `.default()` to
   every field, so it cannot represent "the guest has not answered", which is the entire
   reason this pipeline exists. `buildBffTrip()` is the translation, and the
   `STRICTNESS_GAPS` table in `bff-contract/contract-spec.mjs` records every place this
   repo is deliberately stricter than the contract.
2. Confirm the real 4 house-norm fields and their default values with
   Jett/Eloa — `houseNorms.ts` is guessed.
3. Get billing enabled on the Gemini API key (see §2, ADR-005a) — the free
   tier cannot run a 30-message × multiple-provider bake-off at all.
4. Once Eloa's 30 real messages exist, drop them into
   `packages/extractor/eval/dataset.real.json` and run the same harness —
   the result becomes ADR-005b.
5. Set `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or the `UPSTASH_*` names) in the Vercel
   project. Without them production runs the in-memory store, which loses threads on cold
   start and cannot hold the phone lock across instances — see the §8 note and grep the
   function logs for `NO KV CONFIGURED IN PRODUCTION`.

