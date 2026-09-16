import { describe, it, expect } from "vitest";
import { resolveRelativeDate, deriveCheckOut } from "../src/dates.js";

// Anchor: Tuesday 2026-09-15 (Manila) — matches the date these docs were written.
const TODAY = "2026-09-15";

describe("resolveRelativeDate", () => {
  it("resolves today and tomorrow, VI and EN", () => {
    expect(resolveRelativeDate("today", TODAY)).toBe("2026-09-15");
    expect(resolveRelativeDate("hôm nay", TODAY)).toBe("2026-09-15");
    expect(resolveRelativeDate("tomorrow", TODAY)).toBe("2026-09-16");
    expect(resolveRelativeDate("ngày mai", TODAY)).toBe("2026-09-16");
  });

  it("resolves 'in N days' phrasing", () => {
    expect(resolveRelativeDate("in 5 days", TODAY)).toBe("2026-09-20");
    expect(resolveRelativeDate("5 ngày nữa", TODAY)).toBe("2026-09-20");
  });

  it("resolves a plain weekday to the next occurrence, never today", () => {
    // TODAY is a Tuesday; "Tuesday" with no qualifier must mean next Tuesday.
    expect(resolveRelativeDate("Tuesday", TODAY)).toBe("2026-09-22");
    expect(resolveRelativeDate("Saturday", TODAY)).toBe("2026-09-19");
  });

  it("resolves 'next <weekday>' as a full week further out", () => {
    expect(resolveRelativeDate("next Saturday", TODAY)).toBe("2026-09-26");
  });

  it("treats a bare weekend reference as the coming Saturday", () => {
    expect(resolveRelativeDate("cuối tuần sau", TODAY)).toBe("2026-09-26");
  });

  it("returns null for phrases it cannot parse, instead of guessing", () => {
    expect(resolveRelativeDate("sometime in December maybe", TODAY)).toBeNull();
  });
});

describe("deriveCheckOut", () => {
  it("adds nights to check-in, never asks the model", () => {
    expect(deriveCheckOut("2026-09-19", 3)).toBe("2026-09-22");
  });
});
