import type { Transport, StructuredRequest, StructuredResponse, TextRequest } from "./core.ts";

export interface GeminiTransportOptions {
  apiKey: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
}

const DEFAULT_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$schema" || k === "additionalProperties" || k === "$ref") continue;
      if (k === "exclusiveMinimum" || k === "exclusiveMaximum") continue;
      out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return node;
}

export function createGeminiTransport(options: GeminiTransportOptions): Transport {
  const apiKey = options.apiKey;
  const model = options.model ?? "gemini-3.1-flash-lite";
  const baseUrl = withoutTrailingSlashes(options.baseUrl ?? DEFAULT_API_BASE);

  return {
    async structured(req: StructuredRequest): Promise<StructuredResponse> {
      const maxRetries = 1;
      const MAX_RETRY_WAIT_MS = 3_000;
      let res: Response | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : undefined;

        try {
          res = await fetch(`${baseUrl}/${model}:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: req.system }] },
              contents: [{ role: "user", parts: [{ text: req.user }] }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: toGeminiSchema(req.schema),
              },
            }),
          });
        } finally {
          if (timer) clearTimeout(timer);
        }

        if (res.status === 429 && attempt < maxRetries) {
          const errText = await res.text().catch(() => "");
          let waitMs = 1_500;
          try {
            const parsed = JSON.parse(errText);
            const retryInfo = parsed.error?.details?.find(
              (d: Record<string, unknown>) => typeof d.retryDelay === "string",
            );
            if (retryInfo?.retryDelay) {
              const match = String(retryInfo.retryDelay).match(/(\d+(?:\.\d+)?)/);
              if (match) {
                waitMs = Math.ceil(parseFloat(match[1] ?? "0") * 1000);
              }
            }
          } catch {
            // fallback to default wait
          }
          waitMs = Math.min(waitMs, MAX_RETRY_WAIT_MS);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        break;
      }

      if (!res || !res.ok) {
        const errText = await res?.text().catch(() => "");
        throw new Error(`Gemini extract failed: ${res?.status} ${errText}`);
      }

      const body = await res.json();
      const usage = body.usageMetadata ?? {};
      const textOut = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

      return {
        json: textOut,
        tokensIn: usage.promptTokenCount ?? 0,
        tokensOut: usage.candidatesTokenCount ?? 0,
        cacheRead: usage.cachedContentTokenCount ?? 0,
      };
    },

    async text(req: TextRequest): Promise<string> {
      const controller = new AbortController();
      const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : undefined;

      try {
        const res = await fetch(`${baseUrl}/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: "user", parts: [{ text: req.user }] }],
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Gemini generateText failed: ${res.status} ${errText}`);
        }

        const body = await res.json();
        return body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
