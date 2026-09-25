import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  BffTrip,
  BffRoom,
  BffGuest,
  BffDayPlanEntry,
  BffRoomType,
  BffCourseCode,
  BffValidationCode,
  BffSaneIssueCode,
} from "../src/schema.js";
import { buildBffTrip } from "../src/odooHandoff.js";
import * as spec from "../bff-contract/contract-spec.mjs";

/**
 * The extractor's hand-written transcription of the BFF quotation contract
 * (`src/schema.ts`) is checked against the vendored copy of the authoritative upstream
 * schema (`bff-contract/contract-spec.mjs`, provenance in `bff-contract/PROVENANCE.md`).
 *
 * Both sides are transcriptions, which is the point: this test does not prove the
 * contract is *right*, it proves the two copies still agree. When upstream changes, one
 * side moves, this test goes red, and the failure names the exact field to reconcile.
 *
 * One asymmetry is deliberate. Upstream fills twelve money-affecting fields with
 * `.default()`, so a payload with the key missing is priced as `retail`/`none`/a diver.
 * This repo requires those keys instead, and `spec.STRICTNESS_GAPS` is the declared,
 * asserted list of exactly which ones. Being stricter than upstream is the safe direction
 * (we can produce payloads upstream accepts; the reverse is not guaranteed), so the test
 * pins the gap rather than demanding identical nullability.
 */

type FieldSpec = { type: string; req: boolean; def: unknown };
type SpecObject = Record<string, FieldSpec>;

const here = fileURLToPath(new URL(".", import.meta.url));

/** zod 3 objects expose a shape; unwrap to it and fail loudly on anything else. */
function shapeOf(schema: unknown): SpecObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = schema as any;
  const shape = s?.shape ?? s?._def?.shape;
  if (!shape) throw new Error("expected a ZodObject with a .shape");
  return typeof shape === "function" ? shape() : shape;
}

/** Unwrap `.nullable()` / `.default()` / `.array()` wrappers down to the enum options. */
function enumValues(schema: unknown): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = schema as any;
  if (Array.isArray(s?.options)) return [...s.options];
  if (s?.element) return enumValues(s.element); // ZodArray
  if (s?._def?.innerType) return enumValues(s._def.innerType);
  if (s?.unwrap) return enumValues(s.unwrap());
  throw new Error("not an enum schema, or a wrapper this helper does not understand");
}

/** True when the field carries a `.default()`, i.e. upstream fills it when omitted. */
function hasDefault(schema: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = schema as any;
  if (!s) return false;
  if (s._def?.defaultValue !== undefined) return true;
  if (typeof s._def?.defaultValue === "function") return true;
  if (s.isOptional?.() === true && s._def?.innerType) return hasDefault(s._def.innerType);
  return false;
}

/** Fields our (possibly stricter) schema refuses to parse without. */
function requiredHere(schema: unknown): string[] {
  const shape = shapeOf(schema);
  return Object.entries(shape)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter(([, field]) => (field as any).isOptional?.() !== true)
    .map(([name]) => name)
    .sort();
}

/** Fields upstream fills, so a `{}` payload never leaves them unset. */
function defaultedUpstream(upstream: SpecObject): string[] {
  return Object.entries(upstream)
    .filter(([, fieldSpec]) => !fieldSpec.req)
    .map(([name]) => name)
    .sort();
}

/** zod omits keys it has no value for, so a missing key means "no default". */
function defined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * The value a `{}` payload gets upstream. Scalars use the recorded `def`; containers are
 * asserted only for emptiness, since every element-level field has its own contract test.
 */
function expectedUpstreamDefault(field: FieldSpec): unknown {
  if (field.type.endsWith("[]")) return [];
  if (field.type.startsWith("Record<")) return {};
  return field.def;
}

const OBJECTS = [
  ["Trip", () => BffTrip, spec.Trip],
  ["Guest", () => BffGuest, spec.Guest],
  ["Room", () => BffRoom, spec.Room],
  ["DayPlanEntry", () => BffDayPlanEntry, spec.DayPlanEntry],
] as const;

