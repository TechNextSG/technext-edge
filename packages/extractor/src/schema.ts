// PLACEHOLDER — this is not Phillip's schema. Casa Edge Playbook says Trip must
// match his OpenAPI contract exactly ("no columns split out of the Odoo payload").
// Swap this file for the generated type the day contracts/casa/estimate-api.v1.yaml
// freezes. Shape here is a best guess from the Blueprint/Playbook prose only,
// enough to unblock the extractor pipeline and its tests.

import { z } from "zod";

export const FieldState = z.enum([
  "stated", // model found it verbatim in the message
  "inferred", // model derived it from context, no exact quote
  "default", // house norm applied because it was one of the 4 allowed fields
  "derived", // computed in code from other fields (e.g. checkOut from nights)
  "missing", // not found, not defaultable — becomes a question
]);
export type FieldState = z.infer<typeof FieldState>;

function field<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value: value.nullable(),
    state: FieldState,
    // Verbatim substring of the source message. Playbook eval requires this to be
    // an exact substring 100% of the time when state is "stated" — checked in code,
    // not by a judge. Null for "missing", and normally null for "default".
    evidence: z.string().nullable(),
  });
}
export type Field<T> = { value: T | null; state: FieldState; evidence: string | null };

export const MealPlan = z.enum(["full_board", "half_board", "room_only", "none"]);

// Fields aligned with Odoo Estimate API (estimate-api.v1.json):
export const GuestType = z.enum(["retail", "agent", "instructor"]);
export type GuestType = z.infer<typeof GuestType>;

export const TransportType = z.enum(["none", "roundtrip", "oneway"]);
export type TransportType = z.infer<typeof TransportType>;

export const Trip = z.object({
  // Vietnamese was removed from this project on 2026-09-24 (see normalize.ts and
  // questions.ts): the resort receives English and Chinese enquiries.
  language: field(z.enum(["en", "zh"])),
  checkIn: field(z.string()), // ISO date, resolved in code — never trust a relative date from the model
  checkOut: field(z.string()), // ISO date — usually "derived" from checkIn + nights
  nights: field(z.number().int().positive()),
  guests: field(z.number().int().positive()),
  rooms: field(z.number().int().positive()),
  meals: field(MealPlan),
  transport: field(z.boolean()), // airport van round trip requested
  contactName: field(z.string()),

  // Tier 2 fields from Odoo API Field Guide (missing causes silent pricing error):
  guestType: field(GuestType).optional(), // retail (default) | agent (30% discount) | instructor
  transportType: field(TransportType).optional(), // none | roundtrip | oneway
  diveFrom: field(z.string()).optional(), // ISO date start of dive window (vital for dive charges)
  diveTo: field(z.string()).optional(), // ISO date end of dive window (vital for dive charges)
  diver: field(z.boolean()).optional(), // true if group includes certified divers or dive courses
  // How many of the party actually dive — routinely fewer than `guests` ("2 certified divers
  // + grandma + 2 snorkelling kids" is 5 guests and 2 divers). `diver` only answers whether
  // anyone dives at all, which is not a number the dive line can be priced from: without this
  // the estimate has to guess between 2 and 5, and guessing 5 overcharges by 150%. `diveNotes`
  // keeps the guest's own wording when the plan varies per person; this keeps the number.
  divers: field(z.number().int().positive()).optional(),
  diveNotes: field(z.string()).optional(), // specific notes about diver schedule / breakdown (e.g. "1 diver day 1, 5 divers both days")
  specialRequests: field(z.string()).optional(), // special requirements or custom notes (e.g. "3 day visitors")
  guestNames: field(z.array(z.string())).optional(), // optional voluntary guest roster if provided by booker
});
export type Trip = z.infer<typeof Trip>;

// The exactly-4 fields the pipeline is allowed to default via house norms
// (Playbook: "apply house norms to exactly the four fields allowed to default").
// PLACEHOLDER — confirm the real 4 with Jett/Eloa before the eval run; guessed
// wrong, this list silently mislabels real "missing" fields as "default".
export const HOUSE_NORM_FIELDS = ["meals", "transport", "rooms", "language"] as const;

