import { randomUUID } from "node:crypto";
import type { Trip } from "../../../../ai/src/index.ts";
import type { BffTrip } from "../../../../ai/src/index.ts";
import type { StaffTripEdit } from "../domain/tripDiff.ts";
import type { ExtractProvider } from "../../../../ai/src/index.ts";
import { getStaffAlerts, diveWindowIsGuessed } from "../../../../ai/src/index.ts";
import { buildBffTrip, datesBetweenInclusive } from "../../../../ai/src/index.ts";
import { verifyGuestFacingText, withBudget, type GuestFacingFacts } from "../../../../ai/src/index.ts";
import { quotationValidityLines, quotationValidUntil } from "../domain/quotationValidity.ts";
import {
  roomNightlyRate,
  diveTierPrice,
  MEAL_RATE,
  TRANSPORT_RATE,
  ROOM_TYPE_LABELS,
  vansForGuests,
  type RoomType,
} from "../domain/rates.ts";
import type {
  QuotationLineItem,
  QuotationSubmissionState,
  QuotationContact,
  QuotationSubmission,
  HonoQuotationDraft,
  QuotationEstimatorState,
  HonoToolCallTrace,
} from "../domain/quotationDraft.ts";

export type {
  QuotationLineItem,
  QuotationSubmissionState,
  QuotationContact,
  QuotationSubmission,
  HonoQuotationDraft,
  QuotationEstimatorState,
  HonoToolCallTrace,
};

/**
 * The link to show the guest and to put in the message: our copy when their app lost the link,
 * otherwise theirs. One place, so the studio, the message and the send guard cannot disagree about
 * which link the guest is holding.
 */
export function guestLinkFor(draft: HonoQuotationDraft): string | null {
  return draft.estimator?.mirrorUrl ?? draft.estimator?.guestUrl ?? null;
}

/**
 * Native Gemini / OpenAI Function Declaration for Tool Calling to Hono.
 */
export const SUBMIT_QUOTATION_TO_HONO_DECLARATION = {
  name: "submit_quotation_to_hono",
  description:
    "Calls the Hono Quotation Service to create an editable quotation table and shareable quotation link. Hono staff can edit any line item, price, discount, or URL slug and confirm to send back to the AI.",
  parameters: {
    type: "OBJECT",
    properties: {
      guestName: { type: "STRING", description: "Contact name of the guest" },
      checkIn: { type: "STRING", description: "ISO check-in date YYYY-MM-DD" },
      checkOut: { type: "STRING", description: "ISO check-out date YYYY-MM-DD" },
      nights: { type: "INTEGER", description: "Number of overnight stays" },
      stayingGuests: { type: "INTEGER", description: "Number of guests staying overnight at the resort" },
      totalGroupSize: { type: "INTEGER", description: "Total people in the group including day-trippers/divers" },
      rooms: { type: "INTEGER", description: "Number of resort rooms required" },
      mealPlan: { type: "STRING", description: "full_board, half_board, room_only, or none" },
      diver: { type: "BOOLEAN", description: "Whether the group is diving" },
      divers: { type: "INTEGER", description: "Number of divers if uniform across all days" },
      diveNotes: { type: "STRING", description: "Split-day or custom diving schedule notes" },
      // The three values the contract actually accepts. This said "agent, instructor, or
      // regular" — "regular" appears nowhere in the Trip schema, so a model filling the slot
      // from the description could only produce a value Odoo has no branch for. The contract's
      // word for a direct guest is "retail".
      guestType: { type: "STRING", description: "retail, agent, or instructor" },
    },
    required: ["checkIn", "nights", "stayingGuests"],
  },
} as const;

