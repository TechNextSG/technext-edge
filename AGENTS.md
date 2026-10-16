# AGENTS.md — technext-edge Architecture & Operating Rules

Architecture, extension recipes, and non-negotiable boundaries for agents and engineers.

---

## 1. Real Dependency Map

Strict unidirectional hierarchy: `contracts ← ai ← bff`.

- **`contracts`** (`@casa/contracts`): Domain contracts (`Trip`, `ExtractResult`, Zod schemas). Pure types, zero internal dependencies.
- **`ai`** (`@casa/ai`): Pure neuro-symbolic extraction & synthesis (`extract`, `converse`). **Never** imports `bff`, calls Odoo, reads DB, or touches `process.env`.
- **`bff`** (`@casa/bff`): Hono HTTP server, stores, WhatsApp channel, Estimator client. Injects config into `ai` via function arguments.

*Enforced by:* `npm run check:boundaries` and [ai/test/boundaries.test.ts](file:///e:/technext-edge/ai/test/boundaries.test.ts).

---

## 2. Extension Point Recipes

Always extend through these 4 designated extension points with corresponding guard tests:

| Extension Point | How to Extend | Guard Test |
|---|---|---|
| **AI Provider** | Add descriptor in `PROVIDER_REGISTRY` ([ai/src/infra/providers/providerRegistry.ts](file:///e:/technext-edge/ai/src/infra/providers/providerRegistry.ts)). Admin, env, and fallback chain update automatically. | [bff/test/providerRegistryGuard.test.ts](file:///e:/technext-edge/bff/test/providerRegistryGuard.test.ts) & [ai/test/providers/registrySingleSource.test.ts](file:///e:/technext-edge/ai/test/providers/registrySingleSource.test.ts) |
| **Channel Adapter** | Implement `ChannelAdapter` in [bff/src/channels/channelAdapter.ts](file:///e:/technext-edge/bff/src/channels/channelAdapter.ts) (`sendText`, `sendTemplate`, `verifyWebhook`). | [bff/test/channels/channelAdapter.test.ts](file:///e:/technext-edge/bff/test/channels/channelAdapter.test.ts) |
| **Trip Field** | Add metadata, question rules, and fact-gate logic to `FIELD_REGISTRY` in [ai/src/domain/fieldRegistry.ts](file:///e:/technext-edge/ai/src/domain/fieldRegistry.ts). | [ai/test/fieldRegistry.test.ts](file:///e:/technext-edge/ai/test/fieldRegistry.test.ts) |
| **Turn Step** | Add discrete step in [bff/src/channels/whatsapp/turn/steps/](file:///e:/technext-edge/bff/src/channels/whatsapp/turn/steps/) and register in pipeline. | [bff/test/channels/whatsapp/turnPipeline.test.ts](file:///e:/technext-edge/bff/test/channels/whatsapp/turnPipeline.test.ts) |

---

## 3. Lines Not to Cross

1. **Rule D-129 (Model Policy):** Production guest messages run on Anthropic or approved paid fallback (DeepSeek/Gemini with paid keys). Free tier models (e.g. Gemini free) are forbidden in production.
2. **Never read `.env*` ambiently:** `@casa/ai` must never read `process.env`. All configuration and keys must be validated in BFF [env.ts](file:///e:/technext-edge/bff/src/env.ts) and passed into callers.
3. **Never push to `main` directly:** Every change must go through a feature branch (`feat/*`) and PR with peer review.
4. **Prices only from Estimator:** AI and BFF must never compute, fabricate, or guess room or package rates. All prices originate strictly from the Estimator API.
5. **Webhooks must be cryptographically signed:** Inbound Meta requests require valid `x-hub-signature-256`. Missing or invalid signatures reject immediately (HTTP 401/503).
6. **Zero raw PII:** Never output raw guest phone numbers or email addresses in client logs or query parameters. Mask logs via `maskForLogging`; hash WhatsApp identifiers (`wa:` + sha256).

---

## 4. Verification Gate

Before submitting any commit or PR, verify the full suite passes cleanly:

```bash
npm run verify
```

*(Runs package boundary check, workspace typechecks across all 3 packages, and complete Vitest test suites).*
