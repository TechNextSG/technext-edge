import type {
  ExtractCall,
  ExtractProvider,
  ExtractResult,
  GuestsReadResult,
  CheckInReadResult,
  DiveWindowReadResult,
} from "../../ports/provider.ts";
import { MalformedArgumentsError } from "../../ports/provider.ts";
import {
  EXTRACT_SYSTEM_PROMPT,
  GUESTS_ONLY_PROMPT,
  CHECKIN_ONLY_PROMPT,
  DIVE_WINDOW_ONLY_PROMPT,
  GUESTS_SCHEMA,
  CHECKIN_SCHEMA,
  DIVE_WINDOW_SCHEMA,
} from "./prompts.ts";

export interface StructuredRequest {
  system: string;
  user: string;
  toolName: string;
  toolDescription?: string | undefined;
  schema: unknown;
  timeoutMs?: number | undefined;
}

export interface StructuredResponse {
  json: unknown;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  cacheRead?: number | undefined;
}

export interface TextRequest {
  system: string;
  user: string;
  timeoutMs?: number | undefined;
}

export interface Transport {
  structured(req: StructuredRequest): Promise<StructuredResponse>;
  text?(req: TextRequest): Promise<string>;
}

export interface CoreProviderOptions {
  id: string;
  timeoutMs?: number | undefined;
  synthesisTimeoutMs?: number | undefined;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 8_000;

function parseStructuredJson(json: unknown): unknown {
  if (typeof json === "string") {
    try {
      return JSON.parse(json);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new MalformedArgumentsError(`not valid JSON: ${detail}`, json.slice(0, 2000), err);
    }
  }
  if (typeof json === "object" && json !== null) {
    return json;
  }
  throw new MalformedArgumentsError(
    "Missing or invalid tool arguments",
    JSON.stringify(json ?? null),
  );
}

function parseFocusedJson(json: unknown): any {
  if (typeof json === "string") {
    try {
      return JSON.parse(json);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new MalformedArgumentsError(`not valid JSON: ${detail}`, json.slice(0, 2000), err);
    }
  }
  if (typeof json === "object" && json !== null) {
    return json;
  }
  throw new MalformedArgumentsError(
    "Missing or invalid tool arguments",
    JSON.stringify(json ?? null),
  );
}

/**
 * Creates a shared ExtractProvider on top of a low-level Transport (Pattern 1 & Pattern 3).
 * Standardizes prompt assembly, execution flow, error handling, timeouts, and all 5 passes.
 */
export function createExtractProvider(
  transport: Transport,
  options: CoreProviderOptions,
): ExtractProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const synthesisTimeoutMs = options.synthesisTimeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS;

