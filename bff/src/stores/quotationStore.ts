import { themeCss } from "../views/theme.ts";
import { randomUUID } from "node:crypto";
import { normalizePricing, recalculateQuotationTotals, guestLinkFor, quotationValidityLines, followUpState, followUpWindowFromEnv, quotationValidUntil, type HonoQuotationDraft } from "../../../quotation/src/index.ts";
import { type Trip, buildBffTrip } from "../../../ai/src/index.ts";
import { buildSimulatedModel } from "../services/simulatedEstimator.ts";
import { createQuotationStoreFromEnv, type QuotationStore } from "./quotationStoreClient.ts";
import { type DemoRole } from "../auth/demoAuth.ts";
import { escapeHtml } from "../views/html.ts";

/**
 * Lazily-built, so reading the env happens at first use rather than at import time. That keeps
 * importing this module side-effect free (the contract test can still spin up its own stores
 * without the production env leaking in), and means every caller shares one store for the life
 * of the process — the in-memory one behaves like the old module `Map`s did, while the Redis one
 * is the fix for guest links dying on redeploy.
 */
let storePromise: Promise<QuotationStore> | undefined;
function getStore(): Promise<QuotationStore> {
  storePromise ??= Promise.resolve(createQuotationStoreFromEnv());
  return storePromise;
}

/**
 * The unpredictable part of a guest-facing quotation link.
 *
 * `/q/:slug` is deliberately reachable without a credential — it is the link staff paste
 * into WhatsApp, so the guest must be able to open it — which means the slug itself is the
 * only thing standing between a URL and someone else's booking. A UUID is 122 bits of CSPRNG
 * output.
 *
 * Lowercase, because this store indexes slugs case-insensitively (`quoteIdBySlug` keys are
 * lowercased) while URL paths are case-sensitive. A mixed-case token — base64url, say — would
 * be indexed under one spelling and looked up under another, so a legitimate link would 404.
 * That mistake was made here and caught by the "still serves the real quotation" test; the
 * two slug generators must use the same alphabet.
 *
 * The previous slugs were derived from the guest's own name and dates ("sky-oct10-group"),
 * and are guessable by anyone who knows the guest's name. Treat this value as a credential:
 * never rebuild it from booking data, never shorten it, and never log it next to the PII it
 * protects.
 */
function randomSlug(): string {
  return randomUUID();
}

// A synthetic split-day group scenario, pre-seeded so /quotes always has an immediately
// editable quotation to look at, even on a fresh serverless cold start.
//
// It is a FIXTURE, and it now says so in its own data. It used to carry a real guest's name and
// a real phone number copied out of a live enquiry, which meant PII was sitting in source
// control and rendering on a staff page — and when the old code fell back to this record for any
// unknown slug, that PII was reachable at a public URL. The name and number below are obviously
// not anyone's, so nobody can mistake this for a real booking or leak a real one by extending it.
//
// The guest-facing slug is randomised rather than derived from the name: this record is served by
// `/q/:slug` with no credential, so a guessable slug is a guessable quotation. The quote id stays
// readable because it is only reachable behind the staff token.
// Bump this whenever the seeded fixture's shape or pricing changes. `ensureSeeded()` compares it
// to the stored record and re-seeds when they differ, so a deploy that changes the fixture (e.g.
// the 2026-09-25 real-rate-card migration) does not leave the previous copy stuck in KV forever.
//
// v2: the studio prices from the engine and nothing else, so the fixture carries a real `bffTrip`
// and the engine's own answer for it. Before this it carried a hand-typed line-item table that the
// page no longer renders — a cold-start studio showed "not priced yet" and no trip to review.
//
// v3: the seed's staff alert was markdown (`**Custom Dive Schedule:**`), and staff alerts render as
// text, so the first quotation anyone opens showed literal asterisks.
//
// v4: the stored fixture had been PUBLISHED, against the team estimator's fixture deployment, and that
// deployment keeps share tokens in one serverless instance's memory — so its link is dead and cannot
// be repaired (the token is gone from their side). A fixture that opens on "send the message again"
// with a link nobody can open is a bad first impression of a flow that works, so the fixture is
// rebuilt to its pre-publish state: no estimator session, pending review, priced by the sample
// engine. See `docs/specs/upstream-note-bff-vercel-deploy.md` for the measurement.
//
// v5: it happened again during the 2026-09-28 audit (published 07:10 UTC), because the only thing
// stopping it was a version check that nobody re-runs. Same rebuild, and `/publish` now refuses the
// fixture outright — see `seeded_fixture` in app.ts — so the third time is not a matter of chance.
const SEED_VERSION = 5;

