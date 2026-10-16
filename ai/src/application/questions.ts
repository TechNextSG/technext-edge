/**
 * Question generation, handoff rules, deterministic rendering, fallbacks, and intent (Pattern 6).
 * Decomposed into modular components:
 * - questions/rules.ts: field rules, applicability, open question generation, handoff readiness
 * - questions/render.ts: deterministic formatting and reply composition (greeting, questions, summary)
 * - questions/fallback.ts: static failure/stalled replies, value change notices, partner invitations
 * - questions/intent.ts: guest intent detection for human handoff and partner self-serve
 */

export * from "./questions/rules.ts";
export * from "./questions/render.ts";
export * from "./questions/fallback.ts";
export * from "./questions/intent.ts";
