import { describe, it, expect } from "vitest";
import { maskForLogging } from "../src/application/normalize.js";
import { verifyGuestFacingText } from "../src/application/synthesis.js";
import { corroborateCount } from "../src/domain/counts.js";

// Guest text reaches these regexes verbatim. Each was rewritten to stay linear on the input CodeQL
// named (js/polynomial-redos); these pin both halves of that change: the hostile input returns
// quickly, and the matches a guest actually produces are unchanged.
const LIMIT_MS = 500;
function timed<T>(run: () => T): T {
  const started = Date.now();
  const out = run();
  expect(Date.now() - started).toBeLessThan(LIMIT_MS);
  return out;
}

describe("the log mask", () => {
  it("stays linear on a long run of address characters with no '@'", () => {
    const hostile = "+".repeat(100_000);
    expect(timed(() => maskForLogging(hostile))).toBe(hostile);
  });

  it("still masks addresses, including two written back to back", () => {
    expect(maskForLogging("mail ana.cruz+casa@example.com now")).toBe("mail [email] now");
    expect(maskForLogging("a@x.io,b@y.io")).toBe("[email],[email]");
  });
});

describe("the fact gate", () => {
  const facts = { roomTypes: new Set(["suite"]) };

  it("stays linear on a long digit run with no currency after it", () => {
    const hostile = "We look forward to it " + "9" + "0".repeat(100_000);
    expect(timed(() => verifyGuestFacingText(hostile, {})).ok).toBe(true);
  });

  it("stays linear on 'room type' followed by a long run of spaces", () => {
    const hostile = "Thanks so much, the room type" + " ".repeat(100_000) + "x";
    expect(timed(() => verifyGuestFacingText(hostile, facts)).ok).toBe(true);
  });

  it("still refuses a price, however the number is written", () => {
    for (const text of ["Your stay comes to 12,500 PHP in total.", "That will be .5 dollars per towel, thanks.", "The total is USD 300 for everything."]) {
      expect(verifyGuestFacingText(text, {})).toMatchObject({ ok: false, reason: "unauthorized_price_quote" });
    }
  });

  it("still refuses a room type the booking does not have", () => {
    expect(verifyGuestFacingText("We have noted room type: standard for your group.", facts).ok).toBe(false);
    expect(verifyGuestFacingText("We have noted room type suite for your group, see you soon.", facts).ok).toBe(true);
  });
});

describe("count corroboration", () => {
  it("stays linear on a last turn made of spaces", () => {
    timed(() => corroborateCount("guests", 4, "hello\n" + " ".repeat(100_000) + "x"));
  });

  it("still reads a bare number as the answer to the count question", () => {
    expect(corroborateCount("guests", 4, "how many?\njust 4")).toBe("consistent");
    expect(corroborateCount("guests", 4, "how many?\nonly4")).toBe("consistent");
  });
});
