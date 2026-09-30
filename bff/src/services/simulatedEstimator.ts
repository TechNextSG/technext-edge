/**
 * The simulated estimator: the customer's pricing model, computed locally.
 *
 * Why this exists (lead decision, 2026-09-26): *"trước khi có key từ Phillip cứ dựng giả lập, vì
 * khi nào đảm bảo mới giao ra key được."* Phillip's API keys are handed over only once the work
 * is proven, so until then the whole flow — price, per-guest breakdown, booking — has to run
 * **without a single Odoo credential** and still behave exactly like the finished thing.
 *
 * Two properties make that true rather than aspirational:
 *
 * 1. **It answers in the customer's own shape.** The output is the body of
 *    `contracts/odoo/examples/compute.*.json` — `quotes[]` with per-guest `lines`, `catRev`,
 *    `kpis`, `presence`, `covers`, `dayPlans`, `gwin`. Not a shape of our own invention. So the
 *    studio and the guest page read real-contract fields today, and switching
 *    `ESTIMATOR_MODE=remote` changes where the numbers come from, not how they are read.
 *
 * 2. **It reproduces the captured fixture exactly.** For the couple in
 *    `compute.retail-couple.json` this returns the same ₱31,200, the same ₱15,200 room /
 *    ₱6,000 meals / ₱10,000 dive split, the same `rpgn`, the same `covers`. That equality is the
 *    contract test (`simulatedEstimator.test.ts`), and it is what makes a local price
 *    trustworthy enough to demo: it is the customer's arithmetic, not ours.
 *
 * What it is NOT: a second source of pricing truth. Every number here is labelled
 * `sample: true`, `mode: 'fixture'`, and the studio shows the Sample banner on top of it. The
 * authoritative price remains Odoo's, and `rates.ts` already says the local card will drift the
 * moment Phillip changes a rate.
 *
 * The rules implemented (all four are quoted in `rates.ts`, sourced from the field guide and the
 * captured compute responses):
 *   * room rate is PER NIGHT PER ROOM, keyed by that night's occupancy, then divided across the
 *     roommates — so the guest's room line is "nightly rate ÷ that night's roommates, summed";
 *   * dives are charged per diver per day at the tier for the number of divers out that day;
 *   * meals are per person per day and are NEVER guest-type discounted;
 *   * no partner discount: a partner rate comes from the partner's own Odoo key, not from the trip.
 */
import { randomUUID } from "node:crypto";
import type { BffGuest, BffTrip } from "../../../contracts/src/index.js";
import {
  datesBetweenInclusive,
  validateBffTripPrecheck,
} from "../../../quotation/src/index.js";
import { DEFAULT_ROOM_CAPS, type RoomCaps } from "../../../ai/src/index.js";
import {
  COURSE_RATES,
  diveTierPrice,
  MEAL_RATE,
  roomNightlyRate,
  TRANSPORT_RATE,
  vanLoads,
  vansForGuests,
  type RoomType,
} from "../../../quotation/src/index.js";
import { describeRefusal, refusalIssues } from "./refusalCopy.js";
import type {
  CommitResult,
  EstimateSendResult,
  EstimatorHealth,
  EstimatorPort,
  EstimatorSession,
  GuestLinkCheck,
  ShareResult,
  SubmitInput,
  SubmitResult,
} from "./estimatorPort.js";

/** Two decimals, because the captured card itself carries a 16400.01 deluxe band. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export type SimulatedRole = "guest" | "agent" | "instructor";

/** One priced row, exactly as the customer's `quotes[].lines[]` carries it. */
export interface SimLine {
  cat: "room" | "meals" | "dive" | "course" | "transport";
  label: string;
  sub: string;
  gross: number;
  discs: Array<{ label: string; amount: number }>;
  net: number;
}

export interface SimQuote {
  g: BffGuest;
  isFoc: boolean;
  lines: SimLine[];
  gross: number;
  total: number;
  discountTotal: number;
}

export interface SimWarning {
  level: "warn" | "error";
  text: string;
}

export interface SimFocusSummary {
  ok: boolean;
  per: number;
  bracket: number;
  entitled: number;
  marked: number;
  stay: { heads: number; entitled: number; marked: number };
  dive: { heads: number; entitled: number; marked: number };
}

/**
 * The customer's `model`. Field-for-field what `compute.retail-couple.json` returns, with the
 * nullable cost/margin half left null exactly as their fixture leaves it (we have no cost data in
 * any mode — `B-003` on their side, "cost only with a real staff key").
 */