export function recalculateQuotationTotals(draft: HonoQuotationDraft): HonoQuotationDraft {
  const updatedItems = draft.lineItems.map((item) => {
    const subtotal = Math.round(item.quantity * item.multiplier * item.unitPrice);
    return { ...item, subtotal };
  });
  const subtotalAmount = updatedItems.reduce((sum, item) => sum + item.subtotal, 0);
  // The only discount in the customer's model is the partner/agency rate, and the field guide
  // is explicit that it is "30% off rooms" — meals are "never guest-type discounted". So the
  // discount is computed against the ROOM lines only, not the whole table.
  const roomSubtotal = updatedItems
    .filter((item) => item.category === "room")
    .reduce((sum, item) => sum + item.subtotal, 0);
  const discountPercent = Math.max(0, Math.min(100, Number(draft.discountPercent) || 0));
  const discountAmount = Math.round(roomSubtotal * (discountPercent / 100));
  const totalAmount = Math.max(0, subtotalAmount - discountAmount);

  return {
    ...draft,
    lineItems: updatedItems,
    discountPercent,
    subtotalAmount,
    discountAmount,
    totalAmount,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Does this note belong on a CUSTOMER's page?
 *
 * `staffNotes` is printed on the guest's quotation page and in the confirmed WhatsApp reply, and
 * drafts saved before 2026-09-25 carry a default that talks about our own workflow
 * ("Standard resort quotation draft ready for Hono confirmation.", or for a split-day plan
 * "Custom split-day dive arrangement noted: … Verify boat manifest before confirming."). New
 * drafts default to "" — this drops the known-bad stored values on the way out, so a guest who
 * opens an OLD link does not read our internal to-do list. A migration shim, not a policy: real
 * staff notes pass through untouched.
 */
const LEGACY_INTERNAL_STAFF_NOTES = new Set(["Standard resort quotation draft ready for Hono confirmation."]);

export function guestSafeStaffNotes(staffNotes: string | undefined): string {
  const note = (staffNotes ?? "").trim();
  if (!note) return "";
  if (LEGACY_INTERNAL_STAFF_NOTES.has(note)) return "";
  if (note.startsWith("Custom split-day dive arrangement noted:")) return "";
  return note;
}

/**
 * Builds the initial Editable Quotation Draft (`HonoQuotationDraft`) from a verified Trip.
 * Automatically parses split-day diving schedules in `diveNotes` into separate editable rows!
 */
export function buildHonoQuotationDraft(
  trip: Trip,
  baseUrl = "https://technext-edge-casa-bff.vercel.app",
  existingQuoteId?: string,
  phone?: string
): HonoQuotationDraft {
  const guestName = trip.contactName.value ?? "Valued Guest";
  // No invented dates: a trip without them yields an empty range, which the pre-flight reports as
  // `missing-mandatory-field` instead of a quotation for 10-12 October nobody asked for.
  const checkIn = trip.checkIn.value ?? "";
  const checkOut = trip.checkOut.value ?? "";
  const nights = trip.nights.value ?? 0;
  const stayingGuests = trip.guests.value ?? 2;
  const rooms = trip.rooms.value ?? Math.max(1, Math.ceil(stayingGuests / 2));
  const mealPlan = trip.meals?.value ?? "full_board";
  const diver = trip.diver?.value === true || (trip.diveNotes?.state !== "missing" && Boolean(trip.diveNotes?.value));
  const divers = trip.divers?.value ?? null;
  const diveNotes = trip.diveNotes?.value ?? null;
  const guestType = trip.guestType?.value ?? null;

  const cleanName = guestName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "CASA";
  const dateCompact = checkIn.replace(/-/g, "").slice(4);
  // 2 random characters were not enough: the id itself is fine behind the staff token, but
  // the guest slug below is served by `/q/:slug` with NO credential, so a slug derived from
  // the id (date + guest's own name + 2 chars) let anyone who knows the guest's name walk to
  // their quotation. The slug is now a credential — 122 bits from the platform CSPRNG, and
  // never rebuilt from booking data.
  const quoteId =
    existingQuoteId ?? `QT-${dateCompact}-${cleanName}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const slug = randomUUID();

  const bffTrip = buildBffTrip(trip);

  const lineItems: QuotationLineItem[] = [];

  // 1. Rooms — the customer's per-night room rate for each room's occupancy, summed over the stay.
  // buildBffTrip assigns guests to rooms round-robin (standard rooms), so the occupancy that Odoo
  // will price is read back off it — the draft prices the same thing the payload sends.
  const occupancyByRoom = new Map<string, number>();
  for (const guest of bffTrip.guests) {
    if (guest.roomId) occupancyByRoom.set(guest.roomId, (occupancyByRoom.get(guest.roomId) ?? 0) + 1);
  }
  let roomPerNight = 0;
  let chargedRooms = 0;
  // Which room types this line actually charges for, in the order they were booked. The description
  // used to be the fixed string "Standard Room (Twin / Double Occupancy)" beside whatever rate the
  // booked rooms produced, so a deluxe booking showed a standard room carrying a deluxe unit price —
  // caught on production, on a reference quotation used to argue that the arithmetic was trustworthy.
  const chargedRoomTypes: RoomType[] = [];
  for (const room of bffTrip.rooms) {
    const occupancy = occupancyByRoom.get(room.id ?? "") ?? 0;
    if (occupancy > 0) {
      roomPerNight += roomNightlyRate(room.type as RoomType, occupancy);
      chargedRooms += 1;
      chargedRoomTypes.push(room.type as RoomType);
    }
  }
  const distinctRoomTypes = [...new Set(chargedRoomTypes)];
  const roomDescription =
    distinctRoomTypes.length === 0
      ? "Room (Twin / Double Occupancy)"
      : distinctRoomTypes.length === 1
        ? `${ROOM_TYPE_LABELS[distinctRoomTypes[0]!]} (Twin / Double Occupancy)`
        : // More than one type booked: the unit price below is an average of them, and saying so is
          // the difference between a summary and a wrong statement about the rate.
          `${distinctRoomTypes.map((type) => ROOM_TYPE_LABELS[type]).join(" + ")} (average rate)`;
  lineItems.push({
    id: "item-rooms",
    category: "room",
    description: roomDescription,
    quantity: chargedRooms || rooms,
    unitLabel: "rooms",
    multiplier: nights,
    multiplierLabel: "nights",
    unitPrice: chargedRooms ? Math.round(roomPerNight / chargedRooms) : roomNightlyRate("standard", 1),
    subtotal: roomPerNight * nights,
  });

  // 2. Meals — flat per person per day, never guest-type discounted. The customer has no
  // half-board rate, and buildBffTrip sends both full_board and half_board as `meals: true`, so
  // half-board is priced at the full-board rate until a real half-board price exists.
  if (mealPlan === "full_board" || mealPlan === "half_board") {
    const mealLabel =
      mealPlan === "half_board"
        ? "Half-Board Dining Package"
        : "Full-Board Dining Package (Breakfast, Lunch & Dinner)";
    lineItems.push({
      id: "item-meals",
      category: "meals",
      description: mealLabel,
      quantity: stayingGuests,
      unitLabel: "staying guests",
      multiplier: nights,
      multiplierLabel: "days",
      unitPrice: MEAL_RATE,
      subtotal: stayingGuests * nights * MEAL_RATE,
    });
  }

  // 3. Diving — one line per dive DAY, at the tier price for the divers-out that day (see
  // rates.ts). Priced only when the window is STATED (not guessed) and the head count is uniform.
  // A split-day plan (`diveNotes` while `divers` is missing) carries no invented price: it is
  // routed to staff by NEVER-RE-ASK and surfaced as a staff alert, exactly as before.
  let totalGroupSize = stayingGuests;
  if (diver) {
    const note = diveNotes ?? "";
    // `(?<!\d)`: a count starts where the digit run starts, so a long run is not re-scanned from each
    // digit in it (CodeQL js/polynomial-redos). Same first match and capture.
    const day1Match = note.match(/(?<!\d)(\d+)\s*(?:person|people|pax|diver|divers)\s*dives?\s*(?:on\s*)?day\s*1/i);
    const bothDaysMatch = note.match(/(?<!\d)(\d+)\s*(?:person|people|pax|diver|divers)\s*dives?\s*(?:on\s*)?(?:both\s*days|all\s*days|2\s*days)/i);
    if (day1Match && bothDaysMatch) {
      totalGroupSize = Math.max(stayingGuests, Number(day1Match[1]) + Number(bothDaysMatch[1]));
    } else if (typeof divers === "number") {
      totalGroupSize = Math.max(stayingGuests, divers);
    }

    if (typeof divers === "number" && divers > 0 && !diveWindowIsGuessed(trip)) {
      const from = trip.diveFrom?.value as string | null;
      const to = trip.diveTo?.value as string | null;
      const diveDates = from && to ? datesBetweenInclusive(from, to) : [];
      for (const date of diveDates) {
        const rate = diveTierPrice(divers);
        lineItems.push({
          id: `item-dive-${date}`,
          category: "diving",
          description: `Anilao Boat Dives — ${date}`,
          quantity: divers,
          unitLabel: "divers",
          multiplier: 1,
          multiplierLabel: "day",
          unitPrice: rate,
          subtotal: divers * rate,
        });
      }
    }
  }

  // 4. Airport transfer — a per-van price, not per guest, and more than one van once the group is
  //    bigger than a van carries. It used to be `quantity: 1` for every group, so a 10-guest trip was
  //    drafted with a single van and the engine's answer arrived thousands of pesos higher — the draft
  //    exists to be the engine's own answer, and a fixed one-van line cannot be that for a big group.
  if (trip.transport?.value === true) {
    const oneWay = trip.transportType?.value === "oneway";
    const rate = oneWay ? TRANSPORT_RATE.oneway : TRANSPORT_RATE.roundtrip;
    // Who is actually riding: the per-guest flag when the record has one (that is what the payload
    // sends), and the party size when nobody is flagged — a transfer asked for but not assigned is
    // still a van.
    const riding = bffTrip.guests.filter((guest) => guest.transport).length || stayingGuests;
    const vans = vansForGuests(riding);
    const label = oneWay ? "One Way" : "Round-Trip";
    lineItems.push({
      id: "item-transfer",
      category: "transfer",
      description: `Private Van Transfer (${label}${vans > 1 ? `, ${vans} vans` : ""})`,
      quantity: vans,
      unitLabel: vans === 1 ? "van" : "vans",
      multiplier: 1,
      multiplierLabel: "trip",
      unitPrice: rate,
      subtotal: rate * vans,
    });
  }

  // No discount from what the guest typed. A partner rate is the customer's engine answering an agent
  // who signed in with their own key; "we are a travel agency" in a WhatsApp message is not that. The
  // enquiry is held for staff instead (`partner_rate_confirmation_required`).
  const discountPercent = 0;
  const now = new Date().toISOString();

  const draft: HonoQuotationDraft = {
    quoteId,
    slug,
    status: "pending_hono_review",
    createdAt: now,
    updatedAt: now,
    phone,
    guestName,
    checkIn,
    checkOut,
    nights,
    stayingGuests,
    totalGroupSize,
    // The rooms the payload actually carries; a stated count is kept as stated.
    rooms: trip.rooms.state === "stated" ? rooms : bffTrip.rooms.length,
    mealPlan,
    diver,
    divers,
    diveNotes,
    specialRequests: trip.specialRequests?.value ?? null,
    dietNotes: trip.dietNotes?.value ?? null,
    transferDirection: trip.transferDirection?.value ?? null,
    guestType,
    currency: "PHP",
    discountPercent,
    lineItems,
    subtotalAmount: 0,
    discountAmount: 0,
    totalAmount: 0,
    quotationUrl: `${baseUrl}/q/${slug}`,
    honoEditorUrl: `${baseUrl}/quotes/${quoteId}`,
    // Empty by default, and it has to stay guest-safe: `staffNotes` is printed on the guest's
    // quotation page and in the confirmed WhatsApp reply ("📝 Resort Note"). It used to default to
    // internal wording — "Standard resort quotation draft ready for Hono confirmation" and, for a
    // split-day plan, "Verify boat manifest before confirming" — which shipped our own workflow,
    // and a to-do for our staff, onto the customer's page. The split-day signal staff need is
    // `staffAlerts` below, which is deliberately phrased for both audiences.
    staffNotes: "",
    staffAlerts: getStaffAlerts(trip, "en"),
    // The Odoo/BFF `Trip`, built here and nowhere else, because this is the last point where
    // the full extraction `Trip` still exists. `HonoQuotationDraft` is a lossy view of it —
    // guestType, transportType, diveFrom/diveTo and guestNames have no column here — so a
    // `BffTrip` cannot be reconstructed later from the draft alone, and `buildBffTrip()` is
    // what enforces the 6 mandatory groups `bff/src/trip/fill.ts` rejects with 422. Without
    // this, that validation existed and was tested but no Odoo-bound request ever carried its
    // result, so the contract was correct on paper and absent in production.
    bffTrip,
  };

  return recalculateQuotationTotals(draft);
}

/**
 * How long the greeting may take before the deterministic message goes without it.
 *
 * Shorter than the chat turn's budget on purpose: a staff member is watching this button, and they
 * already know what the message says. Losing the polish costs nothing; making somebody wait does.
 */
const CONFIRMED_GREETING_BUDGET_MS = 3_500;

/**
 * True when this enquiry came from an agent or instructor.
 *
 * F08 (the customer's AI-channel flow): a partner is quoted in the team estimator after signing in
 * with their own key, because only that session gets a partner rate. Our bot holds a guest session, so
 * whatever it prices is the retail figure — publishing that to an agent would quote them the wrong
 * number. Read from the trip that was priced, and from the draft in case the trip is absent.
 */
export function isPartnerEnquiry(draft: Pick<HonoQuotationDraft, "guestType" | "bffTrip">): boolean {
  const type = draft.bffTrip?.guestType ?? draft.guestType;
  return type === "agent" || type === "instructor";
}

/**
 * The facts a guest-facing message must not contradict, read from the trip the engine priced
 * (`bffTrip`), falling back to the draft's own columns when there is none. Feeds `verifyGuestFacingText`.
 * Rooms are left out on purpose: a room *count* in prose is the one figure the studio lets staff change
 * after the fact, and the room *type* is the check that has actually caught a wrong message.
 */
export function guestFacingFactsFor(draft: HonoQuotationDraft): GuestFacingFacts {
  const trip = draft.bffTrip;
  if (!trip) {
    return {
      nights: draft.nights,
      guests: draft.stayingGuests,
      ...(typeof draft.divers === "number" ? { divers: draft.divers } : {}),
      knownDates: new Set([draft.checkIn, draft.checkOut].filter((d) => typeof d === "string" && d !== "")),
    };
  }
  const dates = [trip.checkIn, trip.checkOut].filter((d): d is string => typeof d === "string" && d !== "");
  return {
    ...(trip.checkIn && trip.checkOut ? { nights: datesBetweenInclusive(trip.checkIn, trip.checkOut).length - 1 } : {}),
    guests: trip.guests.length,
    divers: trip.guests.filter((g) => g.diver).length,
    roomTypes: new Set(trip.rooms.map((r) => r.type)),
    knownDates: new Set(dates),
  };
}

/**
 * The message a staff member sends to the guest once the quotation is published.
 *
 * Rewritten after reading what this actually produced on production. It used to list
 * `draft.lineItems` — our own hand-computed price table — under the heading "Confirmed Quotation
 * Breakdown … Total Confirmed Quote", and to fall back to our retired `/q/<slug>` link when nothing
 * had been published. On one real quotation that meant a guest would have been sent ₱38,400 (our
 * arithmetic) beside a line labelled "Standard Room" carrying a deluxe unit price, a link that now
 * answers 410, and the word "Confirmed" for a booking nobody had made. The send was refused by Meta
 * for an unrelated reason (#131030, number not on the test list), which is the only thing that
 * stopped it.
 *
 * Three rules now, and they are the whole point of the rewrite:
 *
 *   1. **No money in this message at all.** The engine's price lives on the customer's own
 *      quotation page, which is what the link opens; a figure repeated in chat is a second source
 *      of the number, and in fixture mode it is a sample figure a guest would read as real.
 *   2. **The link is the published one, or there is no message.** `estimator.guestUrl` is minted by
 *      the team estimator at Publish; our own `/q/<slug>` page is retired and answers 410. The
 *      caller refuses to send without it (route `send-whatsapp`), and this builder never falls back.
 *   3. **"Confirmed" is not a word this message may use.** Approving a quotation is a staff decision
 *      about a price, not a booking; Q-015 is that this system sends no confirmation of anything.
 *      The model's greeting is put through the same fact gate as a chat reply, so a sentence like
 *      "your stay is all confirmed" rolls back to the deterministic text instead of reaching the
 *      guest.
 */
export async function synthesizeConfirmedQuotationReply(
  draft: HonoQuotationDraft,
  provider?: ExtractProvider
): Promise<string> {
  // `guestLinkFor`, not `estimator.guestUrl`: when their app lost the link it issued, the guest is
  // sent our copy of the same revision, and the message has to carry the link that opens.
  const guestLink = guestLinkFor(draft);
  const sample = Boolean(draft.pricing?.sample);
  const note = guestSafeStaffNotes(draft.staffNotes);
  const rooms = draft.bffTrip?.rooms ?? [];

  // The block the guest reads, without a salutation.
  //
  // It used to open with "Hi <name>! Your quotation for…", and the model writes a greeting of its own
  // above it — so the message the guest actually received on production (2026-09-28, read from the
  // body the send route returned) began "Hi Ana Reyes! It's a pleasure to help you start planning…"
  // and then said "Hi Ana Reyes!" again. The greeting belongs to whoever writes it: the model when
  // there is one, and this fallback when there is not.
  const messageBlock = [
    `Your quotation for ${draft.checkIn} to ${draft.checkOut} (${draft.nights} nights) is ready to look at here:`,
    ``,
    // No link yet means this text is being shown as the APPROVAL preview, not sent: the send rebuilds
    // the message from the record once the link exists. Printing "(no link — this quotation has not
    // been published yet)" put a placeholder in front of staff on the approval screen, where the
    // question is not whether a link exists but whether the guest should get one.
    guestLink ?? "(the guest's own link is added when you send this)",
    sample
      ? `\n⚠️ Sample data — not a live quote. These are example figures from our booking engine while it is being set up.`
      : ``,
    note ? `\n📝 ${note}` : ``,
    ``,
    `Open the link to see the full breakdown. If anything looks wrong, just reply here and a member of our team will fix it — nothing is booked yet.`,
    ``,
    // The resort's booking terms, written by code rather than by the model: these are sentences a guest
    // may hold the desk to, so they come from `bookingPolicyLines` — sourced lines only. See it for
    // what is deliberately absent, and why "we are holding your room for 72 hours" is not among them.
    ...quotationValidityLines(quotationValidUntil(draft)).map((line) => `💡 ${line}`),
  ]
    .filter(Boolean)
    .join("\n");

  /** The whole message with no model involved — and the one that greets the guest itself. */
  const deterministicMessage = `Hi ${draft.guestName}! ${messageBlock}`;

  if (!provider?.generateText) {
    return deterministicMessage;
  }

  // What this message may not contradict. `rooms` comes from the trip the engine was actually
  // given, so a greeting that names a different room type is rejected rather than sent.
  const facts: GuestFacingFacts = {
    nights: draft.nights,
    rooms: draft.rooms,
    guests: draft.stayingGuests,
    ...(typeof draft.divers === "number" ? { divers: draft.divers } : {}),
    roomTypes: new Set(rooms.map((r) => r.type)),
    knownDates: new Set([draft.checkIn, draft.checkOut].filter((d) => typeof d === "string" && d !== "")),
  };

  try {
    const sys = [
      `You are the Senior Concierge at Casa Escondida Resort & Dive Center in Anilao, Batangas.`,
      `A member of our reservations team has just finished preparing a guest's quotation and it is ready to look at.`,
      `Write a warm, natural TWO-sentence opening ONLY, and address the guest by name once — the block below starts with the quotation itself, so do not greet them a second time and do not repeat their name.`,
      `Do not list prices, totals or line items — the guest's own quotation page shows those.`,
      `Never say a booking, a stay, a room or a quotation is confirmed: nothing is booked yet and only our front desk takes bookings.`,
      `Then include the link and the closing line provided below, verbatim, and nothing else.`,
    ].join(" ");

    const user = `Guest: ${draft.guestName}\nWrite the greeting, then reproduce this block verbatim:\n${messageBlock}`;
    const llmReply = await withBudget(provider.generateText(sys, user), CONFIRMED_GREETING_BUDGET_MS);

    if (llmReply && llmReply.includes(guestLink ?? "\u0000")) {
      const check = verifyGuestFacingText(llmReply, facts);
      if (check.ok) return llmReply.trim();
      // eslint-disable-next-line no-console
      console.warn(`[quotation] guest message greeting rejected (${check.reason}); using the deterministic text`);
    }
  } catch {
    // Fall back to the deterministic message: a slow or failed greeting must not delay the link.
  }

  return deterministicMessage;
}
