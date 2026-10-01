import type { Trip } from "../domain/schema.ts";
import type { GuestQuestion, ReplyKind } from "./questions.ts";
import { diveWindowIsGuessed } from "./questions.ts";
import type { ExtractProvider } from "../ports/provider.ts";
import type { ConversationTurn } from "../domain/conversation.ts";

export interface SynthesisInput {
  turns: ConversationTurn[];
  trip: Trip;
  questions: GuestQuestion[];
  replyKind: ReplyKind;
  fallbackText: string;
  /**
   * How long the model may take before this falls back to the deterministic reply.
   *
   * The synthesis call is the LAST of five to seven in a turn, and it is the one that cannot start
   * until the facts are settled — so it is the call that decides whether a turn fits inside Meta's
   * deadline. Without a budget it could run to the provider's own timeout, which is longer than the
   * whole turn is allowed to be.
   */
  budgetMs?: number;
}

/** The default budget when the caller does not know its own deadline. */
const DEFAULT_SYNTHESIS_BUDGET_MS = 4_000;

/**
 * Resolve with `promise`, or reject once `ms` elapses — whichever happens first.
 *
 * Written as a helper rather than an inline `Promise.race([...])` because the deployment build
 * (which typechecks through a different config than the workspace `tsc`) reported the race's array
 * literal as "possibly undefined" on `Promise` itself on every deploy. The behaviour is identical
 * and the construct is one the build is happy with; the emitted JavaScript was correct either way,
 * but a build that prints errors on every deploy is a build nobody reads.
 *
 * Exported because the studio's own guest message needs the same guard: it writes a greeting with a
 * model, and a slow model must not hold a staff member's click open when the deterministic text is
 * already sitting there.
 */
export function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`synthesis budget of ${ms}ms elapsed`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * The single "Diving:" line in the verified-facts prompt.
 *
 * A guessed dive window is NOT handed to the model as a range: the model's whole job here is to
 * read these facts back, so giving it an invented window is how a guessed date ends up in the
 * guest's message as if they had said it. The prompt says "dates to be confirmed" instead, which
 * is the same honest phrasing the deterministic summary uses.
 */
function divingLine(input: SynthesisInput): string {
  if (input.trip.diver?.value !== true) {
    return input.trip.diver?.value === false ? "no" : "unconfirmed";
  }
  if (diveWindowIsGuessed(input.trip)) {
    return "yes (dive dates to be confirmed)";
  }
  return `yes (${input.trip.diveFrom?.value ?? ""} to ${input.trip.diveTo?.value ?? ""})`;
}

export interface FactGateResult {
  ok: boolean;
  reason?:
    | "empty_or_too_short"
    | "unauthorized_price_quote"
    | "false_booking_confirmation"
    | "mismatched_nights_count"
    | "mismatched_rooms_count"
    | "mismatched_guests_count"
    | "mismatched_divers_count"
    | "mismatched_room_type"
    | "fabricated_date";
}

// VND is a real currency code and stays in the gate even though Vietnamese replies were
// removed: the fact gate exists to catch a model quoting money, and a guest or model can
// still name any currency. Only the Vietnamese words ("đồng", "triệu") were dropped.
const PRICE_QUOTE_RE =
  // The last branch starts only at the beginning of a run of digits/separators, at its first digit.
  // `\d[\d,.]*` could start anywhere inside a long run and re-scan it each time (quadratic; CodeQL
  // js/polynomial-redos). Same verdict: the run is consumed to its end either way, so what follows it
  // decides, and the run matches iff it contains a digit.
  /(?:\$\s*\d|₱\s*\d|\b(?:PHP|USD|VND|EUR)\s*\d|(?<![\d,.])[,.]*\d[\d,.]*\s*(?:PHP|USD|VND|pesos?|dollars?)\b)/i;

