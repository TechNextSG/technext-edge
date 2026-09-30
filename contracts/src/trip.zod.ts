// The BFF / Odoo Estimate API contract: the payload `POST /api/estimates` accepts.
//
// This is ours to mirror, not ours to design. The source of truth is the upstream
// `contracts/src/trip.zod.ts`; `bff-contract/contract-spec.mjs` pins the commit it was read from and
// the parity test in quotation/ fails when the two drift. Nothing in here may depend on the AI
// extractor, so the AI package, the quotation package and the BFF can all import it.

import { z } from "zod";

// Fields aligned with Odoo Estimate API (estimate-api.v1.json):
export const GuestType = z.enum(["retail", "agent", "instructor"]);
export type GuestType = z.infer<typeof GuestType>;

export const TransportType = z.enum(["none", "roundtrip", "oneway"]);
export type TransportType = z.infer<typeof TransportType>;

// ============================================================================
// P5 BFF & Odoo Estimate API Official Contract (`contracts/src/trip.zod.ts`)
// Handed off 2026-09-25 (`feat/p2-booking` / `docs/specs/06-p5-bff-schema-contract.md`)
// ============================================================================

export const BffRoomType = z.enum(["standard", "deluxe", "suite"]);
export type BffRoomType = z.infer<typeof BffRoomType>;

export const BffCourseCode = z.enum(["dsd", "refresher", "ow", "aow", "rescue"]);
export type BffCourseCode = z.infer<typeof BffCourseCode>;

export const BffDayPlanEntry = z.object({
  dive: z.boolean().default(false),
  third: z.boolean().default(false),
  night: z.boolean().default(false),
  boatId: z.string().max(120).nullable().default(null),
});
export type BffDayPlanEntry = z.infer<typeof BffDayPlanEntry>;

export const BffRoom = z.object({
  id: z.string().max(120).nullable().default(null),
  type: BffRoomType.default("standard"),
  name: z.string().max(120).nullable().default(null),
});
export type BffRoom = z.infer<typeof BffRoom>;

const str120 = z.string().max(120);

const vanRef = z
  .preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    str120.nullable()
  )
  .default(null);

export const BffGuest = z.object({
  id: str120.nullable().default(null),
  name: str120.default("Guest"),
  /** Crucial: Odoo defaults missing `diver` to true! Non-divers MUST explicitly pass `false`. */
  diver: z.boolean(),
  meals: z.boolean().default(true),
  transport: z.boolean().default(true),
  foc: z.boolean().default(false),
  /** ★ Mandatory: must reference an existing `rooms[].id`. */
  roomId: str120.nullable(),
  courses: z.array(BffCourseCode).max(5).default([]),
  /** ★ Mandatory when `diver === true` (>=1 date key within [diveFrom, diveTo]); `{}` when `diver === false`. */
  days: z.record(z.string(), BffDayPlanEntry).default({}),
  // `.default(null)`, not `.optional()`: upstream fills these with null, so an omitted
  // key and an explicit null are the same value there. Keeping them optional here would
  // let a payload reach the BFF with the key absent, which is a shape difference the
  // vendored parity test deliberately rejects.
  arrive: str120.nullable().default(null),
  depart: str120.nullable().default(null),
  comment: z.string().max(500).nullable().default(null),
  vanA: vanRef,
  vanD: vanRef,
});
export type BffGuest = z.infer<typeof BffGuest>;

export const BffCustomItem = z.object({
  id: str120.nullable().default(null),
  name: str120.nullable().default(null),
  price: z.number().min(0).default(0),
  qty: z.number().min(1).default(1),
  mode: str120.nullable().default(null),
  date: str120.nullable().default(null),
  dateTo: str120.nullable().default(null),
  gids: z.array(z.string()).default([]),
});
export type BffCustomItem = z.infer<typeof BffCustomItem>;

export const BffVanMetaEntry = z.object({
  date: str120.nullable().default(null),
  time: str120.nullable().default(null),
  price: z.number().nullable().default(null),
  foc: z.boolean().default(false),
});

/**
 * The exact `Trip` payload accepted by `POST /api/estimates` and `PATCH /api/estimates/:id`
 * (`contracts/src/trip.zod.ts` + `bff/src/trip/fill.ts`).
 *
 * 6 mandatory groups enforced by `fillTrip` (422 if missing):
 * 1. `guestType` ("retail" | "agent" | "instructor")
 * 2. `transportType` ("none" | "roundtrip" | "oneway")
 * 3. `checkIn`, `checkOut` ("YYYY-MM-DD", non-null)
 * 4. `diveFrom`, `diveTo` ("YYYY-MM-DD", non-null when >= 1 guest has `diver: true`)
 * 5. `guests[i].roomId` (must match one of `rooms[].id`)
 * 6. `guests[i].days` (>= 1 key within `[diveFrom, diveTo]` when `diver: true`)
 */
export const BffTrip = z.object({
  label: z.string().max(120).nullable().default(null),
  guestType: GuestType,
  transportType: TransportType,
  checkIn: z.string().max(120).nullable(),
  checkOut: z.string().max(120).nullable(),
  diveFrom: z.string().max(120).nullable(),
  diveTo: z.string().max(120).nullable(),
  bookedDaysAhead: z.number().int().nonnegative().default(0),
  rooms: z.array(BffRoom).max(30).default([]),
  guests: z.array(BffGuest).max(40).default([]),
  items: z.array(BffCustomItem).max(50).default([]),
  vanSplit: z.enum(["equal", "vehicle"]).nullable().default(null),
  vanMeta: z.record(z.string(), BffVanMetaEntry).default({}),
  extraDMByDay: z.record(z.string(), z.string()).default({}),
  dmByDay: z.record(z.string(), z.string()).default({}),
});
export type BffTrip = z.infer<typeof BffTrip>;

export const BffValidationCode = z.enum([
  "checkout-not-after-checkin",
  "checkin-in-past",
  "dive-window-reversed",
  "dive-window-outside-stay",
  "dive-days-outside-window",
  "arrive-depart-outside-stay",
  "room-over-capacity",
  "divers-over-guests",
  "room-empty",
  "missing-mandatory-field",
]);
export type BffValidationCode = z.infer<typeof BffValidationCode>;

export const BffSaneIssueCode = z.enum([
  "dive-revenue-zero",
  "dive-dates-outside-window",
  "transport-revenue-zero",
  "room-revenue-zero",
]);
export type BffSaneIssueCode = z.infer<typeof BffSaneIssueCode>;

export interface BffValidationIssue {
  code: BffValidationCode;
  fields: string[];
  level: "error" | "warn";
  /** `room-over-capacity` only: which room, the busiest night, how many, and the cap. */
  params?: { roomId: string; date: string; n: number; cap: number };
}


