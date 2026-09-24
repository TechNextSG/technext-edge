import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { corroborateCount, countNumbersIn, type CountField } from "../src/counts.js";

// The reader that decides whether a count the model stated came from the guest's own words.
// Two things are asserted here, and they pull in opposite directions on purpose:
//
//   1. it reads the number the guest wrote, in the languages the corpus is written in
//      (English and Chinese), however it is spelled (digits, words, a measure word in
//      between);
//   2. it reads numbers that are *not* counts as little as possible — the eval corpus is
//      built around traps (a phone number next to the guest count in en-03, "12 dives
//      logged" beside it, a WeChat id in zh-03), and a reader that swept the message for
//      digits would turn each of those into a question.
//
// The corpus test at the bottom is the strongest check of (1): every count the dataset
// says a message states, in every non-Vietnamese case, has to come back out of the reader.
//
// Vietnamese was removed from src/counts.ts on 2026-09-24 with the rest of the Vietnamese
// support, so the Vietnamese spellings these tests used to cover ("4 người", "hai phòng",
// "bon nguoi") are gone from the reader and from this file. Each case keeps its English and
// Chinese halves.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(await readFile(path.join(__dirname, "../eval/dataset.mock-30.json"), "utf8")) as Array<{
  id: string;
  text: string;
  expected: Record<string, { state: string; value?: unknown }>;
}>;

describe("countNumbersIn — the numbers a guest put against a count", () => {
  it("reads digits written against the noun, in both languages", () => {
    expect(countNumbersIn("4 of us are coming", "guests")).toEqual([4]);
    expect(countNumbersIn("我们有4位客人", "guests")).toEqual([4]);
    expect(countNumbersIn("we need 3 rooms", "rooms")).toEqual([3]);
    expect(countNumbersIn("需要2间房", "rooms")).toEqual([2]);
    expect(countNumbersIn("staying 4 nights", "nights")).toEqual([4]);
    expect(countNumbersIn("一共3晚", "nights")).toEqual([3]);
  });

  it("reads a number written as a word", () => {
    expect(countNumbersIn("four of us", "guests")).toEqual([4]);
    expect(countNumbersIn("we are three guests", "guests")).toEqual([3]);
    expect(countNumbersIn("two rooms please", "rooms")).toEqual([2]);
    expect(countNumbersIn("三个人", "guests")).toEqual([3]);
    expect(countNumbersIn("两个房间", "rooms")).toEqual([2]);
  });

  it("reads every number the guest put on that count, not just the first", () => {
    // vi-09's shape — eight in the group, four of them staying — in the languages the
    // reader still supports. This is the whole reason the file exists.
    const zhTrap = "我们一共8位客人，但只有4位客人住2晚";
    expect(countNumbersIn(zhTrap, "guests")).toEqual([4, 8]);
    expect(countNumbersIn(zhTrap, "nights")).toEqual([2]);

    const enStay = "Our group has 6 people but only 3 are staying for 2 nights starting Oct 10th.";
    expect(countNumbersIn(enStay, "guests")).toEqual([3, 6]);
    expect(countNumbersIn(enStay, "nights")).toEqual([2]);
  });

  it("ignores numbers that are not counts — phone numbers, dive logs, prices", () => {
    const en03 = "my number is 09171234567. We are a group of certified divers (12 dives logged each) but only 2 of us are joining";
    expect(countNumbersIn(en03, "guests")).toEqual([2]);

    // A digit run inside a longer one is not a count: no prefix of a phone number is a
    // room count.
    expect(countNumbersIn("call me on 09171234567 or 0917 123 4567", "rooms")).toEqual([]);
    expect(countNumbersIn("the whole trip is 50000 pesos for 2 rooms", "rooms")).toEqual([2]);

    // Numbers that count something else entirely.
    expect(countNumbersIn("3 meals and 5 dives", "nights")).toEqual([]);
    expect(countNumbersIn("we have 2 instructors and 2 dive guides", "guests")).toEqual([]);
  });

  it("says nothing about text with no count in it", () => {
    expect(countNumbersIn("can I ask about the price", "guests")).toEqual([]);
    expect(countNumbersIn("", "nights")).toEqual([]);
    expect(countNumbersIn("we might come sometime in December", "nights")).toEqual([]);
  });

  it("does not read a noun-first number (\"room 2\" is a room number, not 2 rooms)", () => {
    expect(countNumbersIn("is room 2 still available?", "rooms")).toEqual([]);
  });
});

