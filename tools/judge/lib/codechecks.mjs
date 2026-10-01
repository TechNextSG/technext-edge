// Everything that can be decided by code is decided here, and the judge never gets to overrule it.

const CURRENCY_RE = /(?:[$₱€£]\s*\d|\b(?:PHP|USD|VND|EUR|pesos?|dollars?)\b)/i;
const LINK_RE = /https?:\/\/|www\./i;
const CJK_RE = /[぀-ヿ㐀-鿿]/;

/** Replies the channel itself wrote on purpose to contain a link (the partner invitation). */
const LINK_ALLOWED_KINDS = new Set(["partner_invitation"]);

export function checkNoMoney(replies) {
  const hit = replies.find((r) => CURRENCY_RE.test(r.text));
  return hit ? { ok: false, detail: `turn ${hit.turn}: mentions money` } : { ok: true };
}

export function checkNoLink(replies) {
  const hit = replies.find((r) => !LINK_ALLOWED_KINDS.has(r.kind) && LINK_RE.test(r.text));
  return hit ? { ok: false, detail: `turn ${hit.turn}: contains a link` } : { ok: true };
}

/** `en` replies must not contain CJK; `zh` replies must. Handoff and fallback replies count too. */
export function checkReplyLanguage(replies, expected) {
  if (!expected) return { ok: true, detail: "no language expectation" };
  const bad = replies.find((r) => (expected === "zh") !== CJK_RE.test(r.text));
  return bad ? { ok: false, detail: `turn ${bad.turn}: expected a ${expected} reply` } : { ok: true };
}

/**
 * The existing fact gate, run on the last reply the model wrote. Only facts the scenario pins are passed, so a reply
 * is never failed for a number the guest never gave.
 */
export function checkFactGate(replies, facts, verifyGuestFacingText) {
  const last = [...replies].reverse().find((r) => r.kind === "converse");
  if (!last) return { ok: true, detail: "no model-written reply to check" };
  const gate = {
    ...(typeof facts?.nights === "number" ? { nights: facts.nights } : {}),
    ...(typeof facts?.guests === "number" ? { guests: facts.guests } : {}),
    ...(typeof facts?.divers === "number" ? { divers: facts.divers } : {}),
    ...(facts?.roomType ? { roomTypes: new Set([facts.roomType]) } : {}),
  };
  const result = verifyGuestFacingText(last.text, gate);
  return result.ok ? { ok: true } : { ok: false, detail: `turn ${last.turn}: ${result.reason}` };
}

/** Did the bot hand over exactly when the scenario says it should? */
export function checkHandoff(run, expectHandoff) {
  const happened = run.turns.some((t) => t.handoff);
  if (expectHandoff === undefined || expectHandoff === null) return { ok: true, detail: "no expectation" };
  return happened === Boolean(expectHandoff)
    ? { ok: true }
    : { ok: false, detail: expectHandoff ? "should have handed over, did not" : "handed over an ordinary enquiry" };
}

export function runCodeChecks({ scenario, run, verifyGuestFacingText }) {
  const replies = run.turns.filter((t) => t.reply).map((t) => ({ turn: t.n, text: t.reply, kind: t.kind }));
  return {
    no_money: checkNoMoney(replies),
    no_link: checkNoLink(replies),
    reply_language: checkReplyLanguage(replies, scenario.replyLanguage),
    fact_gate: checkFactGate(replies, scenario.facts, verifyGuestFacingText),
    handoff: checkHandoff(run, scenario.expectHandoff),
  };
}
