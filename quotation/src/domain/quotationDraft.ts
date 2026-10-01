// The quotation draft as the studio, the store and the guest pages all see it. Types only: building,
// pricing and repricing a draft is application work in quotationTool.ts.
import type { BffTrip } from "../../../ai/src/index.ts";
import type { StaffTripEdit } from "./tripDiff.ts";
import type { QuotationPricing } from "./pricing.ts";

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
  /** The guest's own special requests, dietary needs and transfer direction: kept here for the desk, never sent to the engine. */
  specialRequests?: string | null;
  dietNotes?: string | null;
  transferDirection?: "arrival" | "departure" | null;
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
   * `guestUrl` is the link the team estimator minted, and it is the ONLY link a guest is ever sent
   * once the bot stops publishing its own — see `sharedAt`, which is also what locks the quotation
   * against further edits (their link always resolves to the latest saved revision).
   */
  /**
   * When the message carrying the guest's link actually left, or absent if it never did.
   *
   * Publishing and sending are two different actions ("Create link only" exists for a reason), and
   * the studio used to read `estimator.sharedAt` — a link exists — as "the guest has it". It was
   * caught on production: a record published with `Create link only` showed the status pill
   * "Sent to guest" and a button offering to send "the message again", for a message that had never
   * been sent once. This is the fact that distinguishes them.
   */
  sentToGuestAt?: string | null;
  /**
   * The number the message went to, so a second send defaults to the same recipient.
   */
  sentToPhone?: string | null;
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
   * guest page. What it may render is pinned in `bff/src/guestQuotationCopy.ts`.
   */
  mirrorUrl?: string | null;
  /** Why the copy was needed, in one sentence, for the studio. Never shown to a guest. */
  mirrorReason?: string | null;
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
