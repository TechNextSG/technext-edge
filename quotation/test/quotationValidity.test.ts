// How long a quotation is good for, and what the resort may say about it.
//
// This file exists because the first version of this feature shipped with three problems, all of them
// pinned here:
//
//   1. the badge used `sharedAt` as a fallback for "sent", so a link-only publish was called overdue
//      for a guest who had never been sent anything;
//   2. it ignored `submission`, so a booking that already had a folio would keep being told no deposit
//      had arrived;
//   3. the guest-facing copy promised things the resort never published — that a room was being HELD
//      (nothing in this service holds inventory) and that rooms and boats are first-come, first-served
//      (the resort's site says that about parking). A template that invents a term is a sentence a
//      guest can hold the desk to, so the absence of those words is tested rather than trusted.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_FOLLOW_UP_WINDOW,
  quotationValidityLines,
  followUpState,
  followUpWindowFromEnv,
  formatManila,
  hoursSinceSent,
  quotationValidUntil,
} from "../src/domain/quotationValidity.ts";
import type { HonoQuotationDraft } from "../src/application/quotationTool.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-01T12:00:00Z");

/** Only the fields the window reads. */
function draft(overrides: Partial<HonoQuotationDraft> = {}): HonoQuotationDraft {
  return {
    quoteId: "QT-TEST-1",
    slug: "slug",
    status: "confirmed_by_hono",
    guestName: "Ana",
    checkIn: "2026-11-20",
    checkOut: "2026-11-22",
    nights: 2,
    stayingGuests: 2,
    ...overrides,
  } as HonoQuotationDraft;
}

const sentHoursAgo = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("when a quotation needs chasing", () => {
  it("says nothing about a quotation the guest was never sent", () => {
    // Publishing is not sending: the studio has "Create link only", and a guest who has received
    // nothing is not a guest who has ignored anything.
    const publishedNotSent = draft({
      estimator: { id: "sim-1", cookie: null, seq: 1, guestUrl: "https://their.test/quote/x", sharedAt: sentHoursAgo(100) },
    });
    expect(followUpState(publishedNotSent, NOW)).toBe("none");
  });

  it("is quiet inside the window, a nudge after 48 hours, and stale after 72", () => {
    expect(followUpState(draft({ sentToGuestAt: sentHoursAgo(10) }), NOW)).toBe("none");
    expect(followUpState(draft({ sentToGuestAt: sentHoursAgo(49) }), NOW)).toBe("nudge");
    expect(followUpState(draft({ sentToGuestAt: sentHoursAgo(73) }), NOW)).toBe("stale");
  });

  it("stops chasing once the booking exists", () => {
    // A folio means the money question is answered. Telling staff "no deposit yet" about a booking the
    // team estimator has already created is a lie the desk would have to explain away.
    const booked = draft({
      sentToGuestAt: sentHoursAgo(80),
      submission: { folioId: 42, orderIds: null, sample: false, mode: "fixture" },
    } as Partial<HonoQuotationDraft>);
    expect(followUpState(booked, NOW)).toBe("none");
  });

  it("stops chasing an archived quotation", () => {
    expect(followUpState(draft({ status: "cancelled", sentToGuestAt: sentHoursAgo(90) }), NOW)).toBe("none");
  });

  it("takes its hours from configuration, so the plan's 48/72 are not frozen in code", () => {
    vi.stubEnv("QUOTATION_NUDGE_HOURS", "24");
    vi.stubEnv("QUOTATION_VALID_HOURS", "36");
    expect(followUpWindowFromEnv()).toEqual({ nudgeHours: 24, staleHours: 36 });
    expect(followUpState(draft({ sentToGuestAt: sentHoursAgo(30) }), NOW, followUpWindowFromEnv())).toBe("nudge");
    expect(followUpState(draft({ sentToGuestAt: sentHoursAgo(40) }), NOW, followUpWindowFromEnv())).toBe("stale");
  });

  it("falls back to the defaults rather than to chaos when the config is nonsense", () => {
    vi.stubEnv("QUOTATION_NUDGE_HOURS", "later");
    vi.stubEnv("QUOTATION_VALID_HOURS", "-5");
    expect(followUpWindowFromEnv()).toEqual(DEFAULT_FOLLOW_UP_WINDOW);
    // A nudge later than the validity would mean a quotation that lapses before anyone chases it.
    vi.stubEnv("QUOTATION_NUDGE_HOURS", "100");
    expect(followUpWindowFromEnv().nudgeHours).toBeLessThanOrEqual(followUpWindowFromEnv().staleHours);
  });

  it("counts from the send, and only the send", () => {
    expect(hoursSinceSent(draft(), NOW)).toBeNull();
    expect(hoursSinceSent(draft({ sentToGuestAt: sentHoursAgo(5) }), NOW)).toBeCloseTo(5, 5);
  });
});

describe("when a quotation lapses", () => {
  it("has no deadline until it has been sent", () => {
    expect(quotationValidUntil(draft())).toBeNull();
  });

  it("ends exactly one window after it was sent", () => {
    const sent = sentHoursAgo(0);
    const until = quotationValidUntil(draft({ sentToGuestAt: sent }))!;
    expect(until.getTime() - Date.parse(sent)).toBe(DEFAULT_FOLLOW_UP_WINDOW.staleHours * HOUR);
  });

  it("prints the deadline on the resort's clock, because the guest reads it in Manila", () => {
    // 2026-10-01T12:00:00Z is 20:00 in Manila (UTC+8), and a page that printed 12:00 would give the
    // guest eight hours they do not have.
    expect(formatManila(new Date("2026-10-01T12:00:00Z"))).toBe("01 Oct 2026, 20:00");
  });
});

describe("what the resort may say about the quotation", () => {
  const lines = quotationValidityLines(new Date("2026-10-04T12:00:00Z"));

  it("says nothing about a deposit or a balance: the team estimator does not", () => {
    const text = lines.join(" ").toLowerCase();
    expect(text).not.toContain("deposit");
    expect(text).not.toContain("down payment");
    expect(text).not.toContain("balance");
  });

  it("states the quotation's own validity, with a date", () => {
    expect(lines.join(" ")).toContain("valid until 04 Oct 2026, 20:00");
  });

  it("promises no room hold and no first-come rule, because neither is the resort's published term", () => {
    const text = lines.join(" ").toLowerCase();
    expect(text).not.toContain("hold");
    expect(text).not.toContain("first-come");
    expect(text).not.toContain("filling up");
  });

  it("leaves the deadline off entirely when there is none to state", () => {
    expect(quotationValidityLines(null)).toEqual([]);
  });
});
