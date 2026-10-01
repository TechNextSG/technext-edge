// Output schemas for the judge, parsed with zod so a model that answers in prose is caught, not trusted.
import { z } from "zod";

export const CRITERION_IDS = ["asks_only_missing", "no_promises", "faithful_to_facts", "tone_and_clarity", "handoff_judgement"];

const Score = z.number().int().min(1).max(5);
const Reason = z.string().min(1);

/** { criterion: { reason, score } } — the reason is listed first so the model writes it before it commits to a score. */
export const JudgeOutput = z.object(
  Object.fromEntries(CRITERION_IDS.map((id) => [id, z.object({ reason: Reason, score: Score })])),
);

export const PairOutput = z.object(
  Object.fromEntries(CRITERION_IDS.map((id) => [id, z.object({ reason: Reason, winner: z.enum(["A", "B", "tie"]) })])),
);

/** The first {...} block in a model answer, with markdown fences removed. Throws on anything unparseable. */
export function parseJsonLoose(text) {
  const cleaned = String(text ?? "").replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in the answer");
  return JSON.parse(cleaned.slice(start, end + 1));
}
