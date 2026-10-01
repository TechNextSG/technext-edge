// One scenario, played turn by turn through the same decisions the WhatsApp channel makes
// (bff/src/channels/whatsapp/turn.ts): escalate / not-a-booking go to staff before the model is asked, a thread
// that keeps leaving the same questions open is handed over, a partner is invited to sign in instead of being quoted.
// The model-facing part is the real `converse()`. If turn.ts changes order, change it here too (see README).

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * @param scenario  { id, turns: string[], ... }
 * @param provider  an ExtractProvider (already metered)
 * @param ai        { converse, classifyEnquiry, wantsHuman, declinesPartner, fallbackReply, stalledHandoffReply,
 *                    partnerInvitationReply, detectLanguage, ASK_LIMIT, STALL_LIMIT }
 */
export async function simulateScenario(scenario, provider, ai, { signInUrl = "https://example.invalid/signin" } = {}) {
  const history = [];
  const turns = [];
  let parked = false;
  let stallCount = 0;
  let previousOpen = [];

  for (let i = 0; i < scenario.turns.length; i++) {
    const message = scenario.turns[i];
    const n = i + 1;
    history.push({ role: "guest", text: message });
    const guestText = history.filter((t) => t.role === "guest").map((t) => t.text).join("\n");
    const language = ai.detectLanguage(guestText);

    if (parked) {
      turns.push({ n, guest: message, reply: null, kind: "silent_parked", handoff: false });
      continue;
    }

    const intent = ai.classifyEnquiry(message);
    const askedForHuman = ai.wantsHuman(message);
    const escalate = askedForHuman || intent === "escalate_now";
    const notBooking = !escalate && intent === "not_booking";
    if (escalate || notBooking) {
      const reply = notBooking ? ai.fallbackReply("not_booking", language) : ai.fallbackReply("handoff", language);
      history.push({ role: "assistant", text: reply });
      parked = true;
      turns.push({ n, guest: message, reply, kind: notBooking ? "not_booking" : "handoff", handoff: true });
      continue;
    }

    let outcome;
    try {
      outcome = await ai.converse({ history: history.slice(0, -1), message, channel: "whatsapp" }, provider);
    } catch (error) {
      // The channel answers a failed model call with an honest apology and does not park the thread.
      const reply = ai.fallbackReply("apology", language);
      history.push({ role: "assistant", text: reply });
      turns.push({ n, guest: message, reply, kind: "apology", handoff: false, error: String(error?.message ?? error).slice(0, 200) });
      continue;
    }

    const open = outcome.questions.map((q) => String(q.field));
    const noProgress = open.length > 0 && sameSet(previousOpen, open);
    stallCount = noProgress ? stallCount + 1 : 0;
    previousOpen = open;
    const assistantTurns = history.filter((t) => t.role === "assistant").length;
    if (stallCount >= ai.STALL_LIMIT || assistantTurns >= ai.ASK_LIMIT) {
      const stalled = stallCount >= ai.STALL_LIMIT;
      const reply = stalled
        ? ai.stalledHandoffReply(outcome.questions.map((q) => q.field), language)
        : ai.fallbackReply("handoff", language);
      history.push({ role: "assistant", text: reply });
      parked = true;
      turns.push({ n, guest: message, reply, kind: stalled ? "stalled" : "asking_limit", handoff: true });
      continue;
    }

    const partnerType = outcome.trip.guestType?.value;
    const partnerDeclined = history.some((t) => t.role === "guest" && ai.declinesPartner(t.text));
    if (outcome.done && !partnerDeclined && (partnerType === "agent" || partnerType === "instructor")) {
      const reply = ai.partnerInvitationReply(outcome.trip.language?.value ?? null, signInUrl);
      history.push({ role: "assistant", text: reply });
      parked = true;
      turns.push({ n, guest: message, reply, kind: "partner_invitation", handoff: true });
      continue;
    }

    history.push({ role: "assistant", text: outcome.reply });
    turns.push({
      n,
      guest: message,
      reply: outcome.reply,
      kind: "converse",
      handoff: false,
      done: outcome.done,
      replyKind: outcome.replyKind,
      open,
    });
  }

  return { scenarioId: scenario.id, turns };
}

/** A transcript as the judge reads it. */
export function renderTranscript(run) {
  const lines = [];
  for (const t of run.turns) {
    lines.push(`Guest: ${t.guest}`);
    if (t.reply) lines.push(`Bot: ${t.reply}${t.handoff ? "  [thread handed to staff]" : ""}`);
    else lines.push("Bot: (silent: the thread is with staff)");
  }
  return lines.join("\n");
}
