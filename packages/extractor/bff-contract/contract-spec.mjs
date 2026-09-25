/**
 * Transcription of the authoritative BFF quotation contract, as data.
 *
 * Source of truth is the private repo `TechNextSG/tn-casa-quotation-estimator` at
 * commit 4c489188d9388fcd26c7fb3713b5dbeb31146966 — see PROVENANCE.md next to this
 * file for paths, hashes and the reasoning behind transcribing instead of importing.
 *
 * Why this file exists at all: `packages/extractor/src/schema.ts` hand-writes the same
 * contract (`BffTrip`, `BffGuest`, …) because the upstream package is not published and
 * carries a zod v4 dependency this repo cannot take. A hand-written copy of someone
 * else's schema is exactly the kind of thing that rots silently. `contract-parity.test.ts`
 * compares the two, so a drift shows up as a failing test rather than as a 422 in
 * production. Nothing here is logic — it is the contract written down twice, on purpose.
 *
 * Every entry below is a field of the upstream object, with:
 *   - `type`: the upstream zod type, in source order and source spelling
 *   - `req`:  true when the field has no `.default()` upstream, i.e. the key must be present
 *   - `def`:  the literal upstream `.default(v)`, or null when there is none
 *
 * `req`/`def` are transcribed from the upstream source and then re-checked by
 * `contract-parity.test.ts`, which parses `{}` through this repo's hand-written schema and
 * asserts the filled values equal `def`. So a wrong `def` here fails a test rather than
 * quietly asserting the wrong thing.
 */

export const UPSTREAM = Object.freeze({
  repo: "TechNextSG/tn-casa-quotation-estimator",
  commit: "4c489188d9388fcd26c7fb3713b5dbeb31146966",
  // Path -> sha256 of the file at that commit. `contract-parity.test.ts` asserts these
  // against the recorded provenance, so bumping the commit cannot be half-done.
  files: Object.freeze({
    "contracts/src/trip.zod.ts": "3d93bf47637fe494",
    "contracts/src/odoo/types.ts": "954e9e9f5d416b1e",
  }),
});

/** Contracts that are enums rather than objects. */
export const ENUMS = Object.freeze({
  GuestType: ["retail", "agent", "instructor"],
  TransportType: ["none", "roundtrip", "oneway"],
  RoomType: ["standard", "deluxe", "suite"],
  CourseType: ["dsd", "refresher", "ow", "aow", "rescue"],
  VanSplit: ["equal", "vehicle"],
});

export const DayPlanEntry = Object.freeze({
  dive: { type: "boolean", req: false, def: false },
  third: { type: "boolean", req: false, def: false },
  night: { type: "boolean", req: false, def: false },
  boatId: { type: "string|null", req: false, def: null },
});

export const Room = Object.freeze({
  id: { type: "string|null", req: false, def: null },
  type: { type: "RoomType", req: false, def: "standard" },
  name: { type: "string|null", req: false, def: null },
});

export const Guest = Object.freeze({
  id: { type: "string|null", req: false, def: null },
  name: { type: "string", req: false, def: "Guest" },
  // The one default that costs money: absent `diver` is read upstream as `true`.
  diver: { type: "boolean", req: false, def: true },
  meals: { type: "boolean", req: false, def: true },
  transport: { type: "boolean", req: false, def: true },
  foc: { type: "boolean", req: false, def: false },
  roomId: { type: "string|null", req: false, def: null },
  courses: { type: "CourseType[]", req: false, def: [] },
  days: { type: "Record<string,DayPlanEntry>", req: false, def: {} },
  arrive: { type: "string|null", req: false, def: null },
  depart: { type: "string|null", req: false, def: null },
  comment: { type: "string|null", req: false, def: null },
  vanA: { type: "string|null", req: false, def: null },
  vanD: { type: "string|null", req: false, def: null },
});

export const CustomItem = Object.freeze({
  id: { type: "string|null", req: false, def: null },
  name: { type: "string|null", req: false, def: null },
  price: { type: "number", req: false, def: 0 },
  qty: { type: "number", req: false, def: 1 },
  mode: { type: "string|null", req: false, def: null },
  date: { type: "string|null", req: false, def: null },
  dateTo: { type: "string|null", req: false, def: null },
  gids: { type: "string[]", req: false, def: [] },
});

export const VanMeta = Object.freeze({
  date: { type: "string|null", req: false, def: null },
  time: { type: "string|null", req: false, def: null },
  price: { type: "number|null", req: false, def: null },
  foc: { type: "boolean", req: false, def: false },
});

