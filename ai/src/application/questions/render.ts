import type { Trip, GuestLanguage } from "../../domain/schema.ts";
import { FIELD_REGISTRY } from "../../domain/fieldRegistry.ts";
import {
  type GuestQuestion,
  formatDate,
  formatDay,
  formatRange,
  statedValue,
  notedValue,
  diveWindowIsGuessed,
  getStaffAlerts,
  getNoFlyAdvisory,
} from "./rules.ts";
import { joinList } from "./fallback.ts";

export type ReplyKind = "greeting" | "questions" | "summary";

export interface RenderedReply {
  kind: ReplyKind;
  text: string;
}

type Lang = GuestLanguage;

const SUMMARY_ORDER: ReadonlyArray<keyof Trip> = ["guests", "rooms", "roomType", "meals", "contactName"];

export const LABELS: Record<keyof Trip, Record<Lang, string>> = Object.fromEntries(
  Object.entries(FIELD_REGISTRY).map(([k, def]) => [k, def.label]),
) as Record<keyof Trip, Record<Lang, string>>;

export const STAY_LABEL: Record<Lang, string> = { en: "Stay", zh: "住宿" };

export const ENUM_LABELS: Record<string, Record<Lang, string>> = {
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

export const YES_NO: Record<Lang, [string, string]> = {
  en: ["yes", "no"],
  zh: ["是", "否"],
};

export const ASSUMED_NOTE: Record<Lang, string> = {
  en: " (assumed)",
  zh: "（默认）",
};

export function nightsText(nights: number, lang: Lang): string {
  if (lang === "zh") return `${nights} 晚`;
  return `${nights} ${nights === 1 ? "night" : "nights"}`;
}

export function diversText(divers: number, lang: Lang): string {
  if (lang === "zh") return `${divers} 位潜水`;
  return `${divers} ${divers === 1 ? "diver" : "divers"}`;
}

const DATE_KEYS = new Set<keyof Trip>(["checkIn", "checkOut", "diveFrom", "diveTo"]);

export function formatValue(key: keyof Trip, value: unknown, lang: Lang): string | null {
  if (value === null || value === undefined) return null;
  if (DATE_KEYS.has(key)) return typeof value === "string" ? formatDate(value, lang) : null;
  if (typeof value === "boolean") return YES_NO[lang][value ? 0 : 1];
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return ENUM_LABELS[value]?.[lang] ?? value;
  return null;
}

const GREETING: Record<Lang, string[]> = {
  en: [
    "Hi! Welcome to Casa Escondida — our dive-and-stay resort in Anilao, Batangas.",
    "So the team can check availability and pricing for you, could you share your check-in date, how many nights, how many guests, and a name for the booking?",
  ],
  zh: [
    "您好！欢迎来到 Casa Escondida——位于菲律宾 Anilao 的潜水度假村。",
    "为了帮您查询房态和价格，请告诉我入住日期、住几晚、几位客人，以及登记预订的姓名。",
  ],
};

const STAY_PHRASE: Record<Lang, (day: string, nights: string) => string> = {
  en: (day, nights) => `your stay starting ${day} for ${nights}`,
  zh: (day, nights) => `从 ${day} 开始的 ${nights}`,
};

const CHECK_IN_PHRASE: Record<Lang, (day: string) => string> = {
  en: (day) => `your check-in on ${day}`,
  zh: (day) => `${day} 入住`,
};

const NIGHTS_PHRASE: Record<Lang, (nights: string) => string> = {
  en: (nights) => `a stay of ${nights}`,
  zh: (nights) => `${nights} 的住宿`,
};

const GUESTS_PHRASE: Record<Lang, (guests: number) => string> = {
  en: (guests) => `${guests} ${guests === 1 ? "guest" : "guests"}`,
  zh: (guests) => `${guests} 位客人`,
};

const MEALS_PHRASE: Record<Lang, (label: string) => string> = {
  en: (label) => label,
  zh: (label) => label,
};

const TRANSPORT_PHRASE: Record<Lang, { yes: string; no: string }> = {
  en: { yes: "an airport transfer", no: "that you don't need a transfer" },
  zh: { yes: "机场接送", no: "不需要接送" },
};

const DIVER_PHRASE: Record<Lang, { yes: string; no: string }> = {
  en: { yes: "diving", no: "no diving" },
  zh: { yes: "潜水", no: "不潜水" },
};

const NAME_PHRASE: Record<Lang, (name: string) => string> = {
  en: (name) => `your name, ${name}`,
  zh: (name) => `联系人 ${name}`,
};

const THANKS: Record<Lang, (name: string | null) => string> = {
  en: (name) => (name ? `Thanks, ${name}!` : "Thanks!"),
  zh: (name) => (name ? `谢谢 ${name}！` : "谢谢！"),
};

const NOTED: Record<Lang, (list: string) => string> = {
  en: (list) => `I've noted down ${list}.`,
  zh: (list) => `我已经记录了${list}。`,
};

const NEED: Record<Lang, string> = {
  en: "To complete your enquiry, could you let me know:",
  zh: "为了完成预订，请告诉我：",
};

export function ackParts(trip: Trip, lang: Lang): string[] {
  const parts: string[] = [];
  const checkIn = statedValue<string>(trip, "checkIn");
  const nights = statedValue<number>(trip, "nights");
  const guests = statedValue<number>(trip, "guests");
  const meals = statedValue<string>(trip, "meals");
  const transport = statedValue<boolean>(trip, "transport");
  const diver = statedValue<boolean>(trip, "diver");
  const name = statedValue<string>(trip, "contactName");

  if (checkIn && nights) parts.push(STAY_PHRASE[lang](formatDay(checkIn, lang), nightsText(nights, lang)));
  else if (checkIn) parts.push(CHECK_IN_PHRASE[lang](formatDay(checkIn, lang)));
  else if (nights) parts.push(NIGHTS_PHRASE[lang](nightsText(nights, lang)));
  if (guests) parts.push(GUESTS_PHRASE[lang](guests));
  if (meals) parts.push(MEALS_PHRASE[lang](ENUM_LABELS[meals]?.[lang] ?? meals));
  if (transport !== null) parts.push(TRANSPORT_PHRASE[lang][transport ? "yes" : "no"]);
  if (diver !== null) parts.push(DIVER_PHRASE[lang][diver ? "yes" : "no"]);
  const diveNotes = notedValue<string>(trip, "diveNotes");
  if (diveNotes) {
    if (lang === "zh") parts.push(`潜水安排（${diveNotes}）`);
    else parts.push(`diving schedule (${diveNotes})`);
  }
  if (name) parts.push(NAME_PHRASE[lang](name));
  return parts;
}

export function renderAckAndQuestions(trip: Trip, lang: Lang, questions: GuestQuestion[], parts: string[]): string {
  const name = statedValue<string>(trip, "contactName");
  return [
    THANKS[lang](name),
    NOTED[lang](joinList(parts, lang)),
    NEED[lang],
    ...questions.map((q, i) => `${i + 1}. ${q.question}`),
  ].join("\n");
}

const SUMMARY: Record<Lang, { intro: string; closing: string }> = {
  en: {
    intro: "Here's what I have for your stay:",
    closing: "Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.",
  },
  zh: {
    intro: "以下是您提供的信息：",
    closing: "Casa 团队会很快与您联系确认房态和价格——目前尚未预订。",
  },
};

export function summaryLines(trip: Trip, lang: Lang): string[] {
  const lines: string[] = [];

  const checkIn = trip.checkIn?.state === "missing" ? null : ((trip.checkIn?.value as string | null) ?? null);
  const checkOut = trip.checkOut?.state === "missing" ? null : ((trip.checkOut?.value as string | null) ?? null);
  const nights = trip.nights?.state === "missing" ? null : ((trip.nights?.value as number | null) ?? null);
  const nightsSuffix = nights ? ` (${nightsText(nights, lang)})` : "";
  if (checkIn && checkOut) {
    lines.push(`• ${STAY_LABEL[lang]}: ${formatRange(checkIn, checkOut, lang)}${nightsSuffix}`);
  } else if (checkIn) {
    lines.push(`• ${LABELS.checkIn[lang]}: ${formatDate(checkIn, lang)}${nightsSuffix}`);
  } else if (checkOut) {
    lines.push(`• ${LABELS.checkOut[lang]}: ${formatDate(checkOut, lang)}`);
  }

  for (const key of SUMMARY_ORDER) {
    const field = trip[key];
    if (!field || field.state === "missing") continue;
    const shown = formatValue(key, field.value, lang);
    if (shown === null) continue;
    lines.push(`• ${LABELS[key][lang]}: ${shown}${field.state === "default" ? ASSUMED_NOTE[lang] : ""}`);
  }

  const transport = trip.transport;
  const transportType = trip.transportType;
  if (transport && transport.state !== "missing" && typeof transport.value === "boolean") {
    const wantsTransfer = transport.value;
    const typeLabel =
      wantsTransfer && transportType?.value && transportType.value !== "none"
        ? formatValue("transportType", transportType.value, lang)
        : null;
    const isAssumed =
      transport.state === "default" ||
      (wantsTransfer && transportType && (transportType.state === "derived" || transportType.state === "default"));
    lines.push(
      `• ${LABELS.transport[lang]}: ${YES_NO[lang][wantsTransfer ? 0 : 1]}${typeLabel ? ` · ${typeLabel}` : ""}${
        isAssumed ? ASSUMED_NOTE[lang] : ""
      }`,
    );
  }

  const diver = trip.diver;
  if (diver && diver.state !== "missing" && typeof diver.value === "boolean") {
    const diveFrom = (trip.diveFrom?.value as string | null) ?? null;
    const diveTo = (trip.diveTo?.value as string | null) ?? null;
    const notes = trip.diveNotes?.value ? ` (${trip.diveNotes.value})` : "";
    const divers = typeof trip.divers?.value === "number" ? ` · ${diversText(trip.divers.value, lang)}` : "";
    const window = diveWindowIsGuessed(trip)
      ? (lang === "zh" ? " · 潜水日期待确认" : " · dive dates to confirm")
      : diveFrom && diveTo
        ? ` · ${formatRange(diveFrom, diveTo, lang)}`
        : "";
    lines.push(`• ${LABELS.diver[lang]}: ${YES_NO[lang][diver.value ? 0 : 1]}${divers}${window}${notes}`);
  }

  const special = trip.specialRequests?.value;
  if (special && trip.specialRequests?.state !== "missing") {
    lines.push(`• ${LABELS.specialRequests[lang]}: ${special}`);
  }
  const diet = trip.dietNotes?.value;
  if (diet && trip.dietNotes?.state === "stated") {
    lines.push(`• ${LABELS.dietNotes[lang]}: ${diet}`);
  }

  const guestNames = trip.guestNames?.value;
  if (guestNames && guestNames.length > 0 && trip.guestNames?.state !== "missing") {
    lines.push(`• ${LABELS.guestNames[lang]}: ${guestNames.join(", ")}`);
  }

  return lines;
}

export function renderSummary(trip: Trip, lang: Lang): string {
  const name = statedValue<string>(trip, "contactName");
  const noFly = getNoFlyAdvisory(trip, lang);
  const staffAlerts = getStaffAlerts(trip, lang);
  const diveNotes = notedValue<string>(trip, "diveNotes");
  const specialRequests = notedValue<string>(trip, "specialRequests");
  const guestNames = notedValue<string[]>(trip, "guestNames");

  const notesAck: string[] = [];
  if (diveNotes) {
    if (lang === "zh") notesAck.push(`已为您记录具体潜水安排：${diveNotes}。`);
    else notesAck.push(`I've noted your diving arrangement: ${diveNotes}.`);
  }
  if (specialRequests) {
    if (lang === "zh") notesAck.push(`特别要求：${specialRequests}。`);
    else notesAck.push(`Special note: ${specialRequests}.`);
  }
  if (guestNames && guestNames.length > 0) {
    if (lang === "zh") notesAck.push(`同行成员：${guestNames.join(", ")}。`);
    else notesAck.push(`Party members noted: ${guestNames.join(", ")}.`);
  }

  return [
    THANKS[lang](name),
    ...(notesAck.length > 0 ? [notesAck.join(" ")] : []),
    SUMMARY[lang].intro,
    ...summaryLines(trip, lang),
    ...(staffAlerts.length > 0 ? ["", ...staffAlerts] : []),
    ...(noFly ? ["", noFly] : []),
    "",
    SUMMARY[lang].closing,
  ].join("\n");
}

export function renderReply(trip: Trip, questions: GuestQuestion[]): RenderedReply {
  const lang: Lang = trip.language.value ?? "en";

  if (questions.length === 0) return { kind: "summary", text: renderSummary(trip, lang) };

  const parts = ackParts(trip, lang);
  if (parts.length === 0) return { kind: "greeting", text: GREETING[lang].join("\n") };

  return { kind: "questions", text: renderAckAndQuestions(trip, lang, questions, parts) };
}
