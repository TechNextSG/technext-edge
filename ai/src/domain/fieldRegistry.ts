import { z } from "zod";
import type { Trip, FieldState, GuestLanguage } from "./schema.ts";

/**
 * Single Authoritative Field Registry for Trip properties (Pattern 6).
 * Consolidates field metadata, schema, labels, questions, handoff requirement,
 * and fact gate rules in one central table to prevent multi-file drift.
 */

export interface FieldDefinition {
  key: keyof Trip;
  label: Record<GuestLanguage, string>;
  phrase?: Record<GuestLanguage, string>;
  requiredForHandoff: boolean;
  askOn?: ReadonlyArray<FieldState>;
  question?:
    | Record<GuestLanguage, string>
    | ((trip: Trip, lang: GuestLanguage) => string);
  when?: (trip: Trip) => boolean;
  factGate?: {
    type: "count" | "roomType" | "date" | "boolean" | "none";
    countType?: "nights" | "guests" | "rooms" | "divers";
  };
}

export const FIELD_REGISTRY: Record<keyof Trip, FieldDefinition> = {
  language: {
    key: "language",
    label: { en: "Language", zh: "语言" },
    requiredForHandoff: false,
    factGate: { type: "none" },
  },
  checkIn: {
    key: "checkIn",
    label: { en: "Check-in", zh: "入住" },
    phrase: { en: "your check-in date", zh: "入住日期" },
    requiredForHandoff: true,
    question: { en: "What date would you like to check in?", zh: "您想在哪天入住？" },
    factGate: { type: "date" },
  },
  checkOut: {
    key: "checkOut",
    label: { en: "Check-out", zh: "退房" },
    phrase: { en: "your check-out date", zh: "退房日期" },
    requiredForHandoff: true,
    // Derived from checkIn + nights; never asked directly
    factGate: { type: "date" },
  },
  nights: {
    key: "nights",
    label: { en: "Nights", zh: "晚数" },
    phrase: { en: "how many nights", zh: "住几晚" },
    requiredForHandoff: true,
    question: { en: "How many nights will you be staying?", zh: "您计划入住几个晚上？" },
    when: (trip) => !(trip.checkOut?.state && trip.checkOut.state !== "missing"),
    factGate: { type: "count", countType: "nights" },
  },
  guests: {
    key: "guests",
    label: { en: "Guests", zh: "客人数" },
    phrase: { en: "how many guests", zh: "客人人数" },
    requiredForHandoff: true,
    question: { en: "How many guests in total?", zh: "一共有几位客人？" },
    factGate: { type: "count", countType: "guests" },
  },
  rooms: {
    key: "rooms",
    label: { en: "Rooms", zh: "房间数" },
    phrase: { en: "how many rooms", zh: "房间数" },
    requiredForHandoff: true,
    question: { en: "How many rooms do you need?", zh: "您需要几间房？" },
    factGate: { type: "count", countType: "rooms" },
  },
  roomType: {
    key: "roomType",
    label: { en: "Room type", zh: "房型" },
    requiredForHandoff: true,
    question: {
      en: "Would you like a standard, deluxe, or suite room?",
      zh: "您想订标准房、豪华房，还是套房？",
    },
    factGate: { type: "roomType" },
  },
  meals: {
    key: "meals",
    label: { en: "Meals", zh: "餐食" },
    phrase: { en: "your meal plan", zh: "餐食方案" },
    requiredForHandoff: true,
    question: {
      en: "Would you like full board, half board, or room only?",
      zh: "您需要全餐、半餐，还是只要住宿？",
    },
    factGate: { type: "none" },
  },
  transport: {
    key: "transport",
    label: { en: "Airport transfer", zh: "机场接送" },
    phrase: { en: "whether you need a transfer", zh: "是否需要接送" },
    requiredForHandoff: true,
    question: { en: "Do you need an airport transfer?", zh: "您需要机场接送吗？" },
    factGate: { type: "boolean" },
  },
  contactName: {
    key: "contactName",
    label: { en: "Contact name", zh: "联系人姓名" },
    phrase: { en: "a name for the booking", zh: "预订人姓名" },
    requiredForHandoff: true,
    question: { en: "What name should we put on the booking?", zh: "预订时应该登记谁的姓名？" },
    factGate: { type: "none" },
  },
  guestType: {
    key: "guestType",
    label: { en: "Guest type", zh: "客人类型" },
    requiredForHandoff: false,
    factGate: { type: "none" },
  },
  transportType: {
    key: "transportType",
    label: { en: "Transfer", zh: "接送类型" },
    phrase: { en: "one-way or return transfer", zh: "单程还是往返接送" },
    requiredForHandoff: true,
    askOn: ["missing", "default"],
    question: { en: "One-way or return transfer?", zh: "需要单程还是往返接送？" },
    when: (trip) => trip.transport?.value === true,
    factGate: { type: "none" },
  },
  diver: {
    key: "diver",
    label: { en: "Diving", zh: "是否潜水" },
    phrase: { en: "whether you plan to dive", zh: "是否潜水" },
    requiredForHandoff: true,
    question: { en: "Would you like to go diving during your stay?", zh: "您这次想潜水吗？" },
    when: (trip) => {
      const field = trip.diveNotes;
      return !(
        (field?.state === "stated" || field?.state === "inferred") &&
        field.value !== null &&
        field.value !== undefined
      );
    },
    factGate: { type: "boolean" },
  },
  divers: {
    key: "divers",
    label: { en: "Divers", zh: "潜水人数" },
    phrase: { en: "how many of you dive", zh: "潜水人数" },
    requiredForHandoff: true,
    question: { en: "How many of you will be diving?", zh: "有几位客人潜水？" },
    when: (trip) => {
      const field = trip.diveNotes;
      const hasNotes =
        (field?.state === "stated" || field?.state === "inferred") &&
        field.value !== null &&
        field.value !== undefined;
      return trip.diver?.value === true && !hasNotes;
    },
    factGate: { type: "count", countType: "divers" },
  },
  diveFrom: {
    key: "diveFrom",
    label: { en: "Diving from", zh: "潜水开始" },
    phrase: { en: "the first day you dive", zh: "开始潜水的日期" },
    requiredForHandoff: true,
    question: (trip, lang) => {
      const from = typeof trip.checkIn?.value === "string" ? trip.checkIn.value : null;
      const to = typeof trip.checkOut?.value === "string" ? trip.checkOut.value : null;
      if (from && to) {
        if (lang === "zh") return `潜水从哪天开始？（在住宿期间 ${from} – ${to} 内）`;
        return `Which day does your diving start? (within your stay: ${from} – ${to})`;
      }
      return { en: "Which day does your diving start?", zh: "潜水从哪天开始？" }[lang];
    },
    when: (trip) => {
      const field = trip.diveNotes;
      const hasNotes =
        (field?.state === "stated" || field?.state === "inferred") &&
        field.value !== null &&
        field.value !== undefined;
      return trip.diver?.value === true && !hasNotes;
    },
    factGate: { type: "date" },
  },
  diveTo: {
    key: "diveTo",
    label: { en: "Diving to", zh: "潜水结束" },
    phrase: { en: "the last day you dive", zh: "结束潜水的日期" },
    requiredForHandoff: true,
    question: (trip, lang) => {
      const from = typeof trip.checkIn?.value === "string" ? trip.checkIn.value : null;
      const to = typeof trip.checkOut?.value === "string" ? trip.checkOut.value : null;
      if (from && to) {
        if (lang === "zh") return `哪天结束？（在住宿期间 ${from} – ${to} 内）`;
        return `And which day does it end? (within your stay: ${from} – ${to})`;
      }
      return { en: "And which day does it end?", zh: "哪天结束？" }[lang];
    },
    when: (trip) => {
      const field = trip.diveNotes;
      const hasNotes =
        (field?.state === "stated" || field?.state === "inferred") &&
        field.value !== null &&
        field.value !== undefined;
      return trip.diver?.value === true && !hasNotes;
    },
    factGate: { type: "date" },
  },
  diveNotes: {
    key: "diveNotes",
    label: { en: "Dive breakdown", zh: "潜水安排详情" },
    requiredForHandoff: false,
    factGate: { type: "none" },
  },
  specialRequests: {
    key: "specialRequests",
    label: { en: "Special notes", zh: "特别要求" },
    requiredForHandoff: false,
    factGate: { type: "none" },
  },
  dietNotes: {
    key: "dietNotes",
    label: { en: "Diet / allergies", zh: "饮食／过敏" },
    requiredForHandoff: false,
    factGate: { type: "none" },
  },
  transferDirection: {
    key: "transferDirection",
    label: { en: "Airport transfer", zh: "机场接送" },
    requiredForHandoff: false,
    factGate: { type: "none" },
  },
  guestNames: {
    key: "guestNames",
    label: { en: "Guest names", zh: "客人名单" },
    requiredForHandoff: false,
    factGate: { type: "none" },
  },
};

export const TRIP_FIELD_KEYS = Object.keys(FIELD_REGISTRY) as Array<keyof Trip>;

export function getFieldDefinition(key: keyof Trip): FieldDefinition {
  return FIELD_REGISTRY[key];
}
