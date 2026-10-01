import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extract } from "../src/index.ts";
import { resolveRelativeDate } from "../src/index.ts";
import { buildBffTrip, buildOdooHandoffPayload, validateBffTripPrecheck } from "../src/application/odooHandoff.ts";
import type { ExtractProvider } from "../src/index.ts";
import type { Trip } from "../src/index.ts";

// The customer's engine (bff/src/trip/validate.ts) refuses what these rules describe. The bot must ask the
// guest again, or report the customer's own code — never fill in or clamp a value the guest did not give.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const missing = { value: null, state: "missing", evidence: null };
const stated = (value: unknown, evidence: string) => ({ value, state: "stated", evidence });

function provider(overrides: Record<string, unknown>): ExtractProvider {
  const raw = {
    language: missing, checkIn: missing, checkOut: missing, nights: missing, guests: missing, rooms: missing,
    roomType: missing, meals: missing, transport: missing, contactName: stated("Ana", "I am Ana"),
    diver: missing, diveFrom: missing, diveTo: missing, transportType: missing, divers: missing,
    ...overrides,
  };
  return { id: "fake:v1", call: vi.fn().mockResolvedValue({ raw, tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, ms: 1 }) };
}

const asked = (o: Awaited<ReturnType<typeof extract>>) => o.questions.map((q) => q.field);

describe("dates", () => {
  it("an explicit numeric date that reads two ways is a question, not a guess", () => {
    expect(resolveRelativeDate("10/12/2026", "2026-09-15")).toBeNull();
    expect(resolveRelativeDate("19/12/2026", "2026-09-15")).toBe("2026-12-19"); // only one reading
    expect(resolveRelativeDate("5/5/2026", "2026-09-15")).toBe("2026-05-05"); // both readings agree
    expect(resolveRelativeDate("2026-12-10", "2026-09-15")).toBe("2026-12-10"); // ISO has one order
  });

  it("keeps the year the guest wrote", () => {
    expect(resolveRelativeDate("October 10, 2027", "2026-09-15")).toBe("2027-10-10");
    expect(resolveRelativeDate("10 October 2027", "2026-09-15")).toBe("2027-10-10");
    expect(resolveRelativeDate("October 10", "2026-09-15")).toBe("2026-10-10"); // no year: the next one
  });

  it("a check-in that has already passed goes back to being a question", async () => {
    const out = await extract(
      "I am Ana, 2 guests, 2 nights from 2026-08-01",
      provider({ checkIn: stated("2026-08-01", "2026-08-01"), nights: stated(2, "2 nights"), guests: stated(2, "2 guests") }),
    );
    expect(out.trip.checkIn.state).toBe("missing");
    expect(asked(out)).toContain("checkIn");
  });

  it("a reversed or zero-night range is asked again, and no 10-12 October appears", async () => {
    const out = await extract(
      "I am Ana, 2 guests, from 2026-10-20 to 2026-10-18",
      provider({
        checkIn: stated("2026-10-20", "2026-10-20"),
        checkOut: stated("2026-10-18", "2026-10-18"),
        guests: stated(2, "2 guests"),
      }),
    );
    expect(out.trip.checkOut.state).toBe("missing");
    expect(asked(out)).toContain("nights");
  });
});

describe("counts", () => {
  it("more divers than guests is asked again", async () => {
    const out = await extract(
      "I am Ana, 3 guests, 5 divers, 2026-10-20 for 2 nights",
      provider({
        checkIn: stated("2026-10-20", "2026-10-20"), nights: stated(2, "2 nights"), guests: stated(3, "3 guests"),
        diver: stated(true, "5 divers"), divers: stated(5, "5 divers"),
      }),
    );
    expect(out.trip.divers!.state).toBe("missing");
    expect(asked(out)).toContain("divers");
  });
});

describe("hand-off", () => {
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

  it("a check-in in the past is reported for a guest, and not for staff", () => {
    const t = buildBffTrip(tripOf({ checkIn: f("2026-08-01"), checkOut: f("2026-08-03") }));
    expect(validateBffTripPrecheck(t).map((i) => i.code)).toContain("checkin-in-past");
    expect(validateBffTripPrecheck(t, undefined, { role: "staff" }).map((i) => i.code)).not.toContain("checkin-in-past");
  });

  it("a dive window outside the stay is reported, not moved into the stay", () => {
    const t = buildBffTrip(
      tripOf({
        diver: f(true), divers: f(1), diveFrom: f("2026-11-25"), diveTo: f("2026-11-26"),
      }),
    );
    expect(t.diveFrom).toBe("2026-11-25");
    expect(validateBffTripPrecheck(t).map((i) => i.code)).toContain("dive-window-outside-stay");
  });

  it("divers over guests is reported with their code and holds the enquiry for staff", () => {
    const out = buildOdooHandoffPayload(tripOf({ diver: f(true), divers: f(5), diveFrom: f("2026-11-21"), diveTo: f("2026-11-21") }));
    expect(out.bffValidationIssues.map((i) => i.code)).toContain("divers-over-guests");
    expect(out.readyForAutoQuote).toBe(false);
  });

  it("a group over the engine limit goes to a person instead of being priced as 40", () => {
    const out = buildOdooHandoffPayload(tripOf({ guests: f(45), rooms: f(23, "stated") }));
    expect(out.manualReviewReasons).toContain("group_exceeds_engine_limit");
    expect(out.readyForAutoQuote).toBe(false);
  });
});

describe("what production showed after the first deploy", () => {
  it("a model's pick for '10/12/2026' is not accepted: the phrase supports both months, so the guest is asked", async () => {
    const out = await extract(
      "I am Ana, 2 guests, 2 nights, check in 10/12/2026",
      provider({ checkIn: stated("2026-10-12", "10/12/2026"), nights: stated(2, "2 nights"), guests: stated(2, "2 guests") }),
    );
    expect(out.trip.checkIn.state).toBe("missing");
    expect(asked(out)).toContain("checkIn");
  });

  it("an unambiguous full date is still taken as written", async () => {
    const out = await extract(
      "I am Ana, 2 guests, 2 nights, check in 19/12/2026",
      provider({ checkIn: stated("2026-12-19", "19/12/2026"), nights: stated(2, "2 nights"), guests: stated(2, "2 guests") }),
    );
    expect(out.trip.checkIn.value).toBe("2026-12-19");
  });

  it("a past check-in that is asked again takes the model's worked-out check-out with it", async () => {
    const out = await extract(
      "I am Ana, 2 guests, 2 nights from 2026-08-01",
      provider({
        checkIn: stated("2026-08-01", "2026-08-01"),
        checkOut: { value: "2026-08-03", state: "inferred", evidence: null },
        nights: stated(2, "2 nights"),
        guests: stated(2, "2 guests"),
      }),
    );
    expect(out.trip.checkIn.state).toBe("missing");
    expect(out.trip.checkOut.value).toBeNull();
  });
});
