# Real responses from Phillip's staging

Captured 2026-09-17 from
`https://casa-escondida-03-staging-web-37790335.dev.odoo.com/estimate-api`
against spec md5 `14c078e9` (the 2026-09-16 pin of `../estimate-api.v1.json`; re-pinned 2026-09-30, see `../SOURCE.md`), caller role `guest`
(anonymous — no key was used).

The spec carries no response examples, so Prism invents lorem-ipsum values. These files
are the substitute: point the mock at them and it returns numbers a human can read.

| File | What it is |
|---|---|
| `compute.retail-couple.json` | 2 guests, 2 nights standard, 1 dive day. The readable baseline. |
| `compute.agent-group.json` | Sky's canonical sample trip: 7 guests, 4 nights, agent discount, FOC, one AOW course. 39 KB. |
| `compute.courses.json` | Refresher + Open Water. Proves the engine prices course types that `/rates` does not list. |
| `compute.missing-divewindow.json` | **The trap.** Same trip as B in the field guide but with `diveFrom`/`diveTo` omitted: `catRev.dive` is 0, `diveDates` falls back to Oct 2026, and there is no warning. Keep this as a regression fixture — the day Phillip fixes it, this file stops matching. |
| `rates.json` | The live rate card. Note `deluxe.3-4pax` = 16400.010000000002 and the missing `refresher` / `rescue` course rates. |
| `rooms.json` | 24 real rooms (16 standard, 4 deluxe, 4 suite) with a Nov window. |
| `requests/` | The request bodies that produced the compute responses. |

## Profile (`GET /v1/auth/me`)

Captured 2026-09-29 from the same staging host (module `casa_escondida_estimate_api`
19.0.1.5.2) by `scripts/capture-me.mjs`: login as the internal QA account, `GET /v1/auth/me`
with header `api-key`, then logout (the key it was issued is revoked; it is never printed or
written). The route is in the pinned spec since the 2026-09-30 re-pin. Read-only — there is no route to edit a profile.

| File | What it is |
|---|---|
| `auth-me.agent.json` | QA agent: `id` (res.partner.id, the agent code), agency block filled, `phone` / `agent_name` null, `verified: false`, `attachments: []`. |
| `auth-me.instructor.json` | QA instructor: agency block `null`, `attachments: []`. |
| `auth-me.guest.json` | QA guest: agency block `null`, `attachments: []`. |

Staff has no capture (fixture auth answers 404). Commission is not in this response; it is
shown as `retail_model − model` on the Agent View. Recapture with the script — do not edit by hand.

## Booking submit (`POST /v1/booking/submit`)

Captured once on 2026-09-29 (Anthony ordered it in chat; B-033) by `scripts/capture-submit.mjs`
as the QA agent: one small `[QA]` trip, which created a DRAFT folio on staging (nothing confirmed
or charged). The script refuses to run again while the response file exists — one folio is enough.

| File | What it is |
|---|---|
| `submit.agent.json` | `{ status: 200, body: { success, folio_id: 1574, order_ids: [3 ids] } }`. The fixture gateway's `submit()` returns `body`. |
| `requests/submit.req.1.json` | The request that produced it (synthetic `[QA]` names). |

Calling submit creates a real folio in Phillip's staging: never call it without Anthony's order in chat (CLAUDE.md §5).
