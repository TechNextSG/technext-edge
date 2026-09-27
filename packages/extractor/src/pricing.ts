/**
 * Reading the pricing engine's answer into something a page can draw.
 *
 * Two shapes arrive here and both are the customer's, not ours:
 *
 *   * the **simulated** engine (`simulatedEstimator.ts`), which reproduces
 *     `contracts/odoo/examples/compute.*.json`;
 *   * the **remote** one, which is their BFF relaying Odoo.
 *
 * The shapes are supposed to be identical, and they are not quite — their captured fixture carries
 * `"warnings": {…}` for a single warning where an array is the general form, their `catRev` keys
 * are open-ended, and a response can legitimately arrive with no `quotes` at all. Every read below
 * is therefore defensive on purpose: the swap to the real engine must not be the moment a page
 * starts throwing on a field it assumed.
 *
 * What this is NOT: a second pricing model. It re-adds nothing and rounds nothing. If a number is
 * absent it stays absent, and the page shows a gap rather than a zero — a zero on a quotation reads
 * as "free", which is the most expensive possible way to be wrong.
 */

/** One priced row, as the customer's `quotes[].lines[]` carries it. */
export interface PricedLine {
  cat: string;
  label: string;
  sub: string;
  gross: number;
  net: number;
}

/** One guest's share of a quotation — the "Ana ₱20,600" card. */
export interface PricedGuest {
  name: string;
  total: number;
  discountTotal: number;
  lines: PricedLine[];
}

/** The operational half, for the Ops Sheet: no money anywhere in it. */
export interface PricedOps {
  stayDates: string[];
  /** Per night, who is in house and in which room. */
  presence: Record<string, Array<{ name: string; room: string; meals: boolean; diver: boolean }>>;
  /** Per night, the meal count the kitchen cooks. */
  covers: Record<string, number>;
  /** Per dive day, who is on the boat. */
  dayPlans: Array<{ date: string; divers: string[] }>;
  /** Van runs, when a transfer was booked. */
  transfers: Array<{ date: string; dir: string; pax: number }>;
}

export interface PricedKpis {
  revenue: number | null;
  guests: number | null;
  nights: number | null;
  discounts: number | null;
  rpgn: number | null;
}

export interface QuotationPricing {
  /** Which engine answered. Shown to staff, because "sample" depends on it. */
  source: "simulated" | "remote";
  sample: boolean;
  mode: string | null;
  role: string | null;
  computedAt: string | null;
  guests: PricedGuest[];
  catRev: Record<string, number>;
  kpis: PricedKpis;
  warnings: string[];
  /** The same trip priced as a retail guest, when the engine returns one. Agent View reads it. */
  retail: { guests: PricedGuest[]; kpis: PricedKpis } | null;
  ops: PricedOps | null;
}