/**
 * Phrases that promise something the product does not do.
 *
 * The first group is the outright false confirmation: the bot cannot confirm a booking, and only
 * staff can. The second is subtler and was found by reading replies rather than by a failing test —
 * a model that writes "you're all set" or "we'll email you a confirmation" has made a promise the
 * resort does not keep: their Q-015 is that this app sends no confirmation at all, and the front
 * desk contacts the guest from the folio. Both read to a guest as done, so both roll back.
 *
 * The third group was added after reading a real studio message on production: the message that
 * carries a published quotation to a guest opened with *"your customized stay … is all confirmed,
 * with your Standard Room"* — a confirmation claim about a booking nobody made, in a sentence the
 * narrower patterns above did not match. "is/are/has been confirmed" about a stay, a room or a
 * quotation is never true before the front desk has taken the booking, so it belongs in the same
 * class as "your booking is confirmed".
 */
const FALSE_CONFIRMATION_RE = new RegExp(
  [
    "\\b(?:your booking is confirmed|reservation is confirmed|officially booked|we have booked your room)\\b",
    "\\b(?:you(?:'re| are)|we(?:'re| are)) all set\\b",
    "\\breserved for you\\b",
    "\\bbooking is (?:complete|completed|finali[sz]ed|done|set)\\b",
    "\\b(?:we|i)(?:'ll| will) (?:send|email|whatsapp) (?:you )?(?:a |your )?(?:confirmation|confirm|booking confirmation)\\b",
    "\\bwe(?:'ll| will) (?:hold|reserve) (?:the |your )?(?:room|rooms|booking)\\b",
    // "is all confirmed", "are now confirmed", "has been confirmed" — with the subject left open on
    // purpose: a guest reading it cannot tell a booking from a quotation, and neither can we.
    "\\b(?:is|are|was|were|has been|have been)\\s+(?:all\\s+|now\\s+|fully\\s+)?confirmed\\b",
    "预订已确认|已为您预订成功|已为您预留",
  ].join("|"),
  "i",
);

/**
 * A count written against its own noun, which is the only place a number means that count.
 *
 * `excludeDiveClause` skips a count whose noun is the subject of a diving verb. Without it, the
 * sentence a split-day guest actually wrote — "1 person dives day 1, 5 people dive both days" —
 * reads as two guest counts that contradict the party size, and the gate would reject the correct
 * summary of a six-person trip. The same guard, for the same reason, is `DIVE_CLAUSE_AFTER_NOUN` in
 * counts.ts: a diver head-count is not a guest count.
 */
function countsFor(text: string, nouns: string, options: { excludeDiveClause?: boolean } = {}): number[] {
  const guard = options.excludeDiveClause
    ? "(?!\\s+(?:will\\s+|are\\s+|is\\s+|to\\s+)?(?:dive|dives|diving)\\b)"
    : "";
  const pattern = new RegExp(`\\b(\\d+)\\s*(?:${nouns})\\b${guard}`, "gi");
  return [...text.matchAll(pattern)].map((m) => Number(m[1]));
}

/** ISO dates the reply names, whatever they are attached to. */
function isoDatesIn(text: string): string[] {
  return [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]!);
}

/**
 * Deterministic Symbolic Fact Gate (Post-Generation Verifier):
 * Audits any LLM-synthesized reply against the verified `Trip` facts before
 * it can ever reach a WhatsApp guest.
 *
 * Rejects and triggers an instant rollback to `fallbackText` if:
 * 1. The LLM invents or quotes any price/currency figure (`$`, `₱`, `PHP`, `USD`, `VND`).
 * 2. The LLM claims the booking is already confirmed without human staff approval.
 * 3. The LLM contradicts the guest's stated night count or room count.
 */
export function verifySynthesizedReply(text: string, trip: Trip): FactGateResult {
  const roomTypes = new Set<string>();
  if (trip.roomType?.state === "stated" && typeof trip.roomType.value === "string") {
    roomTypes.add(trip.roomType.value);
  }
  return verifyGuestFacingText(text, {
    ...(trip.nights?.state === "stated" && typeof trip.nights.value === "number" ? { nights: trip.nights.value } : {}),
    ...(trip.rooms?.state === "stated" && typeof trip.rooms.value === "number" ? { rooms: trip.rooms.value } : {}),
    ...(trip.guests?.state === "stated" && typeof trip.guests.value === "number" ? { guests: trip.guests.value } : {}),
    ...(trip.divers?.state === "stated" && typeof trip.divers.value === "number" ? { divers: trip.divers.value } : {}),
    roomTypes,
    knownDates: new Set(
      [trip.checkIn?.value, trip.checkOut?.value, trip.diveFrom?.value, trip.diveTo?.value].filter(
        (d): d is string => typeof d === "string" && d !== "",
      ),
    ),
  });
}

