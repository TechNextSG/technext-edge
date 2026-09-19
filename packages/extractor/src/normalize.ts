// Playbook: "mask emails and phone numbers before logging" — note this masks
// what gets written to logs, not what gets sent to the model provider. The
// open question ("do we mask before sending too?") is still unresolved; see
// docs/adr/ADR-005a-extractor-model.md.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/g;

export function maskForLogging(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

// Heuristic only — good enough to route a demo, not a real language classifier.
// Playbook's v2 plan is a dedicated haiku-tier "is this an enquiry" classifier;
// language detection can ride along with it then.
//
// Two things this deliberately does *not* do:
//  1. It does not treat a single accented character as proof of Vietnamese. A
//     guest who types "i dont ned airport" or "nêd" is writing English with a
//     typo, and replying in Vietnamese to an English enquiry is worse than
//     replying in English to a Vietnamese one.
//  2. It is not meant to run over a whole transcript. The assistant's own
//     Vietnamese form text is full of diacritics; feeding it back in locks the
//     conversation into Vietnamese from the first reply and never unlocks it.
//     Callers pass guest text only (see guestTextOf below).
const CJK_RE = /[\u4e00-\u9fff]/;
const VI_STRONG_LETTERS = /[đĐ]/; // never appears in English text by accident
const VI_SOFT_LETTERS = /[ăĂâÂêÊôÔơƠưƯ]/;
const VI_TONES = /[àáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;
// Diacritic-bearing words: unambiguous on their own, since no English word
// contains these characters. Short bare pronouns ("em", "anh") are deliberately
// absent — "em" is a substring of "email" and "system", which would flag an
// English message as Vietnamese.
const VI_MARKED_WORDS =
  /(không|bạn|mình|tôi|chúng tôi|ngày|đêm|phòng|khách|người|được|cảm ơn|xin chào|vâng|thứ|tuần|nhận|trả|sân bay|bao nhiêu|đưa đón|muốn|giúp|chuyến|dạ|chị|anh ơi|em ơi)/i;
// The same words typed without diacritics ("khach san 2 nguoi"). Shorter and
// riskier — a substring of an English word can match ("dem" in "demo", "thu" in
// "Thursday") — so two matches are required, "thu" only counts as a weekday
// ("thu 7"), and the English guard below can veto.
const VI_UNMARKED_WORDS =
  /(khong|khach|nguoi|phong|ngay|nhung|duoc|minh|nhan|xin chao|bao nhieu|san bay|dua don|cam on|tuan|thu\s?[2-7]|dem|muon|giup|chuyen)/gi;
const EN_WORDS =
  /\b(the|please|for|and|with|want|need|would|could|can|we|us|our|is|are|was|were|night|nights|room|rooms|guest|guests|thanks|thank|hello|hi|how|many|much|full|board|transfer|airport|available|availability|price|booking|name)\b/gi;

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/**
 * The three languages the corpus — and the resort's guests — are written in. A named type
 * rather than a bare union because more than one file reads it now: extract.ts stores it on
 * the trip, and dates.ts uses it to settle a numeric date pair that has no year on it (a
 * Vietnamese guest's "05/12" is 5 December; an English-speaking one's is 12 May).
 */
export type GuestLanguage = "vi" | "en" | "zh";

export function detectLanguage(text: string): GuestLanguage {
  if (CJK_RE.test(text)) return "zh";
  if (VI_MARKED_WORDS.test(text)) return "vi";
  if (VI_STRONG_LETTERS.test(text)) return "vi";
  if (VI_SOFT_LETTERS.test(text) && (VI_TONES.test(text) || (text.match(/[ăĂâÂêÊôÔơƠưƯ]/g) ?? []).length >= 2)) {
    return "vi";
  }
  // Unmarked Vietnamese only wins when the text does not read as English: two
  // Vietnamese word shapes and fewer than two English function words.
  const unmarked = countMatches(text, VI_UNMARKED_WORDS);
  if (unmarked >= 2 && countMatches(text, EN_WORDS) < 2) return "vi";
  return "en";
}

/**
 * The guest's own words, out of a transcript built by converse.ts ("Guest: ..." /
 * "Assistant: ..."), or the whole string when it is a bare message (POST
 * /v1/extract). Evidence and language detection must never read the assistant's
 * turns: a value the bot itself printed would otherwise come back as a "stated"
 * field on the next turn, with the bot's sentence as its evidence.
 *
 * normalize() collapses the newlines, so turns are split on the role markers
 * rather than on lines.
 */
export function guestTextOf(text: string): string {
  const turns = text.split(/(?=\b(?:Guest|Assistant):\s)/);
  const guest = turns
    .filter((turn) => turn.startsWith("Guest: "))
    .map((turn) => turn.replace(/^Guest:\s*/, ""));
  return guest.length > 0 ? guest.map((turn) => turn.trim()).join("\n") : text;
}

export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
