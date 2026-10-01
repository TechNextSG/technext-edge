import type { FieldState, Trip } from "../domain/schema.ts";

// Playbook: "Generate questions for missing fields in the backend's priority
// order: dates, guest count, rooms, and only then meals and transport."
// The model contributes facts, never this wording: this file decides which fields
// get asked about, in what order, and what the reply says. Nothing here calls a
// provider, and nothing here states a price, so a reply cannot commit Casa to one.
//
// Three deterministic replies, and the trip itself picks one (lead, 2026-09-18):
//
//   greeting   the guest has not told us anything usable yet — introduce Casa and
//              ask for the four things a quote needs
//   questions  something was understood but the enquiry is incomplete — read back
//              what was understood, then ask the rest in priority order
//   summary    nothing is left to ask — read the whole booking back and hand it to
//              a human, because only a human can confirm availability and price
//
// A house-norm default is never *asked about*. Interrogating a guest who just said
// "hi" about rooms and meal plans turns a greeting into a questionnaire, and the
// norm is a guess Casa made rather than an answer the guest owes. Assumptions are
// surfaced in the summary instead, flagged, which is where a guest expects to
// correct them.
// Vietnamese was removed from this project on 2026-09-24 (see the note in
// normalize.ts): the resort receives English and Chinese enquiries, and the Vietnamese
// reply tables carried a real risk — a misdetected language sent a guest wording the
// reservations staff cannot read.
export type GuestLanguage = "en" | "zh";

type Lang = GuestLanguage;

export interface GuestQuestion {
  field: keyof Trip;
  question: string;
}

interface QuestionRule {
  key: keyof Trip;
  question: Record<Lang, string> | ((trip: Trip, lang: Lang) => string);
  // Field states that make this worth asking about. "missing" is the baseline:
  // nothing was recorded, so the guest is the only source left. "default" (a house
  // norm) and "derived" (code computing it from other answers) are not asked about
  // unless a rule says so on purpose — see BASELINE.
  askOn?: ReadonlyArray<FieldState>;
  // Tier-2 fields only exist on some trips. Asking a non-diving enquiry for a
  // dive window is noise, and it buries the questions that do matter.
  when?: (trip: Trip) => boolean;
}

function diveStayRange(trip: Trip, lang: Lang): string | null {
  const from = typeof trip.checkIn?.value === "string" ? trip.checkIn.value : null;
  const to = typeof trip.checkOut?.value === "string" ? trip.checkOut.value : null;
  return from && to ? formatRange(from, to, lang) : null;
}

const BASELINE: ReadonlyArray<FieldState> = ["missing"];

const RULES: QuestionRule[] = [
  { key: "checkIn", question: { en: "What date would you like to check in?", zh: "您想在哪天入住？" } },
  // Never asked when the stay is already a date range. "Oct 17 to Oct 20" states both
  // nights and check-out, and extract.ts derives `nights` from that range — so the
  // question would be asking the guest to repeat arithmetic they already did, which is
  // the single worst thing this pipeline can say. Guests who gave a check-in only, or a
  // check-in and a night count, are unaffected, and a night count they DID state always
  // wins over the derived one.
  {
    key: "nights",
    question: { en: "How many nights will you be staying?", zh: "您计划入住几个晚上？" },
    when: (trip) => !(trip.checkOut?.state && trip.checkOut.state !== "missing"),
  },
  { key: "guests", question: { en: "How many guests in total?", zh: "一共有几位客人？" } },
  { key: "rooms", question: { en: "How many rooms do you need?", zh: "您需要几间房？" } },
  // The single biggest lever on the nightly rate, and the one field a guest always knows and
  // the model can only guess. Their own rate card prices a deluxe room at ₱11,200 a night
  // against ₱7,600 for a standard one, for the same two guests — so quietly sending `standard`
  // for a guest who asked for deluxe is not a rounding error: it is ₱3,600 short, every night,
  // on the largest line of the stay, and nobody downstream could see that it had happened.
  //
  // Quoted in pesos rather than as "47%", and that is a correction worth keeping: 3,600 against
  // 7,600 is a number anyone can check against the rate card, and the percentage stops being true
  // the moment the party is four people in one room (₱16,400) instead of a couple. ADR-006
  // Decision 4 ("ask what money depends on; never infer it") is why this is a question and
  // why extract.ts keeps only a `stated` answer.
  {
    key: "roomType",
    question: { en: "Would you like a standard, deluxe, or suite room?", zh: "您想订标准房、豪华房，还是套房？" },
  },
  { key: "meals", question: { en: "Would you like full board, half board, or room only?", zh: "您需要全餐、半餐，还是只要住宿？" } },
  { key: "transport", question: { en: "Do you need an airport transfer?", zh: "您需要机场接送吗？" } },
  // A stay at a dive resort is either a diving trip or it is not, and the answer
  // decides whether a dive package (and its window) belongs on the estimate at
  // all — so it is asked outright instead of being guessed from a keyword. Guests
  // who volunteer it in their first message are never asked.
  {
    key: "diver",
    question: { en: "Would you like to go diving during your stay?", zh: "您这次想潜水吗？" },
    when: (trip) => !notedValue<string>(trip, "diveNotes"),
  },
  { key: "contactName", question: { en: "What name should we put on the booking?", zh: "预订时应该登记谁的姓名？" } },

  // Tier 2, from the Odoo API field guide. A missing dive window silently wipes
  // dive revenue off the estimate (see extract.ts's postProcess), and
  // transportType is only ever filled in by code as "roundtrip" — the guest never
  // confirmed one-way vs return, so a *derived* roundtrip is asked about rather
  // than trusted. Both are gated so neither is asked of a trip it cannot apply to.
  // The dive line is charged per head, and `diver` only says somebody dives: a party of
  // five with two certified divers reads exactly like a party of five who all dive, so
  // without this number the estimate has to guess and a wrong guess is a wrong quote.
  // Asked before the dates because it is the one that cannot be defaulted, and only of a
  // trip that has already said it dives.
  // NEVER RE-ASK RULE (Hybrid AI Guardrail):
  // When `diveNotes` already records a nuanced or split-day diving schedule (e.g.
  // "1 person dives day 1, 5 people dive both days"), `divers` / `diveFrom` / `diveTo`
  // cannot be forced into a single rigid integer/range slot. Instead of re-asking
  // "How many of you will be diving?" and frustrating the guest, skip the slot
  // questions and hand off `diveNotes` to human staff for custom quotation.
  {
    key: "divers",
    question: { en: "How many of you will be diving?", zh: "有几位客人潜水？" },
    when: (trip) => trip.diver?.value === true && !notedValue<string>(trip, "diveNotes"),
  },
  {
    key: "diveFrom",
    question: (trip, lang) => {
      const range = diveStayRange(trip, lang);
      if (range) {
        if (lang === "zh") return `潜水从哪天开始？（在住宿期间 ${range} 内）`;
        return `Which day does your diving start? (within your stay: ${range})`;
      }
      return { en: "Which day does your diving start?", zh: "潜水从哪天开始？" }[lang];
    },
    when: (trip) => trip.diver?.value === true && !notedValue<string>(trip, "diveNotes"),
  },
  {
    key: "diveTo",
    question: (trip, lang) => {
      const range = diveStayRange(trip, lang);
      if (range) {
        if (lang === "zh") return `哪天结束？（在住宿期间 ${range} 内）`;
        return `And which day does it end? (within your stay: ${range})`;
      }
      return { en: "And which day does it end?", zh: "哪天结束？" }[lang];
    },
    when: (trip) => trip.diver?.value === true && !notedValue<string>(trip, "diveNotes"),
  },
  // `derived` is deliberately NOT askable here (2026-09-24). Only code ever derives this
  // value — and only as "none", for a guest who declined a transfer — so a derived state is
  // the answer, not a gap. Asking it would re-ask the guest about a transfer they had
  // already described ("need the airport pickup"), which reads as the assistant not
  // listening. `default` stays askable: that state means the model guessed a house norm
  // rather than code computing it, which is exactly what the guest should confirm.
  { key: "transportType", question: { en: "One-way or return transfer?", zh: "需要单程还是往返接送？" }, askOn: ["missing", "default"], when: (trip) => trip.transport?.value === true },
];