/**
 * The facts a guest-facing sentence may be checked against, from whatever source has them.
 *
 * Split out of `verifySynthesizedReply` when a second caller appeared: the message that carries a
 * published quotation to a guest (`synthesizeConfirmedQuotationReply`) writes its own greeting with
 * a model, and that text reached the guest **without passing this gate at all** — measured on
 * production, where a guest was told *"your customized stay … is all confirmed, with your Standard
 * Room"* while the booking was a suite and nothing had been confirmed. A second copy of these checks
 * for that path is how the two would drift; one function with two callers is how they cannot.
 *
 * Every field is optional, and an absent fact is simply not checked: the draft a studio message is
 * built from has rooms and guests but not a `Trip`'s field states, and a gate that refused to run
 * without them would be a gate that gets bypassed.
 */
export interface GuestFacingFacts {
  nights?: number;
  rooms?: number;
  guests?: number;
  divers?: number;
  /** Every room type on this booking. A sentence naming another one is describing a different trip. */
  roomTypes?: ReadonlySet<string>;
  knownDates?: ReadonlySet<string>;
}

export function verifyGuestFacingText(text: string, facts: GuestFacingFacts): FactGateResult {
  if (!text || text.trim().length < 20) {
    return { ok: false, reason: "empty_or_too_short" };
  }

  if (PRICE_QUOTE_RE.test(text)) {
    return { ok: false, reason: "unauthorized_price_quote" };
  }

  if (FALSE_CONFIRMATION_RE.test(text)) {
    return { ok: false, reason: "false_booking_confirmation" };
  }

  if (typeof facts.nights === "number") {
    const expectedNights = facts.nights;
    for (const count of countsFor(text, "nights?|晚")) {
      if (count !== expectedNights) return { ok: false, reason: "mismatched_nights_count" };
    }
  }

  if (typeof facts.rooms === "number") {
    const expectedRooms = facts.rooms;
    for (const count of countsFor(text, "rooms?|间房")) {
      if (count !== expectedRooms) return { ok: false, reason: "mismatched_rooms_count" };
    }
  }

  // The party size, which the first version of this gate did not check at all — the largest line of
  // a quotation was the one number a model could contradict freely. "people" is included because
  // that is how a guest's own count is echoed back.
  if (typeof facts.guests === "number") {
    for (const count of countsFor(text, "guests?|people|pax|adults?|客人", { excludeDiveClause: true })) {
      if (count !== facts.guests) return { ok: false, reason: "mismatched_guests_count" };
    }
  }

  if (typeof facts.divers === "number") {
    for (const count of countsFor(text, "divers?|潜水员")) {
      if (count !== facts.divers) return { ok: false, reason: "mismatched_divers_count" };
    }
  }

  // The room type, which is the single largest per-night lever in the rate card and therefore the
  // worst thing to get wrong in prose. The pattern deliberately requires the noun to sit against the
  // type ("a deluxe room", "room type: deluxe") rather than matching the bare word — "en suite" and
  // "our standard check-in time" are ordinary hospitality English and must not trip the gate.
  if (facts.roomTypes && facts.roomTypes.size > 0) {
    const named = [
      ...text.matchAll(/\b(standard|deluxe|suite)\s+(?:rooms?|suites?)\b/gi),
      // `\s*(?::\s*)?` rather than `\s*:?\s*`: two adjacent \s* split a run of spaces every possible way.
      ...text.matchAll(/\broom\s+type\s*(?::\s*)?(standard|deluxe|suite)\b/gi),
    ].map((m) => m[1]!.toLowerCase());
    if (named.some((type) => !facts.roomTypes!.has(type))) {
      return { ok: false, reason: "mismatched_room_type" };
    }
  }

  // Any ISO date the reply names has to be one of the booking's own. Written this way round on
  // purpose: the dates are a closed set, so a fifth one is fabricated by definition, and the check
  // needs no understanding of the sentence it sits in. Deliberately ISO only — a model writing
  // "Oct 17" is normal prose, and matching month names is how this rule would start rejecting
  // correct replies ("14 days' notice" and similar).
  if (facts.knownDates && facts.knownDates.size > 0) {
    for (const date of isoDatesIn(text)) {
      if (!facts.knownDates.has(date)) return { ok: false, reason: "fabricated_date" };
    }
  }

  return { ok: true };
}

