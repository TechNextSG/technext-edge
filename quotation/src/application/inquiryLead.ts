import type { Trip } from "../../../ai/src/index.ts";
import { buildBffTrip, courseAssignment } from "../../../ai/src/index.ts";

/**
 * The shape of the customer's website enquiry (their F10, `bff/src/inquiry/types.ts` on
 * `Stage1_Estimator_Tools@5fe2806`): the part a guest fills in on the Casa site, without the contact
 * columns (`name`, `email`, `phone`), the lead id and the timestamp, which are theirs to add.
 *
 * The column list is written out in `customerRules.test.ts` (`INQUIRY_LEAD`).
 * Their own comment on it: "assumed = InquiryRequest (OpenAPI Odoo) + lead_id + created_at; waiting for
 * Phillip (B-043)" — so the shape can still move; `npm run upstream:check` shows when it does.
 */
export interface InquiryLead {
  totalGuests: number | null;
  rooms: { type: "standard" | "deluxe" | "suite"; pax: number }[];
  mealPlan: "full_board" | "room_only" | null;
  airportTransfer: "yes" | "no" | null;
  divers: number | null;
  coursesInterest: "yes" | "no" | null;
  message: string | null;
}

/**
 * Prepares an enquiry from a `Trip` in their F10 shape. **Nothing calls Odoo with it**: the customer's rule
 * is that this side never talks to Odoo directly, and their BFF route for it does not exist yet
 * (`GET /api/staff/inquiries` is "waiting for Phillip"). It is data prepared for the day that route is
 * opened, and the proposed hand-over path — see `docs/notes/lead-extractor-duplication.md`.
 *
 * Only what the guest said goes in. A value the guest never gave is `null`, never a guess: half board has
 * no place in their `mealPlan` (`full_board | room_only`), so it is `null` here and the words travel in
 * `message` instead.
 */
export function toInquiryLead(trip: Trip): InquiryLead {
  const bff = buildBffTrip(trip);
  const paxByRoom = new Map<string, number>();
  for (const guest of bff.guests) {
    if (guest.roomId) paxByRoom.set(guest.roomId, (paxByRoom.get(guest.roomId) ?? 0) + 1);
  }
  const rooms = bff.rooms
    .filter((room) => room.id && (paxByRoom.get(room.id) ?? 0) > 0)
    .map((room) => ({ type: room.type, pax: paxByRoom.get(room.id!)! }));

  const meals = trip.meals?.value;
  const mealPlan = meals === "full_board" ? "full_board" : meals === "room_only" || meals === "none" ? "room_only" : null;

  const transferStated =
    trip.transport?.state === "stated" || (trip.transportType?.state === "stated" && trip.transportType.value !== null);
  const airportTransfer = !transferStated
    ? null
    : trip.transport?.value === false || trip.transportType?.value === "none"
      ? "no"
      : "yes";

  const divers = trip.diver?.value === true ? (trip.divers?.value ?? null) : trip.diver?.value === false ? 0 : null;

  const message = [trip.specialRequests?.value, trip.dietNotes?.value].filter(Boolean).join("; ") || null;

  return {
    totalGuests: trip.guests?.value ?? null,
    rooms,
    mealPlan,
    airportTransfer,
    divers,
    coursesInterest: courseAssignment(trip).courses.length > 0 ? "yes" : null,
    message,
  };
}
