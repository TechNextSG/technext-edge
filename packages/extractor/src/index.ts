export { extract, ExtractionValidationError } from "./extract.js";
export type { ExtractionOutcome } from "./extract.js";
export {
  Trip,
  FieldState,
  HOUSE_NORM_FIELDS,
  BffTrip,
  BffGuest,
  BffRoom,
  BffDayPlanEntry,
  BffRoomType,
  BffCourseCode,
  BffValidationCode,
  BffSaneIssueCode,
} from "./schema.js";
export type { Field, BffValidationIssue } from "./schema.js";
export { createGeminiProvider } from "./providers/gemini.js";
export { createDeepSeekProvider } from "./providers/deepseek.js";
export { createProviderFromEnv, createProviderByName, KNOWN_PROVIDER_NAMES } from "./providerFromEnv.js";
export type { ExtractProvider, ExtractCall, ExtractResult } from "./provider.js";
export { resolveRelativeDate, deriveCheckOut, manilaToday } from "./dates.js";
// Exported for whoever logs raw guest text — the webhook in apps/casa-bff is
// the first such caller. extract() itself deliberately does not mask what it
// sends to the provider (see normalize.ts).
export { maskForLogging, detectLanguage, guestTextOf } from "./normalize.js";
export {
  generateQuestions,
  renderReply,
  fallbackReply,
  partnerInvitationReply,
  stalledHandoffReply,
  changedValueNotice,
  wantsHuman,
  getStaffAlerts,
  ASK_LIMIT,
  STALL_LIMIT,
  isReadyForHandoff,
  diveWindowIsGuessed,
  HANDOFF_REQUIRED_FIELDS,
  NEVER_ASKED_FIELDS,
} from "./questions.js";
export type { ReplyKind, RenderedReply, FallbackKind, GuestLanguage } from "./questions.js";
export type { StatedValueChange } from "./questions.js";
export { classifyEnquiry } from "./intent.js";
export type { EnquiryIntent } from "./intent.js";
export { normalizePricing, readWarnings } from "./pricing.js";
export type {
  QuotationPricing,
  PricedGuest,
  PricedLine,
  PricedOps,
  PricedKpis,
  NormalizePricingInput,
} from "./pricing.js";
export { verifySynthesizedReply, synthesizeHospitalityReply } from "./synthesis.js";
export type { FactGateResult, SynthesisInput } from "./synthesis.js";
export { scoreReplyNaturalness } from "./naturalness.js";
export type { NaturalnessScoreBreakdown } from "./naturalness.js";
export {
  buildOdooHandoffPayload,
  buildBffTrip,
  validateBffTripPrecheck,
  datesBetweenInclusive,
} from "./odooHandoff.js";
export type { OdooHandoffMode, OdooEstimateDraft, OdooHandoffEnvelope } from "./odooHandoff.js";
export { converse } from "./converse.js";
export type { ConversationChannel, ConversationInput, ConversationTurn, ConverseOutcome } from "./converse.js";
export { diffBffTrip, pricedFactsChanged, pricedFactsKey } from "./tripDiff.js";
export type { StaffTripEdit } from "./tripDiff.js";
export {
  SUBMIT_QUOTATION_TO_HONO_DECLARATION,
  buildHonoQuotationDraft,
  recalculateQuotationTotals,
  synthesizeConfirmedQuotationReply,
  guestSafeStaffNotes,
  guestLinkFor,
} from "./quotationTool.js";
export type {
  QuotationLineItem,
  HonoQuotationDraft,
  HonoToolCallTrace,
  QuotationSubmission,
  QuotationSubmissionState,
  QuotationContact,
  QuotationEstimatorState,
} from "./quotationTool.js";



