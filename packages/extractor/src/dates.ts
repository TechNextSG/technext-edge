// Playbook: "Relative dates are computed in code on Manila time, never trusted
// from the model." The model's job is to lift a date phrase verbatim as evidence
// (e.g. "cuối tuần sau", "next Saturday"); this file turns that phrase into an
// ISO date. Nothing here calls a model.
//
// That rule is right about *pricing* and was wrong as an absolute, and the cost
// landed on the guest: the table below cannot know every phrasing a guest types —
// it lost "hôm kia", "chúa nhật", "7/3" and, until the Chinese entries were added,
// every one of the 10 Chinese cases in eval/dataset.mock-30.json (8 of them spell
// the date 月/日 or 周/星期) — and a phrase the table could not read meant a
// check-in date the model *had* computed correctly was deleted, so the guest was
// asked for a date they had already given. The rule now has two halves:
//
//  1. code resolves what it can (resolveRelativeDate below), and
//  2. when the table cannot read a phrase, a date the model proposed is accepted
//     only if this file can corroborate it against the guest's own words
//     (corroborateDatePhrase) and against the calendar (isPlausibleStayDate).
//
// Anything less than that stays `missing`, which is what turns the field back into
// a question. The model proposes; this file decides.

import type { GuestLanguage } from "./normalize.js";

const MANILA_OFFSET_MINUTES = 8 * 60; // UTC+8, no DST

export function manilaToday(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + MANILA_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Vietnamese guests answer a follow-up with the digit form as often as the named
// one ("thứ 7" / "thu 7" for "thứ bảy"), and the named forms plus t2..t7 alone
// were not enough: "thứ 7 tuần sau" — a very common reply — resolved to null and
// silently became a missing check-in. Both spellings of every day are listed.
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, "chủ nhật": 0, "chu nhat": 0, "chúa nhật": 0, "chua nhat": 0, cn: 0,
  monday: 1, mon: 1, "thứ hai": 1, "thu hai": 1, "thứ 2": 1, "thu 2": 1, t2: 1,
  tuesday: 2, tue: 2, "thứ ba": 2, "thu ba": 2, "thứ 3": 2, "thu 3": 2, t3: 2,
  wednesday: 3, wed: 3, "thứ tư": 3, "thu tu": 3, "thứ 4": 3, "thu 4": 3, t4: 3,
  thursday: 4, thu: 4, "thứ năm": 4, "thu nam": 4, "thứ 5": 4, "thu 5": 4, t5: 4,
  friday: 5, fri: 5, "thứ sáu": 5, "thu sau": 5, "thứ 6": 5, "thu 6": 5, t6: 5,
  saturday: 6, sat: 6, "thứ bảy": 6, "thu bay": 6, "thứ 7": 6, "thu 7": 6, t7: 6,
};

// ---------------------------------------------------------------------------
// Chinese. Guest volume in zh is small; the eval set is not, and it is the
// clearest measure of what a missing table entry costs: 8 of the 10 Chinese cases
// in eval/dataset.mock-30.json spell the date as N月N日 / N月N号 (10月12日, 11月5号,
// 10月24日 …) and two as a 周/星期 weekday (下周六, 下周五). The table had no entry
// for any of those forms, so every one of those guests ended the turn with a
// missing check-in despite having given the date, and the eval scored it as the
// pipeline's failure — which it was.
// ---------------------------------------------------------------------------
const ZH_DAY_OFFSETS: Record<string, number> = {
  大后天: 3, 大後天: 3, 后天: 2, 後天: 2, 明天: 1, 明日: 1, 今天: 0,
};
const ZH_WEEKDAY_PREFIXES = ["星期", "礼拜", "禮拜", "周", "週"];
const ZH_WEEKDAY_SUFFIXES: Record<string, number> = {
  日: 0, 天: 0, 7: 0, 一: 1, 1: 1, 二: 2, 2: 2, 三: 3, 3: 3, 四: 4, 4: 4, 五: 5, 5: 5, 六: 6, 6: 6,
};

function zhWeekday(phrase: string): number | null {
  for (const prefix of ZH_WEEKDAY_PREFIXES) {
    for (const [suffix, dow] of Object.entries(ZH_WEEKDAY_SUFFIXES)) {
      if (phrase.includes(prefix + suffix)) return dow;
    }
  }
  // 周末 ("weekend") is the one form with no weekday in it; like "cuối tuần sau",
  // it means the coming Saturday unless another weekday word says otherwise.
  if (/周末|週末/.test(phrase)) return 6;
  return null;
}