/**
 * The transfer line in the verified-facts prompt.
 *
 * The bug this replaced: `yes (${transportType ?? "roundtrip"})` — a guest who said "we need the
 * airport pickup" and had not said one-way or return was handed to the model as `yes (roundtrip)`,
 * and the model duly read it back. That is a priced choice the guest never made, arriving in their
 * own message as though they had made it. `transportType` is a money field for exactly this reason
 * (see extract.ts: a `true` transport is deliberately left unfilled), so the prompt must say so.
 */
function transportLine(trip: Trip): string {
  if (trip.transport?.value !== true) {
    return trip.transport?.value === false ? "no" : "unconfirmed";
  }
  const type = trip.transportType;
  if (type?.state === "stated" && typeof type.value === "string" && type.value !== "none") {
    return `yes (${type.value})`;
  }
  return "yes (one-way or return — the guest has NOT said which)";
}

/** The suffix that marks a fact as the resort's own guess rather than the guest's choice. */
function markAssumed(field: { state?: string } | undefined): string {
  return field?.state === "default" ? " (HOUSE ASSUMPTION — the guest has not chosen this)" : "";
}

/**
 * Synthesizes a natural, warm hospitality message grounded on the verified
 * extracted Trip facts, acknowledging nuanced arrangements while respecting
 * all business boundaries and zero-hallucination guardrails.
 *
 * If the provider has no generateText method, fails/times out, or fails the
 * deterministic `verifySynthesizedReply` fact gate, it rolls back safely to
 * the deterministic renderReply() text.
 */
