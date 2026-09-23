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
// One hole was left, and it is the model's *quote* rather than its number. A count the
// guest's words put one number on is settled by those words; a count they say nothing about
// is left exactly as the rest of the pipeline left it. But that silence is only this reader's
// — it is not proof that the model found the number on the field it labelled it with. So when
// there is no reading for this count, the evidence the model chose is the only support the
// number has, and it has to be about *this* count: `guests: 3` quoted from "cần 3 phòng cho
// gia đình" is a room count with a guest label on it — the mirror image of vi-09, where the
// number is real but is not this field's number — and it becomes a question. An evidence
// quote that names both counts ("chúng tôi 5 người, cần 3 phòng") supports either, so it
// decides nothing, exactly like a vague phrase in dates.ts. Only the quote is read this way,
// never the whole message: what the guest wrote still decides whenever it says anything.

export type CountField = "nights" | "guests" | "rooms" | "divers";

/** The verdict on a number the model proposed for one of the three counts. */
export type CountCorroboration =
  | "consistent" // the guest's own words put this number on this count
  | "conflicting" // they put a different number on it, or more than one
  | "no-opinion"; // nothing this reader recognises — the caller decides, and keeps it

// The noun (or measure word) that makes a number a count of this field, in the three
// languages the corpus is written in, plus the unmarked Vietnamese spellings guests
// actually type ("4 nguoi", "3 phong", "2 dem"). normalize() collapses whitespace but
// never strips diacritics, so both spellings reach this file as the guest typed them.
const COUNT_NOUNS: Record<CountField, string> = {
  // `divers?` deliberately absent here even though a diver is a guest: it became its own
  // count below, and a noun that reads for two counts makes one phrase answer both. "2
  // divers" would then be read as a guest count too, so a party of 5 with 2 divers looks
  // like two different guest numbers and `guests` goes back to being a question it has
  // already been told the answer to.
  guests:
    "người|nguoi|khách|khach|pax|of\\s+us|people|persons?|adults?|kids?|children|guests?|bạn|ban|客人|大人|小孩|位|名|人|口|are\\s+staying|is\\s+staying|staying|ở\\s*lại|o\\s*lai|入住",
  rooms: "phòng|phong|rooms?|房间|房間|房",
  nights: "đêm|dem|nights?|晚上|晚",
  // The dive line is priced per head, so this count is money the same way `guests` is, and
  // it gets the same reader. Only nouns that mean "a person who dives" — never the activity
  // ("2 boat dives" is a number of dives, not of divers).
  divers: "divers?|thợ\\s*lặn|tho\\s*lan|người\\s*lặn|nguoi\\s*lan|潜水员|潛水員|潜水者",
};

// A measure word may sit between the number and the noun it counts: "8位客人", "3間房",
// "2個人". Optional, because most Vietnamese and English guests write the number straight
// against the noun ("8 người", "4 of us").
const CLASSIFIER = "(?:位|個|个|名|間|间)?";

// Numbers written as words. The Han forms cannot take a \p{L} boundary — Chinese is
// written without spaces, so 两 in 我们有两位 is a letter to Unicode — which is why they are
// matched separately from the Latin ones below.
const LATIN_NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  "một": 1, mot: 1, hai: 2, ba: 3, "bốn": 4, bon: 4, "năm": 5, nam: 5, "sáu": 6, sau: 6,
  "bảy": 7, bay: 7, "tám": 8, tam: 8, "chín": 9, chin: 9, "mười": 10, muoi: 10,
};
const HAN_NUMBER_WORDS: Record<string, number> = {
  "一": 1, "二": 2, "两": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
};

const NUMBER_WORDS: Record<string, number> = { ...LATIN_NUMBER_WORDS, ...HAN_NUMBER_WORDS };

const DIGITS = "(?<!\\d)(\\d{1,3})(?!\\d)";
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
const DIVE_CLAUSE_AFTER_NOUN =
  "(?!\\s+(?:will\\s+|want\\s+to\\s+|going\\s+to\\s+|are\\s+|is\\s+)?(?:dive|dives|diving)\\b|\\s+(?:sẽ\\s+|đi\\s+|muốn\\s+)?(?:lặn|lan)\\b|\\s*(?:去|要|会)?(?:潜水|潛水))";

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
  return [...found].sort((a, b) => a - b);
}

