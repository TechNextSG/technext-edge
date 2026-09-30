/**
 * Is this message a booking enquiry at all?
 *
 * The gap this closes: before it, every inbound message went to the model, and the model would
 * dutifully try to find a trip in "what's your wifi password" or "please cancel my booking". The
 * first became a loop of booking questions nobody wanted to answer; the second is worse — a guest
 * asking to cancel a real reservation was answered with a request for their check-in date.
 *
 * ## Why this is a string match and not a model call
 *
 * Same reasoning as `wantsHuman()` in questions.ts, and the asymmetry is the whole argument: a
 * false positive costs one handoff a human declines, while a false negative keeps a frustrated
 * guest — or a guest with a real complaint — inside a bot loop. So the patterns are explicit and
 * the ones that fire are cheap to audit. A classifier model would move this decision somewhere it
 * cannot be read, at a latency cost paid by every genuine guest.
 *
 * ## The three answers
 *
 *   `escalate_now`  A person is needed *because of what this is*: cancelling, refunds, complaints,
 *                   or someone who is already at the resort. Nothing to extract, nothing to price.
 *   `not_booking`   Not an enquiry for this channel at all: general questions about the property
 *                   that are not about staying (wifi, the bar, parking), or a solicitation.
 *   `booking`       Everything else — including the vast majority of odd-looking first messages,
 *                   which is deliberate. Silence, a bare "hi", a half-sentence, and an unusual
 *                   phrasing all belong to the extractor, because those are how real enquiries
 *                   actually start.
 *
 * Note what is NOT here: "how much is a room" is a booking question, as is "do you do day trips"
 * or "can we dive without staying". Only nouns that cannot be about a stay (wifi, beer, parking,
 * directions) put a message in `not_booking`. Guessing wide here means dismissing a real guest.
 */

export type EnquiryIntent = "booking" | "escalate_now" | "not_booking";

/**
 * Requests a person must act on, and the fact that a person asking for one outweighs any facts we
 * could extract. Both mistakes are not equal here either: mis-routing a booking to a human costs a
 * glance, while ignoring a cancellation loses a customer.
 */
const ESCALATE_RE = new RegExp(
  [
    // Cancellation, refunds and complaints, in both supported languages. Stems rather than whole
    // words ("cancel" not "cancelled|cancelling|cancellation"): the meaning is carried by the
    // stem, and an inflected form is exactly what a guest writes when they are upset.
    "\\b(?:cancel|refund|reimburse|chargeback|complaint|complain|dispute)",
    "\\b(?:already\\s+(?:here|at\\s+the\\s+resort|staying|checked\\s*in|booked)|currently\\s+staying)\\b",
    "取消|退款|退钱|投诉",
  ].join("|"),
  "i",
);

/**
 * Things that are genuinely not about booking a stay. Deliberately a short, concrete list rather
 * than a "questions we cannot answer" heuristic: a solicitation has no trip in it, and neither
 * does a question about the wifi password, but "do you have a room for two" must never land here.
 */
const NOT_BOOKING_RE = new RegExp(
  [
    // Property questions that are not stay questions.
    "\\b(?:wi-?fi|internet\\s+password|the\\s+bar|beer|drinks?\\s+menu|restaurant|parking|how\\s+do\\s+(?:i|we)\\s+get\\s+there|exact\\s+address|directions)\\b",
    // Solicitations and link spam.
    "https?://",
    "\\b(?:seo\\b|backlink|crypto|forex|casino|loan\\s+offer|telegram\\s+investment|unsubscribe)\\b",
  ].join("|"),
  "i",
);

export function classifyEnquiry(text: string): EnquiryIntent {
  if (!text || text.trim() === "") return "booking";
  if (ESCALATE_RE.test(text)) return "escalate_now";
  if (NOT_BOOKING_RE.test(text)) return "not_booking";
  return "booking";
}
