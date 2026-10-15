import type { FieldState, Trip, GuestLanguage } from "../../domain/schema.ts";
import { FIELD_REGISTRY } from "../../domain/fieldRegistry.ts";

export type { GuestLanguage };

type Lang = GuestLanguage;

export interface GuestQuestion {
  field: keyof Trip;
  question: string;
}

export interface QuestionRule {
  key: keyof Trip;
  question: Record<Lang, string> | ((trip: Trip, lang: Lang) => string);
  askOn?: ReadonlyArray<FieldState>;
  when?: (trip: Trip) => boolean;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoParts(iso: string): { year: string; month: string; day: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? { year: match[1] ?? "", month: match[2] ?? "", day: match[3] ?? "" } : null;
}

/** The date the way a guest writes it: "Sep 19, 2026" / "2026年9月19日". */
export function formatDate(iso: string, lang: Lang): string {
  const p = isoParts(iso);
  if (!p) return iso;
  if (lang === "zh") return `${p.year}年${Number(p.month)}月${Number(p.day)}日`;
  return `${SHORT_MONTHS[Number(p.month) - 1]} ${Number(p.day)}, ${p.year}`;
}

/** The same date without its year — for a sentence already anchored to a stay. */
export function formatDay(iso: string, lang: Lang): string {
  const p = isoParts(iso);
  if (!p) return iso;
  if (lang === "zh") return `${Number(p.month)}月${Number(p.day)}日`;
  return `${SHORT_MONTHS[Number(p.month) - 1]} ${Number(p.day)}`;
}

/**
 * A stay as one range rather than two dates, collapsing whatever the two ends share:
 * "Sep 19 – 21, 2026", "2026年9月19–21日".
 */
export function formatRange(fromIso: string, toIso: string, lang: Lang): string {
  const from = isoParts(fromIso);
  const to = isoParts(toIso);
  if (!from || !to || from.year !== to.year) {
    return `${formatDate(fromIso, lang)} – ${formatDate(toIso, lang)}`;
  }
  if (lang === "zh") {
    return from.month === to.month
      ? `${from.year}年${Number(from.month)}月${Number(from.day)}–${Number(to.day)}日`
      : `${from.year}年${Number(from.month)}月${Number(from.day)}日 – ${Number(to.month)}月${Number(to.day)}日`;
  }
  return from.month === to.month
    ? `${SHORT_MONTHS[Number(from.month) - 1]} ${Number(from.day)} – ${Number(to.day)}, ${from.year}`
    : `${SHORT_MONTHS[Number(from.month) - 1]} ${Number(from.day)} – ${SHORT_MONTHS[Number(to.month) - 1]} ${Number(to.day)}, ${from.year}`;
}

export function diveStayRange(trip: Trip, lang: Lang): string | null {
  const from = typeof trip.checkIn?.value === "string" ? trip.checkIn.value : null;
  const to = typeof trip.checkOut?.value === "string" ? trip.checkOut.value : null;
  return from && to ? formatRange(from, to, lang) : null;
}

export function statedValue<T>(trip: Trip, key: keyof Trip): T | null {
  const field = trip[key];
  return field?.state === "stated" && field.value !== null && field.value !== undefined
    ? (field.value as T)
    : null;
}

export function notedValue<T>(trip: Trip, key: keyof Trip): T | null {
  const field = trip[key];
  return (field?.state === "stated" || field?.state === "inferred") &&
    field.value !== null &&
    field.value !== undefined
    ? (field.value as T)
    : null;
}

const BASELINE: ReadonlyArray<FieldState> = ["missing"];

export const RULES: QuestionRule[] = [
  { key: "checkIn", question: { en: "What date would you like to check in?", zh: "您想在哪天入住？" } },
  {
    key: "nights",
    question: { en: "How many nights will you be staying?", zh: "您计划入住几个晚上？" },
    when: (trip) => !(trip.checkOut?.state && trip.checkOut.state !== "missing"),
  },
  { key: "guests", question: { en: "How many guests in total?", zh: "一共有几位客人？" } },
  { key: "rooms", question: { en: "How many rooms do you need?", zh: "您需要几间房？" } },
  {
    key: "roomType",
    question: { en: "Would you like a standard, deluxe, or suite room?", zh: "您想订标准房、豪华房，还是套房？" },
  },
  { key: "meals", question: { en: "Would you like full board, half board, or room only?", zh: "您需要全餐、半餐，还是只要住宿？" } },
  { key: "transport", question: { en: "Do you need an airport transfer?", zh: "您需要机场接送吗？" } },
  {
    key: "diver",
    question: { en: "Would you like to go diving during your stay?", zh: "您这次想潜水吗？" },
    when: (trip) => !notedValue<string>(trip, "diveNotes"),
  },
  { key: "contactName", question: { en: "What name should we put on the booking?", zh: "预订时应该登记谁的姓名？" } },
  {
    key: "divers",
    question: { en: "How many of you will be diving?", zh: "有几位客人潜水？" },
    when: (trip) => trip.diver?.value === true && !notedValue<string>(trip, "diveNotes"),
  },
  {
    key: "diveFrom",
    question: (trip, lang) => {
      const range = diveStayRange(trip, lang);
      if (range) {
        if (lang === "zh") return `潜水从哪天开始？（在住宿期间 ${range} 内）`;
        return `Which day does your diving start? (within your stay: ${range})`;
      }
      return { en: "Which day does your diving start?", zh: "潜水从哪天开始？" }[lang];
    },
    when: (trip) => trip.diver?.value === true && !notedValue<string>(trip, "diveNotes"),
  },
  {
    key: "diveTo",
    question: (trip, lang) => {
      const range = diveStayRange(trip, lang);
      if (range) {
        if (lang === "zh") return `哪天结束？（在住宿期间 ${range} 内）`;
        return `And which day does it end? (within your stay: ${range})`;
      }
      return { en: "And which day does it end?", zh: "哪天结束？" }[lang];
    },
    when: (trip) => trip.diver?.value === true && !notedValue<string>(trip, "diveNotes"),
  },
  {
    key: "transportType",
    question: { en: "One-way or return transfer?", zh: "需要单程还是往返接送？" },
    askOn: ["missing", "default"],
    when: (trip) => trip.transport?.value === true,
  },
];

export function ruleApplies(rule: QuestionRule, trip: Trip): boolean {
  if (rule.when && !rule.when(trip)) return false;
  return true;
}

export function openRules(trip: Trip): QuestionRule[] {
  return RULES.filter((rule) => {
    if (!ruleApplies(rule, trip)) return false;
    const state = trip[rule.key]?.state ?? "missing";
    return (rule.askOn ?? BASELINE).includes(state);
  });
}

export function generateQuestions(trip: Trip): GuestQuestion[] {
  const language: Lang = trip.language.value ?? "en";
  return openRules(trip).map((rule) => ({
    field: rule.key,
    question:
      typeof rule.question === "function"
        ? rule.question(trip, language)
        : rule.question[language] ?? rule.question.en,
  }));
}

export const HANDOFF_REQUIRED_FIELDS: ReadonlyArray<keyof Trip> = [
  "checkIn",
  "checkOut",
  "nights",
  "guests",
  "rooms",
  "roomType",
  "meals",
  "transport",
  "contactName",
  "diver",
  "divers",
  "diveFrom",
  "diveTo",
  "transportType",
] as const;

export const NEVER_ASKED_FIELDS: ReadonlyArray<{
  field: keyof Trip;
  satisfiedBy: "code" | "staff";
  reason: string;
}> = [
  {
    field: "checkOut",
    satisfiedBy: "code",
    reason:
      "Arithmetic on the guest's own answers: checkIn + nights. A derived date is exact rather than a guess, which is why it is never asked and never flagged as assumed in the summary.",
  },
  {
    field: "guestType",
    satisfiedBy: "staff",
    reason:
      "Read from phrasing (extract.ts isAgent) and defaulted to retail. A 30% partner rate is a commercial decision staff confirm on the quote, so an unknown guest type changes nothing the guest sees and is not worth a question.",
  },
];

export function ruleFor(field: keyof Trip): QuestionRule | undefined {
  return RULES.find((rule) => rule.key === field);
}

export function isReadyForHandoff(trip: Trip): boolean {
  if (openRules(trip).length > 0) return false;
  for (const field of HANDOFF_REQUIRED_FIELDS) {
    const rule = ruleFor(field);
    if (rule && !ruleApplies(rule, trip)) continue;
    if ((trip[field]?.state ?? "missing") === "missing") return false;
  }
  return true;
}

export function diveWindowIsGuessed(trip: Trip): boolean {
  if (trip.diver?.value !== true) return false;
  if (trip.diveFrom?.state !== "stated" || trip.diveTo?.state !== "stated") return true;

  const from = typeof trip.diveFrom.value === "string" ? trip.diveFrom.value : null;
  const to = typeof trip.diveTo.value === "string" ? trip.diveTo.value : null;
  const checkIn = typeof trip.checkIn?.value === "string" ? trip.checkIn.value : null;
  const checkOut = typeof trip.checkOut?.value === "string" ? trip.checkOut.value : null;
  return from !== null && to !== null && from === checkIn && to === checkOut;
}

export function getNoFlyAdvisory(trip: Trip, lang: Lang): string | null {
  if (diveWindowIsGuessed(trip)) return null;
  if (trip.diver?.value === true && trip.diveTo?.value && trip.checkOut?.value) {
    if (trip.diveTo.value === trip.checkOut.value) {
      if (lang === "zh") {
        return "⚠️ 潜水安全提示：根据 PADI/DAN 指南，潜水后乘机离开马尼拉前建议至少间隔 18–24 小时。";
      }
      return "⚠️ Dive Safety Note: PADI/DAN guidelines recommend an 18–24 hour surface interval after diving before flying out from Manila.";
    }
  }
  return null;
}

const CERTIFICATION_HINT_RE =
  /\b(?:(?:not|non)[-\s]?certified|uncertified|beginner|first[-\s]?time|never\s+(?:dived|dove|been\s+diving)|discover\s+scuba|dsd|learn\s+to\s+dive|try\s+(?:scuba|diving))\b|没有证书|没有潜水证|不会潜水|第一次潜水|体验潜水/iu;

const ENUM_LABELS: Record<string, Record<Lang, string>> = {
  full_board: { en: "full board", zh: "全餐" },
  half_board: { en: "half board", zh: "半餐" },
  room_only: { en: "room only", zh: "仅住宿" },
  none: { en: "none", zh: "无" },
  roundtrip: { en: "return trip", zh: "往返" },
  oneway: { en: "one way", zh: "单程" },
  retail: { en: "retail guest", zh: "散客" },
  agent: { en: "agent", zh: "代理" },
  instructor: { en: "instructor", zh: "教练" },
  standard: { en: "standard", zh: "标准房" },
  deluxe: { en: "deluxe", zh: "豪华房" },
  suite: { en: "suite", zh: "套房" },
};

export function getStaffAlerts(trip: Trip, lang?: GuestLanguage): string[] {
  const l: Lang = lang ?? trip.language?.value ?? "en";
  const alerts: string[] = [];
  const guestType = trip.guestType?.value;

  if (guestType === "agent" || guestType === "instructor") {
    const typeLabel = ENUM_LABELS[guestType]?.[l] ?? guestType;
    if (l === "zh") {
      alerts.push(`📋 已记录为${typeLabel}咨询——合作价将由我们的团队在报价单上直接确认。`);
    } else {
      alerts.push(
        `📋 Noted as a ${typeLabel} enquiry — our team will confirm your partner rates directly on the quotation.`,
      );
    }
  }

  const diveNotes = notedValue<string>(trip, "diveNotes");
  if (diveNotes && trip.divers?.state === "missing") {
    if (l === "zh") {
      alerts.push(`📋 我们已记录您的潜水安排（${diveNotes}），团队会与您确认每天的细节。`);
    } else {
      alerts.push(
        `📋 We've noted your diving plan (${diveNotes}) — our team will confirm the day-by-day details with you.`,
      );
    }
  }

  const diveNuance = [diveNotes, notedValue<string>(trip, "specialRequests")]
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .join(" · ");
  if (trip.diver?.value === true && diveNuance.length > 0 && CERTIFICATION_HINT_RE.test(diveNuance)) {
    if (l === "zh") {
      alerts.push(
        "📋 潜水证书待确认：您的留言提到有潜水员可能还没有证书——团队会在报价前与您确认，未持证者可以改上体验潜水（DSD）课程。",
      );
    } else {
      alerts.push(
        "📋 Dive Certification To Confirm: your message mentions someone who may not be certified yet — our team will confirm this before quoting, and a Discover Scuba Diving course is available for anyone without a certification.",
      );
    }
  }

  if (diveWindowIsGuessed(trip)) {
    if (l === "zh") {
      alerts.push(
        "📋 潜水日期待确认：您表示要潜水，但尚未提供具体潜水日期，因此报价前需由工作人员确认天数（潜水按每位潜水员／每天计费）。",
      );
    } else {
      alerts.push(
        "📋 Dive Days To Confirm: you'd like to dive, but no dive dates were given, so our team will confirm the days with you before quoting — diving is charged per diver, per day.",
      );
    }
  }

  const guestCount = typeof trip.guests?.value === "number" ? trip.guests.value : 0;
  const roomCount = typeof trip.rooms?.value === "number" ? trip.rooms.value : 0;
  if (guestCount > 0 && roomCount > guestCount) {
    if (l === "zh") {
      alerts.push(
        `📋 房间数待确认：您预订了 ${roomCount} 间房，共 ${guestCount} 位住宿客人——报价前我们的团队会与您确认房间分配。`,
      );
    } else {
      alerts.push(
        `📋 Rooms To Confirm: ${roomCount} rooms for ${guestCount} overnight guests — our team will double-check the room split with you before quoting.`,
      );
    }
  }

  return alerts;
}