// Week qualifiers live in one place because two callers must agree on them: the
// resolver strips them before its table lookup, and corroborateDatePhrase reads
// them as "which week did the guest mean" when it checks a model's date.
// `tới`/`toi` is Vietnamese "coming" on its own ("thứ Bảy tới", the form in
// eval/dataset.mock-30.json's vi-07). `tuần tới` above already covers the two-word
// form and is listed first so it is consumed as a whole; a bare qualifier that
// survives the strip is what made "thứ Bảy tới" resolve to null and turn a date the
// guest had written into a question. Unmarked "toi" cannot be confused with "tối"
// (evening) or "tôi" (I): both carry a diacritic.
const WEEK_QUALIFIERS =
  /next|this|coming|tuần sau|tuan sau|tuần tới|tuan toi|cuối tuần sau|cuoi tuan sau|tuần này|tuan nay|này|nay|tới|toi/g;
const NEXT_WEEK =
  /next|tuần sau|tuan sau|tuần tới|tuan toi|cuối tuần sau|cuoi tuan sau|下(?:个|個)?(?:周|週|星期|礼拜|禮拜)/;
const THIS_WEEK = /本周|本週|这周|這週|这星期|thứ\s?\d\s?này|thu\s?\d\s?nay|tuần này|tuan nay/;

function calendarIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Round-trip instead of trusting Date: "2026-02-31" parses as 3 March.
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

// A date written without a year ("15/10", "10月24日") means the next time that day
// comes around: this year if it is still ahead, next year if it is not. A stay
// cannot start in the past, so a date in January said in September is next January.
function upcomingIso(day: number, month: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  for (const candidate of [year, year + 1]) {
    const iso = calendarIso(candidate, month, day);
    if (iso && iso >= today) return iso;
  }
  return null;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}


/**
 * Resolves a relative-date phrase (as lifted verbatim from a guest message) to
 * an ISO date, anchored to `today` (Manila time, "YYYY-MM-DD"). Returns null
 * for phrases it doesn't recognise — the caller must then treat the field as
 * "missing", not silently drop it.
 *
 * `language`, when the caller has detected it (extract.ts detects it from the guest's own
 * words, the same detection that fills trip.language), settles the one form no table can
 * read on its own: a bare day/month pair with no year on it, like "05/12". See
 * numericPairReadings.
 */
