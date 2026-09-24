import type { Trip } from "./schema.js";
import type { ExtractProvider } from "./provider.js";
import { getStaffAlerts } from "./questions.js";

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

export interface HonoQuotationDraft {
  quoteId: string;
  slug: string;
  status: "pending_hono_review" | "confirmed_by_hono";
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
    status: "pending_hono_review" | "confirmed_by_hono";
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
      mealPlan: { type: "STRING", description: "full_board, breakfast_only, or no_meals" },
      diver: { type: "BOOLEAN", description: "Whether the group is diving" },
      divers: { type: "INTEGER", description: "Number of divers if uniform across all days" },
      diveNotes: { type: "STRING", description: "Split-day or custom diving schedule notes" },
      guestType: { type: "STRING", description: "agent, instructor, or regular" },
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
  const discountPercent = Math.max(0, Math.min(100, Number(draft.discountPercent) || 0));
  const discountAmount = Math.round(subtotalAmount * (discountPercent / 100));
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
  const randSuffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  const quoteId = existingQuoteId ?? `QT-${dateCompact}-${cleanName}-${randSuffix}`;
  const slug = quoteId.toLowerCase();

  const lineItems: QuotationLineItem[] = [];

  // 1. Room Accommodation Row
  lineItems.push({
    id: "item-rooms",
    category: "room",
    description: "Deluxe Seaview Resort Room (Twin / Double Occupancy)",
    quantity: rooms,
    unitLabel: "rooms",
    multiplier: nights,
    multiplierLabel: "nights",
    unitPrice: 4800,
    subtotal: rooms * nights * 4800,
  });

  // 2. Meal Plan Row
  if (mealPlan !== "room_only" && mealPlan !== "none") {
    const mealPrice = mealPlan === "full_board" ? 1600 : 950;
    const mealLabel =
      mealPlan === "full_board"
        ? "Full-Board Dining Package (Breakfast, Lunch & Dinner)"
        : "Half-Board Resort Dining Package";
    lineItems.push({
      id: "item-meals",
      category: "meals",
      description: mealLabel,
      quantity: stayingGuests,
      unitLabel: "staying guests",
      multiplier: nights,
      multiplierLabel: "days",
      unitPrice: mealPrice,
      subtotal: stayingGuests * nights * mealPrice,
    });
  }

  // 3. Diving Package Rows (Smart Split-Day Detection from diveNotes!)
  let totalGroupSize = stayingGuests;
  if (diver) {
    const note = diveNotes ?? "";
    const day1Match = note.match(/(\d+)\s*(?:person|people|pax|diver|divers)\s*dives?\s*(?:on\s*)?day\s*1/i);
    const bothDaysMatch = note.match(/(\d+)\s*(?:person|people|pax|diver|divers)\s*dives?\s*(?:on\s*)?(?:both\s*days|all\s*days|2\s*days)/i);

    if (day1Match && bothDaysMatch) {
      const d1Count = Number(day1Match[1]);
      const bothCount = Number(bothDaysMatch[1]);
      totalGroupSize = Math.max(stayingGuests, d1Count + bothCount);

      lineItems.push({
        id: "item-dive-day1",
        category: "diving",
        description: `Anilao Guided Boat Diving — Day 1 Only (${note})`,
        quantity: d1Count,
        unitLabel: "diver(s)",
        multiplier: 1,
        multiplierLabel: "day",
        unitPrice: 3800,
        subtotal: d1Count * 1 * 3800,
      });

      lineItems.push({
        id: "item-dive-both",
        category: "diving",
        description: "Anilao Guided Boat Diving — Both Days (3 Boat Dives/Day + Tanks & Weights)",
        quantity: bothCount,
        unitLabel: "diver(s)",
        multiplier: Math.max(2, nights),
        multiplierLabel: "days",
        unitPrice: 3800,
        subtotal: bothCount * Math.max(2, nights) * 3800,
      });
    } else {
      const diverCount = divers ?? stayingGuests;
      totalGroupSize = Math.max(stayingGuests, diverCount);
      const diveDays = Math.max(1, nights);
      lineItems.push({
        id: "item-dive-std",
        category: "diving",
        description: diveNotes
          ? `Anilao Guided Boat Diving Package (${diveNotes})`
          : "Anilao Guided Boat Diving Package (3 Boat Dives/Day + Tanks & Weights)",
        quantity: diverCount,
        unitLabel: "diver(s)",
        multiplier: diveDays,
        multiplierLabel: "days",
        unitPrice: 3800,
        subtotal: diverCount * diveDays * 3800,
      });
    }
  }

