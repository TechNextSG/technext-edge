import type { Transport, StructuredRequest, StructuredResponse, TextRequest } from "./core.ts";

export interface OpenAiCompatibleOptions {
  apiKey: string;
  baseUrl: string;
  model?: string | undefined;
  disableThinking?: boolean | undefined;
  name?: string | undefined;
}

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

function toOpenAiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toOpenAiSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "exclusiveMinimum" || key === "exclusiveMaximum") continue;
      out[key] = toOpenAiSchema(value);
    }
    return out;
  }
  return node;
}

function defaultToolDescription(name: string): string {
  if (name === "record_guests") return "Record the total guest count.";
  if (name === "record_checkin") return "Record the check-in date.";
  if (name === "record_dive_window") return "Record diving start and end dates.";
  return "Extract structured trip details from a dive resort inquiry.";
}

export function createOpenAiCompatibleTransport(options: OpenAiCompatibleOptions): Transport {
  if (!options.baseUrl) {
    throw new Error("Base URL is required for OpenAI-compatible transport");
  }
  const baseUrl = withoutTrailingSlashes(options.baseUrl);
  const model = options.model ?? "deepseek-flash";
  const name = options.name ?? "OpenAI compatible";

  return {
    async structured(req: StructuredRequest): Promise<StructuredResponse> {
      const controller = new AbortController();
      const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : undefined;

      try {
        const description = req.toolDescription ?? defaultToolDescription(req.toolName);

        const payload: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: req.toolName,
                description,
                parameters: toOpenAiSchema(req.schema),
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: req.toolName },
          },
        };

        if (options.disableThinking) {
          payload.thinking = { type: "disabled" };
        }

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`${name} extract failed: ${res.status} ${errText}`);
        }

        const body = await res.json();
        const usage = body.usage ?? {};
        const args = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "{}";

        const cacheRead =
          usage.prompt_cache_hit_tokens ??
          usage.prompt_tokens_details?.cached_tokens ??
          0;

        return {
          json: args,
          tokensIn: usage.prompt_tokens ?? 0,
          tokensOut: usage.completion_tokens ?? 0,
          cacheRead,
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    async text(req: TextRequest): Promise<string> {
      const controller = new AbortController();
      const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : undefined;

      try {
        const payload: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        };

        if (options.disableThinking) {
          payload.thinking = { type: "disabled" };
        }

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error(`${name} generateText failed: ${res.status}`);
        }

        const body = await res.json();
        return body.choices?.[0]?.message?.content?.trim() ?? "";
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
