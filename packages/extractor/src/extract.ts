import { zodToJsonSchema } from "zod-to-json-schema";
import { ZodError } from "zod";
import { Trip, HOUSE_NORM_FIELDS, type Trip as TripType, type Field } from "./schema.js";
import { HOUSE_NORMS } from "./houseNorms.js";
import { manilaToday, resolveRelativeDate, deriveCheckOut } from "./dates.js";
import { normalize, detectLanguage, maskForLogging } from "./normalize.js";
import { generateQuestions } from "./questions.js";
import type { ExtractProvider } from "./provider.js";

const TRIP_JSON_SCHEMA = zodToJsonSchema(Trip, { $refStrategy: "none", target: "openApi3" });

export interface ExtractionOutcome {
  trip: TripType;
  questions: Array<{ field: keyof TripType; question: string }>;
  meta: {
    provider: string;
    tokensIn: number;
    tokensOut: number;
    cacheReadTokens: number;
    ms: number;
    retried: boolean;
  };
}

export class ExtractionValidationError extends Error {
  constructor(public readonly zodIssues: unknown, public readonly sample: string) {
    super("Trip failed schema validation after retry");
  }
}

// Internal: carries the model's raw (unvalidated) output alongside the zod
// failure, so a retry can show the model what it got wrong instead of just
// rolling the dice again with an identical prompt.
class AttemptFailure extends Error {
  constructor(public readonly cause: unknown, public readonly raw: unknown) {
    super("attempt failed validation");
  }
}

function summarizeError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * POST /v1/extract's pipeline. Exactly one seam to a vendor: `provider.call`.
 * Everything else here is deterministic code, per the Playbook's "trust the
 * model for text, not for dates or defaults" rule.
 */
export async function extract(rawText: string, provider: ExtractProvider): Promise<ExtractionOutcome> {
  const text = normalize(rawText);
  const today = manilaToday();

  // maskForLogging is for whatever calls this and logs `text` — not applied here.
  void maskForLogging;

  type Attempt = { parsed: TripType; result: Awaited<ReturnType<ExtractProvider["call"]>> };

  const attempt = async (retry?: { previousRaw: unknown; error: string }): Promise<Attempt> => {
    const result = await provider.call({ text, jsonSchema: TRIP_JSON_SCHEMA, today, retry });
    try {
      const postProcessed = postProcess(result.raw, today, text);
      const parsed = Trip.parse(postProcessed); // throws ZodError on failure
      return { parsed, result };
    } catch (validationErr) {
      // Carries the model's own raw output forward — a network/schema-level
      // failure from provider.call() itself skips this catch entirely and
      // surfaces with no `raw`, since there's nothing the model can fix there.
      throw new AttemptFailure(validationErr, result.raw);
    }
  };

  let retried = false;
  let outcome: Attempt;
  try {
    outcome = await attempt();
  } catch (firstErr) {
    retried = true;
    const retryContext =
      firstErr instanceof AttemptFailure
        ? { previousRaw: firstErr.raw, error: summarizeError(firstErr.cause) }
        : undefined; // a transport-level failure — nothing to hand back to the model
    try {
      outcome = await attempt(retryContext); // Playbook: "call again once ... if the second attempt still fails, return 422"
    } catch (secondErr) {
      const cause = secondErr instanceof AttemptFailure ? secondErr.cause : secondErr;
      throw new ExtractionValidationError(cause, text);
    }
  }

  const questions = generateQuestions(outcome.parsed);

  return {
    trip: outcome.parsed,
    questions,
    meta: {
      provider: provider.id,
      tokensIn: outcome.result.tokensIn,
      tokensOut: outcome.result.tokensOut,
      cacheReadTokens: outcome.result.cacheReadTokens,
      ms: outcome.result.ms,
      retried,
    },
  };
}

// Everything the model is not trusted to get right, done here instead:
//  - relative dates resolved against Manila "today"
//  - checkOut always derived from checkIn + nights, never taken from the model
//  - house norms applied to exactly the allowed fields when they come back missing
//  - language re-checked by heuristic when the model left it missing
function postProcess(raw: unknown, today: string, sourceText: string): unknown {
  const trip = structuredClone(raw) as Record<string, Field<unknown>>;

  const checkIn = trip.checkIn;
  if (checkIn && (checkIn.state === "stated" || checkIn.state === "inferred") && checkIn.evidence) {
    const resolved = resolveRelativeDate(checkIn.evidence, today);
    if (resolved) {
      checkIn.value = resolved;
    } else {
      checkIn.value = null;
      checkIn.state = "missing";
    }
  }

  const nights = trip.nights;
  if (checkIn?.value && typeof nights?.value === "number") {
    trip.checkOut = {
      value: deriveCheckOut(checkIn.value as string, nights.value),
      state: "derived",
      evidence: null,
    };
  }

  for (const key of HOUSE_NORM_FIELDS) {
    const f = trip[key];
    if (f && f.state === "missing") {
      trip[key] = { value: (HOUSE_NORMS as Record<string, unknown>)[key], state: "default", evidence: null };
    }
  }

  if (trip.language?.state === "missing") {
    trip.language = { value: detectLanguage(sourceText), state: "inferred", evidence: null };
  }

  enforceVerbatimEvidence(trip, sourceText);

  return trip;
}

// Playbook eval metric: "evidence is a verbatim substring — 100%, checked in
// code, no judge needed." This is that check. A field claiming "stated" with
// evidence the source text doesn't actually contain is downgraded to
// "missing" rather than trusted — the fabricated-fields-must-be-zero rule
// applies here, in code, not only in the eval report.
function enforceVerbatimEvidence(trip: Record<string, Field<unknown>>, sourceText: string): void {
  const haystack = sourceText.toLowerCase();
  for (const [key, f] of Object.entries(trip)) {
    if (f?.state === "stated") {
      if (!f.evidence || !haystack.includes(f.evidence.toLowerCase())) {
        trip[key] = { value: null, state: "missing", evidence: null };
      }
    }
  }
}
