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

// Deliberately higher than Gemini's 8s: DeepSeek's own measured p95 on a
// *successful* call is ~15.9s (ADR-005a) — an 8s cap here would misclassify
// normal latency as a hang and force a pointless doubling retry. 20s sits
// comfortably above the measured baseline.
const TIMEOUT_MS = 20_000;

// zod-to-json-schema with the OpenAPI target emits `exclusiveMinimum: true`
// for positive numbers. DeepSeek's tool-schema validator expects the newer
// numeric form and rejects that boolean with a 400. Zod still enforces the
// positive/integer constraints after the model responds, so dropping the
// unsupported bound here does not weaken the application's validation.
function toDeepSeekSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toDeepSeekSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "exclusiveMinimum" || key === "exclusiveMaximum") continue;
      out[key] = toDeepSeekSchema(value);
    }
    return out;
  }
  return node;
}

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
        "evidence for. Evidence must only be a verbatim substring for 'stated'; set it " +
        "to null for every other state. When state is 'missing', set both value and evidence to null; " +
        "never use 0 as a placeholder for an unknown count, and never assign unlabeled " +
        "comma-separated numbers to trip fields. Nights, guests, and rooms are 'stated' only when their " +
        "For 'guests': when a message mentions both a party/group size and a different number of people staying (e.g. 'group of 6 but only 3 are staying' or '4 are day visitors, 2 staying overnight'), always extract the number of guests staying overnight (state 'stated', evidence quoting the staying phrase) — even when the two numbers sit right next to each other with no other words between them. " +
        "Example: 'We are a group of 6 but only 4 of us are joining this trip.' -> guests is stated 4, evidence 'only 4 of us are joining this trip' — 6 is the group size, not the staying count, and this is not a case for 'missing' just because two counts appear. " +
        "When adults and children are specified (e.g. '2 adults and 2 kids'), extract their sum as guests. " +
        "A guest count the message states as a total is never reduced or nulled by a later detail about who is or is not diving, or any other per-person detail — that detail only affects fields it is actually about (like 'diver'), never 'guests'. " +
        "Example: 'We are a group of five in total: myself, my husband, and our three children (one of whom won't be diving with us).' -> guests is stated 5, evidence 'a group of five in total' — the note about one child not diving is not a reason to question or drop the stated total. " +
        "When a message gives a diving window as two dates joined by 'and' with no 'to'/'through' between them (e.g. 'dive on October 16th and 17th'), extract diveFrom as the first date and diveTo as the second date, both stated. " +
        // it wrong twice, in two languages, with the guest's own sentence as the evidence
        // (eval's vi-07 "xe tụi mình tự đi", zh-09 "自己开车过去"): both came back as
        // `transport: true`, which puts an airport transfer on the quote for a guest who is
        // driving themselves. Negation is the one thing a keyword rule cannot do and this model
        // can, so nothing in code tries — and a transfer nobody mentioned stays `missing`, which
        // is the question the guest then answers. providers/gemini.ts carries the same rule.
        "'transport' is true (stated) only when the guest asks the resort for an airport " +
        "pickup or transfer. Set it to false (stated) when they say they have their own " +
        "vehicle, are driving themselves, or do not need a transfer — 'xe tụi mình tự đi', " +
        "'tự chạy xe', 'own van', 'we have a car', '自己开车', '不需要接送'. Otherwise mark it " +
        "missing: a guest who never mentions the airport has not asked for anything. " +
        "'diver' is true (stated) when the guest asks to dive, take a dive course, or are divers. Set it to false (stated) when they say they are not diving, do not want to dive, or have no diving plans — 'no diving', 'không lặn', 'không có nhu cầu lặn', '不潜水'. Otherwise mark it missing. " +
        "Copy a date phrase into evidence verbatim, and also put your best ISO date " +
        "(YYYY-MM-DD) for it in that field's value, computed from today's date — the caller re-checks " +
        "that date against the guest's own words and asks the guest whenever the two disagree.";

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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`${GATEWAY_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            // The gateway rejects named/required tool_choice while thinking is
            // enabled. Extraction needs one deterministic tool call, so use
            // DeepSeek's non-thinking mode for this structured-output path.
            thinking: { type: "disabled" },
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
                  parameters: toDeepSeekSchema(jsonSchema),
                },
              },
            ],
            tool_choice: { type: "function", function: { name: TOOL_NAME } },
          }),
        });
      } catch (err) {
        // See gemini.ts's identical catch — same reasoning, same guarantee
        // that extract.ts's retry/error-classification logic handles this
        // like any other transport failure, never as a validation error.
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(`DeepSeek extract timed out after ${TIMEOUT_MS}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }

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
