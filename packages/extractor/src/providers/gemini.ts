// Demo default per steer: start with Gemini because it's outside Anthropic and
// cheapest through the two gates in the stack proposal (data-residency, then
// structured-output/cache). This is NOT the eval-decided winner — that only
// happens after the 30-message bake-off. Keep this adapter and the other two
// candidates (Claude, GPT-5.1) equally easy to write once eval time comes.
//
// Verify GEMINI_MODEL against https://ai.google.dev/gemini-api/docs/models
// before a real deploy — model names in this family change often and the
// value below is a placeholder, not a confirmed-current id.
import type { ExtractCall, ExtractProvider, ExtractResult, GuestsReadResult, CheckInReadResult, DiveWindowReadResult } from "../provider.js";

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

// Isolated checkIn-only prompt (2026-09-21, ADR-005a) — same reasoning as
// GUESTS_ONLY_PROMPT, added after DeepSeek (now primary) sometimes
// downgraded a clear relative-date phrase to 'inferred' with evidence
// nulled, disabling postProcess's own resolveRelativeDate safety net (it
// only runs when evidence is present). Kept in gemini.ts too for the same
// duplication reasoning as the other rules.
const CHECKIN_ONLY_PROMPT =
  "You extract ONE fact from a dive-resort guest's message: their check-in date. Find any phrase " +
  "— absolute or relative, like 'in 5 days', 'next Saturday', 'this weekend', a specific date — " +
  "that names a specific enough day to check in on. If found, compute your best ISO date " +
  "(YYYY-MM-DD) from today's date, and return state 'stated' with a verbatim quote of that phrase " +
  "as evidence. If the guest explicitly says they have not decided or not confirmed a date yet " +
  "(e.g. 'chưa chốt ngày', 'not sure yet', 'haven't decided'), or only gives a vague range too " +
  "wide to pin to one day (e.g. 'end of this month', 'cuối tháng này', 'sometime next month'), " +
  "that is 'missing' — do not invent a specific day for a vague range, even one that sounds " +
  "plausible. Only use 'inferred' if a specific day is implied with no expressible phrase at all, " +
  "and 'missing' if there is truly no timing information. Never invent a date the guest has not " +
  "actually pinned down.";

const CHECKIN_SCHEMA = {
  type: "object",
  properties: {
    value: { type: "string" },
    state: { type: "string", enum: ["stated", "inferred", "missing"] },
    evidence: { type: "string" },
  },
  required: ["value", "state", "evidence"],
};

// Isolated dive-window prompt (2026-09-21, ADR-005a) — same pattern and
// reasoning as deepseek.ts's DIVE_WINDOW_ONLY_PROMPT, kept in sync with it.
const DIVE_WINDOW_ONLY_PROMPT =
  "You extract TWO facts from a dive-resort guest's message: the date they start diving " +
  "(diveFrom) and the date they end diving (diveTo). Find any phrase that indicates diving " +
  "dates. If only one day is mentioned (e.g. 'diving on Oct 11th'), that single day is both " +
  "diveFrom and diveTo. If a range is given (e.g. 'Oct 11 to Oct 12' or 'Oct 16th and 17th'), " +
  "use the first date as diveFrom and the last as diveTo. Compute your best ISO date " +
  "(YYYY-MM-DD) for each from today's date. Return state 'stated' with a verbatim quote as " +
  "evidence for each field when found; 'missing' if the guest has not mentioned diving or given " +
  "no date for it. Never invent a date.";

