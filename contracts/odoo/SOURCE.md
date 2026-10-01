# Where `estimate-api.v1.json` comes from

| | |
|---|---|
| Source | `https://casa-escondida-03-staging-web-37790335.dev.odoo.com/estimate-api/openapi.json` (public GET, no login) |
| Owner | Phillip (Odoo side). Any PR touching this folder is reviewed by him. |
| Pinned on | 2026-09-30 |
| Pinned by | Fable (Anthony ordered 30/09) |
| md5 | `ae74c14c917b452af35f2c4e30399d35` |
| Spec version | `info.version` 1.0.0, OpenAPI 3.1.0 |
| Paths | 18 paths, 19 routes (listed below) |

Routes in the pinned spec:

| Method | Path |
|---|---|
| GET | `/v1/health` |
| GET | `/v1/estimate/rates` |
| PATCH | `/v1/estimate/rates` |
| GET | `/v1/estimate/rooms` |
| GET | `/v1/estimate/boats` |
| GET | `/v1/estimate/pricelists` |
| GET | `/v1/estimate/rates/manifest` |
| POST | `/v1/estimate/compute` |
| POST | `/v1/booking/submit` |
| GET | `/v1/inquiry` |
| GET | `/v1/inquiry/{lead_id}` |
| POST | `/v1/inquiry/{lead_id}/quoted` |
| POST | `/v1/inquiry/submit` |
| POST | `/v1/guest/lookup` |
| POST | `/v1/auth/register` |
| POST | `/v1/auth/login` |
| POST | `/v1/auth/forgot-password` |
| POST | `/v1/auth/logout` |
| GET | `/v1/auth/me` |

`GET /v1/estimate/pricelists`, `GET /v1/estimate/rates/manifest` and `PATCH /v1/estimate/rates`
are staff tools in the Odoo UI — the BFF never calls them (CLAUDE.md §5).

New in the 30/09 pin (Phillip, 29/09): `SubmitRequest.attachments[]` (`SubmitAttachment`, maxItems 40),
`Trip.transferDirection`, `Guest.transferDirection | diet | allergies`, and `securitySchemes`
(apiKey in header `api-key`).

Previous pin: 2026-09-16 by Anthony, md5 `14c078e9c1dead3654c75978fe577f61`, 5 paths.

Known gaps still open with Phillip (from the "six items for v1"; `securitySchemes` shipped in the 30/09 pin):
no `rates_version` in compute, no `Idempotency-Key` on submit,
no `GET /v1/booking/{id}`, no response examples (Prism therefore runs in dynamic mode).

## Refresh procedure

1. `npm run spec:check -w contracts` prints the diff and exits 1 if staging differs.
2. `npm run spec:pull -w contracts` overwrites the pinned file.
3. `npm run gen -w contracts` regenerates `src/odoo/types.ts`.
4. Update the table above (date, by, md5). The md5 is printed by both scripts.
5. `npm test` from the root. Failing contract tests mean the BFF assumptions changed; fix them in the same PR.
