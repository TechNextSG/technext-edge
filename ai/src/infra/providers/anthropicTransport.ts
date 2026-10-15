import type { Transport, StructuredRequest, StructuredResponse, TextRequest } from "./core.ts";

export interface AnthropicTransportOptions {
  apiKey: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
}

const DEFAULT_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

function toAnthropicSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toAnthropicSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$schema" || key === "$ref") continue;
      out[key] = toAnthropicSchema(value);
    }
    return out;
  }
  return node;
}

export function createAnthropicTransport(options: AnthropicTransportOptions): Transport {
  const apiKey = options.apiKey;
  const model = options.model ?? "claude-haiku-5-5";
  const baseUrl = withoutTrailingSlashes(options.baseUrl ?? DEFAULT_API_BASE);

  return {
    async structured(req: StructuredRequest): Promise<StructuredResponse> {
      const controller = new AbortController();
      const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : undefined;

      try {
        const payload = {
          model,
          max_tokens: 4096,
          system: req.system,
          tools: [
            {
              name: req.toolName,
              description: "Extract structured trip details from a dive resort inquiry.",
              input_schema: toAnthropicSchema(req.schema),
            },
          ],
          tool_choice: { type: "tool", name: req.toolName },
          messages: [{ role: "user", content: req.user }],
        };

        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
        }

        const json = await response.json();
        const usage = json.usage ?? {};
        const content = Array.isArray(json.content) ? json.content : [];
        const toolUse = content.find((c: any) => c.type === "tool_use" && c.name === req.toolName);

        return {
          json: toolUse?.input ?? null,
          tokensIn: usage.input_tokens ?? 0,
          tokensOut: usage.output_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    async text(req: TextRequest): Promise<string> {
      const controller = new AbortController();
      const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : undefined;

      try {
        const payload = {
          model,
          max_tokens: 1024,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
        };

        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
        }

        const json = await response.json();
        const content = Array.isArray(json.content) ? json.content : [];
        const textBlock = content.find((c: any) => c.type === "text");
        return textBlock?.text?.trim() ?? "";
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
