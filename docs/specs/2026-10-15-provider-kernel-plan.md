# Plan: one shared provider core + a provider registry + a repo rules file

Date: 15/10/2026 · Branch: `feat/provider-kernel` (cut from `feat/p6-ai-refactor` @ `8d06dd1`) · Status: waiting for approval

## Why

Adding or dropping an AI vendor is expensive today.

- **Duplicated adapters.** Each adapter re-implements the same 5 calls:
  - `deepseek.ts` is 441 lines and `gemini.ts` is 392.
  - About 80% of that code is the same in both: prompts, schemas, parsing, timeouts, error handling.
- **Claude is missing the three focused passes.** `anthropic.ts` (146 lines) never got `extractGuests`, `extractCheckIn` or `extractDiveWindow`.
- **Vendor names are hard-coded in about 6 places:**
  - `ProviderKind`;
  - `KNOWN_PROVIDER_NAMES`;
  - the `if` chain in `choiceFromName`;
  - `AiEnv`;
  - `settingsStore.ENV_KEY_NAME`;
  - `admin.ts` `z.enum(["gemini","deepseek"])`.
- **The admin page cannot save Claude.** The dropdown shows it, but the zod check rejects it.
- **Prompts have drifted.**
  - DeepSeek carries its own main prompt instead of `EXTRACT_SYSTEM_PROMPT`.
  - Both prompts contain broken sentences ("Never invent a value For 'guests'…", "…stated only when their For 'guests'").
  - Each focused prompt is copied once per adapter.
- **`AGENTS.md` is generic and points at paths that do not exist** (`packages/extractor`, `apps/casa-bff`).

Goal:
- A new OpenAI-compatible vendor is **one registry entry**.
- A vendor with its own API is **one transport of about 60 lines plus one entry**.
- Dropping a vendor is deleting one entry.
- Tests fail as soon as anything is registered outside the registry.

## Diagrams

### 1. Layers after the refactor
```
bff (admin, settingsStore, env)  ── reads ──>  PROVIDER_REGISTRY  (one list)
                                                  │ each entry: kind, label, models, defaultModel,
                                                  │ env {key, model, baseUrl, timeout}, aliases, transport factory
                                                  ▼
providerFromEnv / createProviderFromSettings  ──>  createExtractProvider(transport, opts)   ← SHARED CORE
   (D-129 gate, fallback, breaker unchanged)          call · extractGuests · extractCheckIn ·
                                                      extractDiveWindow · generateText
                                                      prompts (prompts.ts) · schemas · parse · timeout · errors
                                                         │ only calls down 2 functions
                                                         ▼
                                     Transport { structured(req) → {json, usage}, text(req) → string }
                                        ├─ anthropicTransport      /v1/messages + tool_choice
                                        ├─ geminiTransport         generateContent + responseSchema (+ capped 429 retry)
                                        └─ openAiCompatible(base)  /chat/completions + tool_choice  → DeepSeek, and any later vendor
```

### 2. One extraction call (data flow)
```
extract.ts ─> core.call({text, jsonSchema, today, retry})
   core: build system = EXTRACT_SYSTEM_PROMPT, user = date + message (+ retry note)
       ─> transport.structured({system, user, toolName:"extract_trip", schema, timeoutMs})
              transport: vendor schema fix-ups → HTTP → pull out args JSON + usage
       <─ {json, tokensIn, tokensOut, cacheRead}
   core: parse (MalformedArgumentsError on bad JSON), AbortError → "timed out", → ExtractResult
```

## Tasks (TDD: red test before code, `npm run verify` green after every task)

**T1. Lock current behaviour (tests only, no code change).**
- Write `ai/test/providers/transportContract.test.ts`.
- It runs one shared test set against each adapter as it is today, with a fake fetch.
- It checks two things:
  - **Request:** the URL, the auth header, that the tool is forced, and that the schema has been cleaned.
  - **Result:** the `ExtractResult` / `GuestsReadResult` shapes; bad JSON raises `MalformedArgumentsError`; a timeout raises "timed out"; a non-2xx status raises an error that carries the status.
- Commit the current prompts into a snapshot, so later prompt changes show up as a diff.

