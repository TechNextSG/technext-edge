// Playbook: "Relative dates are computed in code on Manila time, never trusted
// from the model." The model's job is to lift a date phrase verbatim as evidence
// (e.g. "cuối tuần sau", "next Saturday"); this file turns that phrase into an
// ISO date. Nothing here calls a model.

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
  sunday: 0, sun: 0, "chủ nhật": 0, "chu nhat": 0, cn: 0,
  monday: 1, mon: 1, "thứ hai": 1, "thu hai": 1, "thứ 2": 1, "thu 2": 1, t2: 1,
  tuesday: 2, tue: 2, "thứ ba": 2, "thu ba": 2, "thứ 3": 2, "thu 3": 2, t3: 2,
  wednesday: 3, wed: 3, "thứ tư": 3, "thu tu": 3, "thứ 4": 3, "thu 4": 3, t4: 3,
  thursday: 4, thu: 4, "thứ năm": 4, "thu nam": 4, "thứ 5": 4, "thu 5": 4, t5: 4,
  friday: 5, fri: 5, "thứ sáu": 5, "thu sau": 5, "thứ 6": 5, "thu 6": 5, t6: 5,
  saturday: 6, sat: 6, "thứ bảy": 6, "thu bay": 6, "thứ 7": 6, "thu 7": 6, t7: 6,
};

/**
 * Resolves a relative-date phrase (as lifted verbatim from a guest message) to
 * an ISO date, anchored to `today` (Manila time, "YYYY-MM-DD"). Returns null
 * for phrases it doesn't recognise — the caller must then treat the field as
 * "missing", not silently drop it.
 */
export function resolveRelativeDate(phrase: string, today: string): string | null {
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

  if (/^(today|hôm nay|hom nay)$/.test(p)) return today;
  if (/^(tomorrow|ngày mai|ngay mai)$/.test(p)) return addDays(today, 1);
  if (/^(day after tomorrow|ngày kia|ngay kia)$/.test(p)) return addDays(today, 2);

  const inNDays = p.match(/^in (\d+) days?$|^(\d+) ngày nữa$|^(\d+) ngay nua$/);
  if (inNDays) {
    const n = Number(inNDays[1] ?? inNDays[2] ?? inNDays[3]);
    return addDays(today, n);
  }

  // "next <weekday>" / "thứ Bảy tuần sau" / "cuối tuần sau" (treated as next Saturday)
  const isNextWeek = /next|tuần sau|tuan sau|cuối tuần sau|cuoi tuan sau/.test(p);
  let weekdayToken = p
    // "này"/"nay" is Vietnamese "this" — strips both the "tuần này" (this week)
    // form and a bare trailing "này" on the weekday itself ("thứ Bảy này").
    .replace(/next|this|tuần sau|tuan sau|cuối tuần sau|cuoi tuan sau|tuần này|tuan nay|này|nay/g, "")
    .trim();
  if (/cuối tuần|cuoi tuan|weekend/.test(p) && !/thứ|thu|day/.test(weekdayToken)) {
    weekdayToken = "saturday";
  }
  const targetDow = WEEKDAYS[weekdayToken];
  if (targetDow !== undefined) {
    const todayDate = new Date(`${today}T00:00:00Z`);
    const currentDow = todayDate.getUTCDay();
    let delta = (targetDow - currentDow + 7) % 7;
    if (delta === 0) delta = 7; // "next Saturday" always means a future one, not today
    if (isNextWeek) delta += 7;
    return addDays(today, delta);
  }

  return null;
}

export function deriveCheckOut(checkInIso: string, nights: number): string {
  return addDays(checkInIso, nights);
}
