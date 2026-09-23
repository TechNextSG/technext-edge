import type { Trip } from "./schema.js";
import { generateQuestions, getStaffAlerts } from "./questions.js";

export type OdooHandoffMode =
  | "incomplete_enquiry"
  | "auto_estimate_ready"
  | "manual_staff_review";

export interface OdooEstimateDraft {
  contactName: string;
  language: "en" | "vi" | "zh";
  guestType: "retail" | "agent" | "instructor";
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  rooms: number;
  meals: "full_board" | "half_board" | "room_only" | "none";
  transport: boolean;
  transportType: "roundtrip" | "oneway" | "none";
  diving: {
    diver: boolean;
    divers: number | null;
    diveFrom: string | null;
    diveTo: string | null;
    diveNotes: string | null;
  };
  specialRequests: string | null;
  guestNames: string[];
}

export interface OdooHandoffEnvelope {
  mode: OdooHandoffMode;
  /** True only when all core fields are complete AND no partner/agency or split-day custom pricing requires human intervention. */
  readyForAutoQuote: boolean;
  /** Explicit reasons why a human reservation specialist must review or apply custom rates (e.g. 30% agency discount, split-day dive schedule). */
  manualReviewReasons: string[];
  /** Human-readable staff alerts localized for the WhatsApp handoff card. */
  staffAlerts: string[];
  /** Open questions if the enquiry is still incomplete. */
  missingFields: Array<keyof Trip>;
  /** Normalized draft payload ready for Phillip's Odoo Estimate endpoint. */
  draft: OdooEstimateDraft | null;
}

/**
 * Builds the Phase 2/3 Odoo Handoff & Quotation Envelope from a validated `Trip`.
 *
 * Separates enquiries into three deterministic tracks:
 * - `incomplete_enquiry`: Still gathering required fields on WhatsApp.
 * - `auto_estimate_ready`: Standard retail booking with exact integer counts — safe for instant Odoo API quotation.
 * - `manual_staff_review`: Complete enquiry that carries partner/agency discount (`agent`/`instructor`) or a custom split-day diving schedule (`diveNotes`).
 */
export function buildOdooHandoffPayload(trip: Trip): OdooHandoffEnvelope {
  const questions = generateQuestions(trip);
  const missingFields = questions.map((q) => q.field);
  const staffAlerts = getStaffAlerts(trip);
  const manualReviewReasons: string[] = [];

  if (questions.length > 0) {
    return {
      mode: "incomplete_enquiry",
      readyForAutoQuote: false,
      manualReviewReasons: [],
      staffAlerts,
      missingFields,
      draft: null,
    };
  }

  const guestType = trip.guestType?.value ?? "retail";
  if (guestType === "agent" || guestType === "instructor") {
    manualReviewReasons.push(`partner_rate_confirmation_required:${guestType}`);
  }

  const diveNotes = trip.diveNotes?.value ?? null;
  if (diveNotes && trip.divers?.state === "missing") {
    manualReviewReasons.push("custom_split_day_dive_schedule");
  }

  if (trip.specialRequests?.value) {
    manualReviewReasons.push("guest_special_requests_present");
  }

  const draft: OdooEstimateDraft = {
    contactName: trip.contactName?.value ?? "Guest",
    language: trip.language?.value ?? "en",
    guestType,
    checkIn: trip.checkIn?.value ?? "",
    checkOut: trip.checkOut?.value ?? "",
    nights: trip.nights?.value ?? 1,
    guests: trip.guests?.value ?? 1,
    rooms: trip.rooms?.value ?? 1,
    meals: trip.meals?.value ?? "full_board",
    transport: Boolean(trip.transport?.value),
    transportType: trip.transportType?.value ?? "none",
    diving: {
      diver: Boolean(trip.diver?.value),
      divers: typeof trip.divers?.value === "number" ? trip.divers.value : null,
      diveFrom: trip.diveFrom?.value ?? null,
      diveTo: trip.diveTo?.value ?? null,
      diveNotes,
    },
    specialRequests: trip.specialRequests?.value ?? null,
    guestNames: trip.guestNames?.value ?? [],
  };

  const isManual = manualReviewReasons.length > 0;

  return {
    mode: isManual ? "manual_staff_review" : "auto_estimate_ready",
    readyForAutoQuote: !isManual,
    manualReviewReasons,
    staffAlerts,
    missingFields: [],
    draft,
  };
}