describe("BFF contract parity (vendored @ 4c48918)", () => {
  describe("provenance is pinned and self-consistent", () => {
    it("records one commit, both upstream paths and a hash each", () => {
      expect(spec.UPSTREAM.commit).toBe("4c489188d9388fcd26c7fb3713b5dbeb31146966");
      expect(Object.keys(spec.UPSTREAM.files)).toEqual([
        "contracts/src/trip.zod.ts",
        "contracts/src/odoo/types.ts",
      ]);
      for (const hash of Object.values(spec.UPSTREAM.files)) {
        expect(hash).toMatch(/^[0-9a-f]{16,64}$/);
      }
    });

    it("PROVENANCE.md names the same repo, commit, paths and hashes", () => {
      const md = readFileSync(`${here}../bff-contract/PROVENANCE.md`, "utf8");
      expect(md).toContain(spec.UPSTREAM.repo);
      expect(md).toContain(spec.UPSTREAM.commit);
      for (const [path, hash] of Object.entries(spec.UPSTREAM.files)) {
        expect(md).toContain(path);
        expect(md).toContain(hash);
      }
    });

    it("the vendored field tables have not been edited in place", () => {
      // Pins the transcription itself. Editing a field without re-fetching from upstream
      // (and updating PROVENANCE.md) now fails here instead of diverging quietly.
      const dataOnly = JSON.stringify([
        spec.ENUMS,
        spec.Trip,
        spec.Guest,
        spec.Room,
        spec.DayPlanEntry,
        spec.CustomItem,
        spec.VanMeta,
        spec.BOUNDS,
      ]);
      expect(createHash("sha256").update(dataOnly).digest("hex")).toBe(TRANSCRIPTION_SHA256);
    });
  });

  describe("enums match upstream", () => {
    it("GuestType", () => {
      expect(enumValues(BffTrip.shape.guestType)).toEqual(spec.ENUMS.GuestType);
    });

    it("TransportType", () => {
      expect(enumValues(BffTrip.shape.transportType)).toEqual(spec.ENUMS.TransportType);
    });

    it("RoomType", () => {
      expect(enumValues(BffRoom.shape.type)).toEqual(spec.ENUMS.RoomType);
    });

    it("CourseType", () => {
      expect(enumValues(BffGuest.shape.courses)).toEqual(spec.ENUMS.CourseType);
    });

    it("VanSplit", () => {
      expect(enumValues(BffTrip.shape.vanSplit)).toEqual(spec.ENUMS.VanSplit);
    });

    it("the exported enum schemas agree with the shapes they are used in", () => {
      expect(BffRoomType.options).toEqual(spec.ENUMS.RoomType);
      expect(BffCourseCode.options).toEqual(spec.ENUMS.CourseType);
    });

    // Local-only: this repo's pre-flight mirror of bff/src/trip/validate.ts and
    // bff/src/trip/sanity.ts. Not part of the upstream zod contract, so asserted, not reconciled.
    it("local pre-flight issue codes are present", () => {
      expect(BffValidationCode.options).toContain("missing-mandatory-field");
      expect(BffSaneIssueCode.options).toContain("dive-revenue-zero");
    });
  });

  describe("field sets match upstream exactly", () => {
    it.each(OBJECTS)("%s", (_name, get, upstream) => {
      expect(Object.keys(shapeOf(get())).sort()).toEqual(Object.keys(upstream).sort());
    });

    it("Trip carries none of this repo's extraction-only fields", () => {
      const ours = Object.keys(shapeOf(BffTrip));
      // Each is a real field of the internal extraction `Trip` (src/schema.ts) and would
      // be ignored or rejected by the BFF. `guests`/`rooms` are excluded because they
      // legitimately exist here as arrays where the extraction shape has numbers.
      for (const extractionOnly of [
        "nights",
        "contactName",
        "language",
        "meals",
        "transport",
        "diver",
        "divers",
        "diveNotes",
        "specialRequests",
        "guestNames",
      ]) {
        expect(ours).not.toContain(extractionOnly);
      }
    });

    it("keeps the shapes that force buildBffTrip() to be a translation", () => {
      // The extraction shape has `guests: number`, `rooms: number`, `nights`, and a flat
      // `diver`/`divers` pair. Upstream has none of the four, so this can never be an identity.
      expect(spec.Trip.guests.type).toBe("Guest[]");
      expect(spec.Trip.rooms.type).toBe("Room[]");
      expect(Object.keys(spec.Trip)).not.toContain("nights");
      expect(Object.keys(spec.Guest)).toContain("diver");
    });
  });

  describe("strictness gap is exactly the declared one", () => {
    it.each(OBJECTS)("%s requires upstream-defaulted fields only where declared", (_name, get, upstream) => {
      const declared = Object.keys(
        (spec.STRICTNESS_GAPS as Record<string, Record<string, string>>)[_name] ?? {},
      ).sort();
      // Upstream fills every `req: false` field, so OUR required set should be a subset of
      // those, and the difference is precisely the declared gap.
      const defaulted = defaultedUpstream(upstream);
      for (const field of declared) {
        expect(defaulted).toContain(field);
      }
      const undeclared = requiredHere(get()).filter((f) => !declared.includes(f));
      expect(undeclared).toEqual([]);
    });

    it("every declared gap names a reason", () => {
      for (const [obj, fields] of Object.entries(spec.STRICTNESS_GAPS)) {
        for (const [field, reason] of Object.entries(fields as Record<string, string>)) {
          expect(reason.length, `${obj}.${field} has no usable reason`).toBeGreaterThan(15);
        }
      }
    });

    it("uses zod defaults only where upstream does, so nothing is looser", () => {
      // The reverse direction: a field we default but upstream does not would be a gap
      // we cannot see by parsing `{}`.
      for (const [name, get, upstream] of OBJECTS) {
        for (const field of Object.keys(shapeOf(get()))) {
          if (hasDefault(shapeOf(get())[field])) {
            expect(
              upstream[field],
              `${name}.${field} has a zod default but upstream has none`,
            ).toBeDefined();
            expect(upstream[field]!.req).toBe(false);
          }
        }
      }
    });
  });

  describe("defaults filled by `{}` upstream are filled identically here", () => {
    it.each(OBJECTS)("%s fills every non-declared field the same way", (_name, get, upstream) => {
      const declared = new Set(
        Object.keys((spec.STRICTNESS_GAPS as Record<string, Record<string, string>>)[_name] ?? {}),
      );
      // `{}` cannot be parsed through our schema when it declares required fields, so
      // probe field by field instead: every field upstream defaults must be optional here
      // (unless declared strict) and must produce the same value.
      for (const [field, fieldSpec] of Object.entries(upstream)) {
        if (fieldSpec.req) continue;
        const schema = shapeOf(get())[field];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const optional = (schema as any)?.isOptional?.() === true;

        if (declared.has(field)) {
          expect(optional, `${field} is declared strict but parses without a value`).toBe(false);
          continue;
        }
        expect(optional, `${field} defaults upstream but is required here`).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((schema as any).parse(undefined)).toEqual(expectedUpstreamDefault(fieldSpec));
      }
    });

    it("the money default `Guest.diver` is true upstream", () => {
      // If this flips upstream, an absent `diver` stops being priced as a diver there and
      // starts being an omission we could send by accident — see PROVENANCE.md.
      expect(spec.Guest.diver.def).toBe(true);
      expect(spec.Guest.diver.req).toBe(false);
    });

    it("we refuse to let `diver` be omitted, unlike upstream", () => {
      // This is the gap that protects the pricing. Asserted separately from the table
      // above because it is the one a reader should not have to go looking for.
      expect(spec.STRICTNESS_GAPS.Guest.diver).toMatch(/defaults true/i);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((BffGuest.shape.diver as any).isOptional()).toBe(false);
      expect(BffGuest.safeParse({ roomId: "r1" }).success).toBe(false);
    });
  });

  describe("bounds match upstream", () => {
    it("Guest.name is capped at the upstream 120", () => {
      expect(spec.BOUNDS.guestName).toBe(120);
      const schema = BffGuest.shape.name;
      expect(schema.safeParse("x".repeat(120)).success).toBe(true);
      expect(schema.safeParse("x".repeat(121)).success).toBe(false);
    });

    it("Guest.comment is capped at the upstream 500 and nullable", () => {
      expect(spec.BOUNDS.guestComment).toBe(500);
      const schema = BffGuest.shape.comment;
      expect(schema.safeParse("x".repeat(500)).success).toBe(true);
      expect(schema.safeParse("x".repeat(501)).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(true);
    });

    it("Trip.rooms and Trip.guests are capped at the upstream 30 and 40", () => {
      expect(spec.BOUNDS.roomsMax).toBe(30);
      expect(spec.BOUNDS.guestsMax).toBe(40);
      const room = { id: "r1", type: "standard" as const, name: null };
      const guest = { id: "g1", diver: false, roomId: "r1" };
      expect(BffTrip.shape.rooms.safeParse(Array.from({ length: 30 }, () => room)).success).toBe(true);
      expect(BffTrip.shape.rooms.safeParse(Array.from({ length: 31 }, () => room)).success).toBe(false);
      expect(BffTrip.shape.guests.safeParse(Array.from({ length: 40 }, () => guest)).success).toBe(true);
      expect(BffTrip.shape.guests.safeParse(Array.from({ length: 41 }, () => guest)).success).toBe(false);
    });

    it("CourseType list is capped at the upstream 5", () => {
      expect(spec.BOUNDS.coursesMax).toBe(5);
      expect(BffGuest.shape.courses.safeParse(["ow", "ow", "ow", "ow", "ow"]).success).toBe(true);
      expect(BffGuest.shape.courses.safeParse(["ow", "ow", "ow", "ow", "ow", "ow"]).success).toBe(false);
    });
  });

  describe("buildBffTrip never emits a payload that leans on an upstream default", () => {
    it("every guest has an explicit boolean diver, a string id and a live roomId", () => {
      const out = buildBffTrip(makeTrip({ guests: 3, rooms: 2, divers: 1 }));

      expect(out.guests).toHaveLength(3);
      const roomIds = new Set(out.rooms.map((r) => r.id));
      for (const g of out.guests) {
        // `diver: undefined` would be read as `true` by Odoo and priced as a diver.
        expect(typeof g.diver).toBe("boolean");
        expect(typeof g.id).toBe("string");
        expect(g.roomId).toBeTruthy();
        expect(roomIds.has(g.roomId!)).toBe(true);
        // `days` is mandatory upstream whenever diver is true.
        if (g.diver) expect(Object.keys(g.days).length).toBeGreaterThan(0);
      }
      expect(out.guests.filter((g) => g.diver)).toHaveLength(1);
    });

    it("names every field this repo declares strict, so the payload is never short", () => {
      // Belt and braces: whatever buildBffTrip() returns must satisfy the strict schema.
      const out = buildBffTrip(makeTrip({ guests: 2, rooms: 1, divers: 2 }));
      for (const field of requiredHere(BffTrip)) {
        expect(out[field as keyof typeof out]).not.toBeUndefined();
      }
      for (const g of out.guests) {
        for (const field of requiredHere(BffGuest)) {
          expect(g[field as keyof typeof g]).not.toBeUndefined();
        }
      }
    });

    it("a group with no divers still gets explicit `diver: false` and `days: {}`", () => {
      const out = buildBffTrip(makeTrip({ guests: 2, rooms: 1, diver: false, divers: null }));
      expect(out.guests.every((g) => g.diver === false)).toBe(true);
      expect(out.guests.every((g) => Object.keys(g.days).length === 0)).toBe(true);
      expect(out.diveFrom).toBeNull();
      expect(out.diveTo).toBeNull();
    });

    it("round-trips through the hand-written schema unchanged once parsed", () => {
      const out = buildBffTrip(makeTrip({ guests: 2, rooms: 1, divers: 2 }));
      // JSON first, because that is how the payload actually travels to the BFF: it drops
      // `undefined` keys, and the point is that the parsed shape survives that trip.
      const first = BffTrip.parse(JSON.parse(JSON.stringify(out)));
      expect(BffTrip.parse(JSON.parse(JSON.stringify(first)))).toEqual(first);
    });

    it("the builder emits every key the BFF contract fills, so raw === parsed", () => {
      // buildBffTrip() emits arrive/depart/comment/vanA/vanD as explicit nulls rather than
      // omitting them. Upstream fills those with null, so including them means the payload
      // that leaves this service is byte-for-byte what upstream would have produced for the
      // same parse — and a reviewer reading the JSON sees every field, not a gap.
      const raw = buildBffTrip(makeTrip({ guests: 1, rooms: 1, divers: 1 }));
      const guest = raw.guests[0]!;
      for (const field of Object.keys(spec.Guest)) {
        expect(Object.keys(guest), `guest is missing ${field}`).toContain(field);
      }
      expect(guest).toMatchObject({
        arrive: null,
        depart: null,
        comment: null,
        vanA: null,
        vanD: null,
      });
      // Nothing is left for the BFF to fill in.
      expect(BffTrip.parse(JSON.parse(JSON.stringify(raw)))).toEqual(raw);
    });
  });
});

/** sha256 of the vendored field tables; recompute when the contract legitimately moves. */
const TRANSCRIPTION_SHA256 = "f78afa81c272e5a6cc98fc3d67ba82696ff7fd88452e2fecd386fcc6749f75b2";

function makeTrip(overrides: {
  guests: number;
  rooms: number;
  divers: number | null;
  diver?: boolean;
}) {
  const f = (value: unknown, state = "stated") => ({ value, state, evidence: null });
  const diver = overrides.diver ?? true;
  return {
    language: f("en", "default"),
    contactName: f("Ana"),
    checkIn: f("2026-11-20"),
    checkOut: f("2026-11-23"),
    nights: f(3),
    guests: f(overrides.guests),
    rooms: f(overrides.rooms),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none"),
    diver: f(diver),
    divers: f(overrides.divers),
    diveFrom: f("2026-11-21"),
    diveTo: f("2026-11-22"),
    diveNotes: f(null, "missing"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
  };
}