describe("corroborateCount — what keeps a model's number", () => {
  it("keeps the model's number when the guest's words put it on that count", () => {
    expect(corroborateCount("guests", 4, "we have 4 guests")).toBe("consistent");
    expect(corroborateCount("nights", 3, "we are staying 3 nights")).toBe("consistent");
    expect(corroborateCount("rooms", 2, "we need 2 rooms")).toBe("consistent");
    expect(corroborateCount("guests", 2, "2 of us")).toBe("consistent");
  });

  it("refuses a number that is not the one the guest put on this count", () => {
    expect(corroborateCount("nights", 4, "we are staying 2 nights")).toBe("conflicting");
    expect(corroborateCount("guests", 5, "we have 6 guests")).toBe("conflicting");
    expect(corroborateCount("guests", 8, "party of 2")).toBe("conflicting");
  });

  it("is scoped to its own noun, so one count's number is not read as another's", () => {
    // "3 rooms" says nothing about guests. Reading it as a guest count would make every
    // rooms-first message a question, and the trap corpus (en-03, zh-03) shows how much
    // damage a reader that grabs numbers outside its own field would do. A model that
    // moves a number between fields is the fabrication case the eval scores on its own: a
    // field the ground truth marks `missing` coming back non-null.
    expect(corroborateCount("guests", 3, "we need 3 rooms for the family")).toBe("no-opinion");
  });

  it("refuses a number whose own quote is about a different count", () => {
    // The one thing this reader knows when the guest's words say nothing about a count is which
    // count the model's *own quote* is about — and a quote about another count is not support for
    // this field. "we need 3 rooms for the family" states a room count and says nothing about
    // guests, so a `guests: 3` quoted from it is a room count priced per head. Both become
    // questions.
    const roomsOnly = "we need 3 rooms for the family";
    expect(corroborateCount("guests", 3, roomsOnly, "3 rooms")).toBe("conflicting");
    expect(corroborateCount("nights", 3, roomsOnly, "we need 3 rooms")).toBe("conflicting");

    // A count the guest's own words *do* settle is still decided by those words, and by nothing
    // else: two nights asked for in the same message as three rooms is kept, quote and all, and
    // the quote is support for the count it names.
    expect(corroborateCount("rooms", 3, roomsOnly, "3 rooms")).toBe("consistent");
    expect(corroborateCount("nights", 2, "staying 2 nights, need 3 rooms", "staying 2 nights")).toBe("consistent");

    // A quote that names both counts is evidence for either, so it decides nothing…
    expect(corroborateCount("guests", 4, "we booked 2 rooms for the group", "4 guests and 2 rooms")).toBe("no-opinion");
    // …and a quote with no count noun in it is not evidence against the number either.
    expect(corroborateCount("guests", 6, "the whole family is coming", "the whole family")).toBe("no-opinion");
  });

  it("reads divers as its own count, separate from guests", () => {
    // "2 divers" must not also read as a guest count: a family of 5 with 2 divers has two
    // different, real numbers, and conflating them is the EN-LONG-02 bug (guests=5, divers
    // vanished — see docs/casa-anilao-test-scenarios.html).
    const text = "We have 2 divers in our group, staying 3 nights";
    expect(countNumbersIn(text, "divers")).toEqual([2]);
    expect(countNumbersIn(text, "guests")).toEqual([]);
    expect(corroborateCount("divers", 2, text)).toBe("consistent");
  });

  it("lets a divers quote support guests, but not the reverse", () => {
    // "6 AOW divers" does not sit directly against a guests noun, so corroboration falls
    // back to what the model's own quote names. Every diver is a guest, so that quote is
    // real support for a guests count that happens to equal it (en-01: the whole party
    // dives) — not "conflicting" the way an unrelated quote would be.
    const text = "International group diving Anilao";
    expect(corroborateCount("guests", 6, text, "6 AOW divers")).toBe("no-opinion");
    // The relationship is one-way: a quote naming guests says nothing about how many of
    // them dive, so it is not support for `divers`.
    expect(corroborateCount("divers", 6, text, "6 guests confirmed")).toBe("conflicting");
  });

  it("refuses both numbers when the guest's own message states two", () => {
    // Not "the largest" and not "the first": the message does not identify a total, so
    // only the guest can. Picking either one is a 100% error on the biggest line. This is
    // vi-09's shape, written in Chinese — the vi-* messages are no longer readable.
    const text = "我们一共8位客人，但只有4位客人住2晚";
    expect(corroborateCount("guests", 8, text)).toBe("conflicting");
    expect(corroborateCount("guests", 4, text)).toBe("conflicting");
    // …and the nights in the same sentence, where there is only one number, are kept.
    expect(corroborateCount("nights", 2, text)).toBe("consistent");
  });

  it("corroborates a bare number reply in multi-turn conversation", () => {
    const history = [
      "Hi! Our group has 6 people coming this Saturday, but only 3 are staying for 2 nights",
      "I have an added person",
      "4",
    ].join("\n");
    expect(corroborateCount("guests", 4, history)).toBe("consistent");
    expect(corroborateCount("guests", 5, history)).toBe("conflicting");
  });

  it("has no opinion when the guest never put a number on that count", () => {
    // A count phrased in a way this reader cannot see is still the guest's number; the
    // caller keeps whatever the rest of the pipeline decided.
    expect(corroborateCount("guests", 6, "the whole family is coming")).toBe("no-opinion");
    expect(corroborateCount("rooms", 2, "we need a double room")).toBe("no-opinion");
    expect(corroborateCount("nights", 3, "staying a few days")).toBe("no-opinion");
  });
});