/**
 * The fixture's trip, as the extractor would have produced it: a split-day diving group, which is
 * the case the guardrail deliberately routes to staff rather than auto-pricing.
 */
function seededTrip(): Trip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  return {
    language: f("en", "default"),
    contactName: f("Sample Group"),
    checkIn: f("2026-10-10"),
    checkOut: f("2026-10-12"),
    nights: f(2),
    guests: f(4),
    rooms: f(2),
    roomType: f("standard"),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none", "derived"),
    diver: f(true),
    divers: f(null, "missing"),
    diveNotes: f("1 person dives day 1; 5 people dive both days"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
  } as Trip;
}

let seedPromise: Promise<void> | undefined;
function ensureSeeded(): Promise<void> {
  seedPromise ??= (async () => {
    const store = await getStore();
    const existing = await store.get("QT-1010-SKY");
    if (existing && existing.seedVersion === SEED_VERSION) return;
    const now = new Date().toISOString();
    const baseUrl = "https://technext-edge-casa-bff.vercel.app";
    const slug = randomSlug();
    const trip = buildBffTrip(seededTrip());
    const seeded: HonoQuotationDraft = recalculateQuotationTotals({
    quoteId: "QT-1010-SKY",
    slug,
    seedVersion: SEED_VERSION,
    status: "pending_hono_review",
    createdAt: now,
    updatedAt: now,
    phone: "639000000000",
    guestName: "Sample Group",
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
    nights: 2,
    stayingGuests: 4,
    totalGroupSize: 6,
    rooms: 2,
    mealPlan: "full_board",
    diver: true,
    divers: null,
    diveNotes: "1 person dives day 1; 5 people dive both days",
    guestType: "regular",
    currency: "PHP",
    discountPercent: 0,
    // No hand-typed lines: the studio draws the price from the engine now, and a seeded fixture
    // that carried its own arithmetic is exactly the second source of truth that was removed.
    // `totalAmount` below is the engine's own revenue, so the sidebar and the cards agree.
    lineItems: [],
    subtotalAmount: 0,
    discountAmount: 0,
    totalAmount: buildSimulatedModel(trip).kpis.revenue ?? 0,
    bffTrip: trip,
    pricing: normalizePricing({
      model: buildSimulatedModel(trip),
      source: "simulated",
      sample: true,
      mode: "fixture",
      role: "guest",
      computedAt: now,
    }),
    estimator: null,
    quotationUrl: `${baseUrl}/q/${slug}`,
    honoEditorUrl: `${baseUrl}/quotes/QT-1010-SKY`,
    staffNotes:
      "Split-day diving arrangement: 6 people total (4 staying overnight in 2 rooms; 1 diver on Day 1 only, 5 divers on both days).",
    staffAlerts: [
      // Plain text, no `**`: this string is rendered as text in the studio, so markdown emphasis
      // reaches staff as literal asterisks. (Found on the seeded fixture, which is the first thing
      // anyone opens.)
      "Custom dive schedule noted — 1 person dives day 1, 5 people dive both days. Our reservation team will prepare the quotation.",
    ],
  });
    await store.save(seeded);
  })();
  return seedPromise;
}

export async function saveQuotationDraft(draft: HonoQuotationDraft): Promise<HonoQuotationDraft> {
  const store = await getStore();
  await ensureSeeded();
  const normalized = recalculateQuotationTotals(draft);
  return store.save(normalized);
}

