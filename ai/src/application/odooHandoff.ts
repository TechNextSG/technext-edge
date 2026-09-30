import type {
  Trip,
  BffTrip,
  BffRoom,
  BffGuest,
  BffDayPlanEntry,
  BffCourseCode,
  BffValidationIssue,
} from "../domain/schema.js";
import { DEFAULT_ROOM_CAPS, type RoomCaps } from "../domain/houseNorms.js";
import { manilaToday } from "../domain/dates.js";
import { generateQuestions, getStaffAlerts, diveWindowIsGuessed } from "./questions.js";

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

/**
 * Which guests the courses in the notes belong to, or null when the notes do not say.
 *
 * The notes are one free-text string for the whole party, so "AOW course" says a course exists, not who
 * takes it. It used to be stamped on every diver, which prices a course per diver. Assigned only where
 * the words settle it — one diver, or "all / everyone / both / each" — and otherwise left off and sent to
 * staff (`course_assignee_unclear`).
 */
export function courseAssignment(trip: Trip): { courses: BffCourseCode[]; assignable: boolean } {
  const text = [trip.diveNotes?.value, trip.specialRequests?.value].filter(Boolean).join(" ");
  const courses = detectCourseCodes(text);
  if (courses.length === 0) return { courses, assignable: true };
  const divers = trip.diver?.value ? Math.max(1, trip.divers?.value ?? 1) : 0;
  const everyone = /\b(?:all|everyone|everybody|each|both|we\s+all|all\s+of\s+us)\b/i.test(text);
  return { courses, assignable: divers === 1 || (divers > 0 && everyone) };
}

