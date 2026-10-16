import type { Trip, GuestLanguage } from "../../domain/schema.ts";
import { FIELD_REGISTRY } from "../../domain/fieldRegistry.ts";

export type FallbackKind = "apology" | "handoff" | "not_booking";

export const ASK_LIMIT = 8;
export const STALL_LIMIT = 3;

export const FALLBACKS: Record<FallbackKind, Record<GuestLanguage, string>> = {
  apology: {
    en: "Sorry — something went wrong on our side while I was reading your last message, so I haven't managed to note the details down yet. I've flagged this for the Casa team and a person will reply to you here. Our front desk is open until 9 PM (Manila time), so if you have written outside those hours you will hear from us the next morning.",
    zh: "抱歉，我们这边读取您刚才的消息时出了问题，暂时还没能记录下信息。我已经通知 Casa 团队，会在这里回复您。前台服务时间至晚上 9 点（马尼拉时间），若您在此时间之后留言，我们会在第二天早上回复您。",
  },
  handoff: {
    en: "A member of the Casa team is handling your enquiry now and will reply to you here. Our front desk is open until 9 PM (Manila time), so if you have written outside those hours you will hear from us the next morning. Thank you for your patience.",
    zh: "Casa 团队正在处理您的咨询，会在这里回复您。前台服务时间至晚上 9 点（马尼拉时间），若您在此时间之后留言，我们会在第二天早上回复您。感谢您的耐心等待。",
  },
  not_booking: {
    en: "Thanks for your message! This number is for new booking enquiries, so I've passed it to the Casa team — a person will reply to you here.",
    zh: "感谢您的消息！此号码用于新的预订咨询，我已将您的消息转给 Casa 团队，会有人在这里回复您。",
  },
};

/** The static message for a moment with no trip to render, in the guest's language. */
export function fallbackReply(kind: FallbackKind, language: GuestLanguage | null): string {
  return FALLBACKS[kind][language ?? "en"];
}

export function partnerInvitationReply(language: GuestLanguage | null, signInUrl: string): string {
  if (language === "zh") {
    return [
      "如果您是以合作旅行社／代理身份预订，请在我们的报价 App 登录，即可看到您的合作价并直接预订：",
      signInUrl,
      "新的合作账号由前台审核开通。如果您只是为自己预订，回复我一声，我就照常继续。",
    ].join("\n");
  }
  return [
    "If you're booking as a partner agency, sign in on our quotation app to see your partner rate and book directly:",
    signInUrl,
    "New partner accounts are verified by our front desk. If you're booking for yourselves, just tell me and I'll carry on.",
  ].join("\n");
}

export function joinList(items: string[], lang: GuestLanguage): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (lang === "zh") return items.join("、");
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(", ")} and ${last}`;
}

export function stalledHandoffReply(
  missingFields: ReadonlyArray<keyof Trip>,
  language: GuestLanguage | null,
): string {
  const lang: GuestLanguage = language ?? "en";
  const phrases = missingFields
    .map((field) => FIELD_REGISTRY[field]?.phrase?.[lang])
    .filter((p): p is string => Boolean(p))
    .slice(0, 3);

  if (lang === "zh") {
    const list = phrases.length > 0 ? `（还差：${phrases.join("、")}）` : "";
    return `为了避免重复询问，我已将您的咨询转给 Casa 团队成员，他们会在这里继续与您确认${list}。感谢您的耐心等待。`;
  }
  if (phrases.length === 0) return fallbackReply("handoff", lang);
  return `Rather than ask you the same things again, I've passed your enquiry to a member of the Casa team, who will pick it up with you here (still needed: ${joinList(phrases, lang)}). Thank you for your patience.`;
}

export interface StatedValueChange {
  field: string;
  from: string | number | boolean;
  to: string | number | boolean;
}

const VALUE_LABELS: Record<string, Record<GuestLanguage, string>> = {
  nights: { en: "nights", zh: "晚" },
  guests: { en: "guests", zh: "位客人" },
  rooms: { en: "rooms", zh: "间房" },
  divers: { en: "divers", zh: "位潜水员" },
};

const YES_NO: Record<GuestLanguage, [string, string]> = {
  en: ["yes", "no"],
  zh: ["是", "否"],
};

function shownValue(field: string, value: string | number | boolean, lang: GuestLanguage): string {
  if (typeof value === "boolean") return value ? YES_NO[lang][0] : YES_NO[lang][1];
  return `${value} ${VALUE_LABELS[field]?.[lang] ?? ""}`.trim();
}

export function changedValueNotice(
  changes: ReadonlyArray<StatedValueChange>,
  language: GuestLanguage | null,
): string {
  const lang: GuestLanguage = language ?? "en";
  const known = changes.filter((c) => VALUE_LABELS[c.field]).slice(0, 2);
  if (known.length === 0) return "";

  const parts = known.map((change) =>
    lang === "zh"
      ? `${VALUE_LABELS[change.field]![lang]}从 ${shownValue(change.field, change.from, lang)} 改为 ${shownValue(change.field, change.to, lang)}`
      : `${shownValue(change.field, change.from, lang)} → ${shownValue(change.field, change.to, lang)}`,
  );
  const last = known[known.length - 1]!;

  if (lang === "zh") {
    return `请确认一下：${parts.join("，")}。我先按最新的 ${shownValue(last.field, last.to, lang)} 记录。`;
  }
  return `Just to check — you changed ${joinList(parts, lang)}. I've kept the newest one (${shownValue(
    last.field,
    last.to,
    lang,
  )}); tell me if that's not right.`;
}
