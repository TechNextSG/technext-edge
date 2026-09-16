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

export interface ExtractProvider {
  id: string;
  call(input: ExtractCall): Promise<ExtractResult>;
}