export function resolveRelativeDate(phrase: string, today: string, language?: GuestLanguage): string | null {
  const p = phrase.trim().toLowerCase();

  // Guests commonly answer a follow-up with a numeric calendar date. Validate
  // the calendar value instead of asking the model to interpret it.
  const isoDate = p.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const numericDate = p.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (isoDate || numericDate) {
    const [, isoYear, isoMonth, isoDay] = isoDate ?? [];
    const [, numericDay, numericMonth, numericYear] = numericDate ?? [];
    const day = isoDay ?? numericDay;
    const month = isoMonth ?? numericMonth;
    const year = isoYear ?? numericYear;
    const candidate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const parsed = new Date(`${candidate}T00:00:00Z`);
    if (
      parsed.getUTCFullYear() === Number(year) &&
      parsed.getUTCMonth() + 1 === Number(month) &&
      parsed.getUTCDate() === Number(day)
    ) {
      return candidate;
    }
    return null;
  }

  // Chinese calendar dates: 10月12日, 11月5号, and the same with a year (2027年1月15日).
  const zhDate = p.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]/);
  if (zhDate) {
    const [, year, month, day] = zhDate;
    return year
      ? calendarIso(Number(year), Number(month), Number(day))
      : upcomingIso(Number(day), Number(month), today);
  }

  // "starting Oct 10th" (en-06), "Nov 2" (en-07), "coming Dec 1st" (en-08) — an English
  // month name with a day on it. The table had no entry for this form, so three of the 19
  // check-ins the pre-fix pipeline deleted were left to the model's own reading (they were
  // tagged `authored-checkIn:model` in eval/fixtures.mock-30.json, where the replay probes
  // its model-decided cases with a wrong date). Reading the phrase here does not change any
  // of those dates; it takes the model out of the decision, which is the Playbook rule. A
  // month with no day on it is still not a date — "sometime in December" has to keep
  // falling through to null, or vi-02's answer gets guessed at.
  const enMonthFirst = p.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?!\d)/);
  const enDayFirst = p.match(
    /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/,
  );
  if (enMonthFirst ?? enDayFirst) {
    const match = (enMonthFirst ?? enDayFirst)!;
    // The two readings of "8 October" and "October 8" put month and day in opposite
    // groups, so which one is which is decided by which pattern matched, not by position.
    const monthWord = (enMonthFirst ? match[1] : match[2]) as string;
    const day = Number(enMonthFirst ? match[2] : match[1]);
    const iso = upcomingIso(day, EN_MONTHS[monthWord.slice(0, 3)] as number, today);
    if (iso) return iso;
  }

  // A date with no year at all — "15/10", as in "từ ngày 15/10", is the form guests
  // type most; yearlessNumeric() explains why an ambiguous pair stays unresolved.
  if (!/\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}/.test(p)) {
    const yearless = yearlessNumeric(p, today, language);
    if (yearless) return yearless;
  }

  // Day-offset words, read wherever they sit inside the quote — "arriving tomorrow"
  // (en-03), "planning a trip in 5 days" (en-05). These used to be anchored to the whole
  // phrase, and that anchoring is the same asymmetry that cost 8 of the 10 Chinese eval
  // cases their check-in: the evidence a model quotes is a fragment of the guest's
  // sentence, not a tidy phrase, so a phrase this table could not read was a date the
  // guest had already given and was asked for again. All four forms live in
  // dayOffsetOfPhrase, which the corroboration path reads too — that is what keeps the two
  // halves of this file from drifting apart — and which refuses a negated one.
  const offset = dayOffsetOfPhrase(p);
  if (offset !== null) return addDays(today, offset);

  // "next <weekday>" / "thứ Bảy tuần sau" / "cuối tuần sau" (treated as next Saturday)
  // / "下周五". The qualifier words are shared with corroborateDatePhrase below.
  const isNextWeek = NEXT_WEEK.test(p);
  const weekdayToken = p
    // "này"/"nay" is Vietnamese "this" — strips both the "tuần này" (this week)
    // form and a bare trailing "này" on the weekday itself ("thứ Bảy này").
    .replace(WEEK_QUALIFIERS, "")
    .trim();
  // zhWeekday() reads 周/星期/礼拜 + day, which never survives the strip above;
  // viWeekdayIn() finds a Vietnamese weekday inside a longer phrase, the way the
  // full-name scan in weekdayOfPhrase() does for English.
  const namedDow = WEEKDAYS[weekdayToken] ?? zhWeekday(p) ?? viWeekdayIn(p) ?? undefined;
  // "cuối tuần" / "weekend" is the coming Saturday, and only when no weekday is named
  // beside it. This used to be a regex guard — `!/thứ|thu|day/` — in which the "day"
  // in "weekend" blocked its own phrase, so "this weekend" (eval's en-02, which the
  // live run resolved to the coming Saturday) depended on which other words the model
  // happened to quote. Asking the tables whether a weekday is named cannot do that.
  const targetDow = namedDow ?? (/cuối tuần|cuoi tuan|weekend/.test(p) ? 6 : undefined);
  if (targetDow !== undefined) {
    const todayDate = new Date(`${today}T00:00:00Z`);
    const currentDow = todayDate.getUTCDay();
    let delta = (targetDow - currentDow + 7) % 7;
    // A week qualifier already means "the one in the next week" (7..13 days out), so
    // the same-day case must not add another 7 on top of it: 下周五 / "next Friday"
    // said *on* a Friday is 7 days out, and the earlier order of these two lines made
    // it 14 — a check-in a week late on the day the guest wrote. Without the
    // qualifier, a weekday named on its own day means the coming one, not today.
    if (isNextWeek) delta += 7;
    else if (delta === 0) delta = 7;
    return addDays(today, delta);
  }

  return null;
}

export function deriveCheckOut(checkInIso: string, nights: number): string {
  return addDays(checkInIso, nights);
}