  return {
    id: options.id,

    answeredBy(): string {
      return options.id;
    },

    async call(input: ExtractCall): Promise<ExtractResult> {
      const started = Date.now();
      let userPrompt = `Today's date (Asia/Manila): ${input.today}\n\nGuest message:\n${input.text}`;
      if (input.retry) {
        userPrompt += `\n\n[RETRY NOTICE: Your previous extraction failed validation: ${input.retry.error}. Previous output was: ${JSON.stringify(input.retry.previousRaw)}. Please fix all invalid fields.]`;
      }

      let res: StructuredResponse;
      try {
        res = await transport.structured({
          system: EXTRACT_SYSTEM_PROMPT,
          user: userPrompt,
          toolName: "extract_trip",
          toolDescription: "Extract structured trip details from a dive resort inquiry.",
          schema: input.jsonSchema,
          timeoutMs,
        });
      } catch (err) {
        if (err instanceof Error && (err.name === "AbortError" || /timed out|aborted/i.test(err.message))) {
          throw new Error(`${options.id} extract timed out after ${timeoutMs}ms`);
        }
        throw err;
      }

      const raw = parseStructuredJson(res.json);

      return {
        raw,
        tokensIn: res.tokensIn ?? 0,
        tokensOut: res.tokensOut ?? 0,
        cacheReadTokens: res.cacheRead ?? 0,
        ms: Date.now() - started,
      };
    },

    async extractGuests(text: string): Promise<GuestsReadResult> {
      const started = Date.now();
      let res: StructuredResponse;
      try {
        res = await transport.structured({
          system: GUESTS_ONLY_PROMPT,
          user: `Guest message:\n${text}`,
          toolName: "record_guests",
          toolDescription: "Record the total guest count.",
          schema: GUESTS_SCHEMA,
          timeoutMs,
        });
      } catch (err) {
        if (err instanceof Error && (err.name === "AbortError" || /timed out|aborted/i.test(err.message))) {
          throw new Error(`${options.id} extractGuests timed out after ${timeoutMs}ms`);
        }
        throw err;
      }

      const parsed = parseFocusedJson(res.json);
      const state: GuestsReadResult["state"] =
        parsed.state === "stated" || parsed.state === "inferred" ? parsed.state : "missing";

      return {
        value: state === "missing" ? null : (typeof parsed.value === "number" ? parsed.value : null),
        state,
        evidence:
          state === "stated" && typeof parsed.evidence === "string" && parsed.evidence.length > 0
            ? parsed.evidence
            : null,
        tokensIn: res.tokensIn ?? 0,
        tokensOut: res.tokensOut ?? 0,
        ms: Date.now() - started,
      };
    },

    async extractCheckIn(text: string, today: string): Promise<CheckInReadResult> {
      const started = Date.now();
      let res: StructuredResponse;
      try {
        res = await transport.structured({
          system: CHECKIN_ONLY_PROMPT,
          user: `Today's date (Asia/Manila): ${today}\n\nGuest message:\n${text}`,
          toolName: "record_checkin",
          toolDescription: "Record the check-in date.",
          schema: CHECKIN_SCHEMA,
          timeoutMs,
        });
      } catch (err) {
        if (err instanceof Error && (err.name === "AbortError" || /timed out|aborted/i.test(err.message))) {
          throw new Error(`${options.id} extractCheckIn timed out after ${timeoutMs}ms`);
        }
        throw err;
      }

      const parsed = parseFocusedJson(res.json);
      const state: CheckInReadResult["state"] =
        parsed.state === "stated" || parsed.state === "inferred" ? parsed.state : "missing";

      return {
        value: state === "missing" ? null : (typeof parsed.value === "string" ? parsed.value : null),
        state,
        evidence:
          state === "stated" && typeof parsed.evidence === "string" && parsed.evidence.length > 0
            ? parsed.evidence
            : null,
        tokensIn: res.tokensIn ?? 0,
        tokensOut: res.tokensOut ?? 0,
        ms: Date.now() - started,
      };
    },

    async extractDiveWindow(text: string, today: string): Promise<DiveWindowReadResult> {
      const started = Date.now();
      let res: StructuredResponse;
      try {
        res = await transport.structured({
          system: DIVE_WINDOW_ONLY_PROMPT,
          user: `Today's date (Asia/Manila): ${today}\n\nConversation so far:\n${text}`,
          toolName: "record_dive_window",
          toolDescription: "Record diving start and end dates.",
          schema: DIVE_WINDOW_SCHEMA,
          timeoutMs,
        });
      } catch (err) {
        if (err instanceof Error && (err.name === "AbortError" || /timed out|aborted/i.test(err.message))) {
          throw new Error(`${options.id} extractDiveWindow timed out after ${timeoutMs}ms`);
        }
        throw err;
      }

      const parsed = parseFocusedJson(res.json);
      const fromState: DiveWindowReadResult["diveFrom"]["state"] =
        parsed.diveFromState === "stated" || parsed.diveFromState === "inferred"
          ? parsed.diveFromState
          : "missing";
      const toState: DiveWindowReadResult["diveTo"]["state"] =
        parsed.diveToState === "stated" || parsed.diveToState === "inferred"
          ? parsed.diveToState
          : "missing";

      return {
        diveFrom: {
          value:
            fromState === "missing"
              ? null
              : typeof parsed.diveFromValue === "string"
                ? parsed.diveFromValue
                : null,
          state: fromState,
          evidence:
            fromState === "stated" &&
            typeof parsed.diveFromEvidence === "string" &&
            parsed.diveFromEvidence.length > 0
              ? parsed.diveFromEvidence
              : null,
        },
        diveTo: {
          value:
            toState === "missing"
              ? null
              : typeof parsed.diveToValue === "string"
                ? parsed.diveToValue
                : null,
          state: toState,
          evidence:
            toState === "stated" &&
            typeof parsed.diveToEvidence === "string" &&
            parsed.diveToEvidence.length > 0
              ? parsed.diveToEvidence
              : null,
        },
        tokensIn: res.tokensIn ?? 0,
        tokensOut: res.tokensOut ?? 0,
        ms: Date.now() - started,
      };
    },

    ...(transport.text
      ? {
          async generateText(systemPrompt: string, userPrompt: string): Promise<string> {
            return transport.text!({
              system: systemPrompt,
              user: userPrompt,
              timeoutMs: synthesisTimeoutMs,
            });
          },
        }
      : {}),
  };
}
