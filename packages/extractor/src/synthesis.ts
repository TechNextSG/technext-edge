import type { Trip } from "./schema.js";
import type { GuestQuestion, ReplyKind } from "./questions.js";
import type { ExtractProvider } from "./provider.js";
import type { ConversationTurn } from "./converse.js";

export interface SynthesisInput {
  turns: ConversationTurn[];
  trip: Trip;
  questions: GuestQuestion[];
  replyKind: ReplyKind;
  fallbackText: string;
}

export interface FactGateResult {
  ok: boolean;
  reason?:
    | "empty_or_too_short"
    | "unauthorized_price_quote"
    | "false_booking_confirmation"
    | "mismatched_nights_count"
    | "mismatched_rooms_count";
}

// VND is a real currency code and stays in the gate even though Vietnamese replies were
// removed: the fact gate exists to catch a model quoting money, and a guest or model can
// still name any currency. Only the Vietnamese words ("đồng", "triệu") were dropped.
const PRICE_QUOTE_RE =
  /(?:\$\s*\d|₱\s*\d|\b(?:PHP|USD|VND|EUR)\s*\d|\d[\d,.]*\s*(?:PHP|USD|VND|pesos?|dollars?)\b)/i;

const FALSE_CONFIRMATION_RE =
  /\b(?:your booking is confirmed|reservation is confirmed|officially booked|we have booked your room|预订已确认|已为您预订成功)\b/i;

/**
 * Deterministic Symbolic Fact Gate (Post-Generation Verifier):
 * Audits any LLM-synthesized reply against the verified `Trip` facts before
 * it can ever reach a WhatsApp guest.
 *
 * Rejects and triggers an instant rollback to `fallbackText` if:
 * 1. The LLM invents or quotes any price/currency figure (`$`, `₱`, `PHP`, `USD`, `VND`).
 * 2. The LLM claims the booking is already confirmed without human staff approval.
 * 3. The LLM contradicts the guest's stated night count or room count.
 */
export function verifySynthesizedReply(text: string, trip: Trip): FactGateResult {
  if (!text || text.trim().length < 20) {
    return { ok: false, reason: "empty_or_too_short" };
  }

  if (PRICE_QUOTE_RE.test(text)) {
    return { ok: false, reason: "unauthorized_price_quote" };
  }

  if (FALSE_CONFIRMATION_RE.test(text)) {
    return { ok: false, reason: "false_booking_confirmation" };
  }

  if (trip.nights?.state === "stated" && typeof trip.nights.value === "number") {
    const expectedNights = trip.nights.value;
    const nightMatches = [...text.matchAll(/\b(\d+)\s*(?:nights?|晚)\b/gi)];
    for (const m of nightMatches) {
      if (Number(m[1]) !== expectedNights) {
        return { ok: false, reason: "mismatched_nights_count" };
      }
    }
  }

  if (trip.rooms?.state === "stated" && typeof trip.rooms.value === "number") {
    const expectedRooms = trip.rooms.value;
    const roomMatches = [...text.matchAll(/\b(\d+)\s*(?:rooms?|间房)\b/gi)];
    for (const m of roomMatches) {
      if (Number(m[1]) !== expectedRooms) {
        return { ok: false, reason: "mismatched_rooms_count" };
      }
    }
  }

  return { ok: true };
}

/**
 * Synthesizes a natural, warm hospitality message grounded on the verified
 * extracted Trip facts, acknowledging nuanced arrangements while respecting
 * all business boundaries and zero-hallucination guardrails.
 *
 * If the provider has no generateText method, fails/times out, or fails the
 * deterministic `verifySynthesizedReply` fact gate, it rolls back safely to
 * the deterministic renderReply() text.
 */
