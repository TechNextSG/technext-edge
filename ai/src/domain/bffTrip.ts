/* The Trip payload the BFF sends to Odoo, as the extractor names it.
 *
 * The shape is not ours: it is `@casa/contracts` (TripSchema, hand-written from Phillip's spec and
 * held to it by contracts/test/trip-zod.test.ts). These are aliases, so the extractor keeps one
 * vocabulary (`BffTrip`, `BffGuest`, …) without a second copy of the schema that could drift.
 *
 * The precheck codes below ARE the extractor's own: they mirror the 422s `bff/src/trip/fill.ts` and
 * `bff/src/trip/validate.ts` would return, so a draft that is going to be refused is caught before
 * the BFF is called. They are not an Odoo contract. */
import { z } from 'zod';
import {
  TripSchema,
  GuestSchema,
  RoomSchema,
  DayPlanEntrySchema,
  CourseTypeSchema,
  RoomTypeSchema,
  CustomItemSchema,
  VanMetaSchema,
  type TripShape,
  type GuestShape,
} from '@casa/contracts';

export const BffTrip = TripSchema;
export type BffTrip = TripShape;
export const BffGuest = GuestSchema;
export type BffGuest = GuestShape;
export const BffRoom = RoomSchema;
export type BffRoom = z.infer<typeof RoomSchema>;
export const BffDayPlanEntry = DayPlanEntrySchema;
export type BffDayPlanEntry = z.infer<typeof DayPlanEntrySchema>;
export const BffCourseCode = CourseTypeSchema;
export type BffCourseCode = z.infer<typeof CourseTypeSchema>;
export const BffRoomType = RoomTypeSchema;
export type BffRoomType = z.infer<typeof RoomTypeSchema>;
export const BffCustomItem = CustomItemSchema;
export type BffCustomItem = z.infer<typeof CustomItemSchema>;
export const BffVanMetaEntry = VanMetaSchema;
export type BffVanMetaEntry = z.infer<typeof VanMetaSchema>;

export const BffValidationCode = z.enum([
  'checkout-not-after-checkin',
  'checkin-in-past',
  'dive-window-reversed',
  'dive-window-outside-stay',
  'dive-days-outside-window',
  'arrive-depart-outside-stay',
  'room-over-capacity',
  'divers-over-guests',
  'room-empty',
  'missing-mandatory-field',
]);
export type BffValidationCode = z.infer<typeof BffValidationCode>;

export const BffSaneIssueCode = z.enum([
  'dive-revenue-zero',
  'dive-dates-outside-window',
  'transport-revenue-zero',
  'room-revenue-zero',
]);
export type BffSaneIssueCode = z.infer<typeof BffSaneIssueCode>;

export interface BffValidationIssue {
  code: BffValidationCode;
  fields: string[];
  level: 'error' | 'warn';
  /** `room-over-capacity` only: which room, the busiest night, how many, and the cap. */
  params?: { roomId: string; date: string; n: number; cap: number };
}