const DIVE_WINDOW_SCHEMA = {
  type: "object",
  properties: {
    diveFromValue: { type: "string" },
    diveFromState: { type: "string", enum: ["stated", "inferred", "missing"] },
    diveFromEvidence: { type: "string" },
    diveToValue: { type: "string" },
    diveToState: { type: "string", enum: ["stated", "inferred", "missing"] },
    diveToEvidence: { type: "string" },
  },
  required: ["diveFromValue", "diveFromState", "diveFromEvidence", "diveToValue", "diveToState", "diveToEvidence"],
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
    async extractCheckIn(text: string, today: string): Promise<CheckInReadResult> {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: CHECKIN_ONLY_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: `Today's date (Asia/Manila): ${today}\n\nGuest message:\n${text}` }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: CHECKIN_SCHEMA },
          }),
        });
        if (!res.ok) throw new Error(`Gemini extractCheckIn failed: ${res.status} ${await res.text()}`);
        const body = await res.json();
        const usage = body.usageMetadata ?? {};
        const parsed = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
        const state: CheckInReadResult["state"] = parsed.state === "stated" || parsed.state === "inferred" ? parsed.state : "missing";
        return {
          value: state === "missing" ? null : (typeof parsed.value === "string" ? parsed.value : null),
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
    async extractDiveWindow(text: string, today: string): Promise<DiveWindowReadResult> {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: DIVE_WINDOW_ONLY_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: `Today's date (Asia/Manila): ${today}\n\nConversation so far:\n${text}` }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: DIVE_WINDOW_SCHEMA },
          }),
        });
        if (!res.ok) throw new Error(`Gemini extractDiveWindow failed: ${res.status} ${await res.text()}`);
        const body = await res.json();
        const usage = body.usageMetadata ?? {};
        const parsed = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
        const fromState: DiveWindowReadResult["diveFrom"]["state"] = parsed.diveFromState === "stated" || parsed.diveFromState === "inferred" ? parsed.diveFromState : "missing";
        const toState: DiveWindowReadResult["diveTo"]["state"] = parsed.diveToState === "stated" || parsed.diveToState === "inferred" ? parsed.diveToState : "missing";
        return {
          diveFrom: {
            value: fromState === "missing" ? null : (typeof parsed.diveFromValue === "string" ? parsed.diveFromValue : null),
            state: fromState,
            evidence: fromState === "stated" && typeof parsed.diveFromEvidence === "string" && parsed.diveFromEvidence.length > 0 ? parsed.diveFromEvidence : null,
          },
          diveTo: {
            value: toState === "missing" ? null : (typeof parsed.diveToValue === "string" ? parsed.diveToValue : null),
            state: toState,
            evidence: toState === "stated" && typeof parsed.diveToEvidence === "string" && parsed.diveToEvidence.length > 0 ? parsed.diveToEvidence : null,
          },
          tokensIn: usage.promptTokenCount ?? 0,
          tokensOut: usage.candidatesTokenCount ?? 0,
          ms: Date.now() - started,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    async generateText(systemPrompt: string, userPrompt: string): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          }),
        });
        if (!res.ok) throw new Error(`Gemini generateText failed: ${res.status}`);
        const body = await res.json();
        return body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
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
        "When a message gives a diving window as two dates joined by 'and' with no 'to'/'through' between them (e.g. 'dive on October 16th and 17th'), extract diveFrom as the first date and diveTo as the second date, both stated. " +
        "'transport' is true (stated) only when the guest asks the resort for an airport " +
        "pickup or transfer. Set it to false (stated) when they say they have their own " +
        "vehicle, are driving themselves, or do not need a transfer — 'xe tụi mình tự đi', " +
        "'tự chạy xe', 'own van', 'we have a car', '自己开车', '不需要接送'. Otherwise mark it " +
        "missing: a guest who never mentions the airport has not asked for anything. " +
        "'diver' is true (stated) when the guest asks to dive, take a dive course, or are divers. Set it to false (stated) when they say they are not diving, do not want to dive, or have no diving plans — 'no diving', 'không lặn', 'không có nhu cầu lặn', '不潜水'. Otherwise mark it missing. " +
        "For 'divers': how many people will actually dive, which is routinely fewer than 'guests' — '2 certified divers, grandma and 2 snorkelling kids' is guests 5 and divers 2; '6 AOW divers' is divers 6; 'both of us are divers' is divers 2. Mark it 'stated' only when the guest's own words give one number for how many dive. When different people dive on different days and no single number covers it (e.g. 'one person on the first day and five on both'), leave divers missing and put that breakdown in diveNotes instead — never average, split the difference, or fall back to the guest count. " +
        "For 'diveNotes': when the guest mentions specific diver schedules, splits, or arrangements (e.g. 'one person will dive on the first day and five will dive on both'), extract that breakdown as a concise string (state 'stated', evidence quoting the phrase). Otherwise missing. " +
        "For 'specialRequests': when the guest mentions special arrangements or requirements (e.g. 'day visitors joining', 'rollaway bed', 'photographer guide'), extract that as a concise string (state 'stated', evidence quoting the phrase). Otherwise missing. " +
        "For 'guestNames': when the guest mentions names of companions or members in their party (e.g. 'with Sarah, David and John'), extract them as an array of names (state 'stated', evidence quoting the phrase). Otherwise missing. " +
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

      // 2026-09-21: was maxRetries=3 with exponential backoff (5s/10s/20s) and
      // no ceiling on the API's own suggested retryDelay — under real
      // quota exhaustion this stacked to 35-90s+ *inside a single call*,
      // long enough that Vercel's own function timeout killed the whole
      // invocation before extract.ts's retry-once/apology-fallback path
      // ever got a turn. Confirmed live: a plain /v1/extract call hung
      // 25s+ with no response while this was in effect. A guest getting a
      // fast, honest failure (which extract.ts turns into an apology, not
      // silence) is better than one long enough to get killed with no
      // reply at all. See MAX_RETRY_WAIT_MS below.
      const maxRetries = 1;
      const MAX_RETRY_WAIT_MS = 3_000;
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
          // Deliberately short and capped — see MAX_RETRY_WAIT_MS's comment
          // above. Still honors the API's own suggested delay as a *signal*
          // (worth a short pause rather than hammering immediately), but
          // never trusts it enough to wait the full amount, since that
          // suggested delay is exactly what stacked to 51s+ in the incident
          // this replaced.
          let waitMs = 1_500;
          try {
            const parsed = JSON.parse(errText);
            const retryInfo = parsed.error?.details?.find(
              (d: Record<string, unknown>) => typeof d.retryDelay === "string"
            );
            if (retryInfo?.retryDelay) {
              const match = String(retryInfo.retryDelay).match(/(\d+(?:\.\d+)?)/);
              if (match) {
                waitMs = Math.ceil(parseFloat(match[1]) * 1000);
              }
            }
          } catch {
            // fallback to the 1.5s default
          }
          waitMs = Math.min(waitMs, MAX_RETRY_WAIT_MS);
          console.warn(`[gemini] Rate limited (429), waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries} (capped at ${MAX_RETRY_WAIT_MS}ms)...`);
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
