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
  retry?: { previousRaw: unknown; error: string };
}

export interface ExtractResult {
  raw: unknown; // parsed JSON from the model, not yet zod-validated
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  ms: number;
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

export interface ExtractProvider {
  id: string;
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
}