/**
 * The readings a yearless numeric pair has, in the order the guest's own convention puts
 * them. upcomingIso() takes (day, month), so the day-first reading is the pair as written
 * ("05/12" → 5 December) and the month-first one is the pair swapped ("05/12" → 12 May).
 *
 * What used to be missing here is the guest's language. Both orders are valid calendar
 * dates for "05/12", so this reader refused the pair outright and left the field to
 * corroboration against the model's own date (extract.ts) — and a model that read it the
 * other way priced the wrong month, which is exactly what happened to eval's vi-09 and
 * vi-10. Vietnam and China write day/month, so a "vi" or "zh" guest's pair has one reading
 * and an English-speaking guest's has the other, and the language is already detected from
 * that same message (normalize.ts) before the field is resolved.
 *
 * The language only breaks a tie between two *possible* dates. An order that is not a date
 * at all is not a reading in any language — "15/10" is 15 October whether the guest writes
 * Vietnamese or English — and refusing it because the guest's convention preferred a month
 * 15 would delete a date they plainly gave, which is the failure this file exists to avoid.
 *
 * With no language (the phrase table is also called with a bare quote and no caller
 * context) both orders are read and an ambiguous pair stays unresolved: one question is
 * cheaper than a month of revenue priced on the wrong reading.
 */
function numericPairReadings(a: number, b: number, today: string, language?: GuestLanguage): string[] {
  const dayFirst = upcomingIso(a, b, today);
  const monthFirst = upcomingIso(b, a, today);
  if (dayFirst === null) return monthFirst === null ? [] : [monthFirst];
  if (monthFirst === null) return [dayFirst];
  // Both orders land on the same day, so there is nothing to choose between and nothing a
  // language could add: "5/5" is 5 May in either convention.
  if (dayFirst === monthFirst) return [dayFirst];
  if (language === "en") return [monthFirst];
  if (language === "vi" || language === "zh") return [dayFirst];
  return [dayFirst, monthFirst];
}

/**
 * "05/12" — a date with no year on it, the form guests type most ("từ ngày 15/10",
 * "7/3"). The 4-digit-year regexes above cannot read it, so every such guest was losing
 * their check-in date. Exactly one reading has to exist for this reader to settle the
 * phrase itself; numericPairReadings explains which reading the guest's language leaves.
 */
function yearlessNumeric(text: string, today: string, language?: GuestLanguage): string | null {
  const m = text.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})/);
  if (!m) return null;
  const readings = numericPairReadings(Number(m[1]), Number(m[2]), today, language);
  return readings.length === 1 ? readings[0]! : null;
}

// Where "sometime next year" stops being a booking and starts being a wish. A date
// a model computed past this horizon means it misread the message, not that a guest
// plans two years ahead.
const MAX_STAY_HORIZON_DAYS = 730;

/**
 * True when `iso` is a date a stay could start on: an exact calendar date
 * (YYYY-MM-DD, no rollover — "2026-02-31" is 3 March to `Date`), today or later,
 * and inside the booking horizon. This is the calendar half of what a
 * model-proposed date has to pass; corroborateDatePhrase() is the other half.
 */
export function isPlausibleStayDate(iso: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return false;
  if (iso < today) return false; // a stay cannot start in the past
  return daysBetween(today, iso) <= MAX_STAY_HORIZON_DAYS;
}

export type DateCorroboration = "consistent" | "contradicted" | "no-opinion";

const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const EN_MONTH_WORD = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/;

// Vietnamese weekday words are two words long ("thứ bảy", "chủ nhật", "thứ 7"), so a
// phrase the model lifts can carry one inside a sentence. The live run's own evidence
// for vi-03 was "ở 1 đêm cuối tuần sau", not a bare "cuối tuần sau" — evidence is
// quoted from wherever the guest wrote the date — and an exact-string lookup then
// misses a weekday the guest plainly wrote. Longest first so "thứ bảy" is not read as
// "thứ ba". Only the two-word entries are scanned: a bare "thu" is a substring of
// everyday words like "thuê" (to rent) and is Thursday only when it stands alone.
const VI_WEEKDAY_TOKENS: ReadonlyArray<readonly [string, number]> = Object.entries(WEEKDAYS)
  .filter(([word]) => word.includes(" "))
  .sort((a, b) => b[0].length - a[0].length);

