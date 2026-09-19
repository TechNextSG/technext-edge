import { zodToJsonSchema } from "zod-to-json-schema";
import { ZodError } from "zod";
import { Trip, HOUSE_NORM_FIELDS, type Trip as TripType, type Field, type FieldState } from "./schema.js";
import { HOUSE_NORMS } from "./houseNorms.js";
import { manilaToday, resolveRelativeDate, deriveCheckOut, corroborateDatePhrase } from "./dates.js";
import { normalize, detectLanguage, guestTextOf, maskForLogging } from "./normalize.js";
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
      if (secondErr instanceof AttemptFailure) {
        throw new ExtractionValidationError(secondErr.cause, text);
      }
      // Not a validation failure — the provider itself failed both times
      // (rate limit, 5xx, network). Surface as-is so the caller can tell
      // "the model produced bad JSON twice" apart from "we got rate limited
      // twice in a row" instead of both reading as one generic 422. Found via
      // the eval harness: a Gemini free-tier 429 was being reported as
      // "model output did not match the Trip schema" — misleading.
      throw secondErr;
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

// The two FieldStates that are this file's to set: `default` (house norms, applied
// to exactly HOUSE_NORM_FIELDS below) and `derived` (checkOut from checkIn + nights,
// transportType from the transport boolean). The prompt tells the model its states
// are 'stated', 'inferred' or 'missing' (see providers/deepseek.ts) — a `default` a
// model pins on its own guess would otherwise be shown to the guest as a house norm,
// and, being non-missing, would keep the question from ever being asked.
const CODE_ONLY_STATES: ReadonlyArray<FieldState> = ["default", "derived"];

