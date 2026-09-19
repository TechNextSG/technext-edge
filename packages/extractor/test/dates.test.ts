import { describe, it, expect } from "vitest";
import {
  resolveRelativeDate,
  deriveCheckOut,
  isPlausibleStayDate,
  corroborateDatePhrase,
} from "../src/dates.js";

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

  it("accepts an explicit numeric calendar date from a follow-up answer", () => {
    expect(resolveRelativeDate("19/9/2026", TODAY)).toBe("2026-09-19");
    expect(resolveRelativeDate("2026-09-19", TODAY)).toBe("2026-09-19");
    expect(resolveRelativeDate("31/2/2026", TODAY)).toBeNull();
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

  it("resolves 'thứ Bảy này' (this Saturday), found via a live Gemini test that left it unresolved", () => {
    expect(resolveRelativeDate("thứ Bảy này", TODAY)).toBe("2026-09-19");
  });

  it("resolves Vietnamese digit weekdays, the form guests actually type", () => {
    // Found live: the table had the named form ("thứ bảy") and t7 but not "thứ 7",
    // so a guest answering "thứ 7 tuần sau" resolved to null and lost their check-in
    // date to a missing field.
    expect(resolveRelativeDate("thứ 7 tuần sau", TODAY)).toBe("2026-09-26");
    expect(resolveRelativeDate("thu 7", TODAY)).toBe("2026-09-19");
    expect(resolveRelativeDate("thứ 2 tuần sau", TODAY)).toBe("2026-09-28");
    expect(resolveRelativeDate("thứ 3", TODAY)).toBe("2026-09-22");
    expect(resolveRelativeDate("thu 5 nay", TODAY)).toBe("2026-09-17");
  });

  it("reads a weekday the guest qualifies with a bare 'tới', quoted inside a sentence too", () => {
    // eval's vi-07 is "check in thứ Bảy tới": the qualifier used to survive the strip, so
    // the phrase matched nothing and the guest was asked for the date they had written.
    // The recording also shows the model quoting a whole fragment rather than a tidy
    // phrase — its vi-03 evidence was "ở 1 đêm cuối tuần sau" — so the weekday has to be
    // findable inside one.
    expect(resolveRelativeDate("thứ Bảy tới", TODAY)).toBe("2026-09-19");
    expect(resolveRelativeDate("check in thứ Bảy tới", TODAY)).toBe("2026-09-19");
    expect(resolveRelativeDate("thứ 7 tới", TODAY)).toBe("2026-09-19");
    expect(resolveRelativeDate("chủ nhật tới", TODAY)).toBe("2026-09-20");
    expect(resolveRelativeDate("tuần này mình đi thứ 3", TODAY)).toBe("2026-09-22");
  });

  it("reads a weekend phrase however it is worded, 'day' inside 'weekend' included", () => {
    // The old guard was `!/thứ|thu|day/` on the stripped phrase, and "weekend" contains
    // "day": the phrase blocked itself, so which weekend forms resolved depended on what
    // else the model happened to quote. In the live run "this weekend" (en-02) and
    // "cuối tuần này" (vi-08) were both the coming Saturday.
    expect(resolveRelativeDate("this weekend", TODAY)).toBe("2026-09-19");
    expect(resolveRelativeDate("weekend", TODAY)).toBe("2026-09-19");
    expect(resolveRelativeDate("cuối tuần này", TODAY)).toBe("2026-09-19");
  });

  it("returns null for phrases it cannot parse, instead of guessing", () => {
    expect(resolveRelativeDate("sometime in December maybe", TODAY)).toBeNull();
  });

  it("reads a day-offset word inside the sentence the model quoted", () => {
    // The evidence a model lifts is a fragment, not a tidy phrase: en-03's was "arriving
    // tomorrow" and en-05's "planning a trip in 5 days". Both were resolved by the
    // corroboration path only, which left the date to the model's own arithmetic; reading
    // them here is what takes the model out of it.
    expect(resolveRelativeDate("arriving tomorrow", TODAY)).toBe("2026-09-16");
    expect(resolveRelativeDate("planning a trip in 5 days", TODAY)).toBe("2026-09-20");
    expect(resolveRelativeDate("chúng tôi đến ngày mai", TODAY)).toBe("2026-09-16");
    // Longest phrase first: "the day after tomorrow" contains "tomorrow".
    expect(resolveRelativeDate("leaving the day after tomorrow", TODAY)).toBe("2026-09-17");
  });

  it("refuses a date the guest negated", () => {
    // "not tomorrow" is the opposite of a date, and reading the word without the negation
    // is a stay priced on a day the guest ruled out. Blunt on purpose: the cost of
    // refusing is one question.
    expect(resolveRelativeDate("not tomorrow", TODAY)).toBeNull();
    expect(resolveRelativeDate("không phải ngày mai", TODAY)).toBeNull();
    expect(resolveRelativeDate("不是明天", TODAY)).toBeNull();
  });

  it("reads an English month name with a day on it, and nothing vaguer than that", () => {
    // en-06/07/08's forms, verbatim. Three of the 19 check-ins the pre-fix pipeline deleted
    // were these, and the table had no entry for any of them.
    expect(resolveRelativeDate("starting Oct 10th", TODAY)).toBe("2026-10-10");
    expect(resolveRelativeDate("starting Nov 2", TODAY)).toBe("2026-11-02");
    expect(resolveRelativeDate("coming Dec 1st", TODAY)).toBe("2026-12-01");
    expect(resolveRelativeDate("on 8 October", TODAY)).toBe("2026-10-08");
    // A month on its own is still not a check-in date.
    expect(resolveRelativeDate("sometime in December", TODAY)).toBeNull();
    expect(resolveRelativeDate("next month", TODAY)).toBeNull();
  });
});

