// The three counts an estimate is priced from — nights, guests, rooms — and the one
// question this file answers about them: did the guest's own message put *this* number on
// *this* count?
//
// Playbook and ADR-006 Decision 4 say the same thing about money fields: the model may
// propose, code decides, and ambiguity is a question rather than a guess. dates.ts has
// done that for checkIn since the phrase table was made corroborating. This is the same
// rule for the numbers, and the gap it closes is measured rather than imagined. In the
// recorded live run (eval/fixtures.mock-30.json) the vi-09 message reads
// "nhóm mình có 8 người nhưng chỉ 4 người ở lại 2 đêm" — eight in the group, four of them
// staying — and the model answered `guests: 8`. Both numbers sit in the same sentence
// against the same noun; the model's evidence for its 8 was a verbatim substring of the
// guest's own words, so evidence enforcement kept it. Nobody reading that message can say
// from the text alone which number the estimate should be priced from, which is exactly
// why a person has to be asked: silently taking either one is a 100% error on the largest
// line of the quote.
//
// So the rule is deliberately blunt, and wrong only in the safe direction:
//
//   * the message states one number for this count and it is the model's → keep it;
//   * the message states one number for this count and it is not the model's → the field
//     goes back to `missing`, which is what turns it into the question in questions.ts;
//   * the message states two different numbers for this count → `missing` as well. Not
//     "the largest", not "the first": the guest's words do not identify a total, so only
//     the guest can — the same reason yearlessNumeric() refuses "7/3";
//   * the message states no number this reader can see → no opinion, and the field is left
//     exactly as the rest of the pipeline left it. That silence is not consent: an
//     unreadable count phrase is still the guest's number, and overruling evidence
//     enforcement from a second angle would turn correct extractions into questions.
//
// "Next to the count" is narrow on purpose. A number is read only when it sits directly
// against that count's own noun or classifier — "4 người", "3 phòng", "2 đêm", "4 of us",
// "3 rooms", "4位客人", "3晚" — never merely somewhere in the message. The eval corpus is
// full of numbers that are not counts (en-03's phone number and "12 dives logged", vi-09's
// "0988776655", zh-03's WeChat id), and a reader that swept the whole turn for digits would
// turn those into guest counts. `(?<!\d)(\d{1,3})(?!\d)` keeps a digit run *inside* a
// longer one out too: no prefix of a phone number is ever a room count.
//
// One hole was closed by deleting it (2026-09-25): the reader that judged a count by the
// model's own quote. A count the guest's words put one number on is settled by those words; a
// count they say nothing this reader recognises about is left exactly as the rest of the
// pipeline left it, and the model's number stands. Reading the quote with the same noun list is
// still comprehension — the model's job, not the code's — and it is what wiped a correct
// `divers: 4`: "all 4 of us will dive" has no `diver` noun, so the quote check read "of us" as a
// guests noun and turned a right answer into a question the guest had already answered.
// Fabrication is already guarded by enforceVerbatimEvidence (the quote must be the guest's own
// words); this file now only vetoes on a contradiction the guest's words actually state.

import {
  type CountField,
  COUNT_NOUNS,
  LATIN_NUMBER_WORDS,
  HAN_NUMBER_WORDS,
  NUMBER_WORDS,
  DIGITS_RE_STR as DIGITS,
  CLASSIFIER_RE_STR as CLASSIFIER,
  PERSON_NOUNS,
  DIVE_AUX_RE_STR as DIVE_AUX,
  DIVE_CLAUSE_AFTER_NOUN,
} from "./lexicon.ts";

export type { CountField };

/** The verdict on a number the model proposed for one of the three counts. */
export type CountCorroboration =
  | "consistent" // the guest's own words put this number on this count
  | "conflicting" // they put a different number on it, or more than one
  | "no-opinion"; // nothing this reader recognises — the caller decides, and keeps it