  // 4. Airport Transfer Row (if requested)
  if (trip.transport?.value === true) {
    lineItems.push({
      id: "item-transfer",
      category: "transfer",
      description: "Private Van Transfer (Manila NAIA ↔ Casa Escondida Anilao)",
      quantity: 1,
      unitLabel: "van",
      multiplier: 2,
      multiplierLabel: "ways",
      unitPrice: 4500,
      subtotal: 9000,
    });
  }

  const isPartner = guestType === "agent" || guestType === "instructor";
  const discountPercent = isPartner ? 30 : 0;
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
    staffNotes: diveNotes
      ? `Custom split-day dive arrangement noted: "${diveNotes}". Verify boat manifest before confirming.`
      : "Standard resort quotation draft ready for Hono confirmation.",
    staffAlerts: getStaffAlerts(trip, "en"),
  };

  return recalculateQuotationTotals(draft);
}

/**
 * Generates the AI's response AFTER Hono staff edits & confirms the quotation table and link!
 * Because Hono has explicitly confirmed the quotation (`status === "confirmed_by_hono"`),
 * the AI is now authorized to present the confirmed quotation table and edited quotation link.
 */
export async function synthesizeConfirmedQuotationReply(
  draft: HonoQuotationDraft,
  provider?: ExtractProvider
): Promise<string> {
  const symbol = draft.currency === "USD" ? "$" : "₱";
  const fmt = (n: number) => `${symbol}${n.toLocaleString("en-US")}`;

  const tableLines = draft.lineItems.map(
    (item, idx) =>
      `${idx + 1}. **${item.description}**\n   • ${item.quantity} ${item.unitLabel} × ${item.multiplier} ${item.multiplierLabel} @ ${fmt(item.unitPrice)} = **${fmt(item.subtotal)}**`
  );

  const deterministicMessage = [
    `Hi ${draft.guestName}! Great news — our reservation team at Casa Escondida has reviewed and confirmed your customized quotation (#${draft.quoteId}).`,
    ``,
    `📋 **Confirmed Quotation Breakdown (${draft.checkIn} to ${draft.checkOut} · ${draft.nights} nights):**`,
    ...tableLines,
    ``,
    draft.discountPercent > 0
      ? `• **Subtotal:** ${fmt(draft.subtotalAmount)}\n• **Partner / Special Discount (${draft.discountPercent}%):** -${fmt(draft.discountAmount)}\n• **Total Confirmed Quote:** **${fmt(draft.totalAmount)} ${draft.currency}**`
      : `• **Total Confirmed Quote:** **${fmt(draft.totalAmount)} ${draft.currency}**`,
    draft.staffNotes ? `\n📝 **Resort Note:** ${draft.staffNotes}` : ``,
    ``,
    `🔗 **View & Download Your Interactive Quotation:**`,
    `${draft.quotationUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (!provider?.generateText) {
    return deterministicMessage;
  }

  try {
    const sys = [
      `You are the Senior Concierge at Casa Escondida Resort & Dive Center in Anilao, Batangas.`,
      `The Hono Reservation Backend has just CONFIRMED an edited quotation for the guest via tool response.`,
      `Write a warm, natural 2-sentence opening greeting acknowledging their confirmed setup (including any split-day diving or room setup), and then include the EXACT confirmed breakdown and quotation link provided below without changing any numbers or URLs.`,
    ].join(" ");

    const user = `Guest: ${draft.guestName}\nConfirmed Breakdown & Link (include verbatim after your greeting):\n${deterministicMessage}`;
    const llmReply = await Promise.race([
      provider.generateText(sys, user),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3500)),
    ]);

    if (llmReply && llmReply.includes(draft.quotationUrl)) {
      return llmReply.trim();
    }
  } catch {
    // Fall back to deterministic message
  }

  return deterministicMessage;
}
