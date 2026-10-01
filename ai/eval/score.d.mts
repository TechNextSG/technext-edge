// Types for score.mjs, which stays plain JS so `node eval/runner.mjs` runs without a build step.
// Only what the replay test reads is declared.
export declare const REQUIRED_FIELDS: readonly ("checkIn" | "guests" | "rooms" | "nights")[];
export declare const PRICED_FIELDS: readonly "transport"[];
export declare function checkPricedFields(
  testCase: unknown,
  trip: unknown,
): { checked: number; mismatches: Array<{ field: string; expected: { state: unknown; value: unknown }; actual: { state: unknown; value: unknown } }> };
export declare function checkEvidence(trip: unknown, sourceText: string): { stated: number; evidenceOk: number };
export declare function scoreCase(
  testCase: unknown,
  trip: unknown,
): { rows: unknown[]; fabricated: number; requiredTotal: number; requiredCorrect: number };