// Longest first, so a shorter word can never shadow a longer one if one is ever added:
// the alternation is ordered by length rather than by the object's key order.
const LATIN_WORDS = Object.keys(LATIN_NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const HAN_WORDS = Object.keys(HAN_NUMBER_WORDS).join("|");
// Group 1 is the digits, group 2 the Latin word, group 3 the Han word — exactly one of
// them is ever defined on a match.
const NUMBER = `(?:${DIGITS}|(?<![\\p{L}])(${LATIN_WORDS})(?![\\p{L}])|(${HAN_WORDS}))`;

const PATTERNS = new Map<CountField, RegExp>();

// English also writes a group with the number *after* the collective noun — "party of 2"
// (en-05), "Family of 5" (en-08) — and there the number has no count noun of its own to
// attach to, so the pattern above cannot see it. Deliberately English-only: Vietnamese
// puts the number first ("nhóm mình 6 bạn", which the noun "bạn" already reads) and so
// does Chinese ("一家3口", read by 口).
const COLLECTIVE_OF = new RegExp(`(?:party|group|family|team)\\s+of\\s+${NUMBER}`, "giu");

// The mirror of DIVE_CLAUSE_AFTER_NOUN below, and the whole reason that guard needs one.
//
// A guest usually counts divers with the *verb*, not the noun: "all 4 of us will dive", "the
// 4 of us are diving", "4 people dive both days". The count nouns above cannot see those, and
// `guests` deliberately refuses them, so such a number lands on no count at all — and then
// `corroborateCount` judges the model's `divers` by its own quote, where "4 of us" reads as a
// *guests* noun and correctly-extracted `divers: 4` comes back "conflicting".
//
// Measured, not theorised. For "Yes, all 4 of us will dive on Sunday and Monday" the reader
// returned [] for BOTH `guests` and `divers`, and corroborateCount("divers", 4, …) answered
// "conflicting", so extract.ts wiped a right number and the guest was asked "how many of you
// will be diving?" immediately after saying it — while the same reply's own summary line read
// back "all 4 of you". A number no reader can see is a number nobody can check.
//
// Only a *person* noun may carry this count, never the activity: "2 boat dives" and "12 dives
// logged" are numbers of dives, not of divers, and stay invisible here.
const DIVERS_CLAUSE = new RegExp(
  `${NUMBER}\\s*${CLASSIFIER}\\s*(?:(?:${PERSON_NOUNS})\\s+${DIVE_AUX}(?:dive|dives|diving)\\b` +
    `|(?:人|客人|大人|小孩)\\s*(?:(?:去|要|会|想)\\s*)?(?:潜水|潛水|深潜))`,
  "giu",
);

/**
 * The pattern that finds "a number written against this count's noun". One regex per
 * field, built once: it carries every noun and every number word, and rebuilding it per
 * call would put a compile on the hot path of every extraction.
 */
// When a guest writes "1 person dives day 1, 5 people dive both days" or "1 người lặn",
// the noun ("person", "people", "người") is the subject of a diving verb rather than a
// statement of total staying guests. Excluding nouns immediately followed by a diving verb
// prevents `corroborateCount("guests", ...)` from misreading diver head-counts as conflicting
// total guest counts and wiping the stated `guests` field back to `missing`.

function patternFor(field: CountField): RegExp {
  let pattern = PATTERNS.get(field);
  if (!pattern) {
    const suffix = field === "guests" ? DIVE_CLAUSE_AFTER_NOUN : "";
    pattern = new RegExp(`${NUMBER}\\s*${CLASSIFIER}\\s*(?:${COUNT_NOUNS[field]})${suffix}`, "giu");
    PATTERNS.set(field, pattern);
  }
  return pattern;
}

/**
 * Every number the guest's own words put against this count, deduplicated and sorted.
 * `[]` means this reader has nothing to say about the field; two entries mean the message
 * itself is ambiguous about it. Empty for text that is not a guest's message at all —
 * callers pass the guest's turns only (see guestTextOf in normalize.ts), never the bot's.
 */
export function countNumbersIn(text: string, field: CountField): number[] {
  const found = new Set<number>();
  const collect = (match: RegExpMatchArray) => {
    const digits = match[1];
    const word = (match[2] ?? match[3] ?? "").toLowerCase();
    const value = digits !== undefined ? Number(digits) : NUMBER_WORDS[word];
    if (typeof value === "number") found.add(value);
  };
  // matchAll() reads a fresh iterator and does not advance the shared pattern's
  // lastIndex, so the cached regexes above stay stateless across calls.
  for (const match of text.matchAll(patternFor(field))) collect(match);
  if (field === "guests") {
    for (const match of text.matchAll(COLLECTIVE_OF)) collect(match);
  }
  // Divers are counted with the verb far more often than with the noun, and `guests` refuses
  // that phrasing on purpose — so it is read here, and only here (see DIVERS_CLAUSE).
  if (field === "divers") {
    for (const match of text.matchAll(DIVERS_CLAUSE)) collect(match);
  }
  return [...found].sort((a, b) => a - b);
}

const ADULT_NOUNS = "adults?|大人";
const CHILD_NOUNS = "kids?|children|child|小孩|儿童|孩子";
const STAYING_NOUNS = "are\\s+staying|is\\s+staying|staying|stay\\s+overnight|overnight|入住";

const ADULT_PATTERN = new RegExp(`${NUMBER}\\s*${CLASSIFIER}\\s*(?:${ADULT_NOUNS})`, "giu");
const CHILD_PATTERN = new RegExp(`${NUMBER}\\s*${CLASSIFIER}\\s*(?:${CHILD_NOUNS})`, "giu");
const STAYING_PATTERN = new RegExp(`${NUMBER}\\s*${CLASSIFIER}\\s*(?:${STAYING_NOUNS})`, "giu");

function extractCountWithPattern(text: string, pattern: RegExp): number | null {
  for (const match of text.matchAll(pattern)) {
    const digits = match[1];
    const word = (match[2] ?? match[3] ?? "").toLowerCase();
    const val = digits !== undefined ? Number(digits) : NUMBER_WORDS[word];
    if (typeof val === "number") return val;
  }
  return null;
}

export function adultAndChildSum(text: string): number | null {
  const turns = text.split("\n").map((t) => t.trim()).filter(Boolean);
  for (let i = turns.length - 1; i >= 0; i--) {
    const adults = extractCountWithPattern(turns[i] ?? "", ADULT_PATTERN);
    const children = extractCountWithPattern(turns[i] ?? "", CHILD_PATTERN);
    if (adults !== null && children !== null) {
      return adults + children;
    }
  }
  const adults = extractCountWithPattern(text, ADULT_PATTERN);
  const children = extractCountWithPattern(text, CHILD_PATTERN);
  if (adults !== null && children !== null) {
    return adults + children;
  }
  return null;
}

export function stayingGuestsCount(text: string): number | null {
  const turns = text.split("\n").map((t) => t.trim()).filter(Boolean);
  for (let i = turns.length - 1; i >= 0; i--) {
    const staying = extractCountWithPattern(turns[i] ?? "", STAYING_PATTERN);
    if (staying !== null) return staying;
  }
  return extractCountWithPattern(text, STAYING_PATTERN);
}

/**
 * The verdict on a count the model stated, in the same shape as
 * corroborateDatePhrase's: "consistent" is the only answer that keeps the model's number;
 * "conflicting" means the guest's own words contradict it and it goes back to a question.
 *
 * Division of labour (2026-09-25): the model owns comprehension, the code owns contradiction
 * detection. So this reader only answers "conflicting" on POSITIVE evidence — the guest's own
 * words put a number on this count and it disagrees with the model's, or they put two different
 * numbers on it. It never answers "conflicting" for an ABSENCE: when the guest's words put no
 * recognisable number on this count, the answer is "no-opinion" and the model's number is kept.
 * A number the code cannot see is still the model's to read, and punishing it for that is what
 * turned a correct `divers: 4` into a re-asked question (see the header).
 */
export function corroborateCount(
  field: CountField,
  proposed: number,
  guestText: string,
): CountCorroboration {
  // When a guest specifies both adults and children ("2 adults and 2 kids"),
  // their sum is the total guest count. If proposed matches that sum, corroborate it.
  if (field === "guests") {
    const acSum = adultAndChildSum(guestText);
    if (acSum !== null && proposed === acSum) {
      return "consistent";
    }
    const staying = stayingGuestsCount(guestText);
    if (staying !== null && proposed === staying) {
      return "consistent";
    }
  }

  // In a multi-turn transcript (guest turns separated by newline), check if a
  // later turn clarified this count: "how many guests?" followed by "3 of us"
  // resolves the earlier "group of 6 but only 3 staying" ambiguity.
  const turns = guestText.split("\n").map((t) => t.trim()).filter(Boolean);
  if (turns.length > 0) {
    const lastTurn = turns[turns.length - 1] ?? "";
    // `(?:(?:just|only)\s*)?` so the optional word is not flanked by two \s* that split spaces ambiguously.
    const bareMatch = /^\s*(?:(?:just|only)\s*)?(\d{1,3})\s*$/iu.exec(lastTurn);
    if (bareMatch && Number(bareMatch[1]) === proposed) {
      return "consistent";
    }
  }

  let stated: number[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const inTurn = countNumbersIn(turns[i] ?? "", field);
    if (inTurn.length > 0) {
      stated = inTurn;
      break;
    }
  }
  if (stated.length === 0) {
    stated = countNumbersIn(guestText, field);
  }

  // Two numbers on one count in the same statement is not a chance to pick the likelier one:
  // "8 người ... nhưng chỉ 4 người ở lại" (vi-09) is the case that produced this file, and the model
  // that picked the 8 had the guest's own words as its evidence.
  if (stated.length > 1) return "conflicting";
  if (stated.length === 1) return stated[0] === proposed ? "consistent" : "conflicting";
  // The guest's words say nothing this reader recognises about this count. That is silence, not
  // contradiction — the model's number stands. Punishing silence here was the bug: a verb-phrased
  // diver count ("all 4 of us will dive") fell through to a quote check that read "of us" as a
  // guests noun and wiped a correct answer.
  return "no-opinion";
}

