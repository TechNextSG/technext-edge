export { extract, ExtractionValidationError } from "./application/extract.js";
export type { ExtractionOutcome } from "./application/extract.js";
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
} from "./domain/schema.js";
export type { Field, BffValidationIssue } from "./domain/schema.js";
export { createGeminiProvider } from "./infra/providers/gemini.js";
export { createDeepSeekProvider } from "./infra/providers/deepseek.js";
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
} from "./infra/providers/providerFromEnv.js";
export type { ProviderKind, ModelChoice, ProviderSettings, ProviderOutcome } from "./infra/providers/providerFromEnv.js";
export type { ExtractProvider, ExtractCall, ExtractResult } from "./ports/provider.js";
export { resolveRelativeDate, deriveCheckOut, manilaToday } from "./domain/dates.js";
// Exported for whoever logs raw guest text — the webhook in bff is
// the first such caller. extract() itself deliberately does not mask what it
// sends to the provider (see normalize.ts).
export { maskForLogging, detectLanguage, guestTextOf } from "./application/normalize.js";
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
} from "./application/questions.js";
export type { ReplyKind, RenderedReply, FallbackKind, GuestLanguage } from "./application/questions.js";
export type { StatedValueChange } from "./application/questions.js";
export { classifyEnquiry } from "./application/intent.js";
export type { EnquiryIntent } from "./application/intent.js";
export { normalizePricing, readWarnings } from "./domain/pricing.js";
export type {
  QuotationPricing,
  PricedGuest,
  PricedLine,
  PricedOps,
  PricedKpis,
  NormalizePricingInput,
} from "./domain/pricing.js";
export { verifyGuestFacingText, verifySynthesizedReply, synthesizeHospitalityReply } from "./application/synthesis.js";
export type { FactGateResult, SynthesisInput } from "./application/synthesis.js";
export { scoreReplyNaturalness } from "./application/naturalness.js";
export type { NaturalnessScoreBreakdown } from "./application/naturalness.js";
export {
  buildOdooHandoffPayload,
  buildBffTrip,
  validateBffTripPrecheck,
  datesBetweenInclusive,
} from "./application/odooHandoff.js";
export type { OdooHandoffMode, OdooEstimateDraft, OdooHandoffEnvelope } from "./application/odooHandoff.js";
export { toInquiryLead } from "./application/inquiryLead.js";
export type { InquiryLead } from "./application/inquiryLead.js";
export { converse } from "./application/converse.js";
export type { ConversationChannel, ConversationInput, ConversationTurn, ConverseOutcome } from "./application/converse.js";
export { diffBffTrip, pricedFactsChanged, pricedFactsKey } from "./application/tripDiff.js";
export type { StaffTripEdit } from "./application/tripDiff.js";
export { extractorFieldsForTripPath, pathsRestatedByGuest } from "./application/tripCorrections.js";
export {
  DEFAULT_FOLLOW_UP_WINDOW,
  quotationValidityLines,
  followUpState,
  followUpWindowFromEnv,
  formatManila,
  hoursSinceSent,
  quotationValidUntil,
  sentAtMs,
} from "./domain/quotationValidity.js";
export type { FollowUpState, FollowUpWindow } from "./domain/quotationValidity.js";
export {
  SUBMIT_QUOTATION_TO_HONO_DECLARATION,
  buildHonoQuotationDraft,
  recalculateQuotationTotals,
  synthesizeConfirmedQuotationReply,
  guestFacingFactsFor,
  isPartnerEnquiry,
  guestSafeStaffNotes,
  guestLinkFor,
} from "./application/quotationTool.js";
export type {
  QuotationLineItem,
  HonoQuotationDraft,
  HonoToolCallTrace,
  QuotationSubmission,
  QuotationSubmissionState,
  QuotationContact,
  QuotationEstimatorState,
} from "./application/quotationTool.js";



