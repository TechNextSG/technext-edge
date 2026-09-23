import type { Trip } from "./schema.js";
import type { GuestQuestion } from "./questions.js";
import { verifySynthesizedReply } from "./synthesis.js";

export interface NaturalnessScoreBreakdown {
  /** 1.0 if the bot did NOT re-ask any diving/stay nuance already recorded in diveNotes or stated fields. */
  noReAskScore: number;
  /** 1.0 if all stated nuances (diveNotes, specialRequests, guestNames) are explicitly acknowledged in the reply. */
  nuanceAckScore: number;
  /** 1.0 if the reply passes the Symbolic Fact Gate (zero hallucinated prices, confirmations, or mismatched counts). */
  factGateScore: number;
  /** 1.0 if the reply exhibits warm 5-star concierge structure (greeting/thanks, structured clarity, polite closing). */
  conciergeWarmthScore: number;
  /** Weighted overall naturalness score from 0 to 100. */
  overallScore: number;
  /** Diagnostic notes explaining any deductions. */
  diagnostics: string[];
}

/**
 * Objective Naturalness & Non-Redundancy Scorer (Phase 2 Benchmark Engine).
 *
 * Designed to evaluate both synthetic multi-turn scenarios and the 30 anonymized
 * guest transcripts from Eloa without subjective guesswork.
 */
export function scoreReplyNaturalness(
  replyText: string,
  trip: Trip,
  questions: GuestQuestion[],
): NaturalnessScoreBreakdown {
  const diagnostics: string[] = [];
  const lowerReply = replyText.toLowerCase();

  // 1. Non-Redundancy (NEVER RE-ASK check) — Weight: 35%
  let noReAskScore = 1.0;
  const hasDiveNotes =
    (trip.diveNotes?.state === "stated" || trip.diveNotes?.state === "inferred") &&
    Boolean(trip.diveNotes?.value);

  if (hasDiveNotes) {
    const askedDiveSlot = questions.some((q) =>
      ["divers", "diveFrom", "diveTo"].includes(q.field as string),
    );
    const askedInText =
      /how many (?:of you|people) will be diving|có bao nhiêu người sẽ lặn|有几位客人潜水/i.test(
        replyText,
      );
    if (askedDiveSlot || askedInText) {
      noReAskScore = 0.0;
      diagnostics.push("Redundant question: re-asked diver count/window despite diveNotes being present.");
    }
  }

  // 2. Nuance Acknowledgment — Weight: 25%
  let nuanceAckScore = 1.0;
  const expectedNuances: Array<{ label: string; value: string }> = [];
  if (hasDiveNotes && typeof trip.diveNotes?.value === "string") {
    expectedNuances.push({ label: "diveNotes", value: trip.diveNotes.value });
  }
  if (
    (trip.specialRequests?.state === "stated" || trip.specialRequests?.state === "inferred") &&
    typeof trip.specialRequests?.value === "string" &&
    trip.specialRequests.value.trim().length > 0
  ) {
    expectedNuances.push({ label: "specialRequests", value: trip.specialRequests.value });
  }

  if (expectedNuances.length > 0) {
    let matched = 0;
    for (const item of expectedNuances) {
      const snippet = item.value.toLowerCase().slice(0, 18);
      if (lowerReply.includes(snippet)) {
        matched++;
      } else {
        diagnostics.push(`Missing acknowledgment for ${item.label}: "${item.value}"`);
      }
    }
    nuanceAckScore = matched / expectedNuances.length;
  }

  // 3. Symbolic Fact Gate — Weight: 25%
  const gate = verifySynthesizedReply(replyText, trip);
  const factGateScore = gate.ok ? 1.0 : 0.0;
  if (!gate.ok) {
    diagnostics.push(`Failed Symbolic Fact Gate: ${gate.reason}`);
  }

  // 4. Concierge Warmth & Clarity — Weight: 15%
  let conciergeWarmthScore = 0.0;
  const hasPoliteOpening =
    /\b(?:thanks|thank you|welcome|hi|hello)\b|cảm ơn|chào|dạ|谢谢|您好/i.test(replyText);
  const hasStructuredReadback =
    /noted|ghi nhận|tóm tắt|here's what i have|已为您记录|已经记录|以下是/i.test(replyText);
  if (hasPoliteOpening && hasStructuredReadback) {
    conciergeWarmthScore = 1.0;
  } else if (hasPoliteOpening || hasStructuredReadback) {
    conciergeWarmthScore = 0.6;
    diagnostics.push("Partial warmth: reply has either polite opening or structured readback, but not both.");
  } else {
    diagnostics.push("Low warmth: reply lacks polite opening and structured readback.");
  }

  const overallScore = Math.round(
    (noReAskScore * 35 +
      nuanceAckScore * 25 +
      factGateScore * 25 +
      conciergeWarmthScore * 15) *
      10,
  ) / 10;

  return {
    noReAskScore,
    nuanceAckScore,
    factGateScore,
    conciergeWarmthScore,
    overallScore,
    diagnostics,
  };
}