describe("resolveRelativeDate — a week qualifier said on that same weekday", () => {
  // Anchor: Friday 2026-09-18, the day the eval recording was made, so the case below is
  // the eval corpus's own zh-08 rather than a made-up edge: "下周五" said on a Friday.
  const FRIDAY = "2026-09-18";

  it("takes a next-week weekday to *next* week, not two weeks out", () => {
    // The qualifier was added *after* the "it is today, so say next week" substitution, so
    // a next-week Friday said on a Friday landed on 2026-10-02 and the stay was priced a
    // week late. The live run did exactly that — see zh-08's check-in in
    // results-deepseek.log, which the replay test now pins to 2026-09-25.
    expect(resolveRelativeDate("下周五", FRIDAY)).toBe("2026-09-25");
    expect(resolveRelativeDate("next Friday", FRIDAY)).toBe("2026-09-25");
    expect(resolveRelativeDate("thứ Sáu tuần sau", FRIDAY)).toBe("2026-09-25");
  });

  it("still means the coming one for a bare weekday named on its own day", () => {
    expect(resolveRelativeDate("Friday", FRIDAY)).toBe("2026-09-25");
  });
});

describe("deriveCheckOut", () => {
  it("adds nights to check-in, never asks the model", () => {
    expect(deriveCheckOut("2026-09-19", 3)).toBe("2026-09-22");
  });
});

// The tables below exist because a phrase the parser cannot read used to cost the
// guest their check-in date entirely. These are the eval corpus's own words: 8 of the
// 10 Chinese cases, plus vi-04's "từ ngày 15/10".
describe("resolveRelativeDate — Chinese forms", () => {
  it("reads N月N日 / N月N号, the form 8 of the 10 Chinese eval cases use", () => {
    expect(resolveRelativeDate("10月12日", TODAY)).toBe("2026-10-12");
    expect(resolveRelativeDate("11月5号", TODAY)).toBe("2026-11-05");
    expect(resolveRelativeDate("10月20日", TODAY)).toBe("2026-10-20");
    expect(resolveRelativeDate("10月24日", TODAY)).toBe("2026-10-24");
    expect(resolveRelativeDate("11月8日", TODAY)).toBe("2026-11-08");
    expect(resolveRelativeDate("11月15日", TODAY)).toBe("2026-11-15");
    expect(resolveRelativeDate("12月10日", TODAY)).toBe("2026-12-10");
    // No year on any of them: the next time that day comes around, so a January date
    // said in September is next January.
    expect(resolveRelativeDate("1月15日", TODAY)).toBe("2027-01-15");
    expect(resolveRelativeDate("2027年1月15日", TODAY)).toBe("2027-01-15");
    expect(resolveRelativeDate("2月31日", TODAY)).toBeNull(); // no such day
  });

  it("reads 周/星期/礼拜 weekdays, including the next-week form", () => {
    // zh-01 and zh-08 of the eval set, verbatim.
    expect(resolveRelativeDate("下周六", TODAY)).toBe("2026-09-26");
    expect(resolveRelativeDate("下周五", TODAY)).toBe("2026-09-25");
    expect(resolveRelativeDate("周三", TODAY)).toBe("2026-09-16");
    expect(resolveRelativeDate("星期三", TODAY)).toBe("2026-09-16");
    expect(resolveRelativeDate("星期日", TODAY)).toBe("2026-09-20");
    expect(resolveRelativeDate("下周末", TODAY)).toBe("2026-09-26");
  });

  it("reads 明天/后天/大后天, longest word first so 大后天 is not read as 后天", () => {
    expect(resolveRelativeDate("明天", TODAY)).toBe("2026-09-16");
    expect(resolveRelativeDate("后天", TODAY)).toBe("2026-09-17");
    expect(resolveRelativeDate("大后天", TODAY)).toBe("2026-09-18");
  });
});

