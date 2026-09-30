import { describe, it, expect } from "vitest";

// The fixtures' fixed stay dates (2026-11-20…) depend on "today" being before them: see test/setup.ts.
describe("the test clock", () => {
  it("starts on the pinned day, whatever day the suite is run on", () => {
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(new Date(Date.now()).toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("still runs forward, so a wait-until-deadline loop ends", async () => {
    const before = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(Date.now() - before).toBeGreaterThanOrEqual(20);
  });

  it("leaves explicit dates alone", () => {
    expect(new Date("2027-01-15T00:00:00Z").toISOString()).toBe("2027-01-15T00:00:00.000Z");
    expect(Date.UTC(2026, 10, 20)).toBe(new Date("2026-11-20T00:00:00Z").getTime());
  });
});
