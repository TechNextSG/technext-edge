import type { FieldState, Trip } from "./schema.js";

// Playbook: "Generate questions for missing fields in the backend's priority
// order: dates, guest count, rooms, and only then meals and transport."
// The model contributes facts, never this wording: this file decides which fields
// get asked about, in what order, and what the reply says. Nothing here calls a
// provider, and nothing here states a price, so a reply cannot commit Casa to one.
//
// Three deterministic replies, and the trip itself picks one (lead, 2026-09-18):
//
//   greeting   the guest has not told us anything usable yet — introduce Casa and
//              ask for the four things a quote needs
//   questions  something was understood but the enquiry is incomplete — read back
//              what was understood, then ask the rest in priority order
//   summary    nothing is left to ask — read the whole booking back and hand it to
//              a human, because only a human can confirm availability and price
//
// A house-norm default is never *asked about*. Interrogating a guest who just said
// "hi" about rooms and meal plans turns a greeting into a questionnaire, and the
// norm is a guess Casa made rather than an answer the guest owes. Assumptions are
// surfaced in the summary instead, flagged, which is where a guest expects to
// correct them.
export type GuestLanguage = "en" | "vi" | "zh";

type Lang = GuestLanguage;

export interface GuestQuestion {
  field: keyof Trip;
  question: string;
}

interface QuestionRule {
  key: keyof Trip;
  question: Record<Lang, string>;
  // Field states that make this worth asking about. "missing" is the baseline:
  // nothing was recorded, so the guest is the only source left. "default" (a house
  // norm) and "derived" (code computing it from other answers) are not asked about
  // unless a rule says so on purpose — see BASELINE.
  askOn?: ReadonlyArray<FieldState>;
  // Tier-2 fields only exist on some trips. Asking a non-diving enquiry for a
  // dive window is noise, and it buries the questions that do matter.
  when?: (trip: Trip) => boolean;
}

const BASELINE: ReadonlyArray<FieldState> = ["missing"];

const RULES: QuestionRule[] = [
  { key: "checkIn", question: { en: "What date would you like to check in?", vi: "Bạn muốn nhận phòng vào ngày nào?", zh: "您想在哪天入住？" } },
  { key: "nights", question: { en: "How many nights will you be staying?", vi: "Bạn sẽ ở bao nhiêu đêm?", zh: "您计划入住几个晚上？" } },
  { key: "guests", question: { en: "How many guests in total?", vi: "Tổng cộng có bao nhiêu khách?", zh: "一共有几位客人？" } },
  { key: "rooms", question: { en: "How many rooms do you need?", vi: "Bạn cần bao nhiêu phòng?", zh: "您需要几间房？" } },
  { key: "meals", question: { en: "Would you like full board, half board, or room only?", vi: "Bạn muốn ăn trọn gói, bán phần hay chỉ thuê phòng?", zh: "您需要全餐、半餐，还是只要住宿？" } },
  { key: "transport", question: { en: "Do you need an airport transfer?", vi: "Bạn có cần đưa đón sân bay không?", zh: "您需要机场接送吗？" } },
  // A stay at a dive resort is either a diving trip or it is not, and the answer
  // decides whether a dive package (and its window) belongs on the estimate at
  // all — so it is asked outright instead of being guessed from a keyword. Guests
  // who volunteer it in their first message are never asked.
  { key: "diver", question: { en: "Would you like to go diving during your stay?", vi: "Mình có muốn đi lặn trong chuyến này không?", zh: "您这次想潜水吗？" } },
  { key: "contactName", question: { en: "What name should we put on the booking?", vi: "Mình nên ghi tên ai trên booking?", zh: "预订时应该登记谁的姓名？" } },

  // Tier 2, from the Odoo API field guide. A missing dive window silently wipes
  // dive revenue off the estimate (see extract.ts's postProcess), and
  // transportType is only ever filled in by code as "roundtrip" — the guest never
  // confirmed one-way vs return, so a *derived* roundtrip is asked about rather
  // than trusted. Both are gated so neither is asked of a trip it cannot apply to.
  { key: "diveFrom", question: { en: "Which day does your diving start?", vi: "Bạn bắt đầu lặn từ ngày nào?", zh: "潜水从哪天开始？" }, when: (trip) => trip.diver?.value === true },
  { key: "diveTo", question: { en: "And which day does it end?", vi: "Và kết thúc vào ngày nào?", zh: "哪天结束？" }, when: (trip) => trip.diver?.value === true },
  { key: "transportType", question: { en: "One-way or return transfer?", vi: "Bạn cần đưa đón một chiều hay khứ hồi?", zh: "需要单程还是往返接送？" }, askOn: ["missing", "default", "derived"], when: (trip) => trip.transport?.value === true },
];