export async function synthesizeHospitalityReply(
  input: SynthesisInput,
  provider?: ExtractProvider,
): Promise<string> {
  // Captured into a `const` at the top, not called as `provider.generateText` further down.
  // TypeScript drops the narrowing on a parameter once a closure exists in the same function, which
  // the deployment build caught even though an incremental local typecheck had not: `const` keeps it.
  const generate = provider?.generateText?.bind(provider);
  if (!generate) {
    return input.fallbackText;
  }

  // Greeting turn (guest has said nothing extractable yet) — standard greeting is concise and clear
  if (input.replyKind === "greeting") {
    return input.fallbackText;
  }

  try {
    const lang = input.trip.language?.value ?? "en";
    const langName = lang === "zh" ? "Chinese" : "English";

    const systemPrompt =
      "You are the warm, professional reservation concierge at Casa Escondida Anilao Resort & PADI Dive Center in Batangas, Philippines. " +
      "Your role is to write a natural, hospitable, and intelligent reply to a guest inquiring about a stay over WhatsApp.\n\n" +
      "STRICT BUSINESS GUARDRAILS (ZERO HALLUCINATION):\n" +
      "1. You must base all dates, room counts, and guest numbers strictly on the Verified Facts provided below.\n" +
      "2. NEVER invent or promise room rates or prices.\n" +
      "3. NEVER state that a booking is officially confirmed or completed.\n" +
      "4. If the situation is 'summary' (all required details collected), you MUST conclude with: 'Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.'\n" +
      "5. If the situation is 'questions', warmly acknowledge what was noted and ask the remaining questions provided below.\n" +
      "6. CRITICAL EMPATHY & NUANCE: If the guest mentioned specific nuanced arrangements (such as day visitors vs staying guests, or who dives on which days), explicitly acknowledge that arrangement with understanding so the guest knows they were heard.\n" +
      `7. Reply in ${langName}.\n` +
      "8. WhatsApp style: Friendly, concise, hospitable (5-star dive resort concierge). Include the clean bulleted summary lines so the guest can easily check their details.\n" +
      "9. HOUSE ASSUMPTIONS: a fact marked '(HOUSE ASSUMPTION — the guest has not chosen this)' is the resort's default, NOT something the guest said. Never present it as their choice or as already settled. Mention it as what we will assume unless they say otherwise — e.g. 'we'll plan on full board unless you'd prefer otherwise'. If the guest has not mentioned it at all, it is usually better to leave it out of a short reply than to assert it.";

    const userPrompt =
      `Conversation History:\n${input.turns.map((t) => `${t.role === "guest" ? "Guest" : "Concierge"}: ${t.text}`).join("\n")}\n\n` +
      `Verified Facts:\n` +
      `- Stay: ${input.trip.checkIn?.value ?? "not specified"} to ${input.trip.checkOut?.value ?? "not specified"} (${input.trip.nights?.value ?? "not specified"} nights)\n` +
      `- Guests staying overnight: ${input.trip.guests?.value ?? "not specified"}\n` +
      `- Rooms: ${String(input.trip.rooms?.value ?? "1")}${markAssumed(input.trip.rooms)}\n` +
      (typeof input.trip.roomType?.value === "string"
        ? `- Room type: ${input.trip.roomType.value}${markAssumed(input.trip.roomType)}\n`
        : "") +
      `- Meals: ${String(input.trip.meals?.value ?? "full board")}${markAssumed(input.trip.meals)}\n` +
      `- Diving: ${divingLine(input)}\n` +
      (typeof input.trip.divers?.value === "number" ? `- Divers in the party: ${input.trip.divers.value}\n` : "") +
      (input.trip.diveNotes?.value ? `- Diving breakdown: ${input.trip.diveNotes.value}\n` : "") +
      (input.trip.specialRequests?.value ? `- Special notes: ${input.trip.specialRequests.value}\n` : "") +
      (input.trip.guestNames?.value && input.trip.guestNames.value.length > 0 ? `- Guest names in party: ${input.trip.guestNames.value.join(", ")}\n` : "") +
      `- Airport transfer: ${transportLine(input.trip)}${markAssumed(input.trip.transport)}\n` +
      `- Contact name: ${input.trip.contactName?.value ?? "Guest"}\n\n` +
      `Situation: ${input.replyKind}\n` +
      (input.questions.length > 0 ? `Remaining questions to ask:\n${input.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}\n\n` : "") +
      `Reference summary (keep core details matching this):\n${input.fallbackText}`;

    // The budget is enforced here rather than left to the provider: this is the last call in the
    // turn, so a provider that hangs would take the whole turn past Meta's deadline and the guest
    // would get nothing at all. Losing the polish and keeping the reply is the right trade.
    const budgetMs = input.budgetMs && input.budgetMs > 0 ? input.budgetMs : DEFAULT_SYNTHESIS_BUDGET_MS;
    const text = await withBudget(generate(systemPrompt, userPrompt), budgetMs);

    // Post-Generation Symbolic Fact Gate: verify no hallucinated prices, confirmations, or mismatched counts
    const check = verifySynthesizedReply(text, input.trip);
    if (!check.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[synthesis] Fact gate rejected LLM reply (${check.reason}); rolling back to deterministic fallback`);
      return input.fallbackText;
    }

    // Safety check: if situation is summary, ensure the disclaimer is present
    if (input.replyKind === "summary") {
      const lower = text.toLowerCase();
      if (!lower.includes("nothing is booked yet") && !lower.includes("尚未完成预订") && !lower.includes("尚未预订")) {
        return text + "\n\nSomeone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.";
      }
    }

    return text;
  } catch (err) {
    // Non-blocking fallback to deterministic text
    // eslint-disable-next-line no-console
    console.warn(`[synthesis] Non-blocking fallback: ${err instanceof Error ? err.message : String(err)}`);
    return input.fallbackText;
  }
}