export interface SimModel {
  N: number;
  stayDates: string[];
  diveDates: string[];
  quotes: SimQuote[];
  catRev: Record<string, number>;
  catGross: Record<string, number>;
  catCost: null;
  costs: null;
  cost: null;
  extras: null;
  nonDivers: number;
  diverCount: number;
  dayPlans: Array<{ date: string; divers: BffGuest[] }>;
  vans: number;
  vanRuns: Array<{ date: string; dir: "arrival" | "departure"; vans: Array<{ pax: number }> }> | null;
  kpis: {
    revenue: number;
    cost: null;
    profit: null;
    margin: null;
    rpgn: number;
    discounts: number;
    guests: number;
    nights: number;
  };
  /**
   * Emitted as an array. Their captured fixture carries a single object when there is one warning
   * (`"warnings":{"level":"warn","text":…}`); an array is the correct general shape, so readers
   * on our side accept both and this side emits the honest one. See `readWarnings` in
   * `quotationStore.ts`.
   */
  warnings: SimWarning[];
  gwin: Record<string, { a: string; dep: string; n: number; dates: string[] }>;
  presence: Record<string, BffGuest[]>;
  covers: Record<string, number>;
  maxCovers: number;
  gn: number;
  roomNightsUsed: Record<string, number>;
  roomPeak: Record<string, number>;
  foc: SimFocusSummary;
  roomNames: Record<string, string[]>;
  roomAvailability: Record<string, string[]>;
}