/**
 * A record nobody may delete, however the request arrived.
 *
 * This is the one code path in the product that removes a business record, and it is asked two ways:
 * the automatic duplicate rule below, and an explicit list of ids (`{ ids: [...] }`, which is how
 * leftovers from a manual test are cleared). The explicit list is the more dangerous form — whoever
 * holds the staff key can name any record at all — so the protections live here, in one predicate
 * both routes call, rather than being a property of how a list was built.
 *
 * What it protects, and why each one is here:
 *
 *   * a **published** record, because a guest may be holding its link;
 *   * a **corrected** record, because somebody's work is in it;
 *   * the **seeded** fixture, because that is what a cold start shows;
 *   * an **approved** record, because that is a decision somebody made and may already have told the
 *     guest about — deleting the only local evidence of it is not a tidy-up;
 *   * a record with a **submission**, because a folio exists on the customer's side and this record
 *     is what ties it to a guest here.
 */
export function protectedFromCleanup(q: HonoQuotationDraft): boolean {
  if (q.estimator?.sharedAt) return true;
  if ((q.staffEdits ?? []).length > 0) return true;
  if (typeof q.seedVersion === "number" || q.quoteId === "QT-1010-SKY") return true;
  if (q.status === "confirmed_by_hono" || q.confirmedAt) return true;
  if (q.submission) return true;
  return false;
}

/**
 * A closed enquiry — cancelled, or the record a reset closed behind it.
 *
 * Never a duplicate and never a candidate for the automatic rule: staff close records on purpose
 * (`closeEnquiryQuotation`), and the studio keeps them readable under their own filter. Cleanup may
 * still remove one that is named explicitly, because that is a person pointing at a record they can
 * see; what it must not do is decide on its own that a *live* record was the duplicate of a closed
 * one, which is the shape of the bug this predicate exists for.
 */
function isClosedQuotation(q: HonoQuotationDraft): boolean {
  return q.status === "cancelled";
}

/**
 * The duplicate drafts a fixed bug left behind, and the rule that says which are safe to remove.
 *
 * Before `findOpenQuotationForPhone` existed, every message in a thread that had enough information
 * minted a NEW quotation for the same phone: one manual test produced thirteen (`QT-1120-MIGU-*`,
 * four of them inside the same minute). Staff cannot work a queue like that, and every one of them
 * looked current.
 *
 * The rule is deliberately conservative, because this is the only code in the product that deletes
 * a business record:
 *
 *   * one record per phone survives — the **newest** by `updatedAt` among the records that are plain
 *     drafts. A protected or closed record is not a candidate to be that survivor: choosing one and
 *     then deleting the live record it replaced is how a cancelled quotation, which is newer than
 *     everything because it was closed last, would have deleted the enquiry that replaced it;
 *   * anything `protectedFromCleanup` names survives;
 *   * a closed record survives the automatic rule too, and only ever goes when it is named;
 *   * a record with no phone is not a duplicate of anything, and survives.
 *
 * Everything it does remove is a record nobody published, approved, corrected or booked, which a
 * newer record for the same guest already replaces. It is a pure function of the list, so the route
 * and its test cannot disagree about what would go.
 */
export function duplicateQuotationIds(all: HonoQuotationDraft[]): HonoQuotationDraft[] {
  const candidates = all.filter((q) => !protectedFromCleanup(q) && !isClosedQuotation(q));
  const newestByPhone = new Map<string, HonoQuotationDraft>();
  for (const q of candidates) {
    const key = q.phone ? `phone:${q.phone}` : `quote:${q.quoteId}`;
    const incumbent = newestByPhone.get(key);
    // `list()` is newest-first, but this must not depend on that: compare timestamps outright.
    if (!incumbent || q.updatedAt > incumbent.updatedAt) newestByPhone.set(key, q);
  }

  return all.filter((q) => {
    const key = q.phone ? `phone:${q.phone}` : `quote:${q.quoteId}`;
    if (newestByPhone.get(key)?.quoteId === q.quoteId) return false;
    if (protectedFromCleanup(q)) return false;
    if (isClosedQuotation(q)) return false;
    return true;
  });
}

/** Remove one quotation by id or slug. Returns false when there was nothing to remove. */
export async function removeQuotation(idOrSlug: string): Promise<boolean> {
  const store = await getStore();
  return store.remove(idOrSlug);
}