export async function synthesizeHospitalityReply(
  input: SynthesisInput,
  provider?: ExtractProvider,
): Promise<string> {
  if (!provider?.generateText) {
    return input.fallbackText;
  }

  // Greeting turn (guest has said nothing extractable yet) — standard greeting is concise and clear
  if (input.replyKind === "greeting") {
    return input.fallbackText;
  }

  try {
    const lang = input.trip.language?.value ?? "en";
    const langName = lang === "zh" ? "Chinese" : "English";

    const systemPrompt =
      "You are the warm, professional reservation concierge at Casa Escondida Anilao Resort & PADI Dive Center in Batangas, Philippines. " +
      "Your role is to write a natural, hospitable, and intelligent reply to a guest inquiring about a stay over WhatsApp.\n\n" +
      "STRICT BUSINESS GUARDRAILS (ZERO HALLUCINATION):\n" +
      "1. You must base all dates, room counts, and guest numbers strictly on the Verified Facts provided below.\n" +
      "2. NEVER invent or promise room rates or prices.\n" +
      "3. NEVER state that a booking is officially confirmed or completed.\n" +
      "4. If the situation is 'summary' (all required details collected), you MUST conclude with: 'Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.'\n" +
      "5. If the situation is 'questions', warmly acknowledge what was noted and ask the remaining questions provided below.\n" +
      "6. CRITICAL EMPATHY & NUANCE: If the guest mentioned specific nuanced arrangements (such as day visitors vs staying guests, or who dives on which days), explicitly acknowledge that arrangement with understanding so the guest knows they were heard.\n" +
      `7. Reply in ${langName}.\n` +
      "8. WhatsApp style: Friendly, concise, hospitable (5-star dive resort concierge). Include the clean bulleted summary lines so the guest can easily check their details.";

    const userPrompt =
      `Conversation History:\n${input.turns.map((t) => `${t.role === "guest" ? "Guest" : "Concierge"}: ${t.text}`).join("\n")}\n\n` +
      `Verified Facts:\n` +
      `- Stay: ${input.trip.checkIn?.value ?? "not specified"} to ${input.trip.checkOut?.value ?? "not specified"} (${input.trip.nights?.value ?? "not specified"} nights)\n` +
      `- Guests staying overnight: ${input.trip.guests?.value ?? "not specified"}\n` +
      `- Rooms: ${input.trip.rooms?.value ?? "1"}\n` +
      `- Meals: ${input.trip.meals?.value ?? "full board"}\n` +
      `- Diving: ${input.trip.diver?.value ? `yes (${input.trip.diveFrom?.value ?? ""} to ${input.trip.diveTo?.value ?? ""})` : input.trip.diver?.value === false ? "no" : "unconfirmed"}\n` +
      (typeof input.trip.divers?.value === "number" ? `- Divers in the party: ${input.trip.divers.value}\n` : "") +
      (input.trip.diveNotes?.value ? `- Diving breakdown: ${input.trip.diveNotes.value}\n` : "") +
      (input.trip.specialRequests?.value ? `- Special notes: ${input.trip.specialRequests.value}\n` : "") +
      (input.trip.guestNames?.value && input.trip.guestNames.value.length > 0 ? `- Guest names in party: ${input.trip.guestNames.value.join(", ")}\n` : "") +
      `- Airport transfer: ${input.trip.transport?.value ? `yes (${input.trip.transportType?.value ?? "roundtrip"})` : input.trip.transport?.value === false ? "no" : "unconfirmed"}\n` +
      `- Contact name: ${input.trip.contactName?.value ?? "Guest"}\n\n` +
      `Situation: ${input.replyKind}\n` +
      (input.questions.length > 0 ? `Remaining questions to ask:\n${input.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}\n\n` : "") +
      `Reference summary (keep core details matching this):\n${input.fallbackText}`;

    const text = await provider.generateText(systemPrompt, userPrompt);

    // Post-Generation Symbolic Fact Gate: verify no hallucinated prices, confirmations, or mismatched counts
    const check = verifySynthesizedReply(text, input.trip);
    if (!check.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[synthesis] Fact gate rejected LLM reply (${check.reason}); rolling back to deterministic fallback`);
      return input.fallbackText;
    }

    // Safety check: if situation is summary, ensure the disclaimer is present
    if (input.replyKind === "summary") {
      const lower = text.toLowerCase();
      if (!lower.includes("nothing is booked yet") && !lower.includes("尚未完成预订") && !lower.includes("尚未预订")) {
        return text + "\n\nSomeone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.";
      }
    }

    return text;
  } catch (err) {
    // Non-blocking fallback to deterministic text
    // eslint-disable-next-line no-console
    console.warn(`[synthesis] Non-blocking fallback: ${err instanceof Error ? err.message : String(err)}`);
    return input.fallbackText;
  }
}
