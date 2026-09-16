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
        "that state 'stated' cannot point to verbatim evidence for. Do not resolve relative " +
        "dates yourself — copy the date phrase as written and let the caller resolve it.";

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

      const res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userParts.join("\n\n") }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(jsonSchema),
          },
        }),
      });

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