// The count nouns again, one compiled pattern per noun rather than the single alternation
// above, because this reader asks a different question: not "is a number written against this
// noun" but "does this quote name this count at all". A Han noun is matched as it stands —
// Chinese is written without spaces to bound it by — while a Latin one is matched whole, so
// the unmarked "dem" in "demand" is not a night and "ban" in "banana" is not a guest.
function nounPatternsFor(field: CountField): readonly RegExp[] {
  return COUNT_NOUNS[field]
    .split("|")
    .map((noun) => new RegExp(/[\u4e00-\u9fff]/.test(noun) ? noun : "(?<![\\p{L}])" + noun + "(?![\\p{L}])", "iu"));
}

const COUNT_FIELDS = ["nights", "guests", "rooms", "divers"] as const;
const NOUN_PATTERNS: Record<CountField, readonly RegExp[]> = {
  nights: nounPatternsFor("nights"),
  guests: nounPatternsFor("guests"),
  rooms: nounPatternsFor("rooms"),
  divers: nounPatternsFor("divers"),
};

/** The counts a quote names — empty for a quote with no count noun in it at all ("we are a group"). */
function countsNamedIn(quote: string): CountField[] {
  return COUNT_FIELDS.filter((field) => NOUN_PATTERNS[field].some((pattern) => pattern.test(quote)));
}

const ADULT_NOUNS = "adults?|người\\s+lớn|nguoi\\s+lon|大人";
const CHILD_NOUNS = "kids?|children|child|trẻ\\s+em|tre\\s+em|em\\s+bé|bé|小孩|儿童|孩子";
const STAYING_NOUNS = "are\\s+staying|is\\s+staying|staying|stay\\s+overnight|overnight|ở\\s*lại|o\\s*lai|入住";

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
    const adults = extractCountWithPattern(turns[i], ADULT_PATTERN);
    const children = extractCountWithPattern(turns[i], CHILD_PATTERN);
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
    const staying = extractCountWithPattern(turns[i], STAYING_PATTERN);
    if (staying !== null) return staying;
  }
  return extractCountWithPattern(text, STAYING_PATTERN);
}

/**
 * The verdict on a count the model stated, in the same shape as
 * corroborateDatePhrase's: "consistent" is the only answer that keeps the model's number;
 * everything else means the field goes back to being a question. A count the guest never
 * put a number on is "no-opinion", because this file has nothing to hold the model to —
 * which is not the same thing as the model being right. The one exception is the model's own
 * evidence quote: when the guest's words are silent this reader still knows which count the
 * quote is about, and a quote about another count supports no number at all (see the header).
 */
export function corroborateCount(
  field: CountField,
  proposed: number,
  guestText: string,
  evidence?: string | null,
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
    const lastTurn = turns[turns.length - 1];
    const bareMatch = /^\s*(?:just|only|tầm|khoảng|chỉ|khoang)?\s*(\d{1,3})\s*(?:nhé|nha|ạ|thôi|nhe)?\s*$/iu.exec(lastTurn);
    if (bareMatch && Number(bareMatch[1]) === proposed) {
      return "consistent";
    }
  }

  let stated: number[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const inTurn = countNumbersIn(turns[i], field);
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
  // The guest's words say nothing about this count, so the quote the model chose is all this
  // number has behind it: a quote that names another count and not this one is not support
  // for this field. A quote that names no count at all ("we are a group of friends") is not
  // evidence against the number either, and one naming both counts decides nothing.
  if (evidence) {
    const named = countsNamedIn(evidence);
    // Every diver is a guest, so a quote naming "divers" ("6 AOW divers") still supports
    // "guests" — the two counts happen to be equal in that message, not in conflict. The
    // reverse does not hold: a quote naming "guests" says nothing about how many of them
    // dive, so it is not support for `divers`.
    const supportsGuestsViaDivers = field === "guests" && named.includes("divers");
    if (named.length > 0 && !named.includes(field) && !supportsGuestsViaDivers) return "conflicting";
  }
  return "no-opinion";
}