describe("countNumbersIn against the eval corpus", () => {
  const FIELDS: CountField[] = ["nights", "guests", "rooms"];

  // Cases where the guest's message states the count without a number written against its
  // noun. The reader deliberately says nothing there — its header explains why widening the
  // window between a number and a noun is the risky direction — and "no opinion" is not
  // "conflict": the caller keeps the model's number. Listed with the reason, and asserted
  // at the end so the list cannot rot silently.
  const NO_NUMBER_AGAINST_THE_NOUN: Record<string, string> = {
    "en-07-fun-diving-package.guests": '"3 certified rescue divers" — modifiers between the number and the noun',
    "en-10-solo-diver.guests": '"Solo diver" — one guest, and no number anywhere in the message',
  };

  it("reads the count every non-Vietnamese dataset message states", () => {
    const twoNumbers: string[] = [];
    const excused: string[] = [];

    // The reader no longer supports Vietnamese input (counts.ts, 2026-09-24), so the ten
    // vi-* messages cannot be read at all and are not part of this check. The two-number
    // trap they carried — vi-09, the case this file was written for — is asserted directly
    // in Chinese in the describe above.
    for (const item of dataset.filter((c) => !/^vi-/.test(c.id))) {
      for (const field of FIELDS) {
        const expected = item.expected[field];
        if (expected?.state !== "stated") continue;
        const key = `${item.id}.${field}`;
        const numbers = countNumbersIn(item.text, field);

        const excuse = NO_NUMBER_AGAINST_THE_NOUN[key];
        if (excuse) {
          excused.push(key);
          expect(numbers, `${key}: ${excuse}`).toEqual([]);
          continue;
        }

        // A message that states two numbers for one count is reported rather than read as
        // either one: the reader has to see both rather than quietly choose.
        if (numbers.length > 1) {
          twoNumbers.push(key);
          continue;
        }
        expect(numbers, `${key} states ${String(expected.value)} and the reader found nothing`).toEqual([
          expected.value,
        ]);
      }
    }

    // No remaining (en/zh) message puts two numbers on one count; the vi-09 shape is
    // asserted in `corroborateCount` above.
    expect(twoNumbers).toEqual([]);
    expect(excused.sort()).toEqual(Object.keys(NO_NUMBER_AGAINST_THE_NOUN).sort());
  });
});
