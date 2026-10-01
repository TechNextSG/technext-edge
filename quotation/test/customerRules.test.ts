import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extract, partnerTypeOf, detectLanguage, buildBffTrip, buildOdooHandoffPayload } from "../../ai/src/index.ts";
import { toInquiryLead } from "../src/application/inquiryLead.ts";
import { buildHonoQuotationDraft } from "../src/application/quotationTool.ts";
import type { ExtractProvider } from "../../ai/src/index.ts";
import type { Trip } from "../../ai/src/index.ts";

/**
 * F10 — the website enquiry as `toInquiryLead` prepares it: only the columns this side collects (the team estimator's
 * own `leadId`, `name`, `email`, `phone`, `nights`, `travelMonth`, `checkin` and `sameStayLength` are theirs). Their plan
 * `docs/superpowers/plans/2026-09-28-profile-certs-inquiry.md` (Task 7, `InquiryLead`) marks the shape "assumed", so it
 * can change; `npm run upstream:check` shows when it does.
 */
const INQUIRY_LEAD = {
  fields: ["totalGuests", "rooms", "mealPlan", "airportTransfer", "divers", "coursesInterest", "message"],
  roomTypes: ["standard", "deluxe", "suite"],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const f = (value: unknown, state = "stated") => ({ value, state, evidence: null });

function tripOf(overrides: Record<string, unknown> = {}): Trip {
  return {
    language: f("en", "default"), contactName: f("Ana"), checkIn: f("2026-11-20"), checkOut: f("2026-11-22"),
    nights: f(2), guests: f(3), rooms: f(1, "default"), meals: f("full_board"), transport: f(false),
    guestType: f("retail", "default"), transportType: f("none"), diver: f(false),
    divers: f(null, "missing"), diveFrom: f(null, "missing"), diveTo: f(null, "missing"),
    diveNotes: f(null, "missing"), specialRequests: f(null, "missing"), guestNames: f([]), roomType: f("standard"),
    ...overrides,
  } as unknown as Trip;
}

describe("who is writing: trade phrases, not the bare word", () => {
  it.each([
    ["my real-estate agent recommended you", null],
    ["I booked through an agent last year", null],
    ["Booking on behalf of a travel agency", "agent"],
    ["we are a tour operator", "agent"],
    ["our dive club would like the partner rate", "agent"],
    ["我们是旅行社", "agent"],
    ["I'm a PADI instructor", "instructor"],
    ["we are dive instructors from Manila", "instructor"],
    ["I am an instructor with two students", "instructor"],
    ["my instructor told me about you", null],
  ])("%s -> %s", (text, expected) => {
    expect(partnerTypeOf(text)).toBe(expected);
  });

  it("extract() records an instructor as such", async () => {
    const raw = {
      language: f(null, "missing"), checkIn: f(null, "missing"), checkOut: f(null, "missing"), nights: f(null, "missing"),
      guests: f(null, "missing"), rooms: f(null, "missing"), roomType: f(null, "missing"), meals: f(null, "missing"),
      transport: f(null, "missing"), contactName: f(null, "missing"), diver: f(null, "missing"),
    };
    const provider: ExtractProvider = {
      id: "fake:v1",
      call: vi.fn().mockResolvedValue({ raw, tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, ms: 1 }),
    };
    const out = await extract("Hi, I'm a PADI instructor, 2 students", provider);
    expect(out.trip.guestType?.value).toBe("instructor");
  });
});

describe("language", () => {
  it("Chinese is Chinese; Japanese and Korean, which share the Han block, are answered in English", () => {
    expect(detectLanguage("你好，我们想订两晚")).toBe("zh");
    expect(detectLanguage("こんにちは、東京から二人で行きます")).toBe("en");
    expect(detectLanguage("안녕하세요 東京 二人")).toBe("en");
    expect(detectLanguage("Hello there")).toBe("en");
  });
});

describe("meals, courses, diet and transfer", () => {
  it("half board is held for staff rather than sent as a meal it is not", () => {
    const out = buildOdooHandoffPayload(tripOf({ meals: f("half_board") }));
    expect(out.manualReviewReasons).toContain("meal_plan_needs_staff");
    expect(out.readyForAutoQuote).toBe(false);
  });

  it("'advanced open water' is one course, not two", () => {
    const t = buildBffTrip(
      tripOf({ diver: f(true), divers: f(1), diveFrom: f("2026-11-21"), diveTo: f("2026-11-21"), diveNotes: f("advanced open water course") }),
    );
    expect(t.guests.find((g) => g.diver)!.courses).toEqual(["aow"]);
  });

  it("a course is given to the one diver, or to everyone when the words say everyone — otherwise to staff", () => {
    const base = { diver: f(true), diveFrom: f("2026-11-21"), diveTo: f("2026-11-21") };

    const one = buildBffTrip(tripOf({ ...base, divers: f(1), diveNotes: f("open water course") }));
    expect(one.guests.filter((g) => g.courses.length > 0)).toHaveLength(1);

    const all = buildBffTrip(tripOf({ ...base, divers: f(3), diveNotes: f("we all want the open water course") }));
    expect(all.guests.filter((g) => g.courses.includes("ow"))).toHaveLength(3);

    const unclear = tripOf({ ...base, divers: f(3), diveNotes: f("someone wants an open water course") });
    expect(buildBffTrip(unclear).guests.every((g) => g.courses.length === 0)).toBe(true);
    expect(buildOdooHandoffPayload(unclear).manualReviewReasons).toContain("course_assignee_unclear");
  });

  it("diet and transfer direction stay on the record and never reach the engine's trip", () => {
    const t = tripOf({ dietNotes: f("one guest is vegetarian, nut allergy"), transferDirection: f("arrival") });
    const draft = buildHonoQuotationDraft(t);
    expect(draft.dietNotes).toBe("one guest is vegetarian, nut allergy");
    expect(draft.transferDirection).toBe("arrival");
    const sent = JSON.stringify(buildBffTrip(t));
    expect(sent).not.toContain("vegetarian");
    expect(sent).not.toContain("transferDirection");
  });

  it("extract() keeps only what the guest stated for diet and transfer direction", async () => {
    const stated = (value: unknown, evidence: string) => ({ value, state: "stated", evidence });
    const raw = {
      language: f(null, "missing"), checkIn: f(null, "missing"), checkOut: f(null, "missing"), nights: f(null, "missing"),
      guests: f(null, "missing"), rooms: f(null, "missing"), roomType: f(null, "missing"), meals: f(null, "missing"),
      transport: f(null, "missing"), contactName: f(null, "missing"), diver: f(null, "missing"),
      dietNotes: { value: "vegan", state: "inferred", evidence: null },
      transferDirection: stated("arrival", "pickup on arrival only"),
    };
    const provider: ExtractProvider = {
      id: "fake:v1",
      call: vi.fn().mockResolvedValue({ raw, tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, ms: 1 }),
    };
    const out = await extract("we need a pickup on arrival only", provider);
    expect(out.trip.dietNotes?.state).toBe("missing");
    expect(out.trip.transferDirection).toMatchObject({ value: "arrival", state: "stated" }); // the words are in the message
  });
});

describe("F10: the enquiry prepared for their inquiry route (nothing is sent)", () => {
  it("has exactly the columns their shape has, with their enums", () => {
    const lead = toInquiryLead(tripOf({ diver: f(true), divers: f(2), specialRequests: f("rollaway bed"), dietNotes: f("no pork") }));
    expect(Object.keys(lead).sort()).toEqual([...INQUIRY_LEAD.fields].sort());
    expect(lead.totalGuests).toBe(3);
    expect(lead.rooms).toEqual([{ type: "standard", pax: 2 }, { type: "standard", pax: 1 }]);
    expect(lead.mealPlan).toBe("full_board");
    expect(lead.airportTransfer).toBe("no");
    expect(lead.divers).toBe(2);
    expect(lead.message).toBe("rollaway bed; no pork");
    for (const room of lead.rooms) expect(INQUIRY_LEAD.roomTypes).toContain(room.type);
  });

  it("says null for what the guest never said, and has no place for half board", () => {
    const lead = toInquiryLead(
      tripOf({ meals: f("half_board"), transport: f(null, "missing"), transportType: f(null, "missing"), diver: f(null, "missing") }),
    );
    expect(lead.mealPlan).toBeNull();
    expect(lead.airportTransfer).toBeNull();
    expect(lead.divers).toBeNull();
    expect(lead.coursesInterest).toBeNull();
  });

  it("marks course interest only when a course was named", () => {
    expect(toInquiryLead(tripOf({ diver: f(true), divers: f(1), diveNotes: f("open water course") })).coursesInterest).toBe("yes");
  });
});
