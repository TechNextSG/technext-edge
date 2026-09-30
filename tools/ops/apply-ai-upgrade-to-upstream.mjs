import fs from 'node:fs';
import path from 'node:path';

const upstreamAi = 'E:/tn-casa-quotation-estimator/ai';

// 1. Update schema.ts to include "room-over-capacity" in BffValidationCode
const schemaFile = path.join(upstreamAi, 'src/schema.ts');
let schemaContent = fs.readFileSync(schemaFile, 'utf8');
if (!schemaContent.includes('"room-over-capacity"')) {
  schemaContent = schemaContent.replace(
    '  "room-empty",\n  "missing-mandatory-field",',
    '  "room-empty",\n  "room-over-capacity",\n  "missing-mandatory-field",'
  );
  fs.writeFileSync(schemaFile, schemaContent, 'utf8');
  console.log(`Updated ${schemaFile} to include room-over-capacity in BffValidationCode`);
}

// 2. Update houseNorms.ts
const houseNormsFile = path.join(upstreamAi, 'src/houseNorms.ts');
const houseNormsCode = `// PLACEHOLDER values — these are guesses standing in for real Casa house norms.
// Confirm the actual defaults with Jett/Eloa before this feeds the eval run;
// wrong guesses here surface as fabricated-looking fields, which the eval's
// zero-tolerance metric will (correctly) flag.
export const HOUSE_NORMS = {
  meals: "full_board",
  transport: false,
  rooms: 1,
  language: "en",
} as const;

export type RoomCaps = Partial<Record<"standard" | "deluxe" | "suite", number>>;

/**
 * How many people one room of each type holds, as the source engine enforces it.
 *
 * The source derives this from \`rates.roomRates[type]\` (\`roomCaps\` in its \`bff/src/trip/validate.ts\`):
 * the largest pax count in the tier keys ("2pax" -> 2, "3-4pax" -> 4). This table is the fallback
 * for when we have not read \`/api/rates\`.
 */
export const DEFAULT_ROOM_CAPS: Readonly<Required<RoomCaps>> = {
  standard: 2,
  deluxe: 4,
  suite: 4,
};

/** Same rule as the source's \`roomCaps\`: largest number in the tier keys of each known room type. */
export function roomCapsFromRates(
  rates: { roomRates?: Record<string, unknown> | null } | null | undefined,
): RoomCaps {
  const caps: RoomCaps = {};
  const table = rates?.roomRates;
  if (typeof table !== "object" || table === null) return caps;
  for (const type of ["standard", "deluxe", "suite"] as const) {
    const tiers = table[type];
    if (typeof tiers !== "object" || tiers === null || Array.isArray(tiers)) continue;
    const counts = Object.keys(tiers).flatMap((key) => (key.match(/\\d+/g) ?? []).map(Number));
    if (counts.length > 0) caps[type] = Math.max(...counts);
  }
  return caps;
}
`;
fs.writeFileSync(houseNormsFile, houseNormsCode, 'utf8');
console.log(`Updated ${houseNormsFile}`);

// 3. Update odooHandoff.ts cleanly
const odooHandoffFile = path.join(upstreamAi, 'src/odooHandoff.ts');
// Restore original odooHandoff from git in upstream first, then patch cleanly
import { execFileSync } from 'node:child_process';
execFileSync('git', ['-C', 'E:/tn-casa-quotation-estimator', 'checkout', 'ai/src/odooHandoff.ts'], { encoding: 'utf8' });

let odooHandoffContent = fs.readFileSync(odooHandoffFile, 'utf8');

// Add imports
odooHandoffContent = odooHandoffContent.replace(
  'import { generateQuestions, getStaffAlerts, diveWindowIsGuessed } from "./questions.ts";',
  'import { generateQuestions, getStaffAlerts, diveWindowIsGuessed } from "./questions.ts";\nimport { DEFAULT_ROOM_CAPS, type RoomCaps } from "./houseNorms.ts";'
);

// Update buildBffTrip signature
odooHandoffContent = odooHandoffContent.replace(
  'export function buildBffTrip(trip: Trip): BffTrip {',
  'export function buildBffTrip(trip: Trip, caps: RoomCaps = DEFAULT_ROOM_CAPS): BffTrip {'
);

