// Bake-off candidate #4 — via the team's LiteLLM gateway (Railway), OpenAI-
// compatible chat/completions endpoint. Cheapest of the four (see
// docs/adr/ADR-005a-extractor-model.md), but only run this against synthetic
// test messages, never real guest data: the underlying inference still runs
// on DeepSeek's own infrastructure (data residency in the PRC — this is what
// disqualified DeepSeek at Gate A), and the gateway itself logs every prompt
// and response to the team's spend dashboard.
import type { ExtractCall, ExtractProvider, ExtractResult } from "../provider.js";

const GATEWAY_BASE_URL = "https://litellm-production-7402.up.railway.app/v1";

export function createDeepSeekProvider(
  apiKey: string,
  model: "deepseek-flash" | "deepseek-pro" = (process.env.DEEPSEEK_MODEL as "deepseek-flash" | "deepseek-pro") ?? "deepseek-flash",
): ExtractProvider {
  return {
    id: "deepseek-gateway:" + model,
    async call({ text, jsonSchema, today }: ExtractCall): Promise<ExtractResult> {
      const started = Date.now();
      const systemPrompt =
        "You extract trip details from a dive-resort guest's message into the given " +
        "JSON schema. Every field needs a state: 'stated' (quote it in evidence, verbatim), " +
        "'inferred' (context implies it, no exact quote), or 'missing'. Never invent a value " +
        "that state 'stated' cannot point to verbatim evidence for. Do not resolve relative " +
        "dates yourself — copy the date phrase as written and let the caller resolve it. " +
        "Respond with JSON only, matching this schema exactly:\n" + JSON.stringify(jsonSchema);

      const res = await fetch(`${GATEWAY_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Today's date (Asia/Manila): ${today}\n\nGuest message:\n${text}` },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        throw new Error(`DeepSeek gateway extract failed: ${res.status} ${await res.text()}`);
      }
      const body = await res.json();
      const usage = body.usage ?? {};
      const content = body.choices?.[0]?.message?.content ?? "{}";

      return {
        raw: JSON.parse(content),
        tokensIn: usage.prompt_tokens ?? 0,
        tokensOut: usage.completion_tokens ?? 0,
        cacheReadTokens: usage.prompt_cache_hit_tokens ?? 0,
        ms: Date.now() - started,
      };
    },
  };
}
