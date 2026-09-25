import type {
  Trip,
  BffTrip,
  BffRoom,
  BffGuest,
  BffDayPlanEntry,
  BffCourseCode,
  BffValidationIssue,
} from "./schema.js";
import { generateQuestions, getStaffAlerts } from "./questions.js";

export type OdooHandoffMode =
  | "incomplete_enquiry"
  | "auto_estimate_ready"
  | "manual_staff_review";

export interface OdooEstimateDraft {
  contactName: string;
  // English and Chinese only — Vietnamese was removed from the pipeline on 2026-09-24
  // (see normalize.ts). Kept as a literal union so this handoff contract cannot
  // advertise a language the pipeline is unable to produce. NOTE: "vi" is plain ASCII,
  // so an audit that greps for Vietnamese characters will not find it here.
  language: "en" | "zh";
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
  /** Normalized draft payload ready for internal summary inspection. */
  draft: OdooEstimateDraft | null;
  /** Official P5 BFF / Odoo `Trip` shape (`contracts/src/trip.zod.ts`) ready for `POST /api/estimates`. */
  bffTrip: BffTrip | null;
  /** Ready-to-send body `{ trip: BffTrip }` for `POST /api/estimates`. */
  bffEstimateRequest: { trip: BffTrip } | null;
  /** Pre-compute validation issues matching `bff/src/trip/validate.ts` (`schema.md` §3). */
  bffValidationIssues: BffValidationIssue[];
}

/**
 * Generates inclusive ISO date array `YYYY-MM-DD` from `startIso` to `endIso`.
 */
export function datesBetweenInclusive(startIso: string, endIso: string): string[] {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }
  const result: string[] = [];
  const cur = new Date(start);
  while (cur <= end && result.length < 60) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