/**
 * Looks a quotation up by id or by guest-facing slug.
 *
 * Returns `undefined` for anything unknown, and that is the whole security property: the
 * caller serves `/q/:slug` without a credential, so "not found" has to mean not found.
 *
 * What used to be here instead was a fallback that never let a link 404: any unknown slug
 * returned the most recent quotation, and any id matching `/^QT-/` was cloned from the
 * seeded record. The result was that
 * `GET /q/<anything at all>` returned a real guest's name, dates, party size and total —
 * verified against the live deployment, with no credential.
 */
export async function getQuotationByIdOrSlug(idOrSlug: string): Promise<HonoQuotationDraft | undefined> {
  const store = await getStore();
  await ensureSeeded();
  return store.get(idOrSlug);
}

export async function listQuotations(): Promise<HonoQuotationDraft[]> {
  const store = await getStore();
  await ensureSeeded();
  return store.list();
}

/** What a caller asked the list for. Empty means "all of it", which is what the studio's page does. */
export interface QuotationQuery {
  /** `pending_hono_review` | `confirmed_by_hono` | `cancelled`, or one of the studio's own filters. */
  status?: string;
  /** Free text over the guest's name, the quotation id, the phone and the stay dates. */
  q?: string;
  limit?: number;
}

/** The studio's own filter names, mapped to the stored statuses they select. */
const STATUS_FILTERS: Record<string, (draft: HonoQuotationDraft) => boolean> = {
  "needs-review": (draft) => draft.status !== "confirmed_by_hono" && draft.status !== "cancelled",
  approved: (draft) => draft.status === "confirmed_by_hono",
  cancelled: (draft) => draft.status === "cancelled",
};

/**
 * The queue, filtered where the data is.
 *
 * The route used to answer every quotation it had, always, and the studio filtered the array in the
 * browser. That is fine for the ten records a demo has and wrong for the reason the studio exists:
 * this queue only grows (nothing removes a row except a deliberate cleanup), and every row carries
 * the guest's name and phone number. The filter and the cap belong on the server.
 *
 * The store still reads the whole set and filters here rather than in Redis, and that is a deliberate
 * limit rather than an oversight: an index would be a sorted set per status plus a phone index, with
 * its own consistency rules to get wrong, and the honest size of this queue today does not need one.
 * What it does need — not shipping every record over the wire on every page load — is here.
 */
export function filterQuotations(all: HonoQuotationDraft[], query: QuotationQuery): HonoQuotationDraft[] {
  const status = query.status?.trim().toLowerCase();
  const byStatus = STATUS_FILTERS[status ?? ""] ?? (status ? (draft) => draft.status === status : null);
  const needle = query.q?.trim().toLowerCase();
  const filtered = all.filter((draft) => {
    if (byStatus && !byStatus(draft)) return false;
    if (!needle) return true;
    return [draft.guestName, draft.quoteId, draft.phone, draft.checkIn, draft.checkOut]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle));
  });
  const limit = query.limit && query.limit > 0 ? query.limit : undefined;
  return limit ? filtered.slice(0, limit) : filtered;
}

/**
 * The unpublised quotation this phone's enquiry already has, if it has one.
 *
 * Exists because the quotation tool mints a fresh id and slug on every call: a WhatsApp thread that
 * kept talking after its enquiry was complete left a NEW draft in the studio for every turn.
 * Measured on production from one manual test — thirteen quotations for one guest, at one per
 * message. Staff cannot work a queue like that, and every one of them looked current.
 *
 * A quotation that has been published is deliberately NOT reused: their link resolves to the newest
 * saved revision, so editing a published quote would silently change what a guest already holds
 * (their Q-005). That case has to become a new quotation and a new link.
 *
 * A *closed* one is not reused either, and that filter belongs here rather than at each call site:
 * a cancelled record is a finished enquiry, and "the open quotation for this phone" returning one is
 * how the next guest's enquiry inherited the previous one's approval and price. The two callers that
 * exist today both re-checked it, which is exactly the sort of rule that survives until somebody
 * writes a third caller.
 */
export async function findOpenQuotationForPhone(phone: string): Promise<HonoQuotationDraft | undefined> {
  if (!phone) return undefined;
  const all = await listQuotations();
  return all.find((q) => q.phone === phone && q.status !== "cancelled" && !q.estimator?.sharedAt);
}

// Re-exported from presentation layer for backwards compatibility
export { renderHonoQuotationEditorHtml } from "../views/quotationEditorPage.ts";
