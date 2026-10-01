// The studio's old cold-start record, as a test fixture. The app no longer seeds one (a fresh studio is
// empty); tests that need "a priced-by-the-sample-engine, unapproved, unpublished quotation" build it here.
import { buildBffTrip, type Trip } from "../../../ai/src/index.ts";
import { normalizePricing, recalculateQuotationTotals, type HonoQuotationDraft } from "../../src/quote/index.ts";
import { buildSimulatedModel } from "../../src/services/simulatedEstimator.ts";
import { saveQuotationDraft } from "../../src/store/quotationStore.ts";

export const SAMPLE_QUOTE_ID = "QT-1010-SKY";
/** An older deploy stamped its cold-start record with this; the guards that protect such a record still exist. */
export const SAMPLE_SEED_VERSION = 5;

/** A split-day diving group: the case the guardrail routes to staff rather than auto-pricing. */
function sampleTrip(): Trip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  return {
    language: f("en", "default"),
    contactName: f("Sample Group"),
    checkIn: f("2026-10-10"),
    checkOut: f("2026-10-12"),
    nights: f(2),
    guests: f(4),
    rooms: f(2),
    roomType: f("standard"),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none", "derived"),
    diver: f(true),
    divers: f(null, "missing"),
    diveNotes: f("1 person dives day 1; 5 people dive both days"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
  } as Trip;
}

export function sampleQuotation(): HonoQuotationDraft {
  const now = new Date().toISOString();
  const slug = crypto.randomUUID();
  const trip = buildBffTrip(sampleTrip());
  const baseUrl = "https://technext-edge-casa-bff.vercel.app";
  return recalculateQuotationTotals({
    quoteId: SAMPLE_QUOTE_ID,
    slug,
    seedVersion: SAMPLE_SEED_VERSION,
    status: "pending_hono_review",
    createdAt: now,
    updatedAt: now,
    phone: "639000000000",
    guestName: "Sample Group",
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
    nights: 2,
    stayingGuests: 4,
    totalGroupSize: 6,
    rooms: 2,
    mealPlan: "full_board",
    diver: true,
    divers: null,
    diveNotes: "1 person dives day 1; 5 people dive both days",
    guestType: "regular",
    currency: "PHP",
    discountPercent: 0,
    lineItems: [],
    subtotalAmount: 0,
    discountAmount: 0,
    totalAmount: buildSimulatedModel(trip).kpis.revenue ?? 0,
    bffTrip: trip,
    pricing: normalizePricing({
      model: buildSimulatedModel(trip),
      source: "simulated",
      sample: true,
      mode: "fixture",
      role: "guest",
      computedAt: now,
    }),
    estimator: null,
    quotationUrl: `${baseUrl}/q/${slug}`,
    honoEditorUrl: `${baseUrl}/quotes/${SAMPLE_QUOTE_ID}`,
    staffNotes:
      "Split-day diving arrangement: 6 people total (4 staying overnight in 2 rooms; 1 diver on Day 1 only, 5 divers on both days).",
    staffAlerts: [
      "Custom dive schedule noted — 1 person dives day 1, 5 people dive both days. Our reservation team will prepare the quotation.",
    ],
  });
}

/** Puts the sample record in the store unless it is there already (the store is one per process). */
export async function ensureSampleQuotation(): Promise<void> {
  const { getQuotationByIdOrSlug } = await import("../../src/store/quotationStore.ts");
  if (await getQuotationByIdOrSlug(SAMPLE_QUOTE_ID)) return;
  await saveQuotationDraft(sampleQuotation());
}