// Everything the model is not trusted to get right, done here instead:
//  - relative dates resolved against Manila "today" — and, for a phrase the table
//    cannot read, a model-proposed date corroborated against that phrase first
//    (see the checkIn block below)
//  - checkOut always derived from checkIn + nights, never taken from the model
//  - house norms applied to exactly the allowed fields when they come back missing
//  - language re-checked by heuristic when the model left it missing
function postProcess(raw: unknown, today: string, sourceText: string): unknown {
  const trip = structuredClone(raw) as Record<string, Field<unknown>>;

  // Evidence, language and guest-type detection read the *guest's* words only.
  // A transcript also carries the assistant's own replies, and a field the bot
  // printed itself ("Meals: full board") would otherwise come back as a
  // "stated" field on the next turn, with the bot's own sentence as evidence.
  const guestText = guestTextOf(sourceText);

  // Some structured-output providers use 0 as a stand-in for an unknown
  // positive count. It is recoverable missing information: ask the guest
  // instead of failing the entire conversation turn.
  for (const key of ["nights", "guests", "rooms"] as const) {
    const field = trip[key];
    if (field?.state === "inferred" || (typeof field?.value === "number" && field.value <= 0)) {
      trip[key] = { value: null, state: "missing", evidence: null };
    }
  }

  // Neither an absent key nor a state only code may set is an answer, and the two
  // have the same symptom: the field stops being `missing`, so it is never asked
  // about. The Tier-2 Odoo fields are optional in the schema, so a model that simply
  // leaves one out produces a trip with no state for it — measured against the live
  // provider on 2026-09-19, on the first message of a real WhatsApp run: the same
  // text came back with `diver: missing` on one call and with no `diver` key at all on
  // the next. The first reply asked "would you like to go diving", the second dropped
  // the question entirely — for the field dive revenue is priced from. Normalizing
  // both cases to `missing` here is what turns them back into a question (or, for the
  // four house-norm fields, into the norm a few lines below).
  for (const key of Object.keys(Trip.shape) as Array<keyof TripType>) {
    const field = trip[key] as Field<unknown> | undefined;
    if (!field || typeof field !== "object" || field.state === undefined || CODE_ONLY_STATES.includes(field.state)) {
      trip[key] = { value: null, state: "missing", evidence: null };
    }
  }

  // 1. checkIn — the model may propose a date; code decides whether it is one.
  //
  // The original rule ("relative dates are computed in code, never trusted from the
  // model", dates.ts) is the first branch, and it wins whenever the resolver can read
  // the phrase. The second branch is what used to be a bug: when the table could not
  // read the phrase, the model's own date — often correct — was deleted along with the
  // evidence, so a guest who wrote "下周五" or "hôm kia" was asked for a date they had
  // already given. A date the model computed is now kept when the guest's own phrase
  // corroborates it (weekday, month, day, week qualifier) and the calendar accepts it;
  // otherwise the field goes back to `missing` and becomes the question it should be.
  //
  // Corroborated means `stated`, not `inferred`. `inferred` is the state that no code
  // path fills and no question asks about — a money field priced from an assumption,
  // which is the shape ADR-006 Decision 4 forbids. Here the guest *did* state the date
  // and code did check the model's reading of it against their words, so `stated` is
  // the honest state, and it is also what keeps the date off the question list.
  const checkIn = trip.checkIn;
  if (checkIn && (checkIn.state === "stated" || checkIn.state === "inferred") && checkIn.evidence) {
    const resolved = resolveRelativeDate(checkIn.evidence, today);
    const proposed = typeof checkIn.value === "string" ? checkIn.value : null;
    if (resolved) {
      // Code read the phrase itself, so this is the guest's own date whether or not the
      // model also computed one — and `stated` is what records that (an `inferred` left
      // here would keep its value while losing the evidence, priced and never asked).
      checkIn.value = resolved;
      checkIn.state = "stated";
    } else if (proposed && corroborateDatePhrase(checkIn.evidence, proposed, today) === "consistent") {
      checkIn.value = proposed;
      checkIn.state = "stated";
    } else {
      checkIn.value = null;
      checkIn.state = "missing";
      checkIn.evidence = null;
    }
  }

  for (const key of HOUSE_NORM_FIELDS) {
    const f = trip[key];
    if (f && f.state === "missing") {
      trip[key] = { value: (HOUSE_NORMS as Record<string, unknown>)[key], state: "default", evidence: null };
    }
  }

  // Language is detected deterministically from the guest's text. A model must
  // not label it "stated" simply because it saw an English or Vietnamese
  // sentence; guests do not normally state their language explicitly.
  trip.language = { value: detectLanguage(guestText), state: "inferred", evidence: null };

  // Align with Odoo Estimate API (estimate-api.v1.json / casa-api-guide):
  // 1. guestType: detect agency phrasing or default to "retail"
  const isAgent = /\b(agency|travel\s+agent|travel\s+agency|agent|tour\s+operator)\b|đại\s*lý|旅行社|代理/i.test(guestText);
  if (!trip.guestType || trip.guestType.state === "missing") {
    trip.guestType = isAgent
      ? { value: "agent", state: "inferred", evidence: null }
      : { value: "retail", state: "default", evidence: null };
  }

  // 2. transportType: maps from transport boolean (roundtrip vs none)
  if (!trip.transportType || trip.transportType.state === "missing") {
    if (trip.transport?.value === true) {
      trip.transportType = { value: "roundtrip", state: "derived", evidence: null };
    } else if (trip.transport?.value === false) {
      trip.transportType = { value: "none", state: "derived", evidence: null };
    } else {
      trip.transportType = { value: "none", state: "default", evidence: null };
    }
  }

  // 3. diver and dive window (diveFrom / diveTo)
  // These used to be *inferred* here by a keyword regex, with the window then
  // derived as the whole stay. Both were wrong for the same reason: the regex fed
  // a money field, and a derived window is an assumption the guest never agreed
  // to, so a guest who wrote "we might dive" was priced for a dive package. All
  // three now come from the model's structured output when the guest actually
  // said something, and otherwise from a question the guest answers
  // (questions.ts): diver is asked outright, and the window only once diver is
  // true, so a non-diving enquiry is never asked for a dive window.
  //
  // Enforced here, not merely described: `stated` is the only dive answer that
  // survives this function. An `inferred` one ("we might dive") would be priced as
  // though the guest had confirmed it and — being non-missing — would never be asked
  // about, which is the same money bug through a different door. ADR-006 Decision 4
  // is "ask what money depends on; never infer it", so an unconfirmed answer becomes
  // `missing` again and the guest's own reply is the only thing that fills it.
  for (const key of ["diver", "diveFrom", "diveTo"] as const) {
    if (trip[key]?.state !== "stated") {
      trip[key] = { value: null, state: "missing", evidence: null };
    }
  }


  // Evidence proves an explicit guest statement only. Keeping it on inferred,
  // missing, default or derived fields makes the UI look more certain than the
  // underlying data and can turn an ambiguous reply into a fabricated fact.
  for (const field of Object.values(trip)) {
    if (field && field.state !== "stated") {
      field.evidence = null;
    }
  }

  enforceVerbatimEvidence(trip, guestText);

  // checkOut is arithmetic on the guest's own answers, and it runs *after* evidence
  // enforcement on purpose: a check-in or a night count that did not survive
  // enforcement must not leave a derived check-out behind, pointing at a source that
  // no longer exists. (robustness.test.ts found the earlier order — the derived date
  // was computed first and outlived the check-in it came from.)
  const nights = trip.nights;
  if (trip.checkIn?.value && typeof nights?.value === "number") {
    trip.checkOut = {
      value: deriveCheckOut(trip.checkIn.value as string, nights.value),
      state: "derived",
      evidence: null,
    };
  }

  return trip;
}

// Playbook eval metric: "evidence is a verbatim substring — 100%, checked in
// code, no judge needed." This is that check. A field claiming "stated" with
// evidence the source text doesn't actually contain is downgraded to
// "missing" rather than trusted — the fabricated-fields-must-be-zero rule
// applies here, in code, not only in the eval report.
//
// The haystack is the guest's own words, never the whole transcript: the bot's
// replies are in the transcript too, and checking against them would let a value
// the bot printed come back as a guest-stated fact on the next turn.
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