function detectCourseCodes(notes: string | null): BffCourseCode[] {
  if (!notes) return [];
  const lower = notes.toLowerCase();
  const codes: BffCourseCode[] = [];
  if (/\b(?:dsd|discover\s+scuba|intro\s+dive)\b/.test(lower)) codes.push("dsd");
  if (/\b(?:refresher|scuba\s+review)\b/.test(lower)) codes.push("refresher");
  // "advanced open water" contains "open water": without the lookbehind one sentence booked two courses.
  if (/(?<!advanced\s)\b(?:open\s+water|padi\s+ow|ow\s+course)\b/.test(lower)) codes.push("ow");
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
export function buildBffTrip(trip: Trip, caps: RoomCaps = DEFAULT_ROOM_CAPS): BffTrip {
  const contactName = trip.contactName?.value ?? "Guest";
  // Normalized at the boundary that feeds Odoo, not trusted from the caller. The extraction
  // schema constrains this to the same three values, so today this only ever passes through —
  // but `buildBffTrip` is exported and takes any object shaped like a Trip, and an
  // out-of-enum `guestType` sent to Odoo lands on no branch at all (its own default is
  // "retail", so an unrecognised string is worse than the default it replaced). Cheaper to
  // narrow here than to depend on every future caller having gone through zod first.
  const rawGuestType = trip.guestType?.value;
  const guestType =
    rawGuestType === "agent" || rawGuestType === "instructor" ? rawGuestType : "retail";
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
  // The type the guest actually named, when they named one. `standard` remains the fallback
  // because a room type nobody stated is a gap for staff to fill in the studio, not a reason to
  // refuse the enquiry — but sending `standard` over a stated `deluxe` was simply the wrong room.
  const roomType = trip.roomType?.value ?? "standard";
  const cap = Math.max(1, caps[roomType] ?? DEFAULT_ROOM_CAPS[roomType]);
  // A room count the guest said stays what they said, even when it cannot hold the group: raising it
  // would invent a fact, and the source engine offers no extra beds (its Q-019). The shortfall is
  // surfaced by `validateBffTripPrecheck` as `room-over-capacity`. A count nobody stated is only the
  // house-norm default, and *that* one must hold the group — the source splits an over-full single
  // room on POST but refuses it on PATCH/commit, so the trip we keep has to be split already.
  const statedRooms = trip.rooms?.state === "stated" && typeof trip.rooms.value === "number";
  const roomCount = statedRooms
    ? Math.max(1, Math.min(30, Math.min(trip.rooms!.value!, guestCount)))
    : Math.max(1, Math.min(30, guestCount, Math.ceil(guestCount / cap)));

  const hasDiving = Boolean(trip.diver?.value);
  const diverCount = hasDiving
    ? Math.max(1, Math.min(guestCount, trip.divers?.value ?? 1))
    : 0;

  let diveFrom: string | null = null;
  let diveTo: string | null = null;

  if (diverCount > 0 && checkIn && checkOut) {
    const defaultStart = nights >= 2 ? addDaysIso(checkIn, 1) : checkIn;
    const defaultEnd = nights >= 2 ? addDaysIso(checkOut, -1) : checkIn;
    diveFrom = trip.diveFrom?.value ?? defaultStart;
    diveTo = trip.diveTo?.value ?? (defaultEnd >= diveFrom ? defaultEnd : diveFrom);
    // Not clamped into the stay: a window the guest gave that falls outside it is `dive-window-outside-stay`
    // (their Q-010: blocked), and moving it here would price dives on days the guest never asked for.
    // The extractor turns such a window back into a question; `validateBffTripPrecheck` reports it if one
    // still arrives.
  }

  const rooms: BffRoom[] = Array.from({ length: roomCount }, (_, idx) => ({
    id: `r${idx + 1}`,
    type: roomType,
    name: null,
  }));

  const diveDateList =
    diverCount > 0 && diveFrom && diveTo ? datesBetweenInclusive(diveFrom, diveTo) : [];

  const mealsIncluded =
    (trip.meals?.value ?? "full_board") === "full_board" ||
    trip.meals?.value === "half_board";
  const hasTransport = transportType !== "none";
  const courseInfo = courseAssignment(trip);
  const courses = courseInfo.assignable ? courseInfo.courses : [];

  // Unstated count: fill room after room in order, as the source's `splitRoomsByCapacity` does, so
  // what we store is what their POST would have made of it. Stated count: spread evenly.
  const roomIndexFor = (idx: number): number =>
    statedRooms ? idx % rooms.length : Math.min(Math.floor(idx / cap), rooms.length - 1);

  const providedNames = trip.guestNames?.value ?? [];
  const guests: BffGuest[] = Array.from({ length: guestCount }, (_, idx) => {
    const isDiver = idx < diverCount;
    const assignedRoom = rooms[roomIndexFor(idx)]!;
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
export interface PrecheckOptions {
  /** Manila "YYYY-MM-DD". Defaults to today. */
  today?: string;
  /** Their rule (Q-012): staff may open a record with a check-in in the past; every other role may not. */
  role?: "guest" | "agent" | "instructor" | "staff";
}

export function validateBffTripPrecheck(
  bffTrip: BffTrip,
  caps: RoomCaps = DEFAULT_ROOM_CAPS,
  opts: PrecheckOptions = {},
): BffValidationIssue[] {
  const issues: BffValidationIssue[] = [];

  if (bffTrip.checkIn && (opts.role ?? "guest") !== "staff" && bffTrip.checkIn < (opts.today ?? manilaToday())) {
    issues.push({ code: "checkin-in-past", fields: ["checkIn"], level: "error" });
  }

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

  // Capacity (source Q-019: no extra beds). Their POST splits an over-full room; PATCH and commit
  // refuse it with 422 `room-over-capacity`, so the studio has to show it before that call. The peak
  // night is counted the way they count it: a guest is in the room on nights [arrive, depart).
  for (const room of bffTrip.rooms) {
    const cap = caps[room.type];
    if (!room.id || cap === undefined) continue;
    const stays: { index: number; start: string; end: string }[] = [];
    bffTrip.guests.forEach((g, index) => {
      if (g.roomId !== room.id) return;
      const start = g.arrive && g.arrive > bffTrip.checkIn! ? g.arrive : bffTrip.checkIn!;
      const end = g.depart && g.depart < bffTrip.checkOut! ? g.depart : bffTrip.checkOut!;
      if (start < end) stays.push({ index, start, end });
    });
    let peak: { date: string; present: number[] } | null = null;
    for (const date of [...new Set(stays.map((x) => x.start))].sort()) {
      const present = stays.filter((x) => x.start <= date && date < x.end).map((x) => x.index);
      if (peak === null || present.length > peak.present.length) peak = { date, present };
    }
    if (peak && peak.present.length > cap) {
      issues.push({
        code: "room-over-capacity",
        fields: peak.present.map((i) => `guests[${i}].roomId`),
        level: "error",
        params: { roomId: room.id, date: peak.date, n: peak.present.length, cap },
      });
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

  // The payload this envelope describes WILL carry a dive window, because `buildBffTrip()` fills
  // one to satisfy the contract. When the guest never gave those dates, that window — and the
  // per-diver-per-day dive charge computed from it — is the pipeline's guess, not an answer. This
  // is the reason that says so out loud instead of letting it read as `auto_estimate_ready`.
  if (diveWindowIsGuessed(trip)) {
    manualReviewReasons.push("dive_window_not_stated");
  }

  if (trip.specialRequests?.value) {
    manualReviewReasons.push("guest_special_requests_present");
  }

  // The engine's guests carry `meals` as true or false. Half board is neither, and the payload used to
  // say true — priced as full board. It is a staff decision, not a value to send silently.
  if (trip.meals?.value === "half_board") {
    manualReviewReasons.push("meal_plan_needs_staff");
  }

  // A course named in the notes with no way to tell who takes it.
  if (!courseAssignment(trip).assignable) {
    manualReviewReasons.push("course_assignee_unclear");
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
  // Their `divers-over-guests`. `buildBffTrip` cannot carry more divers than guests (a guest either dives
  // or does not), so this is read off the Trip, where the number the guest said still is.
  if (
    typeof trip.divers?.value === "number" &&
    typeof trip.guests?.value === "number" &&
    trip.divers.value > trip.guests.value
  ) {
    bffValidationIssues.push({ code: "divers-over-guests", fields: ["divers"], level: "error" });
  }
  const hasBffErrors = bffValidationIssues.some((i) => i.level === "error");
  if (hasBffErrors) {
    manualReviewReasons.push("bff_validation_error");
  }
  // The engine's own limits (guests <= 40, rooms <= 30, a name <= 120 characters). `buildBffTrip` has to
  // cut to them to stay a valid Trip, and a quotation priced on the cut is a quotation for a smaller
  // group than the guest wrote — so anything over goes to a person instead of being priced as-is.
  if ((trip.guests?.value ?? 0) > 40 || (trip.rooms?.value ?? 0) > 30) {
    manualReviewReasons.push("group_exceeds_engine_limit");
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
