import { randomUUID } from "node:crypto";
import type { Trip, BffTrip } from "./schema.js";
import type { StaffTripEdit } from "./tripDiff.js";
import type { ExtractProvider } from "./provider.js";
import { getStaffAlerts, diveWindowIsGuessed } from "./questions.js";
import { buildBffTrip, datesBetweenInclusive } from "./odooHandoff.js";
import { verifyGuestFacingText, withBudget, type GuestFacingFacts } from "./synthesis.js";
import type { QuotationPricing } from "./pricing.js";
import {
  roomNightlyRate,
  diveTierPrice,
  MEAL_RATE,
  TRANSPORT_RATE,
  PARTNER_DISCOUNT_PCT,
  type RoomType,
} from "./rates.js";

export interface QuotationLineItem {
  id: string;
  category: "room" | "meals" | "diving" | "transfer" | "discount" | "custom";
  description: string;
  quantity: number;
  unitLabel: string;
  multiplier: number;
  multiplierLabel: string;
  unitPrice: number;
  subtotal: number;
}

/**
 * The four states a reservation can be in, copied from the customer's own `submission` table
 * (`docs/flows/F07-booking.md` D2). The distinctions are not cosmetic:
 *
 *   `pending`    written before the engine is called, and it is what locks the button. Odoo issues
 *                no idempotency key, so this row IS the double-submit guard.
 *   `confirmed`  the engine answered yes. Terminal.
 *   `failed`     it answered no. Safe to try again — that is the only state that is.
 *   `unknown`    it may have created a folio. Never retried blindly; a person reconciles it.
 */
export type QuotationSubmissionState = "pending" | "confirmed" | "failed" | "unknown";

/** Who the reservation is for. Stored, but never rendered on a guest page and never logged. */
export interface QuotationContact {
  name: string;
  email: string;
  phone: string | null;
}