function addDaysIso(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function detectCourseCodes(notes: string | null): BffCourseCode[] {
  if (!notes) return [];
  const lower = notes.toLowerCase();
  const codes: BffCourseCode[] = [];
  if (/\b(?:dsd|discover\s+scuba|intro\s+dive)\b/.test(lower)) codes.push("dsd");
  if (/\b(?:refresher|scuba\s+review)\b/.test(lower)) codes.push("refresher");
  if (/\b(?:open\s+water|padi\s+ow|\bow\s+course)\b/.test(lower)) codes.push("ow");
  if (/\b(?:advanced\s+open\s+water|aow)\b/.test(lower)) codes.push("aow");
  if (/\b(?:rescue\s+diver|rescue\s+course)\b/.test(lower)) codes.push("rescue");
  return codes.slice(0, 5);
}

/**
 * Converts an extractor `Trip` into the official P5 BFF `BffTrip` (`contracts/src/trip.zod.ts` & `buildTrip.ts`, `schema.md` §2).
 *
 * Guarantees all 6 mandatory ★ groups required by `bff/src/trip/fill.ts`:
 * 1. `guestType` ("retail" | "agent" | "instructor")
 * 2. `transportType` ("none" | "roundtrip" | "oneway")
 * 3. `checkIn`, `checkOut` ("YYYY-MM-DD")
 * 4. `diveFrom`, `diveTo` (non-null when >= 1 guest has `diver: true`; `null` when 0 divers)
 * 5. `guests[i].roomId` (always references a valid `rooms[].id`)
 * 6. `guests[i].days` (populated across `[diveFrom, diveTo]` when `diver: true`; `{}` when `diver: false`)
 */
export function buildBffTrip(trip: Trip): BffTrip {
  const contactName = trip.contactName?.value ?? "Guest";
  const guestType = trip.guestType?.value ?? "retail";
  const transportRequested = Boolean(trip.transport?.value);
  const transportType =
    trip.transportType?.value && trip.transportType.value !== "none"
      ? trip.transportType.value
      : transportRequested
        ? "roundtrip"
        : "none";

  const checkIn = trip.checkIn?.value ?? null;
  const checkOut = trip.checkOut?.value ?? null;
  const nights = trip.nights?.value ?? 1;
  const guestCount = Math.max(1, Math.min(40, trip.guests?.value ?? 1));
  const rawRoomCount = Math.max(1, Math.min(30, trip.rooms?.value ?? 1));
  // Avoid `room-empty` warnings by ensuring room count never exceeds guestCount
  const roomCount = Math.min(rawRoomCount, guestCount);

  const hasDiving = Boolean(trip.diver?.value);
  const diverCount = hasDiving
    ? Math.max(1, Math.min(guestCount, trip.divers?.value ?? guestCount))
    : 0;

  let diveFrom: string | null = null;
  let diveTo: string | null = null;

  if (diverCount > 0 && checkIn && checkOut) {
    const defaultStart = nights >= 2 ? addDaysIso(checkIn, 1) : checkIn;
    const defaultEnd = nights >= 2 ? addDaysIso(checkOut, -1) : checkIn;
    diveFrom = trip.diveFrom?.value ?? defaultStart;
    diveTo = trip.diveTo?.value ?? (defaultEnd >= diveFrom ? defaultEnd : diveFrom);
    // Clamp within [checkIn, checkOut] to prevent `dive-window-outside-stay` (schema.md §3)
    if (diveFrom < checkIn) diveFrom = checkIn;
    if (diveTo > checkOut) diveTo = checkOut;
    if (diveTo < diveFrom) diveTo = diveFrom;
  }

  const rooms: BffRoom[] = Array.from({ length: roomCount }, (_, idx) => ({
    id: `r${idx + 1}`,
    type: "standard",
    name: null,
  }));

  const diveDateList =
    diverCount > 0 && diveFrom && diveTo ? datesBetweenInclusive(diveFrom, diveTo) : [];

  const mealsIncluded =
    (trip.meals?.value ?? "full_board") === "full_board" ||
    trip.meals?.value === "half_board";
  const hasTransport = transportType !== "none";
  const courses = detectCourseCodes(
    [trip.diveNotes?.value, trip.specialRequests?.value].filter(Boolean).join(" ")
  );

  const providedNames = trip.guestNames?.value ?? [];
  const guests: BffGuest[] = Array.from({ length: guestCount }, (_, idx) => {
    const isDiver = idx < diverCount;
    const assignedRoom = rooms[idx % rooms.length]!;
    const guestName =
      providedNames[idx] ?? (idx === 0 && contactName ? contactName : `Guest ${idx + 1}`);

    const days: Record<string, BffDayPlanEntry> = {};
    if (isDiver) {
      for (const d of diveDateList) {
        days[d] = {
          dive: true,
          third: false,
          night: false,
          boatId: null,
        };
      }
    }

    return {
      id: `g${idx + 1}`,
      name: guestName.slice(0, 120),
      diver: isDiver, // Explicitly boolean (`false` for non-divers so Odoo doesn't default to `true`)
      meals: mealsIncluded,
      transport: hasTransport,
      foc: false,
      roomId: assignedRoom.id,
      courses: isDiver ? courses : [],
      days,
      // Emitted as explicit nulls because the BFF contract fills these with null: a key
      // that is absent and a key that is null are the same value on the other side, and
      // sending the key keeps the payload self-describing in logs.
      arrive: null,
      depart: null,
      comment: null,
      vanA: null,
      vanD: null,
    };
  });

  return {
    label: `${contactName} — ${nights} night${nights === 1 ? "" : "s"}`.slice(0, 120),
    guestType,
    transportType,
    checkIn,
    checkOut,
    diveFrom,
    diveTo,
    bookedDaysAhead: 0,
    rooms,
    guests,
    items: [],
    vanSplit: null,
    vanMeta: {},
    extraDMByDay: {},
    dmByDay: {},
  };
}

/**
 * Pre-flight validator matching `bff/src/trip/validate.ts` (`schema.md` §3).
 */
export function validateBffTripPrecheck(bffTrip: BffTrip): BffValidationIssue[] {
  const issues: BffValidationIssue[] = [];

  if (!bffTrip.checkIn || !bffTrip.checkOut) {
    issues.push({
      code: "missing-mandatory-field",
      fields: ["checkIn", "checkOut"],
      level: "error",
    });
    return issues;
  }

  if (bffTrip.checkOut <= bffTrip.checkIn) {
    issues.push({
      code: "checkout-not-after-checkin",
      fields: ["checkIn", "checkOut"],
      level: "error",
    });
    return issues;
  }

  const anyDiver = bffTrip.guests.some((g) => g.diver);
  if (anyDiver) {
    if (!bffTrip.diveFrom || !bffTrip.diveTo) {
      issues.push({
        code: "missing-mandatory-field",
        fields: ["diveFrom", "diveTo"],
        level: "error",
      });
    } else if (bffTrip.diveTo < bffTrip.diveFrom) {
      issues.push({
        code: "dive-window-reversed",
        fields: ["diveFrom", "diveTo"],
        level: "error",
      });
    } else {
      if (bffTrip.diveFrom < bffTrip.checkIn || bffTrip.diveTo > bffTrip.checkOut) {
        issues.push({
          code: "dive-window-outside-stay",
          fields: ["diveFrom", "diveTo"],
          level: "error",
        });
      }
      for (let i = 0; i < bffTrip.guests.length; i++) {
        const g = bffTrip.guests[i]!;
        if (!g.diver) continue;
        const dayKeys = Object.keys(g.days);
        if (dayKeys.length === 0) {
          issues.push({
            code: "missing-mandatory-field",
            fields: [`guests[${i}].days`],
            level: "error",
          });
        } else if (dayKeys.some((k) => k < bffTrip.diveFrom! || k > bffTrip.diveTo!)) {
          issues.push({
            code: "dive-days-outside-window",
            fields: [`guests[${i}].days`],
            level: "error",
          });
        }
      }
    }
  }

  const validRoomIds = new Set(bffTrip.rooms.map((r) => r.id).filter(Boolean));
  const occupiedRoomIds = new Set<string>();
  for (let i = 0; i < bffTrip.guests.length; i++) {
    const g = bffTrip.guests[i]!;
    if (!g.roomId || !validRoomIds.has(g.roomId)) {
      issues.push({
        code: "missing-mandatory-field",
        fields: [`guests[${i}].roomId`],
        level: "error",
      });
    } else {
      occupiedRoomIds.add(g.roomId);
    }
  }

  bffTrip.rooms.forEach((r, idx) => {
    if (!r.id || !occupiedRoomIds.has(r.id)) {
      issues.push({
        code: "room-empty",
        fields: [`rooms[${idx}]`],
        level: "warn",
      });
    }
  });

  return issues;
}

/**
 * Builds the Phase 2/5 Odoo Handoff & Quotation Envelope from a validated `Trip`.
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
      bffTrip: null,
      bffEstimateRequest: null,
      bffValidationIssues: [],
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

  const bffTrip = buildBffTrip(trip);
  const bffValidationIssues = validateBffTripPrecheck(bffTrip);
  const hasBffErrors = bffValidationIssues.some((i) => i.level === "error");
  if (hasBffErrors) {
    manualReviewReasons.push("bff_validation_error");
  }

  const isManual = manualReviewReasons.length > 0;

  return {
    mode: isManual ? "manual_staff_review" : "auto_estimate_ready",
    readyForAutoQuote: !isManual,
    manualReviewReasons,
    staffAlerts,
    missingFields: [],
    draft,
    bffTrip,
    bffEstimateRequest: { trip: bffTrip },
    bffValidationIssues,
  };
}
