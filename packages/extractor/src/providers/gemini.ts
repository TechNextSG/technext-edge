// Demo default per steer: start with Gemini because it's outside Anthropic and
// cheapest through the two gates in the stack proposal (data-residency, then
// structured-output/cache). This is NOT the eval-decided winner — that only
// happens after the 30-message bake-off. Keep this adapter and the other two
// candidates (Claude, GPT-5.1) equally easy to write once eval time comes.
//
// Verify GEMINI_MODEL against https://ai.google.dev/gemini-api/docs/models
// before a real deploy — model names in this family change often and the
// value below is a placeholder, not a confirmed-current id.
import type { ExtractCall, ExtractProvider, ExtractResult, GuestsReadResult } from "../provider.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Playbook's own p95 target for the whole extraction. Measured p95 here is
// ~3.2s (ADR-005a), so 8s leaves real headroom without masking a genuine
// hang — a hung request would otherwise wait indefinitely, past Vercel's own
// function timeout, with no chance for extract.ts's retry-once path to help.
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 15_000);

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

// Isolated guests-only prompt (2026-09-21, ADR-005a) — deliberately small:
// no dates, no transport, no diver rules, nothing else competing for the
// model's attention. Verified 6/6 against the family email that failed
// 5/5 in the full multi-field prompt, with or without a reworded rule —
// isolation is what fixed it, not phrasing.
const GUESTS_ONLY_PROMPT =
  "You extract ONE fact from a dive-resort guest's message: the total number of guests staying. " +
  "Work in two steps. Step 1: find the single clause that states a total or sum of people staying, " +
  "and use that number — when adults and children are specified (e.g. '2 adults and 2 kids'), the " +
  "total is their sum. When a message mentions both a party/group size and a different, smaller " +
  "number of people actually staying (e.g. 'group of 6 but only 3 are staying'), the smaller staying " +
  "number is the total, not the group size. Step 2: ignore every other detail about one specific " +
  "person — their age, name, or whether they personally are diving — it never changes the total " +
  "found in step 1. Return state 'stated' with a verbatim quote as evidence when step 1 found a " +
  "clear total, 'inferred' if the total is implied but not stated outright, or 'missing' if the " +
  "message gives no way to determine how many are staying. Never invent a number.";

const GUESTS_SCHEMA = {
  type: "object",
  properties: {
    value: { type: "number" },
    state: { type: "string", enum: ["stated", "inferred", "missing"] },
    evidence: { type: "string" },
  },
  required: ["value", "state", "evidence"],
};

export function createGeminiProvider(apiKey: string, model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash"): ExtractProvider {
  return {
    id: "google:" + model,
    async extractGuests(text: string): Promise<GuestsReadResult> {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: GUESTS_ONLY_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: `Guest message:\n${text}` }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: GUESTS_SCHEMA },
          }),
        });
        if (!res.ok) throw new Error(`Gemini extractGuests failed: ${res.status} ${await res.text()}`);
        const body = await res.json();
        const usage = body.usageMetadata ?? {};
        const parsed = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
        const state: GuestsReadResult["state"] = parsed.state === "stated" || parsed.state === "inferred" ? parsed.state : "missing";
        return {
          value: state === "missing" ? null : (typeof parsed.value === "number" ? parsed.value : null),
          state,
          evidence: state === "stated" && typeof parsed.evidence === "string" && parsed.evidence.length > 0 ? parsed.evidence : null,
          tokensIn: usage.promptTokenCount ?? 0,
          tokensOut: usage.candidatesTokenCount ?? 0,
          ms: Date.now() - started,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    async call({ text, jsonSchema, today, retry }: ExtractCall): Promise<ExtractResult> {
      const started = Date.now();
      const systemPrompt =
        "You extract trip details from a dive-resort guest's message into the given " +
        "JSON schema. Every field needs a state: 'stated' (quote it in evidence, verbatim), " +
        "'inferred' (context implies it, no exact quote), or 'missing'. Never invent a value " +
        "For 'guests': when a message mentions both a party/group size and a different number of people staying (e.g. 'group of 6 but only 3 are staying' or '4 are day visitors, 2 staying overnight'), always extract the number of guests staying overnight (state 'stated', evidence quoting the staying phrase) — even when the two numbers sit right next to each other with no other words between them. " +
        "Example: 'We are a group of 6 but only 4 of us are joining this trip.' -> guests is stated 4, evidence 'only 4 of us are joining this trip' — 6 is the group size, not the staying count, and this is not a case for 'missing' just because two counts appear. " +
        "When adults and children are specified (e.g. '2 adults and 2 kids'), extract their sum as guests. " +
        // Note (2026-09-21, ADR-005a): a stronger version of this rule, tried
        // in this same multi-field prompt, still failed on a real family
        // email — the model dropped 'guests' to missing 5/5 even with a
        // step-by-step rewording. What actually works is isolating 'guests'
        // into its own call: see extractGuests() below and how extract.ts
        // runs it in parallel and overrides this field with its result.
        // Left the simpler wording here (rather than the failed rewording)
        // since a shorter prompt is one less variable, and this path is now
        // a fallback for providers/cases where the isolated call didn't run.
        "When a message gives a diving window as two dates joined by 'and' with no 'to'/'through' between them (e.g. 'dive on October 16th and 17th'), extract diveFrom as the first date and diveTo as the second date, both stated. " +
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

      const maxRetries = 3;
      let res: Response | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

        if (res.status === 429 && attempt < maxRetries) {
          const errText = await res.text();
          let waitMs = 5000 * Math.pow(2, attempt);
          try {
            const parsed = JSON.parse(errText);
            const retryInfo = parsed.error?.details?.find(
              (d: Record<string, unknown>) => typeof d.retryDelay === "string"
            );
            if (retryInfo?.retryDelay) {
              const match = String(retryInfo.retryDelay).match(/(\d+(?:\.\d+)?)/);
              if (match) {
                waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 1000;
              }
            }
          } catch {
            // fallback to exponential waitMs
          }
          console.warn(`[gemini] Rate limited (429), waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}...`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        break;
      }

      if (!res || !res.ok) {
        throw new Error(`Gemini extract failed: ${res?.status} ${await res?.text()}`);
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