// In buildBffTrip: move roomType up and replace roomCount & room assignment
const oldBuildBlock = `  const checkIn = trip.checkIn?.value ?? null;
  const checkOut = trip.checkOut?.value ?? null;
  const nights = trip.nights?.value ?? 1;
  const guestCount = Math.max(1, Math.min(40, trip.guests?.value ?? 1));
  const rawRoomCount = Math.max(1, Math.min(30, trip.rooms?.value ?? 1));
  // Avoid \`room-empty\` warnings by ensuring room count never exceeds guestCount
  const roomCount = Math.min(rawRoomCount, guestCount);

  const hasDiving = Boolean(trip.diver?.value);
  const diverCount = hasDiving
    ? Math.max(1, Math.min(guestCount, trip.divers?.value ?? 1))
    : 0;

  let diveFrom: string | null = null;
  let diveTo: string | null = null;

  if (diverCount > 0 && checkIn && checkOut) {
    const defaultStart = nights >= 2 ? addDaysIso(checkIn, 1) : checkIn;
    const defaultEnd = nights >= 2 ? addDaysIso(checkOut, -1) : checkIn;
    diveFrom = trip.diveFrom?.value ?? defaultStart;
    diveTo = trip.diveTo?.value ?? (defaultEnd >= diveFrom ? defaultEnd : diveFrom);
    // Clamp within [checkIn, checkOut] to prevent \`dive-window-outside-stay\` (schema.md §3)
    if (diveFrom < checkIn) diveFrom = checkIn;
    if (diveTo > checkOut) diveTo = checkOut;
    if (diveTo < diveFrom) diveTo = diveFrom;
  }

  // The type the guest actually named, when they named one. \`standard\` remains the fallback
  // because a room type nobody stated is a gap for staff to fill in the studio, not a reason to
  // refuse the enquiry — but sending \`standard\` over a stated \`deluxe\` was simply the wrong room.
  const roomType = trip.roomType?.value ?? "standard";
  const rooms: BffRoom[] = Array.from({ length: roomCount }, (_, idx) => ({
    id: \`r\${idx + 1}\`,
    type: roomType,
    name: null,
  }));

  const diveDateList =
    diverCount > 0 && diveFrom && diveTo ? datesBetweenInclusive(diveFrom, diveTo) : [];

  const mealsIncluded =
    (trip.meals?.value ?? "full_board") === "full_board" ||
    trip.meals?.value === "half_board";
  const hasTransport = transportType !== "none";
  const courses = detectCourseCodes(
    [trip.diveNotes?.value, trip.specialRequests?.value].filter(Boolean).join(" ")
  );

  const providedNames = trip.guestNames?.value ?? [];
  const guests: BffGuest[] = Array.from({ length: guestCount }, (_, idx) => {
    const isDiver = idx < diverCount;
    const assignedRoom = rooms[idx % rooms.length]!;`;

const newBuildBlock = `  const checkIn = trip.checkIn?.value ?? null;
  const checkOut = trip.checkOut?.value ?? null;
  const nights = trip.nights?.value ?? 1;
  const guestCount = Math.max(1, Math.min(40, trip.guests?.value ?? 1));
  const roomType = (trip.roomType?.value ?? "standard") as "standard" | "deluxe" | "suite";
  const cap = Math.max(1, caps[roomType] ?? DEFAULT_ROOM_CAPS[roomType]);
  const statedRooms = trip.rooms?.state === "stated" && typeof trip.rooms.value === "number";
  const roomCount = statedRooms
    ? Math.max(1, Math.min(30, Math.min(trip.rooms!.value!, guestCount)))
    : Math.max(1, Math.min(30, guestCount, Math.ceil(guestCount / cap)));

  const hasDiving = Boolean(trip.diver?.value);
  const diverCount = hasDiving
    ? Math.max(1, Math.min(guestCount, trip.divers?.value ?? 1))
    : 0;

  let diveFrom: string | null = null;
  let diveTo: string | null = null;

  if (diverCount > 0 && checkIn && checkOut) {
    const defaultStart = nights >= 2 ? addDaysIso(checkIn, 1) : checkIn;
    const defaultEnd = nights >= 2 ? addDaysIso(checkOut, -1) : checkIn;
    diveFrom = trip.diveFrom?.value ?? defaultStart;
    diveTo = trip.diveTo?.value ?? (defaultEnd >= diveFrom ? defaultEnd : diveFrom);
    // Clamp within [checkIn, checkOut] to prevent \`dive-window-outside-stay\` (schema.md §3)
    if (diveFrom < checkIn) diveFrom = checkIn;
    if (diveTo > checkOut) diveTo = checkOut;
    if (diveTo < diveFrom) diveTo = diveFrom;
  }

  const rooms: BffRoom[] = Array.from({ length: roomCount }, (_, idx) => ({
    id: \`r\${idx + 1}\`,
    type: roomType,
    name: null,
  }));

  const diveDateList =
    diverCount > 0 && diveFrom && diveTo ? datesBetweenInclusive(diveFrom, diveTo) : [];

  const mealsIncluded =
    (trip.meals?.value ?? "full_board") === "full_board" ||
    trip.meals?.value === "half_board";
  const hasTransport = transportType !== "none";
  const courses = detectCourseCodes(
    [trip.diveNotes?.value, trip.specialRequests?.value].filter(Boolean).join(" ")
  );

  const providedNames = trip.guestNames?.value ?? [];
  const guests: BffGuest[] = Array.from({ length: guestCount }, (_, idx) => {
    const isDiver = idx < diverCount;
    const roomIdx = Math.min(rooms.length - 1, Math.floor(idx / cap));
    const assignedRoom = rooms[roomIdx]!;`;

