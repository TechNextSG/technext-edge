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

export const Trip = z.object({
  language: field(z.enum(["vi", "en", "zh"])),
  checkIn: field(z.string()), // ISO date, resolved in code — never trust a relative date from the model
  checkOut: field(z.string()), // ISO date — usually "derived" from checkIn + nights
  nights: field(z.number().int().positive()),
  guests: field(z.number().int().positive()),
  rooms: field(z.number().int().positive()),
  meals: field(MealPlan),
  transport: field(z.boolean()), // airport van round trip requested
  contactName: field(z.string()),
});
export type Trip = z.infer<typeof Trip>;

// The exactly-4 fields the pipeline is allowed to default via house norms
// (Playbook: "apply house norms to exactly the four fields allowed to default").
// PLACEHOLDER — confirm the real 4 with Jett/Eloa before the eval run; guessed
// wrong, this list silently mislabels real "missing" fields as "default".
export const HOUSE_NORM_FIELDS = ["meals", "transport", "rooms", "language"] as const;
