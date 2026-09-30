import { zodToJsonSchema } from "zod-to-json-schema";
import { ZodError } from "zod";
import { Trip, HOUSE_NORM_FIELDS, type Trip as TripType, type Field, type FieldState } from "../domain/schema.js";
import { HOUSE_NORMS } from "../domain/houseNorms.js";
import { manilaToday, resolveRelativeDate, deriveCheckOut, deriveNightsFromRange, corroborateDatePhrase, isPlausibleStayDate, isPastDate } from "../domain/dates.js";
import { corroborateCount } from "../domain/counts.js";
import { normalize, detectLanguage, guestTextOf } from "./normalize.js";
import { generateQuestions } from "./questions.js";
import type { ExtractProvider } from "../ports/provider.js";
import { MalformedArgumentsError } from "../ports/provider.js";

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

  // Isolated guests pass (2026-09-21, ADR-005a), started now so it runs in
  // parallel with the main call below rather than adding latency after it.
  // A provider without extractGuests, or a call that throws, just means no
  // override later — never a hard failure over this safety net.
  const guestsPromise: Promise<Awaited<ReturnType<NonNullable<ExtractProvider["extractGuests"]>>> | null> = provider.extractGuests
    ? provider.extractGuests(text).catch(() => null)
    : Promise.resolve(null);

  // Same pattern, same day, for checkIn — see provider.ts's CheckInReadResult
  // doc for why (DeepSeek downgrading a clear relative-date phrase to
  // 'inferred' with evidence nulled, disabling postProcess's own
  // resolveRelativeDate safety net below).
  const checkInPromise: Promise<Awaited<ReturnType<NonNullable<ExtractProvider["extractCheckIn"]>>> | null> = provider.extractCheckIn
    ? provider.extractCheckIn(text, today).catch(() => null)
    : Promise.resolve(null);

  // Same pattern, same day, for the dive window (diveFrom/diveTo) — found
  // via scripts/test-anilao-real-matrix.ts's AN-01 scenario: "diving on
  // Oct 11th" in a follow-up turn came back diveFrom:null 4/4 in the full
  // prompt, isolated 5/5 correct.
  const diveWindowPromise: Promise<Awaited<ReturnType<NonNullable<ExtractProvider["extractDiveWindow"]>>> | null> = provider.extractDiveWindow
    ? provider.extractDiveWindow(text, today).catch(() => null)
    : Promise.resolve(null);

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
      // Malformed JSON is the exception: it comes back as a
      // `MalformedArgumentsError` from the provider and is handled one level up
      // as the model's own fixable mistake, not as a transport failure.
      throw new AttemptFailure(validationErr, result.raw);
    }
  };

  let retried = false;
  let outcome: Attempt;
  try {
    outcome = await attempt();
  } catch (firstErr) {
    retried = true;
    // Two failures are the model's to fix and get the error attached: a payload that parsed but
    // failed the schema (`AttemptFailure`), and a payload that was not valid JSON at all
    // (`MalformedArgumentsError`). Both are model OUTPUT; a 5xx, a timeout or a network error is
    // not, and there is nothing to hand back for one of those, so the retry is a plain repeat.
    const correctable: { previousRaw: unknown; error: string } | undefined =
      firstErr instanceof AttemptFailure
        ? { previousRaw: firstErr.raw, error: summarizeError(firstErr.cause) }
        : firstErr instanceof MalformedArgumentsError
          ? { previousRaw: firstErr.rawText, error: firstErr.message }
          : undefined;
    try {
      outcome = await attempt(correctable); // Playbook: "call again once ... if the second attempt still fails, return 422"
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

  // Apply the isolated guests pass as a safety net only: it fills in a gap
  // (main pass came back 'missing') rather than overriding an answer the
  // main pass already committed to — the dedicated call has only been
  // verified against the case it was built for, not the full eval suite,
  // so it should not get to overrule a pass that already succeeded.
  // 'stated' still goes through the same verbatim-evidence check every
  // other 'stated' claim does, against the guest's own words only.
  const guestsRead = await guestsPromise;
  let guestsTokensIn = 0;
  let guestsTokensOut = 0;
  let guestsMs = 0;
  if (guestsRead) {
    guestsTokensIn = guestsRead.tokensIn;
    guestsTokensOut = guestsRead.tokensOut;
    guestsMs = guestsRead.ms;
    // Requires 'stated' specifically, not just "not missing" — found live on
    // production the same day this shipped (via the sibling diveWindow
    // override, same bug pattern): an unevidenced 'inferred' sailed straight
    // through the old check below, since it only required verbatim evidence
    // for 'stated'. An 'inferred' guest count with no real phrase behind it
    // is exactly the fabrication this whole pipeline exists to block.
    if (outcome.parsed.guests.state === "missing" && guestsRead.state === "stated" && typeof guestsRead.value === "number") {
      const guestText = guestTextOf(text).toLowerCase();
      const evidenceOk = !!guestsRead.evidence && guestText.includes(guestsRead.evidence.toLowerCase());
      if (evidenceOk) {
        outcome.parsed.guests = { value: guestsRead.value, state: "stated", evidence: guestsRead.evidence };
      }
    }
  }

  // Same safety-net discipline as guests: only fills a gap (main pass not
  // already 'stated'), never overrules a 'stated' the main pass already
  // committed to. 'stated' still needs verbatim evidence in the guest's own
  // words, and the resulting date still has to be a plausible stay date —
  // this does not get to skip the checks any other date takes.
  const checkInRead = await checkInPromise;
  let checkInTokensIn = 0;
  let checkInTokensOut = 0;
  let checkInMs = 0;
  if (checkInRead) {
    checkInTokensIn = checkInRead.tokensIn;
    checkInTokensOut = checkInRead.tokensOut;
    checkInMs = checkInRead.ms;
    // Requires 'stated' specifically — see the same fix on guests just above
    // for why an unevidenced 'inferred' must never pass this check.
    if (outcome.parsed.checkIn.state !== "stated" && checkInRead.state === "stated" && typeof checkInRead.value === "string") {
      const guestText = guestTextOf(text).toLowerCase();
      const evidenceOk = !!checkInRead.evidence && guestText.includes(checkInRead.evidence.toLowerCase());
      if (evidenceOk && isPlausibleStayDate(checkInRead.value, today)) {
        outcome.parsed.checkIn = { value: checkInRead.value, state: "stated", evidence: checkInRead.evidence };
        // checkOut was derived from whatever checkIn the main pass had — stale
        // now that checkIn changed, and robustness.test.ts is explicit that a
        // derived date must never outlive the check-in it came from.
        const nights = outcome.parsed.nights;
        if (typeof nights.value === "number") {
          outcome.parsed.checkOut = { value: deriveCheckOut(checkInRead.value, nights.value), state: "derived", evidence: null };
        }
      }
    }
  }

  // Same safety-net discipline again, for diveFrom/diveTo together. Gated on
  // diver already being true: a dive window has no business appearing on a
  // trip that isn't a diving trip, regardless of what an isolated call
  // guesses.
  const diveWindowRead = await diveWindowPromise;
  let diveWindowTokensIn = 0;
  let diveWindowTokensOut = 0;
  let diveWindowMs = 0;
  if (diveWindowRead) {
    diveWindowTokensIn = diveWindowRead.tokensIn;
    diveWindowTokensOut = diveWindowRead.tokensOut;
    diveWindowMs = diveWindowRead.ms;
    if (outcome.parsed.diver?.value === true) {
      const guestText = guestTextOf(text).toLowerCase();
      for (const key of ["diveFrom", "diveTo"] as const) {
        const current = outcome.parsed[key];
        const read = diveWindowRead[key];
        // Unlike guests/checkIn, 'inferred' is never accepted here: a dive
        // date has no legitimate basis to guess from context the way a
        // guest count can (adults + kids summed). Found live on production
        // (2026-09-21): "we'd like to dive" with no date at all came back
        // diveFrom/diveTo 'inferred' with evidence:null 4/5 runs, and the
        // old check only required verbatim evidence for 'stated' — an
        // unevidenced 'inferred' sailed straight through. Require 'stated'
        // with real evidence, full stop; anything else is treated the same
        // as 'missing'.
        if (current?.state !== "stated" && read.state === "stated" && typeof read.value === "string") {
          const evidenceOk = !!read.evidence && guestText.includes(read.evidence.toLowerCase());
          if (evidenceOk && isPlausibleStayDate(read.value, today)) {
            outcome.parsed[key] = { value: read.value, state: "stated", evidence: read.evidence };
          }
        }
      }
    }
  }

  const questions = generateQuestions(outcome.parsed);

  return {
    trip: outcome.parsed,
    questions,
    meta: {
      provider: provider.id,
      tokensIn: outcome.result.tokensIn + guestsTokensIn + checkInTokensIn + diveWindowTokensIn,
      tokensOut: outcome.result.tokensOut + guestsTokensOut + checkInTokensOut + diveWindowTokensOut,
      cacheReadTokens: outcome.result.cacheReadTokens,
      ms: Math.max(outcome.result.ms, guestsMs, checkInMs, diveWindowMs), // ran in parallel, not sequentially
      retried,
    },
  };
}

/**
 * Who is writing, read from the guest's own words — only phrasings that name a trade.
 *
 * The bare words "agent" and "agency" used to be enough, and they are ordinary English: "my real-estate
 * agent recommended you" made a retail guest a partner, who was then invited to sign in and never quoted.
 * The customer's engine takes the role from the login session, so a wrong guess here costs a guest an
 * answer and a right one only routes them to the sign-in link. Hence: trade phrases only.
 *
 * An instructor is a separate role on their side (`guestType: "instructor"`) and takes the same road as
 * an agent — a partner rate needs their own login, not our message.
 */
const AGENT_RE =
  /\b(?:travel\s+agen(?:t|ts|cy|cies)|tour\s+(?:operator|operators|company)|wholesaler?s?|partner\s+rates?|dive\s+(?:club|shop|centre|center|operator)s?|our\s+clients?|(?:i'?m|i\s+am|we'?re|we\s+are)\s+(?:a\s+)?(?:travel\s+)?agents?\s+(?:for|at|with|from))\b|旅行社/i;
const INSTRUCTOR_RE =
  /\b(?:(?:dive|padi|ssi|naui|scuba|freediving)\s+instructors?|(?:i'?m|i\s+am|we'?re|we\s+are)\s+(?:an?\s+)?(?:\w+\s+)?instructors?)\b|教练|教練/i;

export function partnerTypeOf(guestText: string): "agent" | "instructor" | null {
  if (AGENT_RE.test(guestText)) return "agent";
  if (INSTRUCTOR_RE.test(guestText)) return "instructor";
  return null;
}

// The two FieldStates that are this file's to set: `default` (house norms, applied
// to exactly HOUSE_NORM_FIELDS below) and `derived` (checkOut from checkIn + nights, and
// transportType "none" for a guest who said no transfer). The prompt tells the model its
// states are 'stated', 'inferred' or 'missing' (see providers/deepseek.ts) — a `default` a
// model pins on its own guess would otherwise be shown to the guest as a house norm,
// and, being non-missing, would keep the question from ever being asked.
const CODE_ONLY_STATES: ReadonlyArray<FieldState> = ["default", "derived"];

/**
 * The words a guest actually uses for each room type, in the two languages this pipeline replies
 * in. Latin words are matched on a word boundary; the Han ones are matched as plain substrings,
 * because Chinese is written without spaces (the same reason counts.ts carries a separate Han
 * number table).
 *
 * The patterns are SOURCES, compiled once below with one set of flags. That is not tidiness: this
 * table was three hand-written literals, and the `deluxe` one was written without the `i` flag while
 * the other two had it. The effect was invisible and expensive — a guest who answered the pipeline's
 * own question with "**Deluxe** please" had the answer thrown away (the check is "did the guest's
 * own words name this type?", and a capital D did not match), so `roomType` went back to `missing`
 * and the bot asked the same question again. Found by walking the whole journey rather than by a
 * unit test: every unit test happened to write the type in lower case. One `new RegExp` per type
 * means a missing flag is no longer a thing anyone can do.
 *
 * "standard" is deliberately broad — a guest writing "standard check-in is fine" would let the
 * model's `standard` stand, which costs nothing, because standard is also the value this pipeline
 * falls back to when nobody said anything. The expensive direction is the other two: "deluxe" and
 * "suite" are the types a model could over-claim, so they are matched narrowly — `\bsuite\b` does
 * not fire on "en suite", which is a bathroom, and a guest who asks for one is asked the room
 * question rather than priced into a suite.
 */
const ROOM_TYPE_PATTERNS: Record<string, string> = {
  standard: "\\bstandard\\b|标准|標準|标间|標間",
  deluxe: "\\bdeluxe\\b|\\blux(?:e|ury)\\b|豪华|豪華",
  suite: "(?<!\\ben\\s)suites?\\b|套房|套间|套間",
};

const ROOM_TYPE_WORDS: Record<string, RegExp> = Object.fromEntries(
  Object.entries(ROOM_TYPE_PATTERNS).map(([type, source]) => [type, new RegExp(source, "iu")]),
);

/** Whether the guest's own message names this room type at all. */
function roomTypeNamedBy(type: string, text: string): boolean {
  const words = ROOM_TYPE_WORDS[type];
  return words ? words.test(text) : false;
}

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

  // Detected once, here, because two things decide with it and they must not disagree: the
  // trip's own `language` field, and the reading of a numeric date pair that has no year on
  // it (dates.ts numericPairReadings) — "05/12" is 5 December for a Vietnamese guest and 12
  // May for an English-speaking one, and it is the guest's own message that says which.
  const guestLanguage = detectLanguage(guestText);

  // Some structured-output providers use 0 as a stand-in for an unknown
  // positive count. It is recoverable missing information: ask the guest
  // instead of failing the entire conversation turn.
  for (const key of ["nights", "guests", "rooms", "divers"] as const) {
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
    const resolved = resolveRelativeDate(checkIn.evidence, today, guestLanguage);
    const proposed = typeof checkIn.value === "string" ? checkIn.value : null;
    if (resolved) {
      // Code read the phrase itself, so this is the guest's own date whether or not the
      // model also computed one — and `stated` is what records that (an `inferred` left
      // here would keep its value while losing the evidence, priced and never asked).
      checkIn.value = resolved;
      checkIn.state = "stated";
    } else if (proposed && corroborateDatePhrase(checkIn.evidence, proposed, today, guestLanguage) === "consistent") {
      checkIn.value = proposed;
      checkIn.state = "stated";
    } else {
      checkIn.value = null;
      checkIn.state = "missing";
      checkIn.evidence = null;
    }
  }

  // A stay cannot start before today (Manila) — their `checkin-in-past`. A guest who wrote a date that
  // has already gone (or a year already gone) is asked again rather than priced on it, and nothing
  // fills in a nearby date instead.
  if (trip.checkIn?.state === "stated" && typeof trip.checkIn.value === "string" && isPastDate(trip.checkIn.value, today)) {
    trip.checkIn = { value: null, state: "missing", evidence: null };
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
  trip.language = { value: guestLanguage, state: "inferred", evidence: null };

  // Align with Odoo Estimate API (estimate-api.v1.json / casa-api-guide):
  // 1. guestType: detect agency phrasing or default to "retail"
  if (!trip.guestType || trip.guestType.state === "missing") {
    const partner = partnerTypeOf(guestText);
    trip.guestType = partner
      ? { value: partner, state: "inferred", evidence: null }
      : { value: "retail", state: "default", evidence: null };
  }

  // 2. transportType: only the case the guest has actually settled is filled in here.
  //
  // "No transfer" needs no further question, so a `false` transport is mapped to `none`.
  // A `true` transport is deliberately NOT mapped to anything: "we need the airport
  // pickup" does not say whether that is one way or a return, and the transfer is a
  // priced line, so this file has no business choosing. The old code wrote
  // `roundtrip, derived` here and then asked the guest to confirm it — a symptom fix
  // that left the price sitting on a value code had guessed (roadmap L3, "sửa lỗi tiền:
  // transportType đang bị suy diễn"). Leaving it missing is what makes the question in
  // questions.ts fire, so the guest's own answer is what the estimate is priced from.
  if (!trip.transportType || trip.transportType.state === "missing") {
    if (trip.transport?.value === false) {
      trip.transportType = { value: "none", state: "derived", evidence: null };
    } else {
      trip.transportType = { value: null, state: "missing", evidence: null };
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
  for (const key of ["diver", "diveFrom", "diveTo", "divers", "roomType"] as const) {
    if (trip[key]?.state !== "stated") {
      trip[key] = { value: null, state: "missing", evidence: null };
    }
  }

  // ...and the room type has to pass the same test `checkIn` does: the guest's own words have to
  // name it. `stated` alone is not enough here, because the model choosing one of three values is
  // comprehension, and a verbatim quote is not proof the quote was about the room type — "a nice
  // room" is verbatim, and it is not "deluxe". Their rate card is what makes this worth a check
  // rather than a hope: the same two guests cost ₱7,600 a night in a standard room and ₱11,200 in
  // a deluxe one — ₱3,600 a night, in whichever direction the model guessed.
  // No type word in the guest's message means the field is a question (questions.ts), not a guess.
  if (trip.roomType?.state === "stated" && typeof trip.roomType.value === "string") {
    if (!roomTypeNamedBy(trip.roomType.value, guestText)) {
      trip.roomType = { value: null, state: "missing", evidence: null };
    }
  }


  // Kitchen and transfer notes are read from the guest's words or not at all: an `inferred` diet or a
  // guessed direction would be printed on the kitchen sheet as though the guest had said it.
  for (const key of ["dietNotes", "transferDirection"] as const) {
    if (trip[key] && trip[key]!.state !== "stated") {
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

  // When the model records a stated diving breakdown in `diveNotes` with verified verbatim
  // evidence (e.g. "1 person dives day 1, and 5 people dive both days."), it often attaches
  // the quote to `diveNotes.evidence` and leaves `diver` as `inferred` or `missing`. Since
  // `diveNotes.evidence` has just passed `enforceVerbatimEvidence`, it is verbatim proof
  // from the guest's own words that the trip includes diving.
  if (
    trip.diver?.state === "missing" &&
    trip.diveNotes?.state === "stated" &&
    typeof trip.diveNotes.evidence === "string" &&
    trip.diveNotes.evidence.length > 0
  ) {
    trip.diver = { value: true, state: "stated", evidence: trip.diveNotes.evidence };
  }


  // 4. nights, guests and rooms — the three counts the estimate is priced from, checked
  // against the guest's own words the way a check-in date is. ADR-006 Decision 4 is "ask
  // what money depends on; never infer it", and until now it stopped at the date: a
  // number the model stated was kept as long as its evidence was a verbatim substring,
  // which is not the same as the evidence *being about this count*. vi-09 in the recorded
  // live run is the measured cost — "nhóm mình có 8 người nhưng chỉ 4 người ở lại" came
  // back as `guests: 8` — and the model's evidence was the guest's own words, so nothing
  // in the pipeline could tell the 8 from the 4. corroborateCount does, and the field
  // becomes the question it should be. It runs here, after evidence enforcement, so a
  // field that already failed that check is not judged twice, and before checkOut is
  // derived below, so a night count that does not survive cannot leave a date behind.
  //
  // The evidence travels with the number: when the guest's words put no number on this
  // count, the quote the model chose is the only thing behind the number, so it has to be a
  // quote about *this* count — "cần 3 phòng" offered as the evidence for `guests: 3` is a room
  // count wearing a guest label, and counts.ts turns it into a question too.
  for (const key of ["nights", "guests", "rooms", "divers"] as const) {
    const field = trip[key];
    if (field?.state !== "stated" || typeof field.value !== "number") continue;
    if (corroborateCount(key, field.value, guestText) === "conflicting") {
      trip[key] = { value: null, state: "missing", evidence: null };
    }
  }
  // More divers than guests is their `divers-over-guests`. The old code clamped the count to the party
  // size downstream, which prices a number the guest never said; asking again is the only honest fix.
  if (
    trip.divers?.state === "stated" &&
    typeof trip.divers.value === "number" &&
    trip.guests?.state === "stated" &&
    typeof trip.guests.value === "number" &&
    trip.divers.value > trip.guests.value
  ) {
    trip.divers = { value: null, state: "missing", evidence: null };
  }

  // checkOut is arithmetic on the guest's own answers, and it runs *after* evidence
  // enforcement on purpose: a check-in or a night count that did not survive
  // enforcement must not leave a derived check-out behind, pointing at a source that
  // no longer exists. (robustness.test.ts found the earlier order — the derived date
  // was computed first and outlived the check-in it came from.)
  // A stated check-out has to be a real date after the check-in — their `checkout-not-after-checkin`.
  // A reversed range or a zero-night one is put back to the guest as the night count / check-out
  // question; the old path let it through and the draft defaulted to one night.
  if (
    trip.checkOut?.state === "stated" &&
    typeof trip.checkOut.value === "string" &&
    (isPastDate(trip.checkOut.value, today) ||
      (typeof trip.checkIn?.value === "string" && trip.checkOut.value <= trip.checkIn.value))
  ) {
    trip.checkOut = { value: null, state: "missing", evidence: null };
  }

  const nights = trip.nights;
  if (trip.checkIn?.value && typeof nights?.value === "number") {
    trip.checkOut = {
      value: deriveCheckOut(trip.checkIn.value as string, nights.value),
      state: "derived",
      evidence: null,
    };
  } else if (nights?.state === "missing" && trip.checkIn?.value && trip.checkOut?.value) {
    // The other direction, for a guest who wrote the stay as a date range ("Oct 17 to
    // Oct 20") rather than a night count. Nothing is asked about `nights` in that case
    // (see questions.ts), so without this the count would stay `missing` for the whole
    // conversation and be sent to Odoo as a defaulted 1 night — the same underprice this
    // derivation exists to prevent, arriving from the other side.
    //
    // Guarded on `missing` so a night count the guest actually stated always wins; a range
    // that disagrees with it is a real contradiction, and silently preferring the
    // arithmetic would hide it rather than let the fact gate and staff see it.
    const derived = deriveNightsFromRange(trip.checkIn.value as string, trip.checkOut.value as string);
    if (derived !== null) {
      trip.nights = { value: derived, state: "derived", evidence: null };
    }
  }

  // 5. the dive window (diveFrom / diveTo) — two dates on a field dive revenue is priced
  // from, and the last place a date can be silently wrong. Both survive the normalization
  // above only as `stated`, and a stated date still has to be a date the calendar accepts
  // and a window that sits inside the stay the guest agreed to. A dive window before the
  // check-in or after the check-out is not a strict reading of the guest's message, it is a
  // misread of one — and unlike a check-in, nothing downstream asks about it: questions.ts
  // only puts the window to the guest once `diver` is true, and a window that is present
  // (non-missing) is never asked about at all. So a window that cannot be true is turned
  // back into `missing` here, which is what restores the question.
  //
  // Deliberately silent when there is no stay to check against: a window with a check-in
  // the guest has not given yet is unverifiable, not wrong, and dropping it would ask the
  // guest for two dates they already wrote.
  const stayFrom = trip.checkIn?.state === "stated" ? (trip.checkIn.value as string) : null;
  const stayTo = trip.checkOut?.state === "derived" ? (trip.checkOut.value as string) : null;
  for (const key of ["diveFrom", "diveTo"] as const) {
    const field = trip[key];
    if (field?.state !== "stated") continue;
    // The model may hand back the phrase the guest wrote rather than a date: the recording
    // has vi-04's window as `diveFrom: "15/10"`. Code reads it exactly as it reads a
    // check-in — the model's own ISO date if the calendar accepts it, otherwise the guest's
    // phrase, and nothing at all if neither settles it — so a date the guest gave is kept
    // rather than asked for again, and a phrase that is not a date stops looking like one.
    const proposed = typeof field.value === "string" ? field.value : null;
    const resolved =
      (proposed && isPlausibleStayDate(proposed, today) ? proposed : null) ??
      resolveRelativeDate(field.evidence ?? proposed ?? "", today, guestLanguage);
    const insideStay = resolved !== null && (!stayFrom || resolved >= stayFrom) && (!stayTo || resolved <= stayTo);
    if (!resolved || !insideStay) {
      trip[key] = { value: null, state: "missing", evidence: null };
    } else {
      field.value = resolved;
    }
  }
  // A window whose ends are the wrong way round cannot be priced either, and half of it is
  // no more use than none: both ends go back to being asked about.
  if (
    trip.diveFrom?.state === "stated" &&
    trip.diveTo?.state === "stated" &&
    (trip.diveFrom.value as string) > (trip.diveTo.value as string)
  ) {
    trip.diveFrom = { value: null, state: "missing", evidence: null };
    trip.diveTo = { value: null, state: "missing", evidence: null };
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
        if (
          (key === "diveNotes" || key === "specialRequests" || key === "guestNames") &&
          f.value !== null &&
          f.value !== undefined &&
          (!Array.isArray(f.value) || f.value.length > 0)
        ) {
          trip[key] = { value: f.value, state: "inferred", evidence: null };
        } else {
          trip[key] = { value: null, state: "missing", evidence: null };
        }
      }
    }
  }
}

