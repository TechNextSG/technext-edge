import { z } from "zod";
import {
  validateBffTripPrecheck,
  normalizePricing,
  isPartnerEnquiry,
  type HonoQuotationDraft,
} from "../../../quotation/src/index.js";
import { protectedFromCleanup } from "../stores/quotationStore.js";
import {
  buildEstimateRequest,
  DEFAULT_ESTIMATOR_BASE_URL,
  ESTIMATE_PATH,
} from "./estimatorClient.js";
import type { EstimatorPort } from "./estimatorPort.js";

export const EDITABLE_QUOTATION_FIELDS = [
  "guestName",
  "checkIn",
  "checkOut",
  "staffNotes",
  "phone",
] as const;

export function editableQuotationFields(body: unknown): {
  edits: Partial<HonoQuotationDraft>;
  ignored: string[];
  claimedTrip: unknown;
} {
  const seen = (body ?? {}) as Record<string, unknown>;
  const edits: Partial<HonoQuotationDraft> = {};
  for (const key of EDITABLE_QUOTATION_FIELDS) {
    if (seen[key] !== undefined) (edits as Record<string, unknown>)[key] = seen[key];
  }
  const ignored = Object.keys(seen).filter(
    (key) => !(EDITABLE_QUOTATION_FIELDS as readonly string[]).includes(key),
  );
  return { edits, ignored, claimedTrip: seen.bffTrip };
}

export function alreadySharedRefusal(existing: HonoQuotationDraft): Response | null {
  if (!existing.estimator?.sharedAt) return null;
  return Response.json(
    {
      ok: false,
      reason: "already_shared",
      detail:
        "this quotation is already published, so what the guest is holding must not change — start a new quotation instead",
      guestUrl: existing.estimator.guestUrl,
    },
    { status: 409 },
  );
}

export function partnerRefusalFor(draft: HonoQuotationDraft): Response | null {
  if (!isPartnerEnquiry(draft)) return null;
  return new Response(
    JSON.stringify({
      ok: false,
      reason: "partner_needs_own_login",
      detail:
        "This enquiry is from an agent — they quote in the team estimator after signing in. Reply to them instead of publishing.",
    }),
    { status: 409, headers: { "content-type": "application/json" } },
  );
}

export function deletableByCleanup(q: HonoQuotationDraft): boolean {
  return !protectedFromCleanup(q);
}

export function buildEstimatePreview(draft: HonoQuotationDraft, estimator: EstimatorPort) {
  const trip = draft.bffTrip ?? null;
  return {
    endpoint:
      estimator.kind === "simulated"
        ? "simulated engine (in-process)"
        : `${estimator.baseUrl ?? DEFAULT_ESTIMATOR_BASE_URL}${ESTIMATE_PATH}`,
    body: trip ? buildEstimateRequest(trip).body : null,
    bffTrip: trip,
    validationIssues: trip ? validateBffTripPrecheck(trip, undefined, { role: "staff" }) : [],
    localTotals: {
      currency: draft.currency,
      subtotal: draft.subtotalAmount,
      discount: draft.discountAmount,
      total: draft.totalAmount,
    },
  };
}

export function estimateToRecord(
  existing: HonoQuotationDraft,
  result: Extract<Awaited<ReturnType<EstimatorPort["sendEstimate"]>>, { ok: true }>,
  estimatorKind: "simulated" | "remote",
): Pick<HonoQuotationDraft, "pricing" | "estimator"> {
  return {
    pricing: normalizePricing({
      model: result.model,
      retailModel: result.retailModel,
      source: estimatorKind,
      sample: result.sample,
      mode: result.mode,
      role: result.role,
      computedAt: result.computedAt,
    }),
    estimator: {
      id: result.id ?? existing.estimator?.id ?? null,
      cookie: result.sessionCookie ?? existing.estimator?.cookie ?? null,
      seq: existing.estimator?.seq ?? null,
      guestUrl: existing.estimator?.guestUrl ?? null,
      sharedAt: existing.estimator?.sharedAt ?? null,
    },
  };
}

export const ReservationContact = z
  .object({
    name: z.string().min(1).max(120),
    email: z.string().min(3).max(200),
    phone: z.string().max(40).optional(),
  })
  .strict();
