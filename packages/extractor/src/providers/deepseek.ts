// Bake-off candidate #4 — via the team's LiteLLM gateway (Railway), OpenAI-
// compatible chat/completions endpoint. Cheapest of the four (see
// docs/adr/ADR-005a-extractor-model.md), but only run this against synthetic
// test messages, never real guest data: the underlying inference still runs
// on DeepSeek's own infrastructure (data residency in the PRC — this is what
// disqualified DeepSeek at Gate A), and the gateway itself logs every prompt
// and response to the team's spend dashboard.
import type { ExtractCall, ExtractProvider, ExtractResult } from "../provider.js";

const GATEWAY_BASE_URL = "https://litellm-production-7402.up.railway.app/v1";
const TOOL_NAME = "extract_trip";

// DeepSeek has no `response_format: {type: "json_schema"}` (confirmed against
// their API docs, 2026-09) — only plain `json_object` mode, which is why the
// original version of this file dumped the whole JSON Schema as prose in the
// system prompt just to describe the shape. DeepSeek *does* support strict
// schema-enforced tool calling, so a single forced tool call gets the same
// guarantee (the API rejects/repairs non-conforming arguments server-side)
// for a fraction of the input tokens — no schema text in the prompt at all.
export function createDeepSeekProvider(
  apiKey: string,
  model: "deepseek-flash" | "deepseek-pro" = (process.env.DEEPSEEK_MODEL as "deepseek-flash" | "deepseek-pro") ?? "deepseek-flash",
): ExtractProvider {
  return {
    id: "deepseek-gateway:" + model,
    async call({ text, jsonSchema, today, retry }: ExtractCall): Promise<ExtractResult> {
      const started = Date.now();
      const systemPrompt =
        "You extract trip details from a dive-resort guest's message by calling " +
        `the ${TOOL_NAME} tool. Every field needs a state: 'stated' (quote it in ` +
        "evidence, verbatim), 'inferred' (context implies it, no exact quote), or " +
        "'missing'. Never invent a value that state 'stated' cannot point to verbatim " +
        "evidence for. Do not resolve relative dates yourself — copy the date phrase " +
        "as written and let the caller resolve it.";

      const userParts = [`Today's date (Asia/Manila): ${today}`, `Guest message:\n${text}`];
      if (retry) {
        // Playbook: "call again once with the error attached."
        userParts.push(
          `Your previous tool call's arguments did not match the schema.\n` +
            `Error: ${retry.error}\n` +
            `Your previous arguments: ${JSON.stringify(retry.previousRaw)}\n` +
            `Call ${TOOL_NAME} again with corrected arguments.`,
        );
      }

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
            { role: "user", content: userParts.join("\n\n") },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: TOOL_NAME,
                description: "Record the extracted trip details.",
                parameters: jsonSchema,
                strict: true,
              },
            },
          ],
          tool_choice: { type: "function", function: { name: TOOL_NAME } },
        }),
      });

      if (!res.ok) {
        throw new Error(`DeepSeek gateway extract failed: ${res.status} ${await res.text()}`);
      }
      const body = await res.json();
      const usage = body.usage ?? {};
      const toolCall = body.choices?.[0]?.message?.tool_calls?.[0];
      const args = toolCall?.function?.arguments ?? "{}";

      return {
        raw: JSON.parse(args),
        tokensIn: usage.prompt_tokens ?? 0,
        tokensOut: usage.completion_tokens ?? 0,
        cacheReadTokens: usage.prompt_cache_hit_tokens ?? 0,
        ms: Date.now() - started,
      };
    },
  };
}
