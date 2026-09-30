import type { GuestLanguage } from "../domain/schema.js";

// Playbook: "mask emails and phone numbers before logging".
//
// This masks what gets written to logs, not what gets sent to the model provider. Whether it
// should also mask what is sent is a separate question and is measured, not assumed — see
// `extract.ts`'s ExtractOptions.maskBeforeSend and .scratch-measure/pii-mask.ts. The short
// version of that measurement: masking changes nothing extraction reads on the corpus, but
// this regex had to be fixed first, because as written it ate dates.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * A digit run that looks like a phone number, and specifically NOT like an ISO date.
 *
 * The previous pattern was `\+?\d[\d\s().-]{6,}\d`, which matched `2026-10-07` — nine digits
 * with two dashes is exactly its shape — so every logged guest message had its dates replaced
 * by `[phone]`. Measured: `"Our dates are 2026-10-07 to 2026-10-10"` logged as
 * `"Our dates are [phone] to [phone]"`. That is the worst possible thing for this particular
 * mask to hide: a stay's dates are the first thing anyone reading a log needs, they are what
 * `checkIn`/`checkOut` are resolved from, and the whole reason a human opens these logs is to
 * work out why a date came out wrong.
 *
 * The fix is the negative lookahead: a candidate may not start with the `YYYY-MM-DD` shape.
 * A date still contains a digit run of phone-like length, so no amount of tuning the digit
 * count separates the two — only the separators do.
 *
 * A two-digit-year pair like `07-10-2026` is deliberately left to match as a phone number.
 * It is genuinely ambiguous, `dates.ts` treats a bare numeric pair the same way (it needs the
 * guest's language to read one), and masking it is the safe direction for something whose only
 * job is to keep numbers out of logs.
 */
const PHONE_RE = /(?<!\d)(?!\d{4}-\d{2}-\d{2})\+?\d[\d\s().-]{6,}\d(?!\d)/g;

/**
 * Keeps emails and phone numbers out of log lines. Dates are preserved on purpose — see
 * PHONE_RE — and anything else the guest wrote is passed through untouched.
 *
 * ## The open question this file used to carry
 *
 * "Do we mask before *sending* to the provider too?" That is a separate decision from
 * masking logs, and it was measured rather than argued (.scratch-measure/pii-mask.ts, run
 * against the live API on 2026-09-25, 5 corpus cases × 3 runs × both settings). Masking at
 * the provider seam changed **nothing** the extractor reads: same `guests`, `rooms`,
 * `nights`, `contactName`, `meals`, `diver`, and zero broken evidence quotes, including on
 * en-03 — the case built specifically to trap a phone number being read as a guest count.
 * That trap survives masking because `counts.ts` reads the *evidence quote* against the
 * guest's own words, and the model's quote for `guests` is "only 2 of us are joining", which
 * masking never touches.
 *
 * It is still NOT switched on, and the reason is the sample rather than the result. Five
 * cases cannot show the absence of an effect, `en-10` is visibly unstable in both modes
 * (its check-in alternates between "this Friday" readings across runs, with and without
 * masking), and there is one real failure mode nobody has hit yet: if the model ever quoted
 * a masked placeholder back as evidence, `state: "stated"` would fail enforcement against the
 * unmasked text and turn a fact the guest did give into a question. Before switching this on,
 * run the full 30-case corpus twice and diff. See PHONE_RE for why the date bug had to be
 * fixed first: a mask that eats dates would break the run rather than measure it.
 */
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
// Kana and hangul: Japanese and Korean share the Han block with Chinese, so a Han character alone does not
// make a message Chinese. The customer's tool answers in English or Simplified Chinese only; a Japanese or
// Korean guest is answered in English, not in a language they did not write.
const KANA_HANGUL_RE = /[\u3040-\u30ff\u31f0-\u31ff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

/**
 * The languages the resort actually receives. A named type rather than a bare union
 * because more than one file reads it: extract.ts stores it on the trip, and dates.ts
 * uses it to settle a numeric date pair that has no year on it (a Chinese guest writes
 * day/month, an English-speaking one month/day).
 */
// Defined in the domain (`domain/schema.ts`) — a fact about the guest, not about normalisation.
// Re-exported here because every other importer reads it off this module.
export type { GuestLanguage };

export function detectLanguage(text: string): GuestLanguage {
  return CJK_RE.test(text) && !KANA_HANGUL_RE.test(text) ? "zh" : "en";
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