/**
 * The upstream `TripSchema`. Note what is NOT here: no `nights`, no `contactName`,
 * no `language`, no flat `guests: number` / `rooms: number`, no `divers`, no
 * `transport: boolean`. Those live only in this repo's extraction shape, which is why
 * `buildBffTrip()` has to exist as a translation rather than an identity.
 */
export const Trip = Object.freeze({
  label: { type: "string|null", req: false, def: null },
  guestType: { type: "GuestType", req: false, def: "retail" },
  transportType: { type: "TransportType", req: false, def: "none" },
  checkIn: { type: "string|null", req: false, def: null },
  checkOut: { type: "string|null", req: false, def: null },
  diveFrom: { type: "string|null", req: false, def: null },
  diveTo: { type: "string|null", req: false, def: null },
  bookedDaysAhead: { type: "number", req: false, def: 0 },
  rooms: { type: "Room[]", req: false, def: [] },
  guests: { type: "Guest[]", req: false, def: [] },
  items: { type: "CustomItem[]", req: false, def: [] },
  vanSplit: { type: "VanSplit|null", req: false, def: null },
  vanMeta: { type: "Record<string,VanMeta>", req: false, def: {} },
  extraDMByDay: { type: "Record<string,string>", req: false, def: {} },
  dmByDay: { type: "Record<string,string>", req: false, def: {} },
});

/** Array/string bounds from upstream, kept so the parity test can check them too. */
export const BOUNDS = Object.freeze({
  str120: 120,
  guestName: 120,
  guestComment: 500,
  roomsMax: 30,
  guestsMax: 40,
  itemsMax: 50,
  coursesMax: 5,
});

/**
 * The 6 mandatory groups `bff/src/trip/fill.ts` rejects with 422. They are NOT expressed
 * as `req: true` above, because upstream enforces them in `fillTrip`, after zod parsing
 * has already filled every default. Any producer that only satisfies the zod schema can
 * still be rejected — so the extractor checks these itself in `validateBffTripPrecheck`.
 */
export const MANDATORY_GROUPS = Object.freeze([
  "guestType",
  "transportType",
  "checkIn+checkOut",
  "diveFrom+diveTo once any guest dives",
  "guests[i].roomId referencing rooms[].id",
  "guests[i].days non-empty within dive window once that guest dives",
]);

/**
 * Where this repo's transcription is deliberately STRICTER than upstream, i.e. fields
 * upstream fills with a `.default()` that `packages/extractor/src/schema.ts` requires.
 *
 * This list is asserted exactly by `contract-parity.test.ts`: the set of required fields
 * here must equal the set of fields upstream defaults minus this table. Adding a strict
 * field, or upstream adding a default, fails the test until one side is reconciled.
 *
 * Why stricter is correct here: every one of these values is guest-facing and
 * money-affecting, and upstream's `.default()` is *indistinguishable from a real answer*
 * after parsing. A payload that arrives with the key missing gets priced as
 * `retail`/`none`. The extractor only reaches `buildBffTrip()` after its own question
 * gate (`isReadyForHandoff`) has no open rules left, so a missing key at this point is a
 * bug the schema should catch, not a gap a default should quietly fill.
 */
export const STRICTNESS_GAPS = Object.freeze({
  Trip: Object.freeze({
    guestType:
      "upstream defaults 'retail'; a defaulted value here would silently drop the 30% " +
      "agency discount for an agent enquiry (and `instructor` likewise).",
    transportType:
      "upstream defaults 'none'; a defaulted value here prices a group that asked for " +
      "the airport van with no transfer at all.",
    checkIn:
      "upstream defaults null; null here reaches validateBffTripPrecheck as 'missing " +
      "mandatory field', which is the point — do not make it parseable upstream-style.",
    checkOut: "as checkIn: a null checkout cannot be priced, so it must not parse.",
    diveFrom:
      "upstream defaults null; null only means 'no divers', a decision made explicitly " +
      "in buildBffTrip() from `diver`/`divers`, never by omission.",
    diveTo: "as diveFrom: null would only ever mean 'no divers', decided in buildBffTrip().",
  }),
  Guest: Object.freeze({
    diver:
      "upstream defaults true — an absent `diver` is priced as a diver. Requiring the " +
      "key forces buildBffTrip() to decide, which is what stops a snorkelling-only " +
      "party from being charged for dive days.",
    roomId:
      "upstream defaults null; an empty room reference is a 422 from `fillTrip`. " +
      "Requiring a non-null string here makes that unrepresentable.",
  }),
});