if (!odooHandoffContent.includes(oldBuildBlock)) {
  console.error("Could not find oldBuildBlock in odooHandoff.ts");
} else {
  odooHandoffContent = odooHandoffContent.replace(oldBuildBlock, newBuildBlock);
}

// Update validateBffTripPrecheck
odooHandoffContent = odooHandoffContent.replace(
  'export function validateBffTripPrecheck(bffTrip: BffTrip): BffValidationIssue[] {',
  'export function validateBffTripPrecheck(bffTrip: BffTrip, caps: RoomCaps = DEFAULT_ROOM_CAPS): BffValidationIssue[] {'
);

const oldValidateBlock = `  bffTrip.rooms.forEach((r, idx) => {
    if (!r.id || !occupiedRoomIds.has(r.id)) {
      issues.push({
        code: "room-empty",
        fields: [\`rooms[\${idx}]\`],
        level: "warn",
      });
    }
  });`;

const newValidateBlock = `  // Room over-capacity check (against provided caps or fallback defaults)
  const guestsPerRoom = new Map<string, number>();
  bffTrip.guests.forEach((g) => {
    if (g.roomId) {
      guestsPerRoom.set(g.roomId, (guestsPerRoom.get(g.roomId) ?? 0) + 1);
    }
  });
  bffTrip.rooms.forEach((r, idx) => {
    const count = r.id ? guestsPerRoom.get(r.id) ?? 0 : 0;
    const roomType = (r.type ?? "standard") as "standard" | "deluxe" | "suite";
    const maxPax = caps[roomType] ?? DEFAULT_ROOM_CAPS[roomType];
    if (count > maxPax) {
      issues.push({
        code: "room-over-capacity",
        fields: [\`rooms[\${idx}]\`],
        level: "error",
      });
    }
    if (!r.id || !occupiedRoomIds.has(r.id)) {
      issues.push({
        code: "room-empty",
        fields: [\`rooms[\${idx}]\`],
        level: "warn",
      });
    }
  });`;

if (!odooHandoffContent.includes(oldValidateBlock)) {
  console.error("Could not find oldValidateBlock in odooHandoff.ts");
} else {
  odooHandoffContent = odooHandoffContent.replace(oldValidateBlock, newValidateBlock);
}

fs.writeFileSync(odooHandoffFile, odooHandoffContent, 'utf8');
console.log(`Updated ${odooHandoffFile}`);

// 4. Update index.ts to export DEFAULT_ROOM_CAPS, roomCapsFromRates, RoomCaps
const indexFile = path.join(upstreamAi, 'src/index.ts');
let indexContent = fs.readFileSync(indexFile, 'utf8');
if (!indexContent.includes('DEFAULT_ROOM_CAPS')) {
  indexContent = indexContent.replace(
    "export * from './houseNorms.ts';",
    "export * from './houseNorms.ts';\nexport { DEFAULT_ROOM_CAPS, roomCapsFromRates, type RoomCaps } from './houseNorms.ts';"
  );
  fs.writeFileSync(indexFile, indexContent, 'utf8');
  console.log(`Updated ${indexFile}`);
}

console.log('Clean upgrade complete!');
