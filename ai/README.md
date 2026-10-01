# @casa/ai — the AI channel's extractor (P5)

Guest message in → `Trip` with a state per field, a reply for the guest, and the `BffTrip` handoff the
BFF prices. Imported by `bff/` (`bff/src/routes/extract.ts`). Owner: Nhật.

The rules in `CLAUDE.md` §1 hold here and are checked by `test/boundaries.test.ts`: no Odoo client, no
api key, no pricing, no booking submit, nothing imported from `bff/`. Contract types come from
`@casa/contracts`.

## Layout

```text
src/
  domain/          no I/O, no model calls
    schema.ts        the extractor's Trip: a value, a state (stated/inferred/default/missing) and evidence per field
    bffTrip.ts       BffTrip & co. — aliases of @casa/contracts TripSchema; the precheck issue codes
    dates.ts         relative dates, Manila "today", stay arithmetic
    counts.ts        corroborating the model's counts against the guest's own words
    houseNorms.ts    the defaults the pipeline may apply, room capacities
    conversation.ts  ConversationTurn
  application/     the pipeline, built on domain/ and the provider port
    extract.ts       text → Trip: model call, evidence check, house norms, corroboration
    normalize.ts     language detection, PII mask for logs (maskForLogging)
    intent.ts        is this an enquiry at all
    questions.ts     what to ask next, the handoff contract (isReadyForHandoff), deterministic replies
    synthesis.ts     the hospitality reply and the fact gate every guest-facing text passes
    naturalness.ts   reply scoring for the eval
    tripCorrections.ts  which fields a guest restated
    odooHandoff.ts   Trip → BffTrip, the fillTrip/validateTrip precheck, the handoff envelope
    converse.ts      one turn: extract + reply + handoff
  ports/provider.ts  the ExtractProvider interface the pipeline depends on
  infra/providers/   Gemini and DeepSeek (LiteLLM gateway) adapters; env/settings factory
  index.ts           the only public import surface
test/              vitest; test/setup.ts pins "today" to 2026-09-30 Manila
eval/              the Playbook threshold harness: `node eval/runner.mjs [mock-30|synthetic|real]`
```

Dependencies point one way: `infra → ports ← application → domain → @casa/contracts`. `index.ts`
may re-export any layer; nothing else crosses the arrows.

## Where to change what

| To change | Edit |
|---|---|
| a field the extractor reads | `domain/schema.ts`, then the question in `application/questions.ts` |
| what counts as "ready to quote" | `isReadyForHandoff` in `application/questions.ts` |
| the payload sent to the BFF | `application/odooHandoff.ts` — the shape itself is `@casa/contracts` |
| what may be said to a guest | `verifyGuestFacingText` in `application/synthesis.ts` |
| a model or provider | `infra/providers/` — the pipeline only sees `ports/provider.ts` |

## Commands

```bash
npm run typecheck -w ai
npm test -w ai
node ai/eval/runner.mjs mock-30
```

`eval/results/` and `eval/dataset.real.json` are git-ignored: a run echoes guest text back, and the
real dataset is guest messages.