**T2. Shared core + `prompts.ts`.**
- `ai/src/infra/providers/core.ts`: `createExtractProvider(transport, { id, timeoutMs, synthesisTimeoutMs })`.
- `prompts.ts`: holds the main prompt and the three focused prompts with their schemas, written once.
- Fix the two broken sentences in the prompts. Note: this changes model behaviour, so it is measured in T6.
- Unit tests use a fake `Transport`.

**T3. Three transports, then delete the old adapters.**
- `openAiCompatible.ts`, covering DeepSeek: keep `thinking:{type:"disabled"}` behind an option, and strip `exclusiveMinimum`.
- `geminiTransport.ts`: `responseSchema`, the capped 429 retry, the key in the query string.
- `anthropicTransport.ts`.
- Delete the bodies of `deepseek.ts` and `gemini.ts`, and the old `anthropic.ts`.
- The T1 contract tests must stay green, with the expected values unchanged.
- **Claude gets all 5 passes from the core.**

**T4. Registry as the single source.**
- `registry.ts` defines `PROVIDER_REGISTRY`.
- Derived from it:
  - `ProviderKind` (from `as const`);
  - `PROVIDER_KINDS`;
  - `MODEL_CATALOG`;
  - the regex in `isKnownModel` (each entry carries its own `modelPattern`);
  - `choiceFromName` (by `aliases` and the `kind:model` form);
  - the env-key map used by `keyFor` and `settingsStore`.
- Delete `KNOWN_PROVIDER_NAMES` (derive it if anything still reads it).
- `settingsFromEnv`: the fallback order becomes a `fallbackOrder` list instead of the nested ternary.
- Generalise the `deepseekBaseUrl` setting: a `baseUrls` map per kind. Keep reading the old field so existing KV settings still load.

**T5. bff reads the registry.**
- `admin.ts`: `Kind = z.enum(PROVIDER_KINDS)`.
- `settingsStore.ts`: `ENV_KEY_NAME` comes from the registry.
- `env.ts`: zod fields for each vendor's env keys come from the registry.
- `adminAiPage.ts`: the base-URL field becomes per vendor, shown only when the entry has `baseUrl`.
- **Guard test** `bff/test/providerRegistryGuard.test.ts`, which fails when:
  - a kind is in the registry but the admin cannot save it;
  - an env key is in the registry but not in `env.ts`;
  - a vendor name appears in code outside `ai/src/infra/providers/` (grep), with comments excluded.
- **Done when** adding a fake OpenAI-compatible vendor in a test is one entry, and admin, env, settings and the fallback chain all accept it.

**T6. Measure on synthetic data (no real guest data).**
- Run the existing synthetic suites (`ai/test` eval replay and `tools/live-eval`) before and after, on DeepSeek and Gemini.
- Field accuracy must not drop.
- If it drops because of the prompt fix in T2, report it and do not merge.
- No Anthropic key yet, so Claude is checked by contract tests only.

**T7. Repo rules file.**
- Rewrite `AGENTS.md` at about 80 lines:
  1. **Real map:** `contracts ← ai ← bff`.
  2. **Recipes for the extension points:** provider, channel (`ChannelAdapter`), Trip field (`FIELD_REGISTRY`), turn step (`turn/steps/`). Each recipe names the guard test that proves it.
  3. **Lines not to cross:**
     - D-129;
     - never read `.env*`;
     - never push `main`;
     - prices only from the Estimator;
     - webhooks must be signed;
     - no real phone numbers.
  4. **Verification:** `npm run verify`.
- Add `CLAUDE.md` containing one line, `@AGENTS.md`, so Claude and Antigravity read the same source.

**T8. Close-out.** `Nhat_CHANGELOG.md`, ADR-011 (the Pattern 3 section), one commit per task, no push.

## Not doing
- No change to `createResilientProvider` / the breaker, to the D-129 gate logic, or to the WhatsApp flow.
- The 4 open items from the earlier review (webhook claim, `estimator_pending`, the `ALLOW_NON_ANTHROPIC` flag, old Claude ids) belong to a separate PR. Exception: when T4 rebuilds the catalog it drops the `claude-3*` ids, because they are deleted along with it.
- No new vendor in this PR (that needs a decision on Q-038 / D-129).

## Risk
- The prompt fix in T2 changes outputs. T6 measures it; if it is bad, keep the old wording, which is still one shared copy.
- Settings stored in KV use `deepseekBaseUrl`. T4 keeps reading that field.
- About 1 day of work. Biggest diff: about 900 lines of adapters removed, about 400 lines added.