export interface SimEnvelope {
  ok: true;
  role: SimulatedRole;
  model: SimModel;
  /** The same trip priced as a retail guest, for the Agent View comparison. Null for retail. */
  retail_model: SimModel | null;
  assumptions: null;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** The room names their `rooms.json` allocates, by type: 16 standard, 4 deluxe, 4 suite. */
export function roomNamesFor(type: RoomType): string[] {
  const label = type === "standard" ? "Standard" : type === "deluxe" ? "Deluxe" : "Suite";
  const count = type === "standard" ? 16 : 4;
  return Array.from({ length: count }, (_, i) => `${label} ${LETTERS[i]}`);
}

const ALL_ROOM_NAMES: Record<string, string[]> = {
  standard: roomNamesFor("standard"),
  deluxe: roomNamesFor("deluxe"),
  suite: roomNamesFor("suite"),
};

const COURSE_LABELS: Record<string, string> = {
  dsd: "Discover Scuba Diving",
  refresher: "Scuba Refresher",
  ow: "Open Water course",
  aow: "Advanced Open Water course",
  rescue: "Rescue Diver course",
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sat, Nov 21" — the way their captured card writes a day. */
export function formatCardDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${SHORT_DAYS[d.getUTCDay()]}, ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Rooms one per guest, round-robin — the same assignment `buildBffTrip` sends. */
function occupancyByRoom(trip: BffTrip): Map<string, number> {
  const counts = new Map<string, number>();
  for (const guest of trip.guests) {
    if (guest.roomId) counts.set(guest.roomId, (counts.get(guest.roomId) ?? 0) + 1);
  }
  return counts;
}

/** The display name of a room: its own name, else its slot within its type's allocation. */
function displayRoomName(trip: BffTrip, roomId: string | null): string {
  const idx = trip.rooms.findIndex((r) => r.id === roomId);
  if (idx < 0) return "Room";
  const room = trip.rooms[idx]!;
  if (room.name) return room.name;
  const siblings = trip.rooms.filter((r) => r.type === room.type);
  const slot = Math.max(0, siblings.findIndex((r) => r.id === room.id));
  return ALL_ROOM_NAMES[room.type]?.[slot] ?? `${room.type} ${slot + 1}`;
}

/**
 * The role a price is computed for. Always `guest`, whatever the trip says.
 *
 * Their engine takes the role from the *session* — the Odoo key behind the login — and never from the
 * payload: `deriveGuestType(sessionRole, trip.guestType)` overrides what the trip claims. Our bot only
 * ever holds a guest session (`ubg_sid`), so an enquiry that says "travel agency" is still priced at
 * retail; a partner rate exists only for a partner who signs in on their own system. A simulation that
 * read the role off the trip would hand out a discount the real engine cannot.
 */
function roleOf(_trip: BffTrip): SimulatedRole {
  return "guest";
}

/**
 * Price a validated `BffTrip` into the customer's model.
 *
 * `asRole` is split out because the Agent View needs the *same trip* priced twice — once on the
 * agent card and once as a retail guest — and the two answers must come from one function or they
 * drift.
 */
export function buildSimulatedModel(trip: BffTrip, asRole?: SimulatedRole): SimModel {
  const role = asRole ?? roleOf(trip);
  const checkIn = trip.checkIn ?? "";
  const checkOut = trip.checkOut ?? "";
  const stayDates = checkIn && checkOut ? datesBetweenInclusive(checkIn, checkOut).slice(0, -1) : [];
  const nights = stayDates.length;

  const guests = trip.guests;
  const occupancies = occupancyByRoom(trip);

  // Dive days are read off the guests' own day plans, not off a window: the window is what the
  // contract sends, the per-guest `days` map is what it means for each person.
  const diveDates = Array.from(
    new Set(guests.flatMap((g) => Object.entries(g.days ?? {}).filter(([, v]) => v.dive).map(([d]) => d))),
  ).sort();
  const diversOn = (date: string) => guests.filter((g) => g.days?.[date]?.dive).length;

  const transportRequested = trip.transportType !== "none";
  const transportGuests = guests.filter((g) => g.transport).length || guests.length;
  const vanPrice =
    trip.transportType === "oneway" ? TRANSPORT_RATE.oneway : TRANSPORT_RATE.roundtrip;
  // More than one van once the group is bigger than a van carries: the engine's own captured runs
  // split 7 guests into a van of 6 and a van of 1, so a single van for any group was the one thing
  // this simulation could not be trusted to price. See `vansForGuests`.
  const vanCount = transportRequested ? vansForGuests(transportGuests) : 0;

  const quotes: SimQuote[] = guests.map((guest) => {
    const lines: SimLine[] = [];
    const push = (line: Omit<SimLine, "discs" | "net">) => {
      lines.push({ ...line, gross: r2(line.gross), discs: [], net: r2(line.gross) });
    };

    // 1. Room — nightly rate for that room's occupancy ÷ its roommates, summed over the stay.
    if (guest.roomId && stayDates.length > 0) {
      const occupancy = occupancies.get(guest.roomId) ?? 1;
      const nightly = roomNightlyRate(
        (trip.rooms.find((r) => r.id === guest.roomId)?.type ?? "standard") as RoomType,
        occupancy,
      );
      const gross = r2((nightly / occupancy) * stayDates.length);
      push({
        cat: "room",
        label: `${displayRoomName(trip, guest.roomId)} — ${nights} night${nights === 1 ? "" : "s"}`,
        sub: "nightly rate ÷ that night’s roommates, summed over your stay",
        gross,
      });
    }

    // 2. Meals — per person per day, never discounted.
    if (guest.meals && stayDates.length > 0) {
      push({
        cat: "meals",
        label: `Full board — ${nights} day${nights === 1 ? "" : "s"}`,
        sub: `₱${MEAL_RATE.toLocaleString("en-US")} per person/day · never guest-type discounted`,
        gross: stayDates.length * MEAL_RATE,
      });
    }

    // 3. Diving — one line per dive day this guest dives, at that day's divers-out tier.
    for (const date of diveDates) {
      if (!guest.days?.[date]?.dive) continue;
      const out = diversOn(date);
      const rate = diveTierPrice(out);
      push({
        cat: "dive",
        label: `Boat dives — ${formatCardDay(date)}`,
        sub: `2-dive boat trip · ${out} diver${out === 1 ? "" : "s"} out`,
        gross: rate,
      });
    }

    // 4. Courses — a flat course price per guest who is taking one.
    for (const code of guest.courses ?? []) {
      const price = (COURSE_RATES as Record<string, number>)[code];
      if (typeof price !== "number") continue;
      push({
        cat: "course",
        label: COURSE_LABELS[code] ?? code,
        sub: "per diver · course fee",
        gross: price,
      });
    }

    // 5. Transport — the vans this group needs, split across the guests riding them.
    if (transportRequested && guest.transport) {
      push({
        cat: "transport",
        label:
          trip.transportType === "oneway"
            ? `Private van — one way${vanCount > 1 ? ` (${vanCount} vans)` : ""}`
            : `Private van — round trip${vanCount > 1 ? ` (${vanCount} vans)` : ""}`,
        sub: `per van, split across ${transportGuests} guest${transportGuests === 1 ? "" : "s"}`,
        gross: (vanPrice * vanCount) / transportGuests,
      });
    }

    const gross = r2(lines.reduce((sum, l) => sum + l.gross, 0));
    const discountTotal = r2(lines.reduce((sum, l) => sum + l.discs.reduce((d, x) => d + x.amount, 0), 0));
    const total = r2(lines.reduce((sum, l) => sum + l.net, 0));

    return { g: guest, isFoc: Boolean(guest.foc), lines, gross, total, discountTotal };
  });

  const emptyCats = { room: 0, meals: 0, dive: 0, course: 0, transport: 0, gear: 0, extras: 0 };
  const catRev: Record<string, number> = { ...emptyCats };
  const catGross: Record<string, number> = { ...emptyCats };
  for (const quote of quotes) {
    for (const line of quote.lines) {
      catRev[line.cat] = r2((catRev[line.cat] ?? 0) + line.net);
      catGross[line.cat] = r2((catGross[line.cat] ?? 0) + line.gross);
    }
  }

  const presence: Record<string, BffGuest[]> = {};
  const covers: Record<string, number> = {};
  for (const date of stayDates) {
    presence[date] = guests;
    covers[date] = guests.filter((g) => g.meals).length;
  }

  const revenue = r2(quotes.reduce((sum, q) => sum + q.total, 0));
  const discounts = r2(quotes.reduce((sum, q) => sum + q.discountTotal, 0));
  const guestCount = guests.length;
  const diverCount = guests.filter((g) => g.diver).length;
  const nonDivers = guestCount - diverCount;

  const stayEntitled = Math.floor(guestCount / 6);
  const diveEntitled = Math.floor(diverCount / 6);
  const foc: SimFocusSummary = {
    ok: stayEntitled + diveEntitled > 0,
    per: 5,
    bracket: 6,
    entitled: stayEntitled + diveEntitled,
    marked: 0,
    stay: { heads: guestCount, entitled: stayEntitled, marked: 0 },
    dive: { heads: diverCount, entitled: diveEntitled, marked: 0 },
  };

  // One warning per dive day with no boat chosen — their card's own sentence, verbatim.
  const warnings: SimWarning[] = [];
  for (const date of diveDates) {
    const first = guests.find((g) => g.days?.[date]?.dive && !g.days[date]?.boatId);
    if (first) {
      warnings.push({ level: "warn", text: `${formatCardDay(date)}: no boat picked yet for ${first.name}.` });
    }
  }

  const roomNightsUsed: Record<string, number> = {};
  const roomPeak: Record<string, number> = {};
  for (const room of trip.rooms) {
    if (!room.id) continue;
    const occupancy = occupancies.get(room.id) ?? 0;
    if (occupancy <= 0) continue;
    roomNightsUsed[room.id] = nights;
    roomPeak[room.id] = occupancy;
  }

  const gwin: SimModel["gwin"] = {};
  for (const guest of guests) {
    const key = guest.id ?? `g${Object.keys(gwin).length + 1}`;
    gwin[key] = { a: checkIn, dep: checkOut, n: nights, dates: stayDates };
  }

  const dayPlans = diveDates.map((date) => ({
    date,
    divers: guests.filter((g) => g.days?.[date]?.dive),
  }));

  return {
    N: nights,
    stayDates,
    diveDates,
    quotes,
    catRev,
    catGross,
    catCost: null,
    costs: null,
    cost: null,
    extras: null,
    nonDivers,
    diverCount,
    dayPlans,
    vans: vanCount,
    vanRuns: transportRequested
      ? [
          { date: checkIn, dir: "arrival", vans: vanLoads(transportGuests) },
          { date: checkOut, dir: "departure", vans: vanLoads(transportGuests) },
        ]
      : null,
    kpis: {
      revenue,
      cost: null,
      profit: null,
      margin: null,
      rpgn: guestCount > 0 && nights > 0 ? revenue / (guestCount * nights) : 0,
      discounts,
      guests: guestCount,
      nights,
    },
    warnings,
    gwin,
    presence,
    covers,
    maxCovers: Math.max(0, ...Object.values(covers)),
    // Guest-nights: heads × nights, which is the number their card shows as `gn`.
    gn: guestCount * nights,
    roomNightsUsed,
    roomPeak,
    foc,
    roomNames: ALL_ROOM_NAMES,
    roomAvailability: ALL_ROOM_NAMES,
  };
}

export function buildSimulatedEnvelope(trip: BffTrip, asRole?: SimulatedRole): SimEnvelope {
  const role = asRole ?? roleOf(trip);
  const model = buildSimulatedModel(trip, role);
  // Only an agent (or staff) session gets the retail comparison — their B-039. A guest has nothing
  // to compare against and an instructor is not shown what a retail guest would have paid, so for
  // both the second model is genuinely absent rather than a copy, as in their own fixture.
  const retailModel = role === "agent" ? buildSimulatedModel(trip, "guest") : null;
  return { ok: true, role, model, retail_model: retailModel, assumptions: null };
}

/**
 * How the simulated booking engine answers. The default reproduces fixture semantics
 * (`{success:true, folio_id:null, order_ids:null}`). The other three exist so the state machine's
 * failure branches are reachable on demand — in a test, or in a demo of what a rejected booking
 * looks like — without a network.
 */
/**
 * Their POST-only room split (`splitRoomsByCapacity`): exactly one room holding more guests than its
 * type allows becomes `ceil(n / cap)` rooms of that type, filled in order. Anything else is returned
 * as it came — a person who arranged several rooms has arranged them.
 */
export function splitRoomsByCapacity(trip: BffTrip, caps: RoomCaps): BffTrip {
  if (trip.rooms.length !== 1) return trip;
  const room = trip.rooms[0]!;
  const cap = caps[room.type];
  if (!room.id || cap === undefined || cap < 1) return trip;
  const n = trip.guests.filter((g) => g.roomId === room.id).length;
  if (n <= cap) return trip;

  const ids = [room.id];
  for (let k = 2; ids.length < Math.ceil(n / cap); k += 1) if (`r${k}` !== room.id) ids.push(`r${k}`);
  let seen = 0;
  return {
    ...trip,
    rooms: ids.map((id, i) => (i === 0 ? { ...room } : { id, type: room.type, name: null })),
    guests: trip.guests.map((g) => {
      if (g.roomId !== room.id) return g;
      const roomId = ids[Math.floor(seen / cap)]!;
      seen += 1;
      return { ...g, roomId };
    }),
  };
}

/** Their 422 body for a trip with blocking issues: `{ error, code, fields, issues }`. */
function refusalOf(trip: BffTrip, stage: "plan" | "edit"): EstimateSendResult | null {
  const found = validateBffTripPrecheck(trip, DEFAULT_ROOM_CAPS).map((i) =>
    // Plan my trip never blocks on capacity — it splits, and a group it cannot split only gets a warning.
    stage === "plan" && i.code === "room-over-capacity" ? { ...i, level: "warn" as const } : i,
  );
  const errors = found.filter((i) => i.level === "error");
  if (errors.length === 0) return null;
  const body = { error: "Chuyến không hợp lệ", code: errors[0]!.code, fields: [...new Set(errors.flatMap((i) => i.fields))], issues: found };
  return {
    ok: false,
    reason: "rejected",
    status: 422,
    detail: describeRefusal(body) ?? body.error,
    fields: body.fields,
    code: body.code,
    issues: refusalIssues(body),
  };
}

export type SimulatedSubmitBehaviour = "confirmed" | "rejected" | "busy" | "unknown";

export interface SimulatedEstimatorOptions {
  submitBehaviour?: SimulatedSubmitBehaviour;
  /** Injected so a test can pin ids and timestamps. */
  now?: () => Date;
}

export function createSimulatedEstimator(options: SimulatedEstimatorOptions = {}): EstimatorPort {
  const now = options.now ?? (() => new Date());
  const behaviour = options.submitBehaviour ?? "confirmed";

  // The one piece of state their fixture keeps in a database: how many times a scenario has been
  // saved, and whether it has been committed at all. Held per port instance, which is the honest
  // scope for a simulation — it exists so the commit → share *sequence* can be exercised, including
  // the `no-snapshot` refusal a share gets for a quotation nobody has saved.
  const committed = new Map<string, number>();
  // The trip each scenario last priced. Their commit freezes what is stored, not what the caller
  // sends, and refuses it if it would not pass validation now.
  const saved = new Map<string, BffTrip>();

  async function sendEstimate(trip: BffTrip | null | undefined, session?: EstimatorSession): Promise<EstimateSendResult> {
    if (!trip) {
      return {
        ok: false,
        reason: "no_validated_trip",
        status: null,
        detail: "no validated BffTrip on this quotation, so there is nothing to price",
        fields: [],
      };
    }
    // A session id means their PATCH: the person arranged the rooms, so nothing is split for them and
    // a room over capacity is refused. Without one it is their POST, which splits and only warns.
    const isEdit = Boolean(session?.id);
    const priced = isEdit ? trip : splitRoomsByCapacity(trip, DEFAULT_ROOM_CAPS);
    const refused = refusalOf(priced, isEdit ? "edit" : "plan");
    if (refused) return refused;
    const warnings = validateBffTripPrecheck(priced, DEFAULT_ROOM_CAPS).filter((i) => i.level === "warn");
    const envelope = buildSimulatedEnvelope(priced, "guest");
    // Re-pricing an existing scenario keeps its id and its session, which is what their BFF does:
    // the draft is the session's, and a second compute is a PATCH of it, not a new enquiry.
    const id = session?.id ?? `sim-${randomUUID()}`;
    saved.set(id, priced);
    return {
      ok: true,
      status: 201,
      id,
      role: envelope.role,
      issues: warnings,
      computedAt: now().toISOString(),
      model: envelope.model,
      // Present for a partner session, null for retail — the same rule their fixture follows.
      retailModel: envelope.retail_model,
      // Their `ubg_sid`, in their format, so the caller records and replays a real-looking cookie.
      sessionCookie: session?.cookie ?? `ubg_sid=${id}`,
      // Both labels, always. A simulated price presented as a live one is the one failure this
      // whole port exists to make impossible.
      sample: true,
      mode: "fixture",
    };
  }

  async function commit(session: EstimatorSession, _trip: BffTrip): Promise<CommitResult> {
    if (!session.id) {
      return { ok: false, reason: "rejected", detail: "no scenario id on this quotation to commit" };
    }
    const stored = saved.get(session.id);
    const refused = stored ? refusalOf(stored, "edit") : null;
    if (refused && !refused.ok) return { ok: false, reason: "rejected", detail: refused.detail };
    const seq = (committed.get(session.id) ?? 0) + 1;
    committed.set(session.id, seq);
    return { ok: true, seq, computedAt: now().toISOString() };
  }

  async function share(session: EstimatorSession): Promise<ShareResult> {
    if (!session.id) {
      return { ok: false, reason: "rejected", detail: "no scenario id on this quotation to share" };
    }
    // Their rule, reproduced because it is the one that stops a link to nothing: a quotation with
    // no saved revision has nothing to point at, and their route answers 409 `no-snapshot`.
    if ((committed.get(session.id) ?? 0) === 0) {
      return { ok: false, reason: "no_snapshot", detail: "save the quotation before sharing it" };
    }
    return { ok: true, url: `/quote/sim-${session.id}`, expiresAt: null };
  }

  async function submit(_input: SubmitInput): Promise<SubmitResult> {
    switch (behaviour) {
      case "rejected":
        return { ok: false, reason: "rejected", detail: "simulated booking engine rejected the reservation" };
      case "busy":
        return { ok: false, reason: "busy", detail: "simulated booking engine is busy" };
      case "unknown":
        return { ok: false, reason: "unknown", detail: "simulated booking engine did not confirm" };
      default:
        // The shape the spec promises for fixture mode: success, and no folio — because no folio
        // was created. `sample: true` is what the Booking page turns into "Folio number pending".
        return { ok: true, sample: true, folioId: null, orderIds: null, mode: "fixture" };
    }
  }

  async function checkHealth(): Promise<EstimatorHealth> {
    return { reachable: true, mode: "fixture" };
  }

  /**
   * There is no guest app behind the simulated engine, so a link it mints cannot be checked — and in
   * practice cannot be opened either: `publish` only builds a URL when a host is configured, and the
   * simulated port has none. Saying so is the honest answer; answering `ok` would let a link nobody
   * can open through the gate the real port has to pass.
   */
  async function verifyGuestLink(_guestUrl: string): Promise<GuestLinkCheck> {
    return {
      ok: false,
      reason: "not_configured",
      detail: "the simulated engine has no guest app, so a link it mints cannot be opened",
    };
  }

  return {
    kind: "simulated",
    sendEstimate,
    // A simulation has no scenario to keep, so an edit is just another compute. Present anyway,
    // because the studio's edit path has to be exercisable in the mode the demo actually runs in —
    // a port method the default mode does not implement is a method nobody has tested.
    updateEstimate: (session: EstimatorSession, trip: BffTrip) => sendEstimate(trip, session),
    commit,
    share,
    verifyGuestLink,
    submit,
    checkHealth,
  };
}
