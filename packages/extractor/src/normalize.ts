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
// Vietnamese was removed from this project on 2026-09-24: the resort has no
// Vietnamese-speaking guests, so the detection heuristics and the Vietnamese reply
// tables were carrying cost and risk — a false "vi" answer sent a guest a language the
// reservations staff cannot read. English and Chinese remain.
//
// It is not meant to run over a whole transcript: callers pass guest text only, so the
// assistant's own wording cannot vote on the guest's language. See guestTextOf below.
const CJK_RE = /[\u4e00-\u9fff]/;

/**
 * The languages the resort actually receives. A named type rather than a bare union
 * because more than one file reads it: extract.ts stores it on the trip, and dates.ts
 * uses it to settle a numeric date pair that has no year on it (a Chinese guest writes
 * day/month, an English-speaking one month/day).
 */
export type GuestLanguage = "en" | "zh";

export function detectLanguage(text: string): GuestLanguage {
  return CJK_RE.test(text) ? "zh" : "en";
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
