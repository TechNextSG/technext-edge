/**
 * Shared Linguistic Lexicon for counts, nouns, classifiers, and guards (Pattern 6).
 * Consolidates regexes and vocabulary across counts corroboration and synthesis fact-gating.
 */

export type CountField = "nights" | "guests" | "rooms" | "divers";

export const LATIN_NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

export const HAN_NUMBER_WORDS: Record<string, number> = {
  "一": 1,
  "二": 2,
  "两": 2,
  "兩": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
  "十": 10,
};

export const NUMBER_WORDS: Record<string, number> = { ...LATIN_NUMBER_WORDS, ...HAN_NUMBER_WORDS };

export const DIGITS_RE_STR = "(?<!\\d)(\\d{1,3})(?!\\d)";

export const CLASSIFIER_RE_STR = "(?:位|個|个|名|間|间)?";

export const GUEST_NOUNS =
  "pax|of\\s+us|people|persons?|adults?|kids?|children|guests?|客人|大人|小孩|位|名|人|口|are\\s+staying|is\\s+staying|staying|入住";

export const ROOM_NOUNS = "rooms?|房间|房間|房|间房";

export const NIGHT_NOUNS = "nights?|晚上|晚";

export const DIVER_NOUNS = "divers?|潜水员|潛水員|潜水者";

export const PERSON_NOUNS = "pax|of\\s+us|people|persons?|guests?|adults?|kids?|children|divers?";

export const DIVE_AUX_RE_STR = "(?:(?:will|would|want\\s+to|wanna|going\\s+to|gonna|can|are|is|to)\\s+)?";

export const DIVE_CLAUSE_AFTER_NOUN =
  "(?!\\s+(?:will\\s+|want\\s+to\\s+|going\\s+to\\s+|are\\s+|is\\s+|to\\s+)?(?:dive|dives|diving)\\b|\\s*(?:去|要|会)?(?:潜水|潛水|深潜))";

export const COUNT_NOUNS: Record<CountField, string> = {
  guests: GUEST_NOUNS,
  rooms: ROOM_NOUNS,
  nights: NIGHT_NOUNS,
  divers: DIVER_NOUNS,
};