export function generateQuestions(trip: Trip): GuestQuestion[] {
  const language: Lang = trip.language.value ?? "en";
  const questions: GuestQuestion[] = [];
  for (const rule of RULES) {
    if (rule.when && !rule.when(trip)) continue;
    // `keyof Trip` includes optional fields (transportType, guestType, diveFrom,
    // diveTo, diver) — index access is therefore possibly undefined. A field the
    // model never returned cannot be shown or asked about, so skipping is right.
    // An absent key is not an answer either. The Tier-2 fields are optional in the
    // Trip schema, and a key nobody returned used to end the question right here —
    // which is how the diving question could vanish from a live reply (extract.ts
    // normalizes an omitted key to `missing` before this runs, and the same rule
    // belongs in the layer that decides what to ask).
    const state = trip[rule.key]?.state ?? "missing";
    if (!(rule.askOn ?? BASELINE).includes(state)) continue;
    questions.push({ field: rule.key, question: rule.question[language] ?? rule.question.en });
  }
  return questions;
}

// ---- Reply rendering --------------------------------------------------------
// Deterministic text for the reply: no model call, and every value comes from the
// trip the extractor already validated.

export type ReplyKind = "greeting" | "questions" | "summary";

export interface RenderedReply {
  kind: ReplyKind;
  text: string;
}

// The order a guest reads a booking back in: who is coming, what is included, who
// to contact. The stay leads the summary separately — it is a range, not a field.
// `language` and `guestType` are absent on purpose: the first is a property of the
// message itself and the second is an internal Odoo distinction, so neither means
// anything to the person reading the reply.
const SUMMARY_ORDER: ReadonlyArray<keyof Trip> = ["guests", "rooms", "meals", "contactName"];

const LABELS: Record<keyof Trip, Record<Lang, string>> = {
  language: { en: "Language", vi: "Ngôn ngữ", zh: "语言" },
  checkIn: { en: "Check-in", vi: "Nhận phòng", zh: "入住" },
  checkOut: { en: "Check-out", vi: "Trả phòng", zh: "退房" },
  nights: { en: "Nights", vi: "Số đêm", zh: "晚数" },
  guests: { en: "Guests", vi: "Số khách", zh: "客人数" },
  rooms: { en: "Rooms", vi: "Số phòng", zh: "房间数" },
  meals: { en: "Meals", vi: "Bữa ăn", zh: "餐食" },
  transport: { en: "Airport transfer", vi: "Đưa đón sân bay", zh: "机场接送" },
  contactName: { en: "Contact name", vi: "Tên liên hệ", zh: "联系人姓名" },
  guestType: { en: "Guest type", vi: "Loại khách", zh: "客人类型" },
  transportType: { en: "Transfer", vi: "Chiều đưa đón", zh: "接送类型" },
  diveFrom: { en: "Diving from", vi: "Lặn từ ngày", zh: "潜水开始" },
  diveTo: { en: "Diving to", vi: "Lặn đến ngày", zh: "潜水结束" },
  diver: { en: "Diving", vi: "Có lặn", zh: "是否潜水" },
};