/**
 * Whether a rule applies to this trip at all — its `when` gate and its applicability
 * conditions. Shared by the question list and the handoff check so the two can never
 * disagree about which fields are in play.
 */
function ruleApplies(rule: QuestionRule, trip: Trip): boolean {
  if (rule.when && !rule.when(trip)) return false;
  return true;
}

/**
 * The rules whose field is still missing on this trip — i.e. what the guest still owes.
 *
 * Deliberately the single place that decides this, because `done` and the question list
 * are two views of the same fact: "there is nothing left to ask". Computing them from
 * separate expressions is how `done: true` could once coexist with a field nobody had
 * asked about.
 */
function openRules(trip: Trip): QuestionRule[] {
  return RULES.filter((rule) => {
    if (!ruleApplies(rule, trip)) return false;
    // `keyof Trip` includes optional fields (transportType, guestType, diveFrom,
    // diveTo, diver) — index access is therefore possibly undefined. A field the
    // model never returned cannot be shown or asked about, so skipping is right.
    // An absent key is not an answer either: the Tier-2 fields are optional in the
    // Trip schema, and a key nobody returned used to end the question right here —
    // which is how the diving question could vanish from a live reply. extract.ts
    // normalizes an omitted key to `missing` before this runs, and the same rule
    // belongs in the layer that decides what to ask.
    const state = trip[rule.key]?.state ?? "missing";
    return (rule.askOn ?? BASELINE).includes(state);
  });
}

export function generateQuestions(trip: Trip): GuestQuestion[] {
  const language: Lang = trip.language.value ?? "en";
  return openRules(trip).map((rule) => ({
    field: rule.key,
    question:
      typeof rule.question === "function"
        ? rule.question(trip, language)
        : rule.question[language] ?? rule.question.en,
  }));
}

/**
 * The fields the enquiry must have before it can be handed to the team.
 *
 * This is the HANDOFF contract, and it is deliberately a separate list from the questions
 * (roadmap L3, "tách READY_FIELDS khỏi danh sách hỏi"). Before this existed, "ready for
 * handoff" was inferred from the question list alone, so *what does the guest still owe
 * us* and *what must we know before quoting* shared one answer — and any field that
 * stopped being asked silently stopped being required.
 *
 * Membership rule: a field belongs here when a guest-visible figure or a priced line can
 * depend on it. "Can" is load-bearing — the three dive fields are listed because a diving
 * enquiry needs them, not because every enquiry does. Membership never means a field must
 * be present; that is decided per trip in isReadyForHandoff.
 */
export const HANDOFF_REQUIRED_FIELDS: ReadonlyArray<keyof Trip> = [
  "checkIn",
  "checkOut",
  // Required, but satisfied either way round: stated by the guest, derived by code from
  // checkIn + nights, or derived from a stated date range (extract.ts). The rule that
  // owns it is gated so a guest who gave a range is never asked for the count.
  "nights",
  "guests",
  "rooms",
  // Priced per night off their own rate card (`standard` / `deluxe` / `suite`), and the field
  // with the widest spread of any of them — so it is asked and it is required, not defaulted.
  "roomType",
  "meals",
  "transport",
  "contactName",
  "diver",
  "divers",
  "diveFrom",
  "diveTo",
  // Only in play when a transfer was asked for; a guest who declined one gets "none"
  // derived in postProcess, and asking is gated on transport being true.
  "transportType",
] as const;

/**
 * Handoff fields that no guest is ever asked about, with where the value comes from
 * instead. Note that these are NOT all members of HANDOFF_REQUIRED_FIELDS: `checkOut` is
 * required and code-filled, while `guestType` is neither required nor asked. The coverage
 * test in questions.test.ts proves each entry really is satisfied on a settled trip.
 */
export const NEVER_ASKED_FIELDS: ReadonlyArray<{
  field: keyof Trip;
  satisfiedBy: "code" | "staff";
  reason: string;
}> = [
  {
    field: "checkOut",
    satisfiedBy: "code",
    reason:
      "Arithmetic on the guest's own answers: checkIn + nights. A derived date is exact rather than a guess, which is why it is never asked and never flagged as assumed in the summary.",
  },
  {
    field: "guestType",
    satisfiedBy: "staff",
    reason:
      "Read from phrasing (extract.ts isAgent) and defaulted to retail. A 30% partner rate is a commercial decision staff confirm on the quote, so an unknown guest type changes nothing the guest sees and is not worth a question.",
  },
];

/** The rule that owns a field, if any. At most one rule per field is meaningful. */
function ruleFor(field: keyof Trip): QuestionRule | undefined {
  return RULES.find((rule) => rule.key === field);
}

/**
 * True when the team can take the enquiry over: nothing is left to ask, and every required
 * field that APPLIES to this trip has a value.
 *
 * Applicability is the subtle half, and getting it wrong is not symmetric. `divers`,
 * `diveFrom` and `diveTo` are required for a diving enquiry, but their rules are gated on
 * `diver === true` and on `diveNotes` being absent. Treating them as unconditionally
 * required would mean a guest who is not diving — or the split-day schedule the NEVER-RE-ASK
 * guardrail exists to serve — could never be handed off at all. So a required field is only
 * checked when its rule applies, and a required field with no rule at all (`checkOut`) is
 * filled by code, which the coverage test pins.
 *
 * Not the same as "the guest owes nothing": a house-norm `default` counts (rooms = 1 is
 * Casa's assumption, correctable in the summary), while `missing` never does.
 */
export function isReadyForHandoff(trip: Trip): boolean {
  if (openRules(trip).length > 0) return false;
  for (const field of HANDOFF_REQUIRED_FIELDS) {
    const rule = ruleFor(field);
    // A field whose question does not apply to this trip is not owed by this guest.
    if (rule && !ruleApplies(rule, trip)) continue;
    // An optional field is absent until something fills it; absent is not an answer.
    if ((trip[field]?.state ?? "missing") === "missing") return false;
  }
  return true;
}

