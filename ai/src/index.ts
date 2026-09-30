// The AI package's only public import surface: guest message in, Trip and reply out.
// Pricing, drafts and the Odoo handoff are the quotation package's; the BFF contract is contracts/.
export { extract, ExtractionValidationError, partnerTypeOf } from "./application/extract.js";
export type { ExtractionOutcome } from "./application/extract.js";
export {
  Trip,
  FieldState,
  HOUSE_NORM_FIELDS,
} from "./domain/schema.js";
export type { Field } from "./domain/schema.js";
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
export type { AiEnv, ProviderKind, ModelChoice, ProviderSettings, ProviderOutcome } from "./infra/providers/providerFromEnv.js";
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
export { verifyGuestFacingText, verifySynthesizedReply, synthesizeHospitalityReply } from "./application/synthesis.js";
export type { FactGateResult, SynthesisInput } from "./application/synthesis.js";
export { scoreReplyNaturalness } from "./application/naturalness.js";
export type { NaturalnessScoreBreakdown } from "./application/naturalness.js";
export { converse } from "./application/converse.js";
export type { ConversationChannel, ConversationInput, ConversationTurn, ConverseOutcome } from "./application/converse.js";
export { extractorFieldsForTripPath, pathsRestatedByGuest } from "./application/tripCorrections.js";
export { GuestType, TransportType, MealPlan } from "./domain/schema.js";
export type { GuestLanguage as TripLanguage } from "./domain/schema.js";
export { DEFAULT_ROOM_CAPS, roomCapsFromRates } from "./domain/houseNorms.js";
export type { RoomCaps } from "./domain/houseNorms.js";
export { withBudget } from "./application/synthesis.js";
export type { GuestFacingFacts } from "./application/synthesis.js";
