/* AI extractor (P5): guest message in -> Trip with per-field state, a reply, and the BffTrip handoff.
 * Imported by bff/. Owner: Nhật. This file is the package's only public import surface.
 * Rules that do not bend (CLAUDE.md §1):
 *   - No Odoo client import, no api-key handling
 *   - No pricing calculation (all pricing comes from BFF / Odoo EstimateModel)
 *   - No booking submit
 *   - Contract types come from @casa/contracts (TripShape, GuestShape) */
export { extract, ExtractionValidationError, partnerTypeOf } from "./application/extract.ts";
export type { ExtractionOutcome } from "./application/extract.ts";
export {
  Trip,
  FieldState,
  HOUSE_NORM_FIELDS,
} from "./domain/schema.ts";
export type { Field } from "./domain/schema.ts";
export { createGeminiProvider } from "./infra/providers/gemini.ts";
export { createDeepSeekProvider } from "./infra/providers/deepseek.ts";
export {
  createProviderFromEnv,
  createProviderByName,
  createProviderFromSettings,
  createResilientProvider,
  settingsFromEnv,
  choiceFromName,
  isKnownModel,
  keyFor,
  buildProvider,
  DEFAULT_MODELS,
  MODEL_CATALOG,
  PROVIDER_KINDS,
  KNOWN_PROVIDER_NAMES,
} from "./infra/providers/providerFromEnv.ts";
export type { AiEnv, ProviderKind, ModelChoice, ProviderSettings, ProviderOutcome } from "./infra/providers/providerFromEnv.ts";
export type { ExtractProvider, ExtractCall, ExtractResult } from "./ports/provider.ts";
export { resolveRelativeDate, deriveCheckOut, manilaToday } from "./domain/dates.ts";
// Exported for whoever logs raw guest text — the webhook in bff is
// the first such caller. extract() itself deliberately does not mask what it
// sends to the provider (see normalize.ts).
export { maskForLogging, detectLanguage, guestTextOf } from "./application/normalize.ts";
export {
  generateQuestions,
  renderReply,
  fallbackReply,
  partnerInvitationReply,
  stalledHandoffReply,
  changedValueNotice,
  declinesPartner,
  wantsHuman,
  getStaffAlerts,
  ASK_LIMIT,
  STALL_LIMIT,
  isReadyForHandoff,
  diveWindowIsGuessed,
  HANDOFF_REQUIRED_FIELDS,
  NEVER_ASKED_FIELDS,
} from "./application/questions.ts";
export type { ReplyKind, RenderedReply, FallbackKind, GuestLanguage } from "./application/questions.ts";
export type { StatedValueChange } from "./application/questions.ts";
export { classifyEnquiry } from "./application/intent.ts";
export type { EnquiryIntent } from "./application/intent.ts";
export { verifyGuestFacingText, verifySynthesizedReply, synthesizeHospitalityReply } from "./application/synthesis.ts";
export type { FactGateResult, SynthesisInput } from "./application/synthesis.ts";
export { scoreReplyNaturalness } from "./application/naturalness.ts";
export type { NaturalnessScoreBreakdown } from "./application/naturalness.ts";
export { converse } from "./application/converse.ts";
export type { ConversationChannel, ConversationInput, ConversationTurn, ConverseOutcome } from "./application/converse.ts";
export { extractorFieldsForTripPath, pathsRestatedByGuest } from "./application/tripCorrections.ts";
export { GuestType, TransportType, MealPlan } from "./domain/schema.ts";
export type { GuestLanguage as TripLanguage } from "./domain/schema.ts";
export { DEFAULT_ROOM_CAPS, roomCapsFromRates } from "./domain/houseNorms.ts";
export type { RoomCaps } from "./domain/houseNorms.ts";
export { withBudget } from "./application/synthesis.ts";
export type { GuestFacingFacts } from "./application/synthesis.ts";

// The handoff: Trip -> the @casa/contracts TripShape the BFF prices, plus the precheck it would 422 on.
export type { TripShape, GuestShape } from "@casa/contracts";
export { Trip as AiTripSchema, type Trip as AiTrip } from "./domain/schema.ts";
export {
  BffTrip,
  BffGuest,
  BffRoom,
  BffDayPlanEntry,
  BffCustomItem,
  BffVanMetaEntry,
  BffRoomType,
  BffCourseCode,
  BffValidationCode,
  BffSaneIssueCode,
} from "./domain/bffTrip.ts";
export type { BffValidationIssue } from "./domain/bffTrip.ts";
export {
  buildOdooHandoffPayload,
  buildBffTrip,
  validateBffTripPrecheck,
  datesBetweenInclusive,
  courseAssignment,
} from "./application/odooHandoff.ts";
export type { OdooHandoffMode, OdooEstimateDraft, OdooHandoffEnvelope, PrecheckOptions } from "./application/odooHandoff.ts";
