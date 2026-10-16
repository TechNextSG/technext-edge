/**
 * Intent detection for human handoff and partner self-serve overrides (Pattern 6).
 */

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

const DECLINES_PARTNER_RE = new RegExp(
  [
    "\\b(?:for|by)\\s+(?:our|my)sel(?:f|ves)\\b",
    "\\bnot\\s+(?:an?\\s+)?(?:agency|agent|partner|travel\\s+agent|dive\\s+shop|instructor)\\b",
    "\\bwe(?:'re| are)\\s+not\\s+(?:an?\\s+)?(?:agency|agent|partner)\\b",
    "\\b(?:personal|private)\\s+(?:booking|trip|holiday|stay)\\b",
    "\\bjust\\s+(?:us|me|two\\s+of\\s+us)\\b",
    "\\bno\\s+agency\\b",
    "我们自己(?:订|预订|订房|去|玩)",
    "不是(?:旅行社|代理)",
  ].join("|"),
  "i",
);

/** True when the guest is telling the bot they are not booking as a partner after all. */
export function declinesPartner(text: string): boolean {
  return DECLINES_PARTNER_RE.test(text);
}