const CATEGORY_KEYS = ["room", "meals", "dive", "course", "transport", "gear", "extras"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number, or null. `null` and `undefined` both mean "not stated", never zero. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Their `warnings` is an object for one warning and an array for several; both are real responses.
 * A string is accepted too because a hand-built payload is a reasonable thing for a fixture to be.
 */
export function readWarnings(value: unknown): string[] {
  const fromOne = (entry: unknown): string | null => {
    if (typeof entry === "string") return str(entry);
    if (isRecord(entry)) return str(entry.text) ?? str(entry.message);
    return null;
  };
  if (Array.isArray(value)) return value.map(fromOne).filter((text): text is string => text !== null);
  const one = fromOne(value);
  return one ? [one] : [];
}

function readLines(value: unknown): PricedLine[] {
  if (!Array.isArray(value)) return [];
  const lines: PricedLine[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const label = str(entry.label);
    if (!label) continue;
    lines.push({
      cat: str(entry.cat) ?? "other",
      label,
      sub: str(entry.sub) ?? "",
      gross: num(entry.gross) ?? 0,
      net: num(entry.net) ?? num(entry.gross) ?? 0,
    });
  }
  return lines;
}

function readGuests(value: unknown): PricedGuest[] {
  if (!Array.isArray(value)) return [];
  const guests: PricedGuest[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const g = isRecord(entry.g) ? entry.g : {};
    const name = str(g.name) ?? "Guest";
    const lines = readLines(entry.lines);
    guests.push({
      name,
      total: num(entry.total) ?? num(entry.net) ?? lines.reduce((sum, l) => sum + l.net, 0),
      discountTotal: num(entry.discountTotal) ?? 0,
      lines,
    });
  }
  return guests;
}

function readKpis(value: unknown): PricedKpis {
  const k = isRecord(value) ? value : {};
  return {
    revenue: num(k.revenue),
    guests: num(k.guests),
    nights: num(k.nights),
    discounts: num(k.discounts),
    rpgn: num(k.rpgn),
  };
}

function readCatRev(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const source = isRecord(value) ? value : {};
  for (const key of CATEGORY_KEYS) out[key] = num(source[key]) ?? 0;
  return out;
}

/**
 * The Ops Sheet's half. `presence` and `covers` are keyed by date and `dayPlans` is an array —
 * their fixture is explicit about that asymmetry, so it is preserved rather than tidied.
 */
function readOps(model: Record<string, unknown>): PricedOps | null {
  const stayDates = Array.isArray(model.stayDates) ? model.stayDates.map(String) : [];
  const presenceRaw = isRecord(model.presence) ? model.presence : {};
  const coversRaw = isRecord(model.covers) ? model.covers : {};
  const hasOps = stayDates.length > 0 || Object.keys(presenceRaw).length > 0 || Array.isArray(model.dayPlans);
  if (!hasOps) return null;

  const presence: PricedOps["presence"] = {};
  for (const [date, entries] of Object.entries(presenceRaw)) {
    if (!Array.isArray(entries)) continue;
    presence[date] = entries.filter(isRecord).map((g) => ({
      name: str(g.name) ?? "Guest",
      room: str(g.roomId) ?? "",
      meals: g.meals === true,
      diver: g.diver === true,
    }));
  }

  const covers: Record<string, number> = {};
  for (const [date, count] of Object.entries(coversRaw)) {
    const n = num(count);
    if (n !== null) covers[date] = n;
  }

  const dayPlans = (Array.isArray(model.dayPlans) ? model.dayPlans : [])
    .filter(isRecord)
    .map((plan) => ({
      date: str(plan.date) ?? "",
      divers: (Array.isArray(plan.divers) ? plan.divers : [])
        .filter(isRecord)
        .map((g) => str(g.name) ?? "Guest"),
    }))
    .filter((plan) => plan.date !== "");

  const transfers = (Array.isArray(model.vanRuns) ? model.vanRuns : [])
    .filter(isRecord)
    .flatMap((run) => {
      const date = str(run.date) ?? "";
      const dir = str(run.dir) ?? "";
      const vans = Array.isArray(run.vans) ? run.vans.filter(isRecord) : [];
      return vans.map((van) => ({ date, dir, pax: num(van.pax) ?? 0 }));
    });

  return { stayDates, presence, covers, dayPlans, transfers };
}

export interface NormalizePricingInput {
  model: unknown;
  /** The retail-priced model, when the engine returns one. `retail_model` in their response. */
  retailModel?: unknown;
  source: "simulated" | "remote";
  sample: boolean;
  mode?: string | null;
  role?: string | null;
  computedAt?: string | null;
}

export function normalizePricing(input: NormalizePricingInput): QuotationPricing {
  const model = isRecord(input.model) ? input.model : {};
  const retailModel = isRecord(input.retailModel) ? input.retailModel : null;

  return {
    source: input.source,
    sample: input.sample,
    mode: input.mode ?? null,
    role: input.role ?? null,
    computedAt: input.computedAt ?? null,
    guests: readGuests(model.quotes),
    catRev: readCatRev(model.catRev),
    kpis: readKpis(model.kpis),
    warnings: readWarnings(model.warnings),
    retail: retailModel ? { guests: readGuests(retailModel.quotes), kpis: readKpis(retailModel.kpis) } : null,
    ops: readOps(model),
  };
}
