// Demo default per steer: start with Gemini because it's outside Anthropic and
// cheapest through the two gates in the stack proposal (data-residency, then
// structured-output/cache). This is NOT the eval-decided winner — that only
// happens after the 30-message bake-off. Keep this adapter and the other two
// candidates (Claude, GPT-5.1) equally easy to write once eval time comes.
//
// Verify GEMINI_MODEL against https://ai.google.dev/gemini-api/docs/models
// before a real deploy — model names in this family change often and the
// value below is a placeholder, not a confirmed-current id.
import type { ExtractCall, ExtractProvider, ExtractResult } from "../provider.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Playbook's own p95 target for the whole extraction. Measured p95 here is
// ~3.2s (ADR-005a), so 8s leaves real headroom without masking a genuine
// hang — a hung request would otherwise wait indefinitely, past Vercel's own
// function timeout, with no chance for extract.ts's retry-once path to help.
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 8_000);

// Gemini's responseSchema is a constrained subset of JSON Schema: no $ref,
// no $schema, no additionalProperties. zod-to-json-schema is told to inline
// everything (no $refStrategy), this strips what's left that Gemini rejects.
function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$schema" || k === "additionalProperties" || k === "$ref") continue;
      // Gemini's schema subset doesn't recognize these numeric-range keywords
      // (confirmed via a live 400: "Unknown name \"exclusiveMinimum\"") —
      // zod's `.positive()`/`.int().positive()` emit them. Dropping the bound
      // means Gemini can't enforce it, but zod still validates the real value
      // after the model responds, so nothing gets through unchecked.
      if (k === "exclusiveMinimum" || k === "exclusiveMaximum") continue;
      out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return node;
}

export function createGeminiProvider(apiKey: string, model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash"): ExtractProvider {
  return {
    id: "google:" + model,
    async call({ text, jsonSchema, today, retry }: ExtractCall): Promise<ExtractResult> {
      const started = Date.now();
      const systemPrompt =
        "You extract trip details from a dive-resort guest's message into the given " +
        "JSON schema. Every field needs a state: 'stated' (quote it in evidence, verbatim), " +
        "'inferred' (context implies it, no exact quote), or 'missing'. Never invent a value " +
        "that state 'stated' cannot point to verbatim evidence for. " +
        "For 'guests': when a message mentions both a party/group size and a different number of people staying (e.g. 'group of 6 but only 3 are staying' is 3; 'nhóm 8 người nhưng chỉ 4 người ở lại' is 4), extract the number of guests staying, or mark it missing if ambiguous — never use the non-staying party total. " +
        // The same transport rule as providers/deepseek.ts, word for word: this adapter is the
        // configured fallback (providerFromEnv.ts), and a rule that lives in only one prompt is
        // a money bug waiting for a missing key. See that file for why it is phrased as the
        // guest's meaning rather than as keywords.
        "'transport' is true (stated) only when the guest asks the resort for an airport " +
        "pickup or transfer. Set it to false (stated) when they say they have their own " +
        "vehicle, are driving themselves, or do not need a transfer — 'xe tụi mình tự đi', " +
        "'tự chạy xe', 'own van', 'we have a car', '自己开车', '不需要接送'. Otherwise mark it " +
        "missing: a guest who never mentions the airport has not asked for anything. " +
        "'diver' is true (stated) when the guest asks to dive, take a dive course, or are divers. Set it to false (stated) when they say they are not diving, do not want to dive, or have no diving plans — 'no diving', 'không lặn', 'không có nhu cầu lặn', '不潜水'. Otherwise mark it missing. " +
        "Copy a date phrase into " +
        "evidence verbatim, and also put your best ISO date (YYYY-MM-DD) for it in that " +
        "field's value, computed from today's date — the caller re-checks that date against " +
        "the guest's own words and asks the guest whenever the two disagree.";

      const userParts = [`Today's date (Asia/Manila): ${today}`, `Guest message:\n${text}`];
      if (retry) {
        // Playbook: "call again once with the error attached." Shows the model
        // its own bad output plus what failed, instead of an identical retry.
        userParts.push(
          `Your previous JSON response did not match the schema.\n` +
            `Error: ${retry.error}\n` +
            `Your previous response: ${JSON.stringify(retry.previousRaw)}\n` +
            `Fix it and return JSON matching the schema exactly.`,
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userParts.join("\n\n") }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: toGeminiSchema(jsonSchema),
            },
          }),
        });
      } catch (err) {
        // Named for observability only — extract.ts treats this exactly like
        // any other transport failure (rate limit, 5xx): it drives the
        // existing retry-once path and is never mistaken for a validation
        // error, since it's thrown before postProcess/Trip.parse ever run.
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(`Gemini extract timed out after ${TIMEOUT_MS}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        throw new Error(`Gemini extract failed: ${res.status} ${await res.text()}`);
      }
      const body = await res.json();
      const usage = body.usageMetadata ?? {};
      const textOut = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

      return {
        raw: JSON.parse(textOut),
        tokensIn: usage.promptTokenCount ?? 0,
        tokensOut: usage.candidatesTokenCount ?? 0,
        cacheReadTokens: usage.cachedContentTokenCount ?? 0,
        ms: Date.now() - started,
      };
    },
  };
}