// The stay is not a field but a range of two of them, so it gets its own label
// rather than being squeezed into LABELS' `keyof Trip` shape.
const STAY_LABEL: Record<Lang, string> = { en: "Stay", vi: "Kỳ nghỉ", zh: "住宿" };

const ENUM_LABELS: Record<string, Record<Lang, string>> = {
  full_board: { en: "full board", vi: "ăn trọn gói", zh: "全餐" },
  half_board: { en: "half board", vi: "bán phần", zh: "半餐" },
  room_only: { en: "room only", vi: "chỉ thuê phòng", zh: "仅住宿" },
  none: { en: "none", vi: "không", zh: "无" },
  roundtrip: { en: "return trip", vi: "khứ hồi", zh: "往返" },
  oneway: { en: "one way", vi: "một chiều", zh: "单程" },
  retail: { en: "retail guest", vi: "khách lẻ", zh: "散客" },
  agent: { en: "agent", vi: "đại lý", zh: "代理" },
  instructor: { en: "instructor", vi: "giáo viên lặn", zh: "教练" },
};

const YES_NO: Record<Lang, [string, string]> = {
  en: ["yes", "no"],
  vi: ["có", "không"],
  zh: ["是", "否"],
};

// A value the guest never said is flagged, so the summary cannot read as a
// confirmation of something Casa assumed. Only house norms carry this note:
// "derived" values are arithmetic on the guest's own answers (checkOut is checkIn
// + nights), which is exact rather than assumed, and flagging it would only make
// the summary noisier.
const ASSUMED_NOTE: Record<Lang, string> = {
  en: " (assumed)",
  vi: " (giả định)",
  zh: "（默认）",
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoParts(iso: string): { year: string; month: string; day: string } | null {
  // Pure string slicing: an ISO date from dates.ts is already resolved in Manila
  // time, and a Date round-trip could shift it by a day.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? { year: match[1], month: match[2], day: match[3] } : null;
}

/** The date the way a guest writes it: "Sep 19, 2026" / "19/09/2026" / "2026年9月19日". */
function formatDate(iso: string, lang: Lang): string {
  const p = isoParts(iso);
  if (!p) return iso;
  if (lang === "vi") return `${p.day}/${p.month}/${p.year}`;
  if (lang === "zh") return `${p.year}年${Number(p.month)}月${Number(p.day)}日`;
  return `${SHORT_MONTHS[Number(p.month) - 1]} ${Number(p.day)}, ${p.year}`;
}

/** The same date without its year — for a sentence already anchored to a stay. */
function formatDay(iso: string, lang: Lang): string {
  const p = isoParts(iso);
  if (!p) return iso;
  if (lang === "vi") return `${p.day}/${p.month}`;
  if (lang === "zh") return `${Number(p.month)}月${Number(p.day)}日`;
  return `${SHORT_MONTHS[Number(p.month) - 1]} ${Number(p.day)}`;
}

/**
 * A stay as one range rather than two dates, collapsing whatever the two ends
 * share: "Sep 19 – 21, 2026", "28/09 – 02/10/2026", "2026年9月19–21日". Falls back
 * to two full dates when the two ends are in different years.
 */
function formatRange(fromIso: string, toIso: string, lang: Lang): string {
  const from = isoParts(fromIso);
  const to = isoParts(toIso);
  if (!from || !to || from.year !== to.year) {
    return `${formatDate(fromIso, lang)} – ${formatDate(toIso, lang)}`;
  }
  if (lang === "vi") {
    return from.month === to.month
      ? `${Number(from.day)}–${Number(to.day)}/${from.month}/${from.year}`
      : `${Number(from.day)}/${from.month} – ${Number(to.day)}/${to.month}/${from.year}`;
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

function nightsText(nights: number, lang: Lang): string {
  if (lang === "vi") return `${nights} đêm`;
  if (lang === "zh") return `${nights} 晚`;
  return `${nights} ${nights === 1 ? "night" : "nights"}`;
}

const DATE_KEYS = new Set<keyof Trip>(["checkIn", "checkOut", "diveFrom", "diveTo"]);

function formatValue(key: keyof Trip, value: unknown, lang: Lang): string | null {
  if (value === null || value === undefined) return null;
  if (DATE_KEYS.has(key)) return typeof value === "string" ? formatDate(value, lang) : null;
  if (typeof value === "boolean") return YES_NO[lang][value ? 0 : 1];
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return ENUM_LABELS[value]?.[lang] ?? value;
  return null;
}

/** A value the guest stated in their own words, or null. Everything else — house
 * norms, code-derived values, another turn's transcript — reads as "not theirs". */
function statedValue<T>(trip: Trip, key: keyof Trip): T | null {
  const field = trip[key];
  return field?.state === "stated" && field.value !== null && field.value !== undefined
    ? (field.value as T)
    : null;
}

// ---- Greeting (first reply) -------------------------------------------------

const GREETING: Record<Lang, string[]> = {
  en: [
    "Hi! Welcome to Casa Escondida — our dive-and-stay resort in Anilao, Batangas.",
    "So the team can check availability and pricing for you, could you share your check-in date, how many nights, how many guests, and a name for the booking?",
  ],
  vi: [
    "Dạ em chào mình! Casa Escondida — khu nghỉ dưỡng kết hợp lặn biển tại Anilao, Batangas.",
    "Để đội ngũ kiểm tra phòng và giá cho mình, mình cho em biết ngày nhận phòng, số đêm, tổng số khách và tên liên hệ nhé.",
  ],
  zh: [
    "您好！欢迎来到 Casa Escondida——位于菲律宾 Anilao 的潜水度假村。",
    "为了帮您查询房态和价格，请告诉我入住日期、住几晚、几位客人，以及登记预订的姓名。",
  ],
};

// ---- Acknowledgment plus the remaining questions ----------------------------

// One sentence per recorded field. Every one of them takes its value from the
// trip, so the reply cannot invent a fact or miscount: there is no "3 of 7
// answers" arithmetic here for a guest to check against.
const STAY_PHRASE: Record<Lang, (day: string, nights: string) => string> = {
  en: (day, nights) => `your stay starting ${day} for ${nights}`,
  vi: (day, nights) => `kỳ nghỉ từ ${day}, ${nights}`,
  zh: (day, nights) => `从 ${day} 开始的 ${nights}`,
};

const CHECK_IN_PHRASE: Record<Lang, (day: string) => string> = {
  en: (day) => `your check-in on ${day}`,
  vi: (day) => `ngày nhận phòng ${day}`,
  zh: (day) => `${day} 入住`,
};

const NIGHTS_PHRASE: Record<Lang, (nights: string) => string> = {
  en: (nights) => `a stay of ${nights}`,
  vi: (nights) => `thời gian ở ${nights}`,
  zh: (nights) => `${nights} 的住宿`,
};

const GUESTS_PHRASE: Record<Lang, (guests: number) => string> = {
  en: (guests) => `${guests} ${guests === 1 ? "guest" : "guests"}`,
  vi: (guests) => `${guests} khách`,
  zh: (guests) => `${guests} 位客人`,
};

const MEALS_PHRASE: Record<Lang, (label: string) => string> = {
  en: (label) => label,
  vi: (label) => `bữa ăn ${label}`,
  zh: (label) => label,
};

const TRANSPORT_PHRASE: Record<Lang, { yes: string; no: string }> = {
  en: { yes: "an airport transfer", no: "that you don't need a transfer" },
  vi: { yes: "đưa đón sân bay", no: "không cần đưa đón sân bay" },
  zh: { yes: "机场接送", no: "不需要接送" },
};

const DIVER_PHRASE: Record<Lang, { yes: string; no: string }> = {
  en: { yes: "diving", no: "no diving" },
  vi: { yes: "có lặn biển", no: "không lặn biển" },
  zh: { yes: "潜水", no: "不潜水" },
};

const NAME_PHRASE: Record<Lang, (name: string) => string> = {
  en: (name) => `your name, ${name}`,
  vi: (name) => `tên liên hệ ${name}`,
  zh: (name) => `联系人 ${name}`,
};

const THANKS: Record<Lang, (name: string | null) => string> = {
  // The name is echoed exactly as the guest wrote it. Transliterating it
  // ("Nhat" → "Nhật") would be the bot correcting a fact the guest gave it.
  en: (name) => (name ? `Thanks, ${name}!` : "Thanks!"),
  vi: (name) => (name ? `Cảm ơn ${name}!` : "Dạ em cảm ơn mình!"),
  zh: (name) => (name ? `谢谢 ${name}！` : "谢谢！"),
};

const NOTED: Record<Lang, (list: string) => string> = {
  en: (list) => `I've noted down ${list}.`,
  vi: (list) => `Em đã ghi nhận ${list} ạ.`,
  zh: (list) => `我已经记录了${list}。`,
};

const NEED: Record<Lang, string> = {
  en: "To complete your enquiry, could you let me know:",
  vi: "Để hoàn tất thông tin, mình cho em biết thêm:",
  zh: "为了完成预订，请告诉我：",
};

function joinList(items: string[], lang: Lang): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (lang === "zh") return items.join("、");
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(", ")}${lang === "vi" ? " và " : " and "}${last}`;
}

/**
 * What the guest has actually said, as clauses. Only `stated` fields appear: an
 * acknowledgment that reads a house-norm default back as though the guest had
 * chosen it is exactly the fabricated confirmation the eval treats as
 * zero-tolerance, and it is also what makes a guest think they were heard when
 * they were not.
 */
function ackParts(trip: Trip, lang: Lang): string[] {
  const parts: string[] = [];
  const checkIn = statedValue<string>(trip, "checkIn");
  const nights = statedValue<number>(trip, "nights");
  const guests = statedValue<number>(trip, "guests");
  const meals = statedValue<string>(trip, "meals");
  const transport = statedValue<boolean>(trip, "transport");
  const diver = statedValue<boolean>(trip, "diver");
  const name = statedValue<string>(trip, "contactName");

  // Read back in the order the guest told the story: when, how many, what is
  // included, who. "No diving" is a fact worth confirming back — a guest who
  // said it is more likely to correct a misreading than to volunteer it twice.
  if (checkIn && nights) parts.push(STAY_PHRASE[lang](formatDay(checkIn, lang), nightsText(nights, lang)));
  else if (checkIn) parts.push(CHECK_IN_PHRASE[lang](formatDay(checkIn, lang)));
  else if (nights) parts.push(NIGHTS_PHRASE[lang](nightsText(nights, lang)));
  if (guests) parts.push(GUESTS_PHRASE[lang](guests));
  if (meals) parts.push(MEALS_PHRASE[lang](ENUM_LABELS[meals]?.[lang] ?? meals));
  if (transport !== null) parts.push(TRANSPORT_PHRASE[lang][transport ? "yes" : "no"]);
  if (diver !== null) parts.push(DIVER_PHRASE[lang][diver ? "yes" : "no"]);
  if (name) parts.push(NAME_PHRASE[lang](name));
  return parts;
}

function renderAckAndQuestions(trip: Trip, lang: Lang, questions: GuestQuestion[], parts: string[]): string {
  const name = statedValue<string>(trip, "contactName");
  return [
    THANKS[lang](name),
    NOTED[lang](joinList(parts, lang)),
    NEED[lang],
    ...questions.map((q, i) => `${i + 1}. ${q.question}`),
  ].join("\n");
}

// ---- Summary (nothing left to ask) ------------------------------------------

const SUMMARY: Record<Lang, { intro: string; closing: string }> = {
  en: {
    intro: "Here's what I have for your stay:",
    // "Nothing is booked yet" is not politeness: this reply is the first thing a
    // guest could mistake for a confirmation, and only a human can confirm
    // availability or a price.
    closing: "Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.",
  },
  vi: {
    intro: "Em xin tóm tắt thông tin mình đã gửi:",
    closing: "Đội ngũ Casa sẽ sớm liên hệ để xác nhận phòng và giá cho mình ạ — hiện tại mình chưa đặt gì nhé.",
  },
  zh: {
    intro: "以下是您提供的信息：",
    closing: "Casa 团队会很快与您联系确认房态和价格——目前尚未预订。",
  },
};

function summaryLines(trip: Trip, lang: Lang): string[] {
  const lines: string[] = [];

  // The stay is one line, a range: the guest asked for a stay, not for a check-in
  // field and a check-out field. checkOut is arithmetic on the guest's own answers
  // (extract.ts derives it), so it carries no assumed-note.
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

  // The transfer is one line, not two: a guest reads "yes · return trip", and
  // one-way vs return only means anything once a transfer is wanted at all.
  const transport = trip.transport;
  const transportType = trip.transportType;
  if (transport && transport.state !== "missing" && typeof transport.value === "boolean") {
    const wantsTransfer = transport.value;
    const typeLabel =
      wantsTransfer && transportType?.value && transportType.value !== "none"
        ? formatValue("transportType", transportType.value, lang)
        : null;
    lines.push(
      `• ${LABELS.transport[lang]}: ${YES_NO[lang][wantsTransfer ? 0 : 1]}${typeLabel ? ` · ${typeLabel}` : ""}${
        transport.state === "default" ? ASSUMED_NOTE[lang] : ""
      }`,
    );
  }

  const diver = trip.diver;
  if (diver && diver.state !== "missing" && typeof diver.value === "boolean") {
    const diveFrom = (trip.diveFrom?.value as string | null) ?? null;
    const diveTo = (trip.diveTo?.value as string | null) ?? null;
    const window = diveFrom && diveTo ? ` · ${formatRange(diveFrom, diveTo, lang)}` : "";
    lines.push(`• ${LABELS.diver[lang]}: ${YES_NO[lang][diver.value ? 0 : 1]}${window}`);
  }

  return lines;
}

function renderSummary(trip: Trip, lang: Lang): string {
  const name = statedValue<string>(trip, "contactName");
  return [THANKS[lang](name), SUMMARY[lang].intro, ...summaryLines(trip, lang), "", SUMMARY[lang].closing].join("\n");
}

/**
 * The single message sent back to a guest, and which of the three it is: the
 * greeting while the guest has told us nothing, acknowledgment plus the open
 * questions while the enquiry is incomplete, the summary once there is nothing
 * left to ask. Values that came from a house norm are flagged as assumed wherever
 * they are shown, so the guest can tell Casa's guesses from their own words.
 *
 * converse.ts picks `done` from `questions.length === 0`, so the summary and an
 * empty question list can never disagree.
 */
export function renderReply(trip: Trip, questions: GuestQuestion[]): RenderedReply {
  const lang: Lang = trip.language.value ?? "en";

  if (questions.length === 0) return { kind: "summary", text: renderSummary(trip, lang) };

  const parts = ackParts(trip, lang);
  // Nothing to acknowledge: this is the first thing the guest hears, so it is an
  // introduction rather than a form pretending to know something. The open
  // questions stay in `questions` for a form UI; the greeting asks for the same
  // four fields a quote needs, in the order the team works in.
  if (parts.length === 0) return { kind: "greeting", text: GREETING[lang].join("\n") };

  return { kind: "questions", text: renderAckAndQuestions(trip, lang, questions, parts) };
}

// ---- Fallbacks: the replies for the moments this contract cannot answer ------
//
// Deliberately not a fourth ReplyKind. The three kinds above are read off a Trip;
// these two exist precisely because there is no Trip to read — the model failed,
// or the thread stopped being the bot's to answer. They are static (same wording
// every time, in the guest's own language) and they are why a guest waiting on a
// provider outage gets a sentence instead of silence.
//
// Same rule as everything else in this file: no model writes them, so they cannot
// promise a room, a price, or a time.
export type FallbackKind = "apology" | "handoff";

/**
 * Asking is not progress after this many assistant turns on a thread that is still
 * incomplete: the guest is stuck (or the extractor is), and another round of the
 * same questions is where an enquiry dies. The thread goes to a person instead.
 *
 * A safety valve, not a cap on asking — one reply already carries every open
 * question, so a normal enquiry finishes in two or three turns.
 */
export const ASK_LIMIT = 8;

// Guests ask for a person in their own words, and both mistakes are not equal:
// a false positive costs one handoff a human can decline, a false negative keeps a
// frustrated guest in a bot loop. So the phrases are explicit — the bare word
// "human" is not enough, because "human resources conference" is a real enquiry
// and not a request to be transferred.
const HUMAN_RE = new RegExp(
  [
    "\\b(?:talk|speak|chat|write)\\s+(?:to\\s+)?(?:a\\s+|the\\s+|an\\s+)?(?:human|person|someone|agent|staff|receptionist|manager|team)\\b",
    "\\b(?:human|person|agent|receptionist|manager|staff)\\s+(?:please|now|instead|available)\\b",
    "\\b(?:call|ring)\\s+me\\b",
    "\\b(?:put|get)\\s+me\\s+through\\s+to\\b",
    "\\btransfer\\s+me\\b",
    "người thật|nhân viên|gặp người|gọi lại cho (?:em|mình|tôi)|nói chuyện với (?:người|nhân viên)|cho (?:em|mình|tôi) gặp",
    "人工|真人|工作人员|客服人员|转接",
  ].join("|"),
  "i",
);

/** True when the guest is asking for a person rather than for an answer. */
export function wantsHuman(text: string): boolean {
  return HUMAN_RE.test(text);
}

const FALLBACKS: Record<FallbackKind, Record<GuestLanguage, string>> = {
  // Sent when a turn failed before anything reached the guest. It says what
  // happened in one clause, then the only thing that is actually true and useful:
  // a person has it. It does not promise a time, and it does not ask the guest to
  // type everything again — the transcript is kept on our side.
  apology: {
    en: "Sorry — something went wrong on our side while I was reading your last message, so I haven't managed to note the details down yet. I've flagged this for the Casa team and a person will reply to you here.",
    vi: "Xin lỗi mình, hệ thống bên em gặp lỗi khi đọc tin nhắn vừa rồi nên chưa ghi nhận được thông tin ạ. Em đã báo cho đội ngũ Casa và sẽ có người trả lời mình ngay tại đây ạ.",
    zh: "抱歉，我们这边读取您刚才的消息时出了问题，暂时还没能记录下信息。我已经通知 Casa 团队，会在这里回复您。",
  },
  // Sent while a thread is parked for a human (after a failure, after the guest
  // asked for a person, or once asking has stopped being useful).
  handoff: {
    en: "A member of the Casa team is handling your enquiry now and will reply to you here. Thank you for your patience.",
    vi: "Đội ngũ Casa đang xử lý yêu cầu của mình và sẽ trả lời ngay tại đây ạ. Cảm ơn mình đã chờ.",
    zh: "Casa 团队正在处理您的咨询，会在这里回复您。感谢您的耐心等待。",
  },
};

/** The static message for a moment with no trip to render, in the guest's language. */
export function fallbackReply(kind: FallbackKind, language: GuestLanguage | null): string {
  return FALLBACKS[kind][language ?? "en"];
}