/**
 * True when this trip will be priced against a dive window the guest never gave.
 *
 * The gap this names is between two decisions that are each right on their own:
 *
 * 1. The NEVER-RE-ASK guardrail deliberately stops asking `diveFrom`/`diveTo` once `diveNotes`
 *    records a nuanced arrangement, so `isReadyForHandoff` lets the trip through with the window
 *    still `missing`.
 * 2. `buildBffTrip()` then has to produce a payload their `fillTrip` will accept, and that
 *    contract requires a dive window whenever a guest dives — so it invents one inside the stay.
 *
 * Together they mean a real enquiry can reach pricing asserting dive days from nobody's words,
 * and the count changes with it: measured on one scenario ("my husband and I dive, the kids
 * snorkel" — no dates given) across five runs, the payload carried 3, 3, 4, 3 and 5 dive days.
 * Dive is charged per diver per day, so those are five different prices.
 *
 * Two shapes count as guessed:
 *
 * - **Not the guest's words.** Either end is not `stated`; `derived`, `default` and `inferred` are
 *   all the pipeline's own, and `buildBffTrip` fills whatever is missing.
 * - **The model echoed the stay.** Both ends read `stated` but equal the whole stay
 *   (`diveFrom === checkIn` and `diveTo === checkOut`). Measured: `diveFrom: 2026-11-25`,
 *   `diveTo: 2026-11-29` quoting `"Nov 25 please, for 4 nights."` — a sentence about the STAY,
 *   not about diving — which survives evidence enforcement because it is a verbatim substring, and
 *   produced **5 dive days for a 4-night trip**. A window that covers arrival AND departure days is
 *   not a normal reading; `buildBffTrip`'s own default deliberately excludes both, so equality with
 *   the stay is the fingerprint of the echo.
 *
 * `diveWindowIsGuessed() === false` means "the guest's own words support the window", not "the
 * window is right" — but it is the best this pipeline can establish without a dive-evidence
 * classifier, which would change extraction semantics and re-open the question of what counts as a
 * dive cue (this repo's fixtures treat a bare date like `"Oct 11"` as valid window evidence).
 */
export function diveWindowIsGuessed(trip: Trip): boolean {
  if (trip.diver?.value !== true) return false;
  if (trip.diveFrom?.state !== "stated" || trip.diveTo?.state !== "stated") return true;

  // The echo shape: a stated window that is exactly the stay. Values are read, not states, because
  // the whole point is that the states are lying — both read "stated" while the words are the
  // check-in/check-out sentence.
  const from = typeof trip.diveFrom.value === "string" ? trip.diveFrom.value : null;
  const to = typeof trip.diveTo.value === "string" ? trip.diveTo.value : null;
  const checkIn = typeof trip.checkIn?.value === "string" ? trip.checkIn.value : null;
  const checkOut = typeof trip.checkOut?.value === "string" ? trip.checkOut.value : null;
  return from !== null && to !== null && from === checkIn && to === checkOut;
}

// ---- Reply rendering --------------------------------------------------------
// Deterministic text for the reply: no model call, and every value comes from the
// trip the extractor already validated.

export type ReplyKind = "greeting" | "questions" | "summary";

export interface RenderedReply {
  kind: ReplyKind;
  text: string;
}

// The order a guest reads a booking back in: who is coming, what is included, who
// to contact. The stay leads the summary separately — it is a range, not a field.
// `language` and `guestType` are absent on purpose: the first is a property of the
// message itself and the second is an internal Odoo distinction, so neither means
// anything to the person reading the reply.
const SUMMARY_ORDER: ReadonlyArray<keyof Trip> = ["guests", "rooms", "roomType", "meals", "contactName"];

const LABELS: Record<keyof Trip, Record<Lang, string>> = {
  language: { en: "Language", zh: "语言" },
  checkIn: { en: "Check-in", zh: "入住" },
  checkOut: { en: "Check-out", zh: "退房" },
  nights: { en: "Nights", zh: "晚数" },
  guests: { en: "Guests", zh: "客人数" },
  rooms: { en: "Rooms", zh: "房间数" },
  roomType: { en: "Room type", zh: "房型" },
  meals: { en: "Meals", zh: "餐食" },
  transport: { en: "Airport transfer", zh: "机场接送" },
  contactName: { en: "Contact name", zh: "联系人姓名" },
  guestType: { en: "Guest type", zh: "客人类型" },
  transportType: { en: "Transfer", zh: "接送类型" },
  diveFrom: { en: "Diving from", zh: "潜水开始" },
  diveTo: { en: "Diving to", zh: "潜水结束" },
  diver: { en: "Diving", zh: "是否潜水" },
  divers: { en: "Divers", zh: "潜水人数" },
  diveNotes: { en: "Dive breakdown", zh: "潜水安排详情" },
  specialRequests: { en: "Special notes", zh: "特别要求" },
  dietNotes: { en: "Diet / allergies", zh: "饮食／过敏" },
  transferDirection: { en: "Airport transfer", zh: "机场接送" },
  guestNames: { en: "Guest names", zh: "客人名单" },
};

// The stay is not a field but a range of two of them, so it gets its own label
// rather than being squeezed into LABELS' `keyof Trip` shape.
const STAY_LABEL: Record<Lang, string> = { en: "Stay", zh: "住宿" };

const ENUM_LABELS: Record<string, Record<Lang, string>> = {
  full_board: { en: "full board", zh: "全餐" },
  half_board: { en: "half board", zh: "半餐" },
  room_only: { en: "room only", zh: "仅住宿" },
  none: { en: "none", zh: "无" },
  roundtrip: { en: "return trip", zh: "往返" },
  oneway: { en: "one way", zh: "单程" },
  retail: { en: "retail guest", zh: "散客" },
  agent: { en: "agent", zh: "代理" },
  instructor: { en: "instructor", zh: "教练" },
  // Room types read back as the words the question offered, so the guest can see that the
  // type they picked is the one being quoted.
  standard: { en: "standard", zh: "标准房" },
  deluxe: { en: "deluxe", zh: "豪华房" },
  suite: { en: "suite", zh: "套房" },
};

const YES_NO: Record<Lang, [string, string]> = {
  en: ["yes", "no"],
  zh: ["是", "否"],
};

/**
 * Wording that says somebody in the party cannot dive the boat package yet.
 *
 * This is a *note for staff*, not a question and not a priced field, which is why a keyword list is
 * acceptable here where it would not be anywhere else in this pipeline: the cost of a false
 * positive is a line in the studio that a person reads and dismisses, and the cost of a false
 * negative is exactly today's behaviour (nothing). It never fills a field, never blocks a handoff,
 * and never moves a number.
 *
 * Only the model's own nuance fields are searched — not the raw message — so the note is about what
 * the conversation actually recorded, in the guest's own words.
 */
const CERTIFICATION_HINT_RE =
  /\b(?:(?:not|non)[-\s]?certified|uncertified|beginner|first[-\s]?time|never\s+(?:dived|dove|been\s+diving)|discover\s+scuba|dsd|learn\s+to\s+dive|try\s+(?:scuba|diving))\b|没有证书|没有潜水证|不会潜水|第一次潜水|体验潜水/iu;