describe("resolveRelativeDate — a date with no year", () => {
  it("reads 15/10 the way the guest meant it", () => {
    // Month 15 does not exist, so there is only one reading to choose from.
    expect(resolveRelativeDate("15/10", TODAY)).toBe("2026-10-15");
    expect(resolveRelativeDate("ngày 20/11", TODAY)).toBe("2026-11-20");
    expect(resolveRelativeDate("20/1", TODAY)).toBe("2027-01-20");
    expect(resolveRelativeDate("15/10/2026", TODAY)).toBe("2026-10-15"); // with the year: unchanged
    expect(resolveRelativeDate("5/5", TODAY)).toBe("2027-05-05"); // both readings are the same day
  });

  it("returns null for an ambiguous 7/3 rather than pick a month", () => {
    // 7 March to a Vietnamese guest, 3 July to an English one, and this call has no language
    // to go on. Asking costs a turn; guessing wrong prices the wrong month. extract.ts passes
    // the language it detected (the next test), and only then does the pair have one reading.
    expect(resolveRelativeDate("7/3", TODAY)).toBeNull();
    // A two-digit year is not guessed at either.
    expect(resolveRelativeDate("3/3/17", TODAY)).toBeNull();
  });

  it("reads an ambiguous pair the way the guest's own language writes it", () => {
    // eval's vi-09 and vi-10, verbatim — the last two check-ins no table could settle, and the
    // two the eval replay used to hand to the model's own date. Vietnam and China write
    // day/month, so a pair that is two valid dates on its own has exactly one reading once the
    // guest's language is known — and extract.ts knows it from the same message (normalize.ts
    // detects it for the trip's `language` field either way).
    expect(resolveRelativeDate("từ ngày 05/12", TODAY, "vi")).toBe("2026-12-05");
    expect(resolveRelativeDate("từ 12/10", TODAY, "vi")).toBe("2026-10-12");
    expect(resolveRelativeDate("05/12", TODAY, "zh")).toBe("2026-12-05");
    // The same pair to an English-speaking guest is month/day: the reading their convention
    // leaves, so the resolver is not a one-way rule either.
    expect(resolveRelativeDate("12/10", TODAY, "en")).toBe("2026-12-10");

    // Language only breaks a tie between two possible dates. "15/10" has no month 15 in any
    // language, so it stays the one reading it can be — refusing it because the guest's
    // convention prefers the other order would delete a date they plainly wrote, which is the
    // failure this whole table exists to avoid.
    expect(resolveRelativeDate("15/10", TODAY, "vi")).toBe("2026-10-15");
    expect(resolveRelativeDate("15/10", TODAY, "en")).toBe("2026-10-15");
  });
});

describe("isPlausibleStayDate — the calendar half of accepting a model's date", () => {
  it("accepts an exact future calendar date inside the horizon, and nothing else", () => {
    expect(isPlausibleStayDate("2026-09-15", TODAY)).toBe(true); // today is still a stay
    expect(isPlausibleStayDate("2026-09-26", TODAY)).toBe(true);
    expect(isPlausibleStayDate("2028-09-14", TODAY)).toBe(true); // today + 730
    expect(isPlausibleStayDate("2026-09-14", TODAY)).toBe(false); // yesterday
    expect(isPlausibleStayDate("2028-09-15", TODAY)).toBe(false); // one day past the horizon
    expect(isPlausibleStayDate("2026-02-31", TODAY)).toBe(false); // Date rolls this to 3 March
    expect(isPlausibleStayDate("2026-9-5", TODAY)).toBe(false); // not the ISO shape the model was asked for
    expect(isPlausibleStayDate("next Saturday", TODAY)).toBe(false); // a phrase, not a date
  });
});

