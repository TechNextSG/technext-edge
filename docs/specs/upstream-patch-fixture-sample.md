# Upstream patch: `POST /api/estimates` should carry the `sample` flag

**Status:** prepared, not applied. Their repo is private and not ours to edit without being asked.
**Repo:** `TechNextSG/tn-casa-quotation-estimator` · branch `main` · commit `4c48918`
**Impact on us:** mitigated on our side already (see the last section) — this is about their own
stated design intent, not a blocker for us.

## What is wrong

`POST /api/estimates` returns a price with no machine-readable indication of whether it came from
Odoo or from captured fixture data:

```ts
// bff/src/app.ts:157
return c.json({
  role: response.role,
  model: redactForRole(response.model, role),
  issues,
  computedAt: new Date().toISOString(),
});
```

Verified against their BFF running in fixture mode (`FIXTURE_MODE=1`, port 8787): the response
carries no `sample` key at all, so any consumer reads a captured price exactly like a real one.

## Why that contradicts their own code

`bff/src/app.ts:32-38` is explicit about the intent:

```ts
export interface AppDeps {
  env: Env;
  gateway: EstimateGateway;
  /** Để /api/health báo cho UI biết đang chạy dữ liệu mẫu hay Odoo thật. Bắt buộc — không có
   * giá trị mặc định, vì mặc định 'odoo' nghĩa là một caller quên truyền sẽ khiến UI hiện dữ
   * liệu mẫu như thể là giá thật (đúng thứ CLAUDE.md §1 cấm). */
  mode: GatewayMode;
  today?: () => string;
}
```

They made `mode` **required with no default** specifically so that sample data is never shown as a
real price. But the value only ever reaches `/api/health` (`app.ts:66`,
`c.json({ ok: true, mode: deps.mode })`) — the route that actually returns prices does not mention
it. So the protection exists at the health endpoint and is absent from the estimate itself.

`docs/specs/06-p5-bff-schema-contract.md` §7 (their handover doc) also states the expectation directly:
*"S1 hiện nhãn 'Sample data' khi `/api/health.mode === 'fixture'`."*

## The patch

One line, in the success branch of `POST /api/estimates`:

```diff
--- a/bff/src/app.ts
+++ b/bff/src/app.ts
@@ -154,10 +154,14 @@
     });

     return c.json({
       role: response.role,
       model: redactForRole(response.model, role),
       issues,
       computedAt: new Date().toISOString(),
+      // Whether this price is real. `mode` is required with no default precisely so sample data
+      // is never presented as a real price (see AppDeps.mode), but until now it only reached
+      // /api/health — so a consumer of this response could not tell. Same field name the
+      // handover doc uses: `sample`.
+      sample: deps.mode === 'fixture',
     });
   });
```

The field name `sample` is already the one their schema document and their own UI convention use,
so nothing new is introduced.

## What it changes for us

Nothing breaks either way — our client (`apps/casa-bff/src/estimatorClient.ts`) treats `sample` as
`their flag OR our own probe`, so it is correct before and after this patch. It flags a price as
sample when either:

- the response says `sample: true`, or
- `GET /api/health` reports `mode: 'fixture'` (asked once, cached 60s).

The patch matters because it is the difference between "the estimate states what it is" and "the
caller has to go and ask a second endpoint". For a price that a staff member may read out to a
guest, the first is the property worth having — and it is the one their `AppDeps` comment says
they intended.
