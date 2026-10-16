import { describe, it, expect } from "vitest";
import { wantsHuman, declinesPartner } from "../src/application/questions/intent.ts";
import {
  fallbackReply,
  partnerInvitationReply,
  stalledHandoffReply,
  changedValueNotice,
  ASK_LIMIT,
  STALL_LIMIT,
} from "../src/application/questions/fallback.ts";
import {
  RULES,
  openRules,
  generateQuestions,
  isReadyForHandoff,
  diveWindowIsGuessed,
  formatDate,
  formatDay,
  formatRange,
} from "../src/application/questions/rules.ts";
import {
  renderReply,
  renderSummary,
  LABELS,
} from "../src/application/questions/render.ts";
import type { Trip, Field } from "../src/domain/schema.ts";

function f<T>(value: T | null, state: "stated" | "missing" | "default" | "derived" = "stated"): Field<T> {
  return { value, state, evidence: null };
}

function mockTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    language: f("en"),
    checkIn: f("2026-11-20"),
    checkOut: f("2026-11-22", "derived"),
    nights: f(2),
    guests: f(2),
    rooms: f(1),
    roomType: f("deluxe"),
    meals: f("full_board"),
    transport: f(false),
    diver: f(false),
    contactName: f("Ana"),
    ...overrides,
  } as Trip;
}

describe("Decomposed Questions Architecture (Pattern 6)", () => {
  describe("questions/intent.ts", () => {
    it("detects when guest requests a human", () => {
      expect(wantsHuman("Can I talk to a human please?")).toBe(true);
      expect(wantsHuman("转接人工客服")).toBe(true);
      expect(wantsHuman("2 guests for next Friday")).toBe(false);
    });

    it("detects when guest clarifies they are booking for themselves", () => {
      expect(declinesPartner("Actually booking for ourselves, not an agency")).toBe(true);
      expect(declinesPartner("我们自己去玩，不是旅行社")).toBe(true);
      expect(declinesPartner("We need 2 deluxe rooms")).toBe(false);
    });
  });

  describe("questions/fallback.ts", () => {
    it("provides static fallback replies", () => {
      expect(fallbackReply("apology", "en")).toContain("Sorry");
      expect(fallbackReply("apology", "zh")).toContain("抱歉");
      expect(fallbackReply("handoff", "en")).toContain("Casa team");
    });

    it("formats partner invitation link", () => {
      const invite = partnerInvitationReply("en", "https://app.test/signin");
      expect(invite).toContain("https://app.test/signin");
      expect(invite).toContain("partner agency");
    });

    it("formats stalled handoff with missing fields", () => {
      const reply = stalledHandoffReply(["nights", "rooms"], "en");
      expect(reply).toContain("how many nights");
      expect(reply).toContain("how many rooms");
    });

    it("formats changed value notice", () => {
      const notice = changedValueNotice(
        [{ field: "guests", from: 2, to: 4 }],
        "en",
      );
      expect(notice).toContain("2 guests → 4 guests");
    });

    it("exports limits", () => {
      expect(ASK_LIMIT).toBe(8);
      expect(STALL_LIMIT).toBe(3);
    });
  });

  describe("questions/rules.ts & render.ts", () => {
    it("formats date strings and ranges", () => {
      expect(formatDate("2026-11-20", "en")).toBe("Nov 20, 2026");
      expect(formatDay("2026-11-20", "en")).toBe("Nov 20");
      expect(formatRange("2026-11-20", "2026-11-22", "en")).toBe("Nov 20 – 22, 2026");
    });

    it("evaluates open rules and ready for handoff", () => {
      const complete = mockTrip();
      expect(isReadyForHandoff(complete)).toBe(true);

      const missingGuest = mockTrip({ guests: f(null, "missing") });
      expect(isReadyForHandoff(missingGuest)).toBe(false);
      const qs = generateQuestions(missingGuest);
      expect(qs.some((q) => q.field === "guests")).toBe(true);
    });

    it("renders reply summary when complete", () => {
      const complete = mockTrip();
      const reply = renderReply(complete, []);
      expect(reply.kind).toBe("summary");
      expect(reply.text).toContain("Here's what I have for your stay:");
      expect(reply.text).toContain("Ana");
    });
  });
});