// A value the guest never said is flagged, so the summary cannot read as a
// confirmation of something Casa assumed. Only house norms carry this note:
// "derived" values are arithmetic on the guest's own answers (checkOut is checkIn
// + nights), which is exact rather than assumed, and flagging it would only make
// the summary noisier.
const ASSUMED_NOTE: Record<Lang, string> = {
  en: " (assumed)",
  zh: "（默认）",
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoParts(iso: string): { year: string; month: string; day: string } | null {
  // Pure string slicing: an ISO date from dates.ts is already resolved in Manila
  // time, and a Date round-trip could shift it by a day.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? { year: match[1] ?? "", month: match[2] ?? "", day: match[3] ?? "" } : null;
}

/** The date the way a guest writes it: "Sep 19, 2026" / "2026年9月19日". */
function formatDate(iso: string, lang: Lang): string {
  const p = isoParts(iso);
  if (!p) return iso;
  if (lang === "zh") return `${p.year}年${Number(p.month)}月${Number(p.day)}日`;
  return `${SHORT_MONTHS[Number(p.month) - 1]} ${Number(p.day)}, ${p.year}`;
}

/** The same date without its year — for a sentence already anchored to a stay. */
function formatDay(iso: string, lang: Lang): string {
  const p = isoParts(iso);
  if (!p) return iso;
  if (lang === "zh") return `${Number(p.month)}月${Number(p.day)}日`;
  return `${SHORT_MONTHS[Number(p.month) - 1]} ${Number(p.day)}`;
}

/**
 * A stay as one range rather than two dates, collapsing whatever the two ends
 * share: "Sep 19 – 21, 2026", "2026年9月19–21日". Falls back to two full dates when
 * the two ends are in different years.
 */
function formatRange(fromIso: string, toIso: string, lang: Lang): string {
  const from = isoParts(fromIso);
  const to = isoParts(toIso);
  if (!from || !to || from.year !== to.year) {
    return `${formatDate(fromIso, lang)} – ${formatDate(toIso, lang)}`;
  }
  if (lang === "zh") {
    return from.month === to.month
      ? `${from.year}年${Number(from.month)}月${Number(from.day)}–${Number(to.day)}日`
      : `${from.year}年${Number(from.month)}月${Number(from.day)}日 – ${Number(to.month)}月${Number(to.day)}日`;
  }
  return from.month === to.month
    ? `${SHORT_MONTHS[Number(from.month) - 1]} ${Number(from.day)} – ${Number(to.day)}, ${from.year}`
    : `${SHORT_MONTHS[Number(from.month) - 1]} ${Number(from.day)} – ${SHORT_MONTHS[Number(to.month) - 1]} ${Number(to.day)}, ${from.year}`;
}

function nightsText(nights: number, lang: Lang): string {
  if (lang === "zh") return `${nights} 晚`;
  return `${nights} ${nights === 1 ? "night" : "nights"}`;
}

function diversText(divers: number, lang: Lang): string {
  if (lang === "zh") return `${divers} 位潜水`;
  return `${divers} ${divers === 1 ? "diver" : "divers"}`;
}

const DATE_KEYS = new Set<keyof Trip>(["checkIn", "checkOut", "diveFrom", "diveTo"]);

function formatValue(key: keyof Trip, value: unknown, lang: Lang): string | null {
  if (value === null || value === undefined) return null;
  if (DATE_KEYS.has(key)) return typeof value === "string" ? formatDate(value, lang) : null;
  if (typeof value === "boolean") return YES_NO[lang][value ? 0 : 1];
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return ENUM_LABELS[value]?.[lang] ?? value;
  return null;
}

/** A value the guest stated in their own words, or null. Everything else — house
 * norms, code-derived values, another turn's transcript — reads as "not theirs". */
function statedValue<T>(trip: Trip, key: keyof Trip): T | null {
  const field = trip[key];
  return field?.state === "stated" && field.value !== null && field.value !== undefined
    ? (field.value as T)
    : null;
}

/** Auxiliary narrative notes (diveNotes, specialRequests, guestNames) may be
 * returned as either `stated` or `inferred` when the model summarizes a guest's
 * multi-clause breakdown. Both represent guest-supplied nuances rather than
 * house-norm guesses. */
function notedValue<T>(trip: Trip, key: keyof Trip): T | null {
  const field = trip[key];
  return (field?.state === "stated" || field?.state === "inferred") && field.value !== null && field.value !== undefined
    ? (field.value as T)
    : null;
}


// ---- Greeting (first reply) -------------------------------------------------

const GREETING: Record<Lang, string[]> = {
  en: [
    "Hi! Welcome to Casa Escondida — our dive-and-stay resort in Anilao, Batangas.",
    "So the team can check availability and pricing for you, could you share your check-in date, how many nights, how many guests, and a name for the booking?",
  ],
  zh: [
    "您好！欢迎来到 Casa Escondida——位于菲律宾 Anilao 的潜水度假村。",
    "为了帮您查询房态和价格，请告诉我入住日期、住几晚、几位客人，以及登记预订的姓名。",
  ],
};

// ---- Acknowledgment plus the remaining questions ----------------------------

// One sentence per recorded field. Every one of them takes its value from the
// trip, so the reply cannot invent a fact or miscount: there is no "3 of 7
// answers" arithmetic here for a guest to check against.
const STAY_PHRASE: Record<Lang, (day: string, nights: string) => string> = {
  en: (day, nights) => `your stay starting ${day} for ${nights}`,
  zh: (day, nights) => `从 ${day} 开始的 ${nights}`,
};

const CHECK_IN_PHRASE: Record<Lang, (day: string) => string> = {
  en: (day) => `your check-in on ${day}`,
  zh: (day) => `${day} 入住`,
};

const NIGHTS_PHRASE: Record<Lang, (nights: string) => string> = {
  en: (nights) => `a stay of ${nights}`,
  zh: (nights) => `${nights} 的住宿`,
};

const GUESTS_PHRASE: Record<Lang, (guests: number) => string> = {
  en: (guests) => `${guests} ${guests === 1 ? "guest" : "guests"}`,
  zh: (guests) => `${guests} 位客人`,
};

const MEALS_PHRASE: Record<Lang, (label: string) => string> = {
  en: (label) => label,
  zh: (label) => label,
};

const TRANSPORT_PHRASE: Record<Lang, { yes: string; no: string }> = {
  en: { yes: "an airport transfer", no: "that you don't need a transfer" },
  zh: { yes: "机场接送", no: "不需要接送" },
};

const DIVER_PHRASE: Record<Lang, { yes: string; no: string }> = {
  en: { yes: "diving", no: "no diving" },
  zh: { yes: "潜水", no: "不潜水" },
};

const NAME_PHRASE: Record<Lang, (name: string) => string> = {
  en: (name) => `your name, ${name}`,
  zh: (name) => `联系人 ${name}`,
};

const THANKS: Record<Lang, (name: string | null) => string> = {
  // The name is echoed exactly as the guest wrote it. Transliterating it
  // ("Nhat" → "Nhật") would be the bot correcting a fact the guest gave it.
  en: (name) => (name ? `Thanks, ${name}!` : "Thanks!"),
  zh: (name) => (name ? `谢谢 ${name}！` : "谢谢！"),
};

const NOTED: Record<Lang, (list: string) => string> = {
  en: (list) => `I've noted down ${list}.`,
  zh: (list) => `我已经记录了${list}。`,
};

const NEED: Record<Lang, string> = {
  en: "To complete your enquiry, could you let me know:",
  zh: "为了完成预订，请告诉我：",
};

function joinList(items: string[], lang: Lang): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (lang === "zh") return items.join("、");
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * What the guest has actually said, as clauses. Only `stated` fields appear: an
 * acknowledgment that reads a house-norm default back as though the guest had
 * chosen it is exactly the fabricated confirmation the eval treats as
 * zero-tolerance, and it is also what makes a guest think they were heard when
 * they were not.
 */
function ackParts(trip: Trip, lang: Lang): string[] {
  const parts: string[] = [];
  const checkIn = statedValue<string>(trip, "checkIn");
  const nights = statedValue<number>(trip, "nights");
  const guests = statedValue<number>(trip, "guests");
  const meals = statedValue<string>(trip, "meals");
  const transport = statedValue<boolean>(trip, "transport");
  const diver = statedValue<boolean>(trip, "diver");
  const name = statedValue<string>(trip, "contactName");

  // Read back in the order the guest told the story: when, how many, what is
  // included, who. "No diving" is a fact worth confirming back — a guest who
  // said it is more likely to correct a misreading than to volunteer it twice.
  if (checkIn && nights) parts.push(STAY_PHRASE[lang](formatDay(checkIn, lang), nightsText(nights, lang)));
  else if (checkIn) parts.push(CHECK_IN_PHRASE[lang](formatDay(checkIn, lang)));
  else if (nights) parts.push(NIGHTS_PHRASE[lang](nightsText(nights, lang)));
  if (guests) parts.push(GUESTS_PHRASE[lang](guests));
  if (meals) parts.push(MEALS_PHRASE[lang](ENUM_LABELS[meals]?.[lang] ?? meals));
  if (transport !== null) parts.push(TRANSPORT_PHRASE[lang][transport ? "yes" : "no"]);
  if (diver !== null) parts.push(DIVER_PHRASE[lang][diver ? "yes" : "no"]);
  const diveNotes = notedValue<string>(trip, "diveNotes");
  if (diveNotes) {
    if (lang === "zh") parts.push(`潜水安排（${diveNotes}）`);
    else parts.push(`diving schedule (${diveNotes})`);
  }
  if (name) parts.push(NAME_PHRASE[lang](name));
  return parts;
}

function renderAckAndQuestions(trip: Trip, lang: Lang, questions: GuestQuestion[], parts: string[]): string {
  const name = statedValue<string>(trip, "contactName");
  return [
    THANKS[lang](name),
    NOTED[lang](joinList(parts, lang)),
    NEED[lang],
    ...questions.map((q, i) => `${i + 1}. ${q.question}`),
  ].join("\n");
}

// ---- Summary (nothing left to ask) ------------------------------------------

const SUMMARY: Record<Lang, { intro: string; closing: string }> = {
  en: {
    intro: "Here's what I have for your stay:",
    // "Nothing is booked yet" is not politeness: this reply is the first thing a
    // guest could mistake for a confirmation, and only a human can confirm
    // availability or a price.
    closing: "Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.",
  },
  zh: {
    intro: "以下是您提供的信息：",
    closing: "Casa 团队会很快与您联系确认房态和价格——目前尚未预订。",
  },
};

function summaryLines(trip: Trip, lang: Lang): string[] {
  const lines: string[] = [];

  // The stay is one line, a range: the guest asked for a stay, not for a check-in
  // field and a check-out field. checkOut is arithmetic on the guest's own answers
  // (extract.ts derives it), so it carries no assumed-note.
  const checkIn = trip.checkIn?.state === "missing" ? null : ((trip.checkIn?.value as string | null) ?? null);
  const checkOut = trip.checkOut?.state === "missing" ? null : ((trip.checkOut?.value as string | null) ?? null);
  const nights = trip.nights?.state === "missing" ? null : ((trip.nights?.value as number | null) ?? null);
  const nightsSuffix = nights ? ` (${nightsText(nights, lang)})` : "";
  if (checkIn && checkOut) {
    lines.push(`• ${STAY_LABEL[lang]}: ${formatRange(checkIn, checkOut, lang)}${nightsSuffix}`);
  } else if (checkIn) {
    lines.push(`• ${LABELS.checkIn[lang]}: ${formatDate(checkIn, lang)}${nightsSuffix}`);
  } else if (checkOut) {
    lines.push(`• ${LABELS.checkOut[lang]}: ${formatDate(checkOut, lang)}`);
  }

  for (const key of SUMMARY_ORDER) {
    const field = trip[key];
    if (!field || field.state === "missing") continue;
    const shown = formatValue(key, field.value, lang);
    if (shown === null) continue;
    lines.push(`• ${LABELS[key][lang]}: ${shown}${field.state === "default" ? ASSUMED_NOTE[lang] : ""}`);
  }

  // The transfer is one line, not two: a guest reads "yes · return trip", and
  // one-way vs return only means anything once a transfer is wanted at all.
  const transport = trip.transport;
  const transportType = trip.transportType;
  if (transport && transport.state !== "missing" && typeof transport.value === "boolean") {
    const wantsTransfer = transport.value;
    const typeLabel =
      wantsTransfer && transportType?.value && transportType.value !== "none"
        ? formatValue("transportType", transportType.value, lang)
        : null;
    const isAssumed =
      transport.state === "default" ||
      (wantsTransfer && transportType && (transportType.state === "derived" || transportType.state === "default"));
    lines.push(
      `• ${LABELS.transport[lang]}: ${YES_NO[lang][wantsTransfer ? 0 : 1]}${typeLabel ? ` · ${typeLabel}` : ""}${
        isAssumed ? ASSUMED_NOTE[lang] : ""
      }`,
    );
  }

  const diver = trip.diver;
  if (diver && diver.state !== "missing" && typeof diver.value === "boolean") {
    const diveFrom = (trip.diveFrom?.value as string | null) ?? null;
    const diveTo = (trip.diveTo?.value as string | null) ?? null;
    const notes = trip.diveNotes?.value ? ` (${trip.diveNotes.value})` : "";
    const divers = typeof trip.divers?.value === "number" ? ` · ${diversText(trip.divers.value, lang)}` : "";
    // A guessed window is never repeated back as the guest's own dates — that would be asserting
    // a number the guest never gave, to their face. Instead it reads "dive dates to confirm".
    const window = diveWindowIsGuessed(trip)
      ? (lang === "zh" ? " · 潜水日期待确认" : " · dive dates to confirm")
      : diveFrom && diveTo
        ? ` · ${formatRange(diveFrom, diveTo, lang)}`
        : "";
    lines.push(`• ${LABELS.diver[lang]}: ${YES_NO[lang][diver.value ? 0 : 1]}${divers}${window}${notes}`);
  }

  const special = trip.specialRequests?.value;
  if (special && trip.specialRequests?.state !== "missing") {
    lines.push(`• ${LABELS.specialRequests[lang]}: ${special}`);
  }
  const diet = trip.dietNotes?.value;
  if (diet && trip.dietNotes?.state === "stated") {
    lines.push(`• ${LABELS.dietNotes[lang]}: ${diet}`);
  }

  const guestNames = trip.guestNames?.value;
  if (guestNames && guestNames.length > 0 && trip.guestNames?.state !== "missing") {
    lines.push(`• ${LABELS.guestNames[lang]}: ${guestNames.join(", ")}`);
  }

  return lines;
}

function getNoFlyAdvisory(trip: Trip, lang: Lang): string | null {
  // Only meaningful when the guest actually said they dive through the departure day. A guessed
  // window that happens to equal the stay would otherwise fire this warning about a dive day
  // nobody described.
  if (diveWindowIsGuessed(trip)) return null;
  if (trip.diver?.value === true && trip.diveTo?.value && trip.checkOut?.value) {
    if (trip.diveTo.value === trip.checkOut.value) {
      if (lang === "zh") {
        return "⚠️ 潜水安全提示：根据 PADI/DAN 指南，潜水后乘机离开马尼拉前建议至少间隔 18–24 小时。";
      }
      return "⚠️ Dive Safety Note: PADI/DAN guidelines recommend an 18–24 hour surface interval after diving before flying out from Manila.";
    }
  }
  return null;
}

/**
 * Staff handoff alerts for pricing & operational edge cases that must never be
 * silently guessed in code:
 * 1. Partner / Agency rate confirmation (e.g. 30% agency or instructor discount).
 * 2. Custom split-day diving schedule (`diveNotes` present while single `divers`
 *    slot was intentionally bypassed via NEVER RE-ASK).
 * 3. More rooms than overnight guests — unusual enough to flag for a second look,
 *    surfaced as a "staff will confirm" note rather than a re-asked question.
 */
export function getStaffAlerts(trip: Trip, lang?: GuestLanguage): string[] {
  const l: Lang = lang ?? trip.language?.value ?? "en";
  const alerts: string[] = [];
  const guestType = trip.guestType?.value;

  if (guestType === "agent" || guestType === "instructor") {
    const typeLabel = ENUM_LABELS[guestType]?.[l] ?? guestType;
    // Guest-facing, and it deliberately names no figure. The previous wording promised "applicable
    // partner discount rates (e.g. 30% agency discount)" — a discount this pipeline never applies,
    // because the bot always quotes retail. So the guest was told to expect money off and the
    // quotation would not show it. Naming a percentage here promises a number we cannot stand
    // behind; a person confirms the rate, on the quote.
    if (l === "zh") {
      alerts.push(`📋 已记录为${typeLabel}咨询——合作价将由我们的团队在报价单上直接确认。`);
    } else {
      alerts.push(
        `📋 Noted as a ${typeLabel} enquiry — our team will confirm your partner rates directly on the quotation.`,
      );
    }
  }

  const diveNotes = notedValue<string>(trip, "diveNotes");
  if (diveNotes && trip.divers?.state === "missing") {
    // Guest-facing. The previous wording — "routed to staff for manual per-day quote calculation"
    // — described our own workflow to the customer, in our own vocabulary ("split-day", "per-day
    // quote calculation"). The guest said something simple and should hear it acknowledged simply;
    // the fact that a person computes it is staff's business, not theirs.
    if (l === "zh") {
      alerts.push(`📋 我们已记录您的潜水安排（${diveNotes}），团队会与您确认每天的细节。`);
    } else {
      alerts.push(
        `📋 We've noted your diving plan (${diveNotes}) — our team will confirm the day-by-day details with you.`,
      );
    }
  }

  // A diver without a certification cannot take the boat-dive package at all — they need a Discover
  // Scuba Diving course instead, which is a different product at a different price. This pipeline
  // cannot decide that: their rate card prices courses (`courseRates.dsd`) but models no
  // "uncertified" state, and the course is assigned per guest by staff in the estimator's own app.
  // So it is not a question the bot asks (it would add a handoff gate for a fact the estimator
  // cannot price) and not something to guess either: the guest's own nuance reaches staff as a note.
  //
  // Read from the nuance fields rather than the raw message, because those are what the model
  // already lifted out of the conversation and what the guest can see us acknowledging.
  const diveNuance = [diveNotes, notedValue<string>(trip, "specialRequests")]
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .join(" · ");
  if (trip.diver?.value === true && diveNuance.length > 0 && CERTIFICATION_HINT_RE.test(diveNuance)) {
    if (l === "zh") {
      alerts.push(
        "📋 潜水证书待确认：您的留言提到有潜水员可能还没有证书——团队会在报价前与您确认，未持证者可以改上体验潜水（DSD）课程。",
      );
    } else {
      alerts.push(
        "📋 Dive Certification To Confirm: your message mentions someone who may not be certified yet — our team will confirm this before quoting, and a Discover Scuba Diving course is available for anyone without a certification.",
      );
    }
  }
  // A dive window nobody stated is the one gap that reaches pricing silently: the guest said they
  // dive, the never-re-ask rule stopped us asking which days, and the payload builder fills the
  // gap. Naming it here is what stops a charged-per-day number appearing from nowhere. Phrased to
  // be true for both audiences, because renderSummary appends these lines to the guest's own
  // message — it states that the days are unconfirmed and that a person will confirm them, and it
  // deliberately does NOT repeat the assumed dates as if the guest had given them.
  if (diveWindowIsGuessed(trip)) {
    if (l === "zh") {
      alerts.push(
        "📋 潜水日期待确认：您表示要潜水，但尚未提供具体潜水日期，因此报价前需由工作人员确认天数（潜水按每位潜水员／每天计费）。",
      );
    } else {
      alerts.push(
        "📋 Dive Days To Confirm: you'd like to dive, but no dive dates were given, so our team will confirm the days with you before quoting — diving is charged per diver, per day.",
      );
    }
  }

  // More rooms than overnight guests is not impossible (a family may want separate rooms), but
  // it is unusual enough that pricing it without a second look is a bet. It is a "staff will
  // confirm" note, not a question: the BFF already treats an empty room as a warning rather than
  // an error, and re-asking a guest who already told us their room count is the exact failure
  // mode the count reader just stopped causing. The numeric check is all that is needed — a
  // house-norm default room count is derived from the guest count, so it can never trip this.
  const guestCount = typeof trip.guests?.value === "number" ? trip.guests.value : 0;
  const roomCount = typeof trip.rooms?.value === "number" ? trip.rooms.value : 0;
  if (guestCount > 0 && roomCount > guestCount) {
    if (l === "zh") {
      alerts.push(
        `📋 房间数待确认：您预订了 ${roomCount} 间房，共 ${guestCount} 位住宿客人——报价前我们的团队会与您确认房间分配。`,
      );
    } else {
      alerts.push(
        `📋 Rooms To Confirm: ${roomCount} rooms for ${guestCount} overnight guests — our team will double-check the room split with you before quoting.`,
      );
    }
  }

  return alerts;
}

function renderSummary(trip: Trip, lang: Lang): string {
  const name = statedValue<string>(trip, "contactName");
  const noFly = getNoFlyAdvisory(trip, lang);
  const staffAlerts = getStaffAlerts(trip, lang);
  const diveNotes = notedValue<string>(trip, "diveNotes");
  const specialRequests = notedValue<string>(trip, "specialRequests");
  const guestNames = notedValue<string[]>(trip, "guestNames");

  const notesAck: string[] = [];
  if (diveNotes) {
    if (lang === "zh") notesAck.push(`已为您记录具体潜水安排：${diveNotes}。`);
    else notesAck.push(`I've noted your diving arrangement: ${diveNotes}.`);
  }
  if (specialRequests) {
    if (lang === "zh") notesAck.push(`特别要求：${specialRequests}。`);
    else notesAck.push(`Special note: ${specialRequests}.`);
  }
  if (guestNames && guestNames.length > 0) {
    if (lang === "zh") notesAck.push(`同行成员：${guestNames.join(", ")}。`);
    else notesAck.push(`Party members noted: ${guestNames.join(", ")}.`);
  }

  return [
    THANKS[lang](name),
    ...(notesAck.length > 0 ? [notesAck.join(" ")] : []),
    SUMMARY[lang].intro,
    ...summaryLines(trip, lang),
    ...(staffAlerts.length > 0 ? ["", ...staffAlerts] : []),
    ...(noFly ? ["", noFly] : []),
    "",
    SUMMARY[lang].closing,
  ].join("\n");
}

/**
 * The single message sent back to a guest, and which of the three it is: the
 * greeting while the guest has told us nothing, acknowledgment plus the open
 * questions while the enquiry is incomplete, the summary once there is nothing
 * left to ask. Values that came from a house norm are flagged as assumed wherever
 * they are shown, so the guest can tell Casa's guesses from their own words.
 *
 * converse.ts picks `done` from `questions.length === 0`, so the summary and an
 * empty question list can never disagree.
 */
export function renderReply(trip: Trip, questions: GuestQuestion[]): RenderedReply {
  const lang: Lang = trip.language.value ?? "en";

  if (questions.length === 0) return { kind: "summary", text: renderSummary(trip, lang) };

  const parts = ackParts(trip, lang);
  // Nothing to acknowledge: this is the first thing the guest hears, so it is an
  // introduction rather than a form pretending to know something. The open
  // questions stay in `questions` for a form UI; the greeting asks for the same
  // four fields a quote needs, in the order the team works in.
  if (parts.length === 0) return { kind: "greeting", text: GREETING[lang].join("\n") };

  return { kind: "questions", text: renderAckAndQuestions(trip, lang, questions, parts) };
}

// ---- Fallbacks: the replies for the moments this contract cannot answer ------
//
// Deliberately not a fourth ReplyKind. The three kinds above are read off a Trip;
// these two exist precisely because there is no Trip to read — the model failed,
// or the thread stopped being the bot's to answer. They are static (same wording
// every time, in the guest's own language) and they are why a guest waiting on a
// provider outage gets a sentence instead of silence.
//
// Same rule as everything else in this file: no model writes them, so they cannot
// promise a room, a price, or a time.
export type FallbackKind = "apology" | "handoff" | "not_booking";

/**
 * Asking is not progress after this many assistant turns on a thread that is still
 * incomplete: the guest is stuck (or the extractor is), and another round of the
 * same questions is where an enquiry dies. The thread goes to a person instead.
 *
 * A safety valve, not a cap on asking — one reply already carries every open
 * question, so a normal enquiry finishes in two or three turns.
 */
export const ASK_LIMIT = 8;

/**
 * How many consecutive replies may leave the SAME questions open before the thread is handed over.
 *
 * `ASK_LIMIT` counts turns, which is a blunt instrument in both directions: a guest who answers one
 * field per message for nine messages is clearly getting somewhere and gets cut off, while a guest
 * who repeats themselves — or an extractor that keeps failing to record the field it keeps asking
 * about — burns the same nine turns producing nothing. This counts *progress* instead: it is the
 * number of times the open-question set has failed to shrink, so one more turn that adds nothing is
 * the signal, whatever the turn number.
 *
 * Three, not one: a guest may answer a question with something the extractor cannot use yet
 * ("sometime in October"), which is not yet stuck. By the third identical ask with no ground
 * gained, another round is no longer the best thing for the guest.
 */
export const STALL_LIMIT = 3;

// Guests ask for a person in their own words, and both mistakes are not equal:
// a false positive costs one handoff a human can decline, a false negative keeps a
// frustrated guest in a bot loop. So the phrases are explicit — the bare word
// "human" is not enough, because "human resources conference" is a real enquiry
// and not a request to be transferred.
const HUMAN_RE = new RegExp(
  [
    "\\b(?:talk|speak|chat|write)\\s+(?:to\\s+)?(?:a\\s+|the\\s+|an\\s+)?(?:human|person|someone|agent|staff|receptionist|manager|team)\\b",
    "\\b(?:human|person|agent|receptionist|manager|staff)\\s+(?:please|now|instead|available)\\b",
    "\\b(?:call|ring)\\s+me\\b",
    "\\b(?:put|get)\\s+me\\s+through\\s+to\\b",
    "\\btransfer\\s+me\\b",
    "人工|真人|工作人员|客服人员|转接",
  ].join("|"),
  "i",
);

/**
 * True when the guest is asking for a person rather than for an answer.
 */
export function wantsHuman(text: string): boolean {
  return HUMAN_RE.test(text);
}

// The answer to the partner invitation: "actually, we're booking for ourselves".
//
// Why this needs its own detector rather than trusting the extraction: `guestType` is read from
// phrasing from the transcript, so once a message has sounded like an agency the reading tends to
// keep saying "agent" — the guest's correction does not remove the earlier sentence. Measured on
// production: the bot invited the same guest to sign in as a partner again, and again, because the
// invitation branch fired on every turn from a reading that the guest's own words had already
// contradicted. The invitation itself promises "just tell me and I'll carry on", so this is the
// phrase it promised to hear. A false positive is cheap here — it means a partner is treated as a
// retail guest — and the wording is explicit for the same reason HUMAN_RE is.
const DECLINES_PARTNER_RE = new RegExp(
  [
    "\\b(?:for|by)\\s+(?:our|my)sel(?:f|ves)\\b",
    "\\bnot\\s+(?:an?\\s+)?(?:agency|agent|partner|travel\\s+agent|dive\\s+shop|instructor)\\b",
    "\\bwe(?:'re| are)\\s+not\\s+(?:an?\\s+)?(?:agency|agent|partner)\\b",
    "\\b(?:personal|private)\\s+(?:booking|trip|holiday|stay)\\b",
    "\\bjust\\s+(?:us|me|two\\s+of\\s+us)\\b",
    "\\bno\\s+agency\\b",
    // Chinese: "we are booking for ourselves" / "not an agency".
    "我们自己(?:订|预订|订房|去|玩)",
    "不是(?:旅行社|代理)",
  ].join("|"),
  "i",
);

/** True when the guest is telling the bot they are not booking as a partner after all. */
export function declinesPartner(text: string): boolean {
  return DECLINES_PARTNER_RE.test(text);
}

const FALLBACKS: Record<FallbackKind, Record<GuestLanguage, string>> = {
  // Sent when a turn failed before anything reached the guest. It says what
  // happened in one clause, then the only thing that is actually true and useful:
  // a person has it. It does not ask the guest to type everything again — the test
  // transcript is kept on our side.
  //
  // Both promises that a person will reply now carry the front desk's hours, because the bot runs
  // 24/7 and the desk does not: the resort's own site publishes "front desk open until 9 PM"
  // (read 2026-09-28), so at 22:00 "a person will reply here" was a promise with no morning in it.
  // The sentence is deliberately static rather than clock-aware — it is true at every hour, and it
  // needs no timezone arithmetic to stay true.
  apology: {
    en: "Sorry — something went wrong on our side while I was reading your last message, so I haven't managed to note the details down yet. I've flagged this for the Casa team and a person will reply to you here. Our front desk is open until 9 PM (Manila time), so if you have written outside those hours you will hear from us the next morning.",
    zh: "抱歉，我们这边读取您刚才的消息时出了问题，暂时还没能记录下信息。我已经通知 Casa 团队，会在这里回复您。前台服务时间至晚上 9 点（马尼拉时间），若您在此时间之后留言，我们会在第二天早上回复您。",
  },
  // Sent while a thread is parked for a human (after a failure, after the guest
  // asked for a person, or once asking has stopped being useful).
  handoff: {
    en: "A member of the Casa team is handling your enquiry now and will reply to you here. Our front desk is open until 9 PM (Manila time), so if you have written outside those hours you will hear from us the next morning. Thank you for your patience.",
    zh: "Casa 团队正在处理您的咨询，会在这里回复您。前台服务时间至晚上 9 点（马尼拉时间），若您在此时间之后留言，我们会在第二天早上回复您。感谢您的耐心等待。",
  },
  // Sent when the message is not a booking enquiry at all (see intent.ts). It names what this
  // number is for and who answers, and it deliberately does not scold: a guest who asked the wrong
  // channel a real question still deserves an answer, so a person follows up either way.
  not_booking: {
    en: "Thanks for your message! This number is for new booking enquiries, so I've passed it to the Casa team — a person will reply to you here.",
    zh: "感谢您的消息！此号码用于新的预订咨询，我已将您的消息转给 Casa 团队，会有人在这里回复您。",
  },
};

/** The static message for a moment with no trip to render, in the guest's language. */
export function fallbackReply(kind: FallbackKind, language: GuestLanguage | null): string {
  return FALLBACKS[kind][language ?? "en"];
}

/**
 * What a partner/agency enquiry is told instead of being priced.
 *
 * Their app derives `guestType` from the *session*, not from the message, and a bot session is an
 * anonymous guest — so every quotation the bot builds is priced at the retail rate
 * (`bff/src/trip/derive.ts` overrides `guestType`). An agency asking for their partner rate would
 * therefore be quoted retail, and the studio's Agent View — which exists to show the two side by
 * side — would never have a retail model to compare against, because there was never a partner
 * session behind it.
 *
 * The manual flow already answers this: an agent signs in on the customer's own app, sees their own
 * rate, and books directly. So the bot's job is to say that, and to stay soft about it — the agent
 * signal is read from phrasing ("our agency", "partner rate") and a guest who happens to write like
 * an agency can simply say so. That is why this is an invitation rather than a redirect: the last
 * sentence tells them how to send the conversation back to the ordinary path.
 */
export function partnerInvitationReply(language: GuestLanguage | null, signInUrl: string): string {
  if (language === "zh") {
    return [
      "如果您是以合作旅行社／代理身份预订，请在我们的报价 App 登录，即可看到您的合作价并直接预订：",
      signInUrl,
      "新的合作账号由前台审核开通。如果您只是为自己预订，回复我一声，我就照常继续。",
    ].join("\n");
  }
  return [
    "If you're booking as a partner agency, sign in on our quotation app to see your partner rate and book directly:",
    signInUrl,
    "New partner accounts are verified by our front desk. If you're booking for yourselves, just tell me and I'll carry on.",
  ].join("\n");
}

/**
 * The holding message for a thread that has stopped making progress, naming what is still missing.
 *
 * This is the one handoff where the guest is told *why*, because they did not ask for a person and
 * did not hit an error — they simply kept talking without the booking coming together. A bare "a
 * person is handling it" leaves them unsure whether anything they said was understood, and the
 * whole point of stopping is that a human is about to ask them the very same questions. Naming the
 * gaps is also the honest readback: it is the same list the staff member sees on the parked thread.
 *
 * Field names are the pipeline's own, so they are translated here rather than shown.
 */
const FIELD_PHRASES: Record<string, Record<GuestLanguage, string>> = {
  checkIn: { en: "your check-in date", zh: "入住日期" },
  checkOut: { en: "your check-out date", zh: "退房日期" },
  nights: { en: "how many nights", zh: "住几晚" },
  guests: { en: "how many guests", zh: "客人人数" },
  rooms: { en: "how many rooms", zh: "房间数" },
  meals: { en: "your meal plan", zh: "餐食方案" },
  transport: { en: "whether you need a transfer", zh: "是否需要接送" },
  transportType: { en: "one-way or return transfer", zh: "单程还是往返接送" },
  contactName: { en: "a name for the booking", zh: "预订人姓名" },
  diver: { en: "whether you plan to dive", zh: "是否潜水" },
  divers: { en: "how many of you dive", zh: "潜水人数" },
  diveFrom: { en: "the first day you dive", zh: "开始潜水的日期" },
  diveTo: { en: "the last day you dive", zh: "结束潜水的日期" },
};

export function stalledHandoffReply(
  missingFields: ReadonlyArray<keyof Trip>,
  language: GuestLanguage | null,
): string {
  const lang: GuestLanguage = language ?? "en";
  const phrases = missingFields
    .map((field) => FIELD_PHRASES[field as string]?.[lang])
    .filter((p): p is string => Boolean(p))
    .slice(0, 3);

  if (lang === "zh") {
    const list = phrases.length > 0 ? `（还差：${phrases.join("、")}）` : "";
    return `为了避免重复询问，我已将您的咨询转给 Casa 团队成员，他们会在这里继续与您确认${list}。感谢您的耐心等待。`;
  }
  // Nothing to name means the enquiry was already complete and the guest was only chatting — so
  // "rather than ask you the same things again" would be describing something that never happened.
  // The plain handoff sentence is the honest one for that case.
  if (phrases.length === 0) return fallbackReply("handoff", lang);
  return `Rather than ask you the same things again, I've passed your enquiry to a member of the Casa team, who will pick it up with you here (still needed: ${joinList(phrases, lang)}). Thank you for your patience.`;
}

// ---- A money field the guest changed their mind about -----------------------
//
// Why this exists: the extractor re-reads the WHOLE transcript every turn, so when a guest says
// "actually make it 3" after saying 5, the new number simply replaces the old one and the reply
// carries on as though nothing happened. That is fine for a preference and wrong for a count the
// price is built from — a silent change to `guests` or `divers` is a different quotation, and the
// guest never sees the moment it changed.
//
// So the change is read back once, naming both numbers. Once, because the store records the new
// value as it does so: a guest who confirms by saying nothing is not asked again, and a guest who
// changes it a third time is told again. Only fields a price depends on are tracked — being asked
// to confirm a changed meal plan would be noise.

/** How a changed count reads back. Keyed by Trip field, so an unknown field is never shown. */
const VALUE_LABELS: Record<string, Record<GuestLanguage, string>> = {
  nights: { en: "nights", zh: "晚" },
  guests: { en: "guests", zh: "位客人" },
  rooms: { en: "rooms", zh: "间房" },
  divers: { en: "divers", zh: "位潜水员" },
};

export interface StatedValueChange {
  field: string;
  from: string | number | boolean;
  to: string | number | boolean;
}

function shownValue(field: string, value: string | number | boolean, lang: GuestLanguage): string {
  if (typeof value === "boolean") return value ? YES_NO[lang][0] : YES_NO[lang][1];
  return `${value} ${VALUE_LABELS[field]?.[lang] ?? ""}`.trim();
}

/**
 * The readback line for values the guest has changed since they first gave them, or "" when nothing
 * money-bearing changed. At most two are named: a third simultaneous change is far more likely to be
 * a misread by the extractor than three genuine corrections, and listing them all would bury the
 * first.
 */
export function changedValueNotice(
  changes: ReadonlyArray<StatedValueChange>,
  language: GuestLanguage | null,
): string {
  const lang: GuestLanguage = language ?? "en";
  const known = changes.filter((c) => VALUE_LABELS[c.field]).slice(0, 2);
  if (known.length === 0) return "";

  const parts = known.map((change) =>
    lang === "zh"
      ? `${VALUE_LABELS[change.field]![lang]}从 ${shownValue(change.field, change.from, lang)} 改为 ${shownValue(change.field, change.to, lang)}`
      : `${shownValue(change.field, change.from, lang)} → ${shownValue(change.field, change.to, lang)}`,
  );
  const last = known[known.length - 1]!;

  if (lang === "zh") {
    return `请确认一下：${parts.join("，")}。我先按最新的 ${shownValue(last.field, last.to, lang)} 记录。`;
  }
  return `Just to check — you changed ${joinList(parts, lang)}. I've kept the newest one (${shownValue(
    last.field,
    last.to,
    lang,
  )}); tell me if that's not right.`;
}