function viWeekdayIn(p: string): number | null {
  for (const [word, dow] of VI_WEEKDAY_TOKENS) {
    if (p.includes(word)) return dow;
  }
  return null;
}

function weekdayOfPhrase(p: string): number | null {
  const stripped = p.replace(WEEK_QUALIFIERS, "").replace(/\s+/g, " ").trim();
  if (WEEKDAYS[stripped] !== undefined) return WEEKDAYS[stripped];
  // A full weekday name anywhere in the phrase ("the coming Friday"). Full names
  // only, six letters or more: a bare "sat" in "we sat down" is not a date.
  for (const token of p.split(/[^a-z]+/)) {
    if (token.length >= 6 && WEEKDAYS[token] !== undefined) return WEEKDAYS[token];
  }
  // A weekday named in either of the two other languages wins over the weekend
  // default, which is why it is asked first — the resolver orders these the same
  // way. "cuối tuần" / "weekend" / 周末 is the one form with no weekday in it.
  const named = viWeekdayIn(p) ?? zhWeekday(p);
  if (named !== null) return named;
  if (/cuối tuần|cuoi tuan|weekend|周末|週末/.test(p)) return 6;
  return null;
}

// A date the guest negated is not a date: "not tomorrow" / "không phải ngày mai" /
// "不是明天" says the opposite of the phrase it contains. Both readers in this file ask
// this question — resolveRelativeDate reads an offset word wherever it sits in a quote
// (below), and corroborateDatePhrase holds a model's date to this function's reading — so
// the guard lives here rather than in either caller. It is deliberately blunt: a negation
// anywhere in the quoted phrase blocks an offset word in it, and the cost of that is one
// question, against a stay priced on a day the guest said was not theirs.
const NEGATED_DATE =
  /\b(?:not|no|never|isn'?t|aren'?t|doesn'?t|don'?t|won'?t|cannot|can'?t)\b|không|khong|chưa|chua|chẳng|chang|đừng|不|没|別|别/;

function dayOffsetOfPhrase(p: string): number | null {
  if (NEGATED_DATE.test(p)) return null;
  for (const [word, offset] of Object.entries(ZH_DAY_OFFSETS).sort((a, b) => b[0].length - a[0].length)) {
    if (p.includes(word)) return offset;
  }
  // Longest phrase first: "the day after tomorrow" contains the word "tomorrow", and the
  // anchored tests this replaced read it as +1 day whenever the model quoted anything
  // around it. A date read a day early is a stay priced a day early.
  if (/\b(the day after tomorrow|ngày kia|ngay kia)\b/.test(p)) return 2;
  if (/\b(tomorrow|ngày mai|ngay mai)\b/.test(p)) return 1;
  if (/\b(today|hôm nay|hom nay)\b/.test(p)) return 0;
  // "in 5 days" / "5 ngày nữa" — a counted offset, the form eval's en-05 uses. The resolver
  // reads it inside a longer quote too ("planning a trip in 5 days"), which is what en-05's
  // model-appended evidence looks like; the corroboration path reads the same helper.
  const inNDays = p.match(/\bin (\d+) days?\b/) ?? p.match(/(\d+) ngày nữa/) ?? p.match(/(\d+) ngay nua/);
  if (inNDays) return Number(inNDays[1]);
  return null;
}

/** The month the phrase names, if it names one (10月, tháng 10, "December"). */
function monthOfPhrase(p: string): number | null {
  const numbered = p.match(/(\d{1,2})\s*月/) ?? p.match(/tháng\s*(\d{1,2})/);
  if (numbered) return Number(numbered[1]);
  const named = p.match(EN_MONTH_WORD);
  return named ? EN_MONTHS[named[1] as string] ?? null : null;
}

/** The day of the month the phrase names, if it names one (12日, ngày 12, "the 12th"). */
function dayOfMonthOfPhrase(p: string): number | null {
  const zh = p.match(/(\d{1,2})\s*[日号號]/);
  if (zh) return Number(zh[1]);
  const vi = p.match(/ngày\s*(\d{1,2})/);
  if (vi) return Number(vi[1]);
  const en =
    p.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/) ??
    p.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/) ??
    p.match(/\b(\d{1,2})\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  return en ? Number(en[1]) : null;
}

