// The quotation package's only public import surface: from a finished Trip to a priced, editable
// draft and the payload the team estimator accepts. Depends on ai/ and contracts/, never the
// other way round.
export { normalizePricing, readWarnings } from "./domain/pricing.ts";
export type {
  QuotationPricing,
  PricedGuest,
  PricedLine,
  PricedOps,
  PricedKpis,
  NormalizePricingInput,
} from "./domain/pricing.ts";
export { toInquiryLead } from "./application/inquiryLead.ts";
export type { InquiryLead } from "./application/inquiryLead.ts";
export { diffBffTrip, pricedFactsChanged, pricedFactsKey } from "./domain/tripDiff.ts";
export type { StaffTripEdit } from "./domain/tripDiff.ts";
export {
  DEFAULT_FOLLOW_UP_WINDOW,
  quotationValidityLines,
  followUpState,
  followUpWindowFromEnv,
  formatManila,
  hoursSinceSent,
  quotationValidUntil,
  sentAtMs,
} from "./domain/quotationValidity.ts";
export type { FollowUpState, FollowUpWindow } from "./domain/quotationValidity.ts";
export {
  SUBMIT_QUOTATION_TO_HONO_DECLARATION,
  buildHonoQuotationDraft,
  recalculateQuotationTotals,
  synthesizeConfirmedQuotationReply,
  guestFacingFactsFor,
  isPartnerEnquiry,
  guestSafeStaffNotes,
  guestLinkFor,
} from "./application/quotationTool.ts";
export type {
  QuotationLineItem,
  HonoQuotationDraft,
  HonoToolCallTrace,
  QuotationSubmission,
  QuotationSubmissionState,
  QuotationContact,
  QuotationEstimatorState,
} from "./application/quotationTool.ts";
export { converseWithQuotation } from "./application/converseWithQuotation.ts";
export type { QuotationConverseOutcome } from "./application/converseWithQuotation.ts";
export * from "./domain/rates.ts";