describe("corroborateDatePhrase — what lets a model's date be used at all", () => {
  it("confirms a date that matches the weekday and the week the guest named", () => {
    expect(corroborateDatePhrase("下周五", "2026-09-25", TODAY)).toBe("consistent");
    expect(corroborateDatePhrase("下周六", "2026-09-26", TODAY)).toBe("consistent");
    expect(corroborateDatePhrase("the coming Friday", "2026-09-18", TODAY)).toBe("consistent");
    expect(corroborateDatePhrase("thứ 7 tuần sau", "2026-09-26", TODAY)).toBe("consistent");
  });

  it("contradicts the wrong week, the wrong day, the wrong month and the past", () => {
    // Same weekday, wrong week: the off-by-one-week misreading of 下周五, which is the
    // error most likely to cost money (it is the wrong week's price).
    expect(corroborateDatePhrase("下周五", "2026-09-18", TODAY)).toBe("contradicted");
    expect(corroborateDatePhrase("下周五", "2026-09-19", TODAY)).toBe("contradicted"); // a Saturday
    expect(corroborateDatePhrase("12月10日", "2026-11-10", TODAY)).toBe("contradicted");
    expect(corroborateDatePhrase("明天", "2026-09-20", TODAY)).toBe("contradicted");
    expect(corroborateDatePhrase("15/10", "2026-11-15", TODAY)).toBe("contradicted");
    expect(corroborateDatePhrase("next Saturday", "2026-09-14", TODAY)).toBe("contradicted"); // the past
    expect(corroborateDatePhrase("想喝咖啡", "2026-09-16", TODAY)).toBe("no-opinion"); // no date words at all
  });

  it("confirms day/month pairs in either reading, and 明天/后天", () => {
    expect(corroborateDatePhrase("ngày 15/10", "2026-10-15", TODAY)).toBe("consistent");
    expect(corroborateDatePhrase("7/3", "2027-07-03", TODAY)).toBe("consistent"); // day/month
    expect(corroborateDatePhrase("7/3", "2027-03-07", TODAY)).toBe("consistent"); // month/day
    expect(corroborateDatePhrase("明天", "2026-09-16", TODAY)).toBe("consistent");
    expect(corroborateDatePhrase("后天", "2026-09-17", TODAY)).toBe("consistent");
  });

  it("holds a pair to the guest's own reading once it knows the language", () => {
    // The two readings above are both accepted only because nothing said which convention the
    // guest writes in. With the language extract.ts detected, a Vietnamese guest's "05/12" is 5
    // December — so a model that read the pair backwards is contradicted instead of being
    // waved through as the other valid reading, which is the wrong-month price this closes.
    expect(corroborateDatePhrase("05/12", "2026-12-05", TODAY, "vi")).toBe("consistent");
    expect(corroborateDatePhrase("05/12", "2027-05-12", TODAY, "vi")).toBe("contradicted");
    expect(corroborateDatePhrase("05/12", "2027-05-12", TODAY, "en")).toBe("consistent");
  });

  it("holds a model's date to a counted offset, even inside a longer quote", () => {
    // en-05's "in 5 days" is the form the resolver only reads bare, so this anchor is what
    // keeps a quoted fragment ("planning a trip in 5 days") from being thrown away — and
    // what rejects a model that reads the offset as something else.
    expect(corroborateDatePhrase("planning a trip in 5 days", "2026-09-20", TODAY)).toBe("consistent");
    expect(corroborateDatePhrase("planning a trip in 5 days", "2026-09-27", TODAY)).toBe("contradicted");
    expect(corroborateDatePhrase("5 ngày nữa", "2026-09-20", TODAY)).toBe("consistent");
    // The same for a weekday and a weekend phrase the model quoted with words around them.
    expect(corroborateDatePhrase("check in thứ Bảy tới", "2026-09-19", TODAY)).toBe("consistent");
    expect(corroborateDatePhrase("weekend", "2026-09-19", TODAY)).toBe("consistent");
  });

  it("has no opinion on a negated date, so the guest keeps getting asked", () => {
    // The offset reader refuses a negated phrase (resolveRelativeDate, same function), and
    // corroboration has to refuse it for the same reason: a model that read "not tomorrow"
    // as tomorrow must not be able to confirm its own mistake against the guest's words.
    expect(corroborateDatePhrase("not tomorrow", "2026-09-16", TODAY)).toBe("no-opinion");
    expect(corroborateDatePhrase("không phải ngày mai", "2026-09-16", TODAY)).toBe("no-opinion");
  });

  it("has no opinion on a vague phrase, so the guest keeps getting asked", () => {
    // eval's vi-02 expects `missing` for "chưa chốt ngày, khoảng cuối tháng này": a
    // month name is not a check-in date, and a model will happily offer a day in it.
    expect(corroborateDatePhrase("cuối tháng này", "2026-09-30", TODAY)).toBe("no-opinion");
    expect(corroborateDatePhrase("sometime in December maybe", "2026-12-05", TODAY)).toBe("no-opinion");
    expect(corroborateDatePhrase("sometime in December maybe", "2026-11-05", TODAY)).toBe("contradicted");
  });
});