function numericPairOfPhrase(p: string): { a: number; b: number } | null {
  // Three-number groups are full dates and belong to the resolver; leaving them in
  // would read "15/10/2026" as the pair "5/10".
  const withoutFullDates = p.replace(/\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}/g, " ");
  const m = withoutFullDates.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})/);
  return m ? { a: Number(m[1]), b: Number(m[2]) } : null;
}

function nextMonth(month: number): number {
  return month === 12 ? 1 : month + 1;
}

/**
 * Does the guest's own phrase support the date the model computed?
 *
 * This is the check that lets a model's ISO date be used at all, so it is written to
 * be wrong in the safe direction only. It answers:
 *
 *  - "contradicted" — the phrase names something the date disagrees with (a weekday,
 *    a month, a day, "next week"), or the date is not one a stay could start on
 *    (malformed, past, past the horizon). The caller must then treat the field as
 *    missing and ask.
 *  - "consistent" — the phrase pins the date down and the date matches: a weekday
 *    (with its week qualifier, where the phrase has one), a day of the month, a
 *    day/month pair, or 明天/后天.
 *  - "no-opinion" — the phrase is vague ("sometime in December", "cuối tháng này",
 *    "next month"). Silence is deliberate: a vague date is exactly where the guest
 *    owes an answer, and a month name is not a check-in date.
 *
 * A month named without a day can only contradict, never confirm — that is what
 * keeps eval's vi-02 ("chưa chốt ngày, khoảng cuối tháng này") missing instead of
 * filled with whichever day of September a model felt like offering.
 *
 * `language` (optional, as in resolveRelativeDate) is what a numeric pair with no year on
 * it is held to: with it, "05/12" corroborates only the reading the guest's own convention
 * gives it, so a model that read a Vietnamese guest's day/month pair backwards is
 * contradicted rather than accepted as the other valid reading. Without it, either reading
 * counts, exactly as before.
 */
export function corroborateDatePhrase(
  phrase: string,
  iso: string,
  today: string,
  language?: GuestLanguage,
): DateCorroboration {
  if (!isPlausibleStayDate(iso, today)) return "contradicted";

  const p = phrase.toLowerCase();
  const isoDow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const isoDay = Number(iso.slice(8, 10));
  const isoMonth = Number(iso.slice(5, 7));
  const deltaDays = daysBetween(today, iso);

  let anchors = 0; // things the phrase states that a date can be held to
  let disagrees = false;
  const anchor = (matches: boolean) => {
    anchors += 1;
    if (!matches) disagrees = true;
  };
  const constrain = (holds: boolean) => {
    if (!holds) disagrees = true;
  };

  const dow = weekdayOfPhrase(p);
  if (dow !== null) {
    anchor(dow === isoDow);
    if (dow === isoDow) {
      // A weekday plus a week qualifier is a single day ("下周五", "next Saturday").
      // A weekday alone means the nearest one — the reading resolveRelativeDate uses
      // — and a fortnight is still "the coming Friday", so what this rejects is a
      // model that landed on some Friday three weeks out.
      if (NEXT_WEEK.test(p)) anchor(deltaDays >= 7 && deltaDays <= 20);
      else if (THIS_WEEK.test(p)) anchor(deltaDays <= 6);
      else anchor(deltaDays <= 13);
    }
  }

  const offset = dayOffsetOfPhrase(p);
  if (offset !== null) anchor(iso === addDays(today, offset));

  const month = monthOfPhrase(p);
  if (month !== null) constrain(month === isoMonth);
  if (/下个月|下個月|next month/.test(p)) constrain(isoMonth === nextMonth(Number(today.slice(5, 7))));
  if (/tháng này|thang nay|本月|这个月|這個月|this month/.test(p)) {
    constrain(isoMonth === Number(today.slice(5, 7)));
  }

  const day = dayOfMonthOfPhrase(p);
  if (day !== null) anchor(day === isoDay);

  // "15/10" and "7/3" are read the way the guest's language reads them, exactly as
  // yearlessNumeric does it — one reading where the language settles it, both where nothing
  // does.
  const pair = numericPairOfPhrase(p);
  if (pair) anchor(numericPairReadings(pair.a, pair.b, today, language).includes(iso));

  if (disagrees) return "contradicted";
  return anchors > 0 ? "consistent" : "no-opinion";
}


