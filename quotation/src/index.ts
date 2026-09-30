// The quotation package's only public import surface: from a finished Trip to a priced, editable
// draft and the payload the customer's estimator accepts. Depends on ai/ and contracts/, never the
// other way round.
export { normalizePricing, readWarnings } from "./domain/pricing.js";
export type {
  QuotationPricing,
  PricedGuest,
  PricedLine,
  PricedOps,
  PricedKpis,
  NormalizePricingInput,
} from "./domain/pricing.js";
export {
  buildOdooHandoffPayload,
  buildBffTrip,
  validateBffTripPrecheck,
  datesBetweenInclusive,
} from "./application/odooHandoff.js";
export type { OdooHandoffMode, OdooEstimateDraft, OdooHandoffEnvelope } from "./application/odooHandoff.js";
export { toInquiryLead } from "./application/inquiryLead.js";
export type { InquiryLead } from "./application/inquiryLead.js";
export { diffBffTrip, pricedFactsChanged, pricedFactsKey } from "./domain/tripDiff.js";
export type { StaffTripEdit } from "./domain/tripDiff.js";
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
export { converseWithQuotation } from "./application/converseWithQuotation.js";
export type { QuotationConverseOutcome } from "./application/converseWithQuotation.js";
export { courseAssignment } from "./application/odooHandoff.js";
export type { PrecheckOptions } from "./application/odooHandoff.js";
export * from "./domain/rates.js";
