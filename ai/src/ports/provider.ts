// The one seam between the extractor's business logic and whichever AI vendor
// answers it. Everything on the other side of this interface — post-processing,
// house norms, zod validation, question generation — must never import a
// provider SDK directly. Swapping vendors means writing a new file here and
// flipping EXTRACTOR_PROVIDER; it must never mean touching extract.ts.

export interface ExtractCall {
  text: string; // normalised guest message
  jsonSchema: object; // JSON Schema generated from the Trip zod schema
  today: string; // Manila-time ISO date, goes in the user turn, never the system prompt
  // Set only on the retry, and only when the first attempt's own output failed
  // validation (not on a transport/network failure, which the model can't fix).
  // Playbook: "call again once with the error attached."
  retry?: { previousRaw: unknown; error: string } | undefined;
}

export interface ExtractResult {
  raw: unknown; // parsed JSON from the model, not yet zod-validated
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  ms: number;
}

/**
 * The provider answered, but what it sent was not parseable JSON.
 *
 * This exists because `JSON.parse` throws a `SyntaxError`, and `extract.ts` classifies anything
 * that is not a `ZodError` as a transport failure — which is right for a 5xx or a timeout, and
 * wrong here. Malformed JSON is the model's own output, and the model is the one thing that can
 * fix it, so it belongs in the same family as a schema rejection: the first attempt is re-sent
 * WITH the error attached.
 *
 * Measured before this existed (DeepSeek, 14 turns x 5 repeats): a retry nearly doubles a turn's
 * wall time — 3.1s median to 6.3s — and a malformed-JSON retry carried no `retry` context at all,
 * so the second call was an identical blind repeat that only sometimes landed. The observed
 * failure was `Expected ':' after property name in JSON at position 11`.
 *
 * `rawText` is bounded before it reaches here by the caller; it is model output the model needs
 * to see again, so it is not masked. Anything logged alongside it should be.
 */
export class MalformedArgumentsError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MalformedArgumentsError";
  }
}

export interface GuestsReadResult {
  value: number | null;
  state: "stated" | "inferred" | "missing";
  evidence: string | null;
  tokensIn: number;
  tokensOut: number;
  ms: number;
}

export interface CheckInReadResult {
  value: string | null; // ISO date (YYYY-MM-DD), the isolated call's own best guess
  state: "stated" | "inferred" | "missing";
  evidence: string | null;
  tokensIn: number;
  tokensOut: number;
  ms: number;
}

export interface DiveWindowReadResult {
  diveFrom: { value: string | null; state: "stated" | "inferred" | "missing"; evidence: string | null };
  diveTo: { value: string | null; state: "stated" | "inferred" | "missing"; evidence: string | null };
  tokensIn: number;
  tokensOut: number;
  ms: number;
}

export interface ExtractProvider {
  id: string;
  /**
   * The provider that answered the most recent extraction `call()`, when it differs from `id` — i.e. a fallback
   * stood in for the primary. Absent on a plain provider, whose `id` is always the one that answered.
   */
  answeredBy?(): string;
  call(input: ExtractCall): Promise<ExtractResult>;
  // Optional, isolated pass added 2026-09-21 (ADR-005a): 'guests' alone, with
  // a prompt carrying only the guests rule — no dates/transport/diver noise.
  // Proven necessary, not just nicer wording: the exact same reworded rule
  // embedded in the full multi-field prompt still failed 5/5 on a real
  // family-booking email; the same rule alone, isolated, passed 6/6.
  // extract.ts runs this *in parallel* with call() (not sequentially, unlike
  // an earlier two-pass attempt that only added latency for no benefit) and
  // overrides 'guests' with this result when it succeeds. A provider that
  // omits this keeps the single call() path exactly as before.
  extractGuests?(text: string): Promise<GuestsReadResult>;
  // Same pattern, same day, for 'checkIn': DeepSeek (now primary) sometimes
  // downgrades a clear relative-date phrase ("in 5 days") to 'inferred' with
  // evidence nulled out — which also disables postProcess's own
  // resolveRelativeDate safety net, since that only runs when evidence is
  // present. Isolated, this same phrase resolved 'stated' 5/5. extract.ts
  // runs this in parallel with call() and only fills a gap (main pass not
  // already 'stated'), same merge discipline as extractGuests.
  extractCheckIn?(text: string, today: string): Promise<CheckInReadResult>;
  // Same pattern, same day, for the dive window: found via the pre-existing
  // tools/live-eval/test-anilao-real-matrix.ts scenario matrix (AN-01) — a guest
  // confirming "diving on Oct 11th" in a follow-up turn came back
  // diveFrom:null 4/4 times in the full multi-field prompt, isolated 5/5
  // correct. diveFrom/diveTo travel together (a single day mention sets
  // both to that day), so one call covers both fields.
  extractDiveWindow?(text: string, today: string): Promise<DiveWindowReadResult>;
  // Optional natural language generation pass for grounded hospitality replies.
  // When provided, converse() uses this to generate warm, empathetic responses
  // that acknowledge nuanced guest arrangements, with safe fallback to renderReply().
  generateText?(systemPrompt: string, userPrompt: string): Promise<string>;
}
