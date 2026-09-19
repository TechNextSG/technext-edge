import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { corroborateCount, countNumbersIn, type CountField } from "../src/counts.js";

// The reader that decides whether a count the model stated came from the guest's own words.
// Two things are asserted here, and they pull in opposite directions on purpose:
//
//   1. it reads the number the guest wrote, in the three languages the corpus is written
//      in, however it is spelled (digits, words, a measure word in between);
//   2. it reads numbers that are *not* counts as little as possible — the eval corpus is
//      built around traps (a phone number next to the guest count in en-03, "12 dives
//      logged" beside it, a WeChat id in zh-03, vi-09's "0988776655"), and a reader that
//      swept the message for digits would turn each of those into a question.
//
// The corpus test at the bottom is the strongest check of (1): every count the dataset
// says a message states, in every language, has to come back out of the reader.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(await readFile(path.join(__dirname, "../eval/dataset.mock-30.json"), "utf8")) as Array<{
  id: string;
  text: string;
  expected: Record<string, { state: string; value?: unknown }>;
}>;

describe("countNumbersIn — the numbers a guest put against a count", () => {
  it("reads digits written against the noun, in the three languages", () => {
    expect(countNumbersIn("nhóm mình có 4 người", "guests")).toEqual([4]);
    expect(countNumbersIn("4 of us are coming", "guests")).toEqual([4]);
    expect(countNumbersIn("我们有4位客人", "guests")).toEqual([4]);
    expect(countNumbersIn("3 phòng", "rooms")).toEqual([3]);
    expect(countNumbersIn("we need 3 rooms", "rooms")).toEqual([3]);
    expect(countNumbersIn("ở 2 đêm", "nights")).toEqual([2]);
    expect(countNumbersIn("staying 4 nights", "nights")).toEqual([4]);
    expect(countNumbersIn("一共3晚", "nights")).toEqual([3]);
  });

  it("reads a number written as a word, including unmarked Vietnamese", () => {
    // normalize() collapses whitespace but never strips diacritics, so both spellings
    // arrive here exactly as the guest typed them.
    expect(countNumbersIn("hai người", "guests")).toEqual([2]);
    expect(countNumbersIn("2 nguoi", "guests")).toEqual([2]);
    expect(countNumbersIn("bon nguoi ở lại", "guests")).toEqual([4]);
    expect(countNumbersIn("four of us", "guests")).toEqual([4]);
    expect(countNumbersIn("một phòng", "rooms")).toEqual([1]);
    expect(countNumbersIn("三个人", "guests")).toEqual([3]);
  });

  it("reads every number the guest put on that count, not just the first", () => {
    // vi-09, verbatim: the whole reason this file exists. Eight in the group, four staying.
    const text = "Alo mình là Tuấn, sđt 0988776655, nhóm mình có 8 người nhưng chỉ 4 người ở lại 2 đêm từ ngày 05/12";
    expect(countNumbersIn(text, "guests")).toEqual([4, 8]);
    expect(countNumbersIn(text, "nights")).toEqual([2]);
  });

  it("ignores numbers that are not counts — phone numbers, dive logs, prices", () => {
    const en03 = "my number is 09171234567. We are a group of certified divers (12 dives logged each) but only 2 of us are joining";
    expect(countNumbersIn(en03, "guests")).toEqual([2]);

    // A digit run inside a longer one is not a count: no prefix of a phone number is a
    // room count.
    expect(countNumbersIn("call me on 09171234567 or 0917 123 4567", "rooms")).toEqual([]);
    expect(countNumbersIn("the whole trip is 50000 pesos for 2 phòng", "rooms")).toEqual([2]);

    // Numbers that count something else entirely.
    expect(countNumbersIn("3 bữa ăn và 5 chuyến lặn", "nights")).toEqual([]);
    expect(countNumbersIn("we have 2 instructors and 2 dive guides", "guests")).toEqual([]);
  });

  it("says nothing about text with no count in it", () => {
    expect(countNumbersIn("mình muốn hỏi giá", "guests")).toEqual([]);
    expect(countNumbersIn("", "nights")).toEqual([]);
    expect(countNumbersIn("we might come sometime in December", "nights")).toEqual([]);
  });

  it("does not read a noun-first number (\"phòng 2\" is a room number, not 2 rooms)", () => {
    expect(countNumbersIn("phòng 2 còn trống không?", "rooms")).toEqual([]);
  });
});

