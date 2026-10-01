/**
 * How long a quotation is good for, and when the resort should chase the guest.
 *
 * Two thresholds, both from the operation the studio is built around (their F07 flow): a soft-hold
 * window of 72 hours, and a nudge at 48 — "chưa phản hồi sau 48h thì nhắc, sau 72h thì nhắc lần cuối
 * rồi để lễ tân quyết định". The reason this is one module rather than three numbers is that the same
 * window is drawn in three places that must not drift: the guest's copy page, the studio's badges,
 * and the message the resort sends. Two of them are guest-facing claims about time.
 *
 * What this deliberately does NOT do is decide whether the resort actually holds a room. It cannot:
 * nothing in this service reserves inventory, and rooms live in the team Odoo. So the window
 * here is the validity of the QUOTATION — which is ours to promise — and any stronger wording ("we are
 * holding your room") has to come from the resort, not from a constant in our code.
 */
import type { HonoQuotationDraft } from "./quotationDraft.js";

/** Hours after the guest was sent the quotation. Timings are the resort's own, so they are config. */
export interface FollowUpWindow {
  /** When a gentle chase is appropriate: the guest has had two days to answer. */
  nudgeHours: number;
  /** When the quotation's stated validity is over. */
  staleHours: number;
}

export const DEFAULT_FOLLOW_UP_WINDOW: FollowUpWindow = { nudgeHours: 48, staleHours: 72 };

function hours(value: string | undefined, fallback: number): number {
  const parsed = Number((value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The window this deployment runs with.
 *
 * `QUOTATION_VALID_HOURS` is the guest-facing one (the plan's "72 giờ"), `QUOTATION_NUDGE_HOURS` the
 * internal one. Both are read per call rather than at module load, because tests set them per case and
 * Vercel does not guarantee env at import time.
 */
export function followUpWindowFromEnv(env: NodeJS.ProcessEnv = process.env): FollowUpWindow {
  const staleHours = hours(env.QUOTATION_VALID_HOURS, DEFAULT_FOLLOW_UP_WINDOW.staleHours);
  const nudgeHours = Math.min(hours(env.QUOTATION_NUDGE_HOURS, DEFAULT_FOLLOW_UP_WINDOW.nudgeHours), staleHours);
  return { nudgeHours, staleHours };
}

/**
 * When the guest was actually sent this quotation, in ms — or null if they never were.
 *
 * `sentToGuestAt` only. Publishing is not sending (the studio has "Create link only"), and a
 * quotation nobody has been sent is not one anybody is waiting on: chasing a guest about a link they
 * never received is how a helpful follow-up becomes a confusing one. Measured on production: the
 * badge used `sharedAt` as a fallback and called a link-only publish "overdue" after 72 hours.
 */
export function sentAtMs(draft: HonoQuotationDraft): number | null {
  const sent = draft.sentToGuestAt;
  if (!sent) return null;
  const ms = new Date(sent).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** How long ago the guest was sent this quotation, or null when they were never sent it. */
export function hoursSinceSent(draft: HonoQuotationDraft, now: number = Date.now()): number | null {
  const sent = sentAtMs(draft);
  return sent === null ? null : (now - sent) / 3_600_000;
}

/**
 * What the resort owes this guest right now.
 *
 *   * `none`   — nothing to chase: never sent, archived, or already booked (a folio exists, so the
 *                deposit question is answered and a "no deposit yet" badge would be a lie);
 *   * `nudge`  — sent, past the nudge threshold, still inside the stated validity: chase gently;
 *   * `stale` — past the validity: chase, and the quotation may be released.
 */
export type FollowUpState = "none" | "nudge" | "stale";

export function followUpState(
  draft: HonoQuotationDraft,
  now: number = Date.now(),
  window: FollowUpWindow = followUpWindowFromEnv(),
): FollowUpState {
  if (draft.status === "cancelled") return "none";
  // A booking is the end of this question. `submission` is the folio the team estimator created, and
  if (draft.submission) return "none";
  const hours = hoursSinceSent(draft, now);
  if (hours === null) return "none";
  if (hours >= window.staleHours) return "stale";
  if (hours >= window.nudgeHours) return "nudge";
  return "none";
}

/**
 * When this quotation stops being valid — the date the guest page and the message both quote.
 *
 * Null when the guest was never sent it: there is no start, so there is no end, and a page that
 * printed one anyway would be inventing a deadline for a quotation nobody has seen.
 */
export function quotationValidUntil(
  draft: HonoQuotationDraft,
  window: FollowUpWindow = followUpWindowFromEnv(),
): Date | null {
  const sent = sentAtMs(draft);
  if (sent === null) return null;
  return new Date(sent + window.staleHours * 3_600_000);
}

/** `2026-10-01 15:00` in Manila, which is the clock the resort and its guests actually use. */
export function formatManila(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * The one sentence about the quotation's own deadline, or nothing when it was never sent.
 *
 * There used to be a deposit and a balance line here beside it. The customer's own quotation tool says
 * nothing about a deposit — the front desk confirms availability and contacts the guest — so this
 * service no longer states one either. What is left is ours and only about the *quotation*: we know when
 * we sent it, so we can say when it lapses. It is not a claim about inventory, and it is not a promise to
 * hold a room (nothing in this service holds one).
 */
export function quotationValidityLines(validUntil: Date | null): string[] {
  return validUntil ? [`This quotation is valid until ${formatManila(validUntil)} (Manila time).`] : [];
}