export interface QuotationSubmission {
  state: QuotationSubmissionState;
  /** The revision being booked. Pinned so a booking can be traced to what was quoted. */
  seq: number;
  contact: QuotationContact;
  folioId: number | null;
  orderIds: number[] | null;
  /** True when this booking was made against labelled sample data. */
  sample: boolean;
  /** Why it failed. A category like "rejected" or "unknown", never anything from the guest. */
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HonoQuotationDraft {  quoteId: string;
  slug: string;
  status: "pending_hono_review" | "confirmed_by_hono" | "cancelled";
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  phone?: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  stayingGuests: number;
  totalGroupSize: number;
  rooms: number;
  mealPlan: string;
  diver: boolean;
  divers: number | null;
  diveNotes: string | null;
  guestType: string | null;
  currency: "PHP" | "USD";
  discountPercent: number;
  lineItems: QuotationLineItem[];
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  /** Editable public quotation link that can be customized by Hono staff */
  quotationUrl: string;
  /** Hono staff editor URL where table & link can be edited and confirmed */
  honoEditorUrl: string;
  staffNotes: string;
  staffAlerts: string[];
  aiConfirmedReply?: string;
  /**
   * Version of the seeded studio fixture (see `quotationStore.ts` `SEED_VERSION`). Present only
   * on the seed record: `ensureSeeded()` uses it to re-seed when the fixture's pricing changes,
   * instead of leaving a stale copy in KV forever. Not part of any guest quotation.
   */
  seedVersion?: number;
  /**
   * The validated Odoo/BFF `Trip` this quotation was priced from, when it was built from an
   * extraction `Trip` at all. Carried through so the Odoo-bound envelope contains the contract
   * shape (`guests[]` with `roomId`/`days`, `diveFrom`/`diveTo`, `guestType`) rather than only
   * this draft's flattened columns. Absent for a draft computed from raw `lineItems`, which was
   * never an extraction result and so has no guest-level facts to send.
   */
  bffTrip?: BffTrip;
  /**
   * Every trip correction staff have made to this quotation, oldest first.
   *
   * This is the only honest measure of how well the WhatsApp extractor did. A count of "staff
   * changed nothing" is the number that says the bot's payload was already right; without it, the
   * only evidence about extraction quality was whoever remembered which quotations they had fixed.
   * The field NAMES are kept (never values) because that is what turns a percentage into a to-do
   * list: "roomType corrected in 6 of 10 cases" is actionable, "30% of quotations were edited" is not.
   */
  staffEdits?: StaffTripEdit[];
  /**
   * What the pricing engine said, in a shape a page can draw: per-guest cards, the category split,
   * the warnings, and the operational half the Ops Sheet needs.
   *
   * Kept on the draft rather than fetched per render because it is the record of *what was quoted*,
   * and a quotation whose price changes depending on when you open it is not a quotation. Absent
   * until someone prices the trip, which is also what the studio's "not priced yet" state means.
   */
  pricing?: QuotationPricing | null;
  /**
   * The reservation, once anyone asked for one. Absent on a quotation nobody has tried to book —
   * which is the difference between "not sent" and "sent and failed", and the studio has to be
   * able to tell those apart before offering the button again.
   */
  submission?: QuotationSubmission | null;
  /**
   * What we hold on the customer's own quotation app for THIS quotation.
   *
   * Their API is session-scoped: `POST /api/estimates` mints a scenario and sets an `ubg_sid`
   * cookie, and `commit` / `share` / `submit` are only answered for the session that owns it. So
   * the id and the cookie have to be kept together, next to the draft, or the second call about a
   * quotation is a 404 for a draft that exists.
   *
   * `guestUrl` is the link the customer's app minted, and it is the ONLY link a guest is ever sent
   * once the bot stops publishing its own — see `sharedAt`, which is also what locks the quotation
   * against further edits (their link always resolves to the latest saved revision).
   */
  estimator?: QuotationEstimatorState | null;
}

export interface QuotationEstimatorState {
  /** Their scenario id, from `POST /api/estimates`. */
  id: string | null;
  /** Their `ubg_sid` cookie, verbatim. Secret-like: never rendered on a page. */
  cookie: string | null;
  /** The frozen revision, once committed. */
  seq: number | null;
  /** The link their app minted, absolute. Null until `share` has answered. */
  guestUrl: string | null;
  /** When the link was minted. After this the quotation is read-only: see Q-005. */
  sharedAt: string | null;
  /**
   * Our own copy of the same frozen revision, set ONLY when their link failed a check at publish.
   *
   * Their demo deployment keeps scenarios and share tokens in one serverless instance's memory
   * (measured: a verified token answered 404 twelve times in a row a minute later), and a guest
   * holding a dead link is worse than a guest reading a copy. `guestLinkFor()` prefers this when it
   * is set, and `publish` never sets it while their link works — so this is a fallback, not a second
   * guest page. What it may render is pinned in `apps/casa-bff/src/guestQuotationCopy.ts`.
   */
  mirrorUrl?: string | null;
  /** Why the copy was needed, in one sentence, for the studio. Never shown to a guest. */
  mirrorReason?: string | null;
}

/**
 * The link to show the guest and to put in the message: our copy when their app lost the link,
 * otherwise theirs. One place, so the studio, the message and the send guard cannot disagree about
 * which link the guest is holding.
 */
export function guestLinkFor(draft: HonoQuotationDraft): string | null {
  return draft.estimator?.mirrorUrl ?? draft.estimator?.guestUrl ?? null;
}

export interface HonoToolCallTrace {
  toolName: "submit_quotation_to_hono";
  status: "executed_pending_hono_confirm" | "confirmed_by_hono";
  arguments: {
    guestName: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    stayingGuests: number;
    totalGroupSize: number;
    rooms: number;
    mealPlan: string;
    diver: boolean;
    divers: number | null;
    diveNotes: string | null;
    guestType: string | null;
  };
  result: {
    quoteId: string;
    status: "pending_hono_review" | "confirmed_by_hono" | "cancelled";
    quotationUrl: string;
    honoEditorUrl: string;
    totalAmount: number;
    currency: "PHP" | "USD";
    lineItemCount: number;
  };
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
  const checkIn = trip.checkIn.value ?? "2026-10-10";
  const checkOut = trip.checkOut.value ?? "2026-10-12";
  const nights = trip.nights.value ?? 2;
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
  for (const room of bffTrip.rooms) {
    const occupancy = occupancyByRoom.get(room.id ?? "") ?? 0;
    if (occupancy > 0) {
      roomPerNight += roomNightlyRate(room.type as RoomType, occupancy);
      chargedRooms += 1;
    }
  }
  lineItems.push({
    id: "item-rooms",
    category: "room",
    description: "Standard Room (Twin / Double Occupancy)",
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
    const day1Match = note.match(/(\d+)\s*(?:person|people|pax|diver|divers)\s*dives?\s*(?:on\s*)?day\s*1/i);
    const bothDaysMatch = note.match(/(\d+)\s*(?:person|people|pax|diver|divers)\s*dives?\s*(?:on\s*)?(?:both\s*days|all\s*days|2\s*days)/i);
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

  // 4. Airport transfer — a per-van price, not per guest.
  if (trip.transport?.value === true) {
    const oneWay = trip.transportType?.value === "oneway";
    const rate = oneWay ? TRANSPORT_RATE.oneway : TRANSPORT_RATE.roundtrip;
    lineItems.push({
      id: "item-transfer",
      category: "transfer",
      description: oneWay ? "Private Van Transfer (One Way)" : "Private Van Transfer (Round-Trip)",
      quantity: 1,
      unitLabel: "van",
      multiplier: 1,
      multiplierLabel: "trip",
      unitPrice: rate,
      subtotal: rate,
    });
  }

  const isPartner = guestType === "agent" || guestType === "instructor";
  const discountPercent = isPartner ? PARTNER_DISCOUNT_PCT : 0;
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
    rooms,
    mealPlan,
    diver,
    divers,
    diveNotes,
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
 *      the customer's app at Publish; our own `/q/<slug>` page is retired and answers 410. The
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

  const deterministicMessage = [
    `Hi ${draft.guestName}! Your quotation for ${draft.checkIn} to ${draft.checkOut} (${draft.nights} nights) is ready to look at here:`,
    ``,
    // No link yet means this text is being shown as the APPROVAL preview, not sent: the send rebuilds
    // the message from the record once the link exists. Printing "(no link — this quotation has not
    // been published yet)" put a placeholder in front of staff on the approval screen, where the
    // question is not whether a link exists but whether the guest should get one.
    guestLink ?? "(the guest's own link is added when you send this)",
    sample
      ? `\n⚠️ Sample prices — these are example figures from our booking engine while it is being set up, not a final quote.`
      : ``,
    note ? `\n📝 ${note}` : ``,
    ``,
    `Open the link to see the full breakdown. If anything looks wrong, just reply here and a member of our team will fix it — nothing is booked yet.`,
  ]
    .filter(Boolean)
    .join("\n");

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
      `Write a warm, natural TWO-sentence opening ONLY. Do not list prices, totals or line items — the guest's own quotation page shows those.`,
      `Never say a booking, a stay, a room or a quotation is confirmed: nothing is booked yet and only our front desk takes bookings.`,
      `Then include the link and the closing line provided below, verbatim, and nothing else.`,
    ].join(" ");

    const user = `Guest: ${draft.guestName}\nWrite the greeting, then reproduce this block verbatim:\n${deterministicMessage}`;
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