describe("corroborateCount — what keeps a model's number", () => {
  it("keeps the model's number when the guest's words put it on that count", () => {
    expect(corroborateCount("guests", 4, "chúng tôi có 4 người")).toBe("consistent");
    expect(corroborateCount("nights", 3, "chúng tôi ở 3 đêm")).toBe("consistent");
    expect(corroborateCount("rooms", 2, "cần 2 phòng")).toBe("consistent");
    expect(corroborateCount("guests", 2, "2 of us")).toBe("consistent");
  });

  it("refuses a number that is not the one the guest put on this count", () => {
    expect(corroborateCount("nights", 4, "chúng tôi ở 2 đêm")).toBe("conflicting");
    expect(corroborateCount("guests", 5, "chúng tôi có 6 người")).toBe("conflicting");
    expect(corroborateCount("guests", 8, "party of 2")).toBe("conflicting");
  });

  it("is scoped to its own noun, so one count's number is not read as another's", () => {
    // "3 phòng" says nothing about guests. Reading it as a guest count would make every
    // rooms-first message a question, and the trap corpus (en-03, vi-09, zh-03) shows how
    // much damage a reader that grabs numbers outside its own field would do. A model that
    // moves a number between fields is the fabrication case the eval scores on its own: a
    // field the ground truth marks `missing` coming back non-null.
    expect(corroborateCount("guests", 3, "cần 3 phòng cho gia đình")).toBe("no-opinion");
  });

  it("refuses a number whose own quote is about a different count", () => {
    // The one thing this reader knows when the guest's words say nothing about a count is which
    // count the model's *own quote* is about — and a quote about another count is not support for
    // this field. "cần 3 phòng cho gia đình" states a room count and says nothing about guests,
    // so a `guests: 3` quoted from it is a room count priced per head: the mirror image of
    // vi-09, where the number is real but is not this field's number. Both become questions.
    const roomsOnly = "cần 3 phòng cho gia đình";
    expect(corroborateCount("guests", 3, roomsOnly, "3 phòng")).toBe("conflicting");
    expect(corroborateCount("nights", 3, roomsOnly, "cần 3 phòng")).toBe("conflicting");

    // A count the guest's own words *do* settle is still decided by those words, and by nothing
    // else: two nights asked for in the same message as three rooms is kept, quote and all, and
    // the quote is support for the count it names.
    expect(corroborateCount("rooms", 3, roomsOnly, "3 phòng")).toBe("consistent");
    expect(corroborateCount("nights", 2, "ở lại 2 đêm, cần 3 phòng", "ở lại 2 đêm")).toBe("consistent");

    // A quote that names both counts is evidence for either, so it decides nothing…
    expect(corroborateCount("guests", 4, "mình đặt 2 phòng cho nhóm", "4 người và 2 phòng")).toBe("no-opinion");
    // …and a quote with no count noun in it is not evidence against the number either.
    expect(corroborateCount("guests", 6, "chúng tôi đi cả gia đình", "cả gia đình")).toBe("no-opinion");
  });

  it("refuses both numbers when the guest's own message states two (vi-09)", () => {
    // Not "the largest" and not "the first": the message does not identify a total, so
    // only the guest can. Picking either one is a 100% error on the biggest line.
    const text = "nhóm mình có 8 người nhưng chỉ 4 người ở lại 2 đêm";
    expect(corroborateCount("guests", 8, text)).toBe("conflicting");
    expect(corroborateCount("guests", 4, text)).toBe("conflicting");
    // …and the nights in the same sentence, where there is only one number, are kept.
    expect(corroborateCount("nights", 2, text)).toBe("consistent");
  });

  it("has no opinion when the guest never put a number on that count", () => {
    // A count phrased in a way this reader cannot see is still the guest's number; the
    // caller keeps whatever the rest of the pipeline decided.
    expect(corroborateCount("guests", 6, "chúng tôi đi cả gia đình")).toBe("no-opinion");
    expect(corroborateCount("rooms", 2, "cần phòng đôi")).toBe("no-opinion");
    expect(corroborateCount("nights", 3, "ở lại vài hôm")).toBe("no-opinion");
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

  it("reads the count every dataset message states — and flags the one that states two", () => {
    const twoNumbers: string[] = [];
    const excused: string[] = [];

    for (const item of dataset) {
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

        // vi-09 is the trap this file exists for: the group is 8 and 4 are staying, so
        // the reader has to see both rather than quietly choose one.
        if (numbers.length > 1) {
          twoNumbers.push(key);
          continue;
        }
        expect(numbers, `${key} states ${String(expected.value)} and the reader found nothing`).toEqual([
          expected.value,
        ]);
      }
    }

    expect(twoNumbers).toEqual(["vi-09-bay-so-dien-thoai.guests"]);
    expect(excused.sort()).toEqual(Object.keys(NO_NUMBER_AGAINST_THE_NOUN).sort());
  });
});
