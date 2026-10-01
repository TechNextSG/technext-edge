import { describe, it, expect } from 'vitest';
import { TripSchema } from '@casa/contracts';
import {
  AiTripSchema,
  buildBffTrip,
  validateBffTripPrecheck,
  maskForLogging,
  converse,
  type ExtractProvider,
} from '../src/index.ts';

function createCompleteSampleTrip(overrides: Partial<Record<string, unknown>> = {}) {
  return AiTripSchema.parse({
    contactName: { value: 'Alex Chen', state: 'stated', evidence: 'Alex Chen' },
    language: { value: 'en', state: 'stated', evidence: 'Hi' },
    guestType: { value: 'retail', state: 'stated', evidence: 'family trip' },
    checkIn: { value: '2026-10-10', state: 'stated', evidence: 'Oct 10' },
    checkOut: { value: '2026-10-14', state: 'stated', evidence: 'Oct 14' },
    nights: { value: 4, state: 'stated', evidence: '4 nights' },
    guests: { value: 5, state: 'stated', evidence: '5 guests' },
    rooms: { value: 2, state: 'stated', evidence: '2 deluxe rooms' },
    roomType: { value: 'deluxe', state: 'stated', evidence: '2 deluxe rooms' },
    meals: { value: 'full_board', state: 'default', evidence: null },
    transport: { value: true, state: 'stated', evidence: 'airport transfer' },
    transportType: { value: 'roundtrip', state: 'stated', evidence: 'roundtrip van' },
    diver: { value: true, state: 'stated', evidence: '4 divers' },
    divers: { value: 4, state: 'stated', evidence: '4 divers and 1 non-diver' },
    diveFrom: { value: '2026-10-11', state: 'stated', evidence: 'dive Oct 11-13' },
    diveTo: { value: '2026-10-13', state: 'stated', evidence: 'dive Oct 11-13' },
    diveNotes: { value: 'Deluxe rooms, 1 night dive on Oct 12, Nitrox', state: 'stated', evidence: 'night dive' },
    specialRequests: { value: null, state: 'missing', evidence: null },
    guestNames: { value: ['Alex Chen', 'Ben Chen', 'Cara Chen', 'Dan Chen', 'Eva Chen'], state: 'stated', evidence: 'names' },
    ...overrides,
  });
}

describe('P5 @casa/ai — BffTrip adapter & @casa/contracts parity', () => {
  it('builds a BffTrip that passes @casa/contracts TripSchema.parse() and satisfies all 6 ★ groups', () => {
    const trip = createCompleteSampleTrip();
    const bffTrip = buildBffTrip(trip);

    // 1. Must parse cleanly against @casa/contracts TripSchema
    const parsedByContract = TripSchema.parse(bffTrip);
    expect(parsedByContract.guestType).toBe('retail');
    expect(parsedByContract.transportType).toBe('roundtrip');
    expect(parsedByContract.checkIn).toBe('2026-10-10');
    expect(parsedByContract.checkOut).toBe('2026-10-14');
    expect(parsedByContract.diveFrom).toBe('2026-10-11');
    expect(parsedByContract.diveTo).toBe('2026-10-13');
    expect(parsedByContract.rooms).toHaveLength(2);
    // The type the guest named, not a default: their rate card prices `standard` at 7,600 a night
    // against `deluxe` at 11,200 for the same two guests, so a payload that flattens every room to
    // `standard` under-quotes the largest line of the stay by 47% and nothing downstream can tell.
    expect(parsedByContract.rooms.map((r) => r.type)).toEqual(['deluxe', 'deluxe']);
    expect(parsedByContract.guests).toHaveLength(5);

    // 2. Non-diver invariant: 4 divers have days populated, 5th guest (non-diver) has diver=false and days={}
    const divers = parsedByContract.guests.filter((g) => g.diver);
    const nonDivers = parsedByContract.guests.filter((g) => !g.diver);
    expect(divers).toHaveLength(4);
    expect(nonDivers).toHaveLength(1);
    expect(nonDivers[0]?.days).toEqual({});
    for (const d of divers) {
      expect(Object.keys(d.days)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13']);
    }

    // 3. Zero validation errors in pre-check
    const issues = validateBffTripPrecheck(bffTrip);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('masks PII (phone & email) via maskForLogging before writing logs or audit rows', () => {
    const raw = 'Hi I am Alex (+63 917 555 1234, alex.chen@example.com), 4 guests Oct 10-14';
    const masked = maskForLogging(raw);
    expect(masked).not.toContain('917 555 1234');
    expect(masked).not.toContain('alex.chen@example.com');
    expect(masked).toContain('[email]');
    expect(masked).toContain('[phone]');
  });

  it('converse() returns done=true and populated bffTrip when all required fields are present', async () => {
    const msg =
      'Hi, Alex Chen here (family trip). 5 guests (4 divers and 1 non-diver), 2 deluxe rooms, Oct 10 to Oct 14 2026 (4 nights), dive Oct 11-13 (night dive, Nitrox), airport transfer by roundtrip van.';
    const sampleTrip = createCompleteSampleTrip({
      guestNames: { value: ['Alex Chen'], state: 'stated', evidence: 'Alex Chen' },
    });
    const mockProvider: ExtractProvider = {
      id: 'fixture-ai',
      async call() {
        return {
          raw: sampleTrip,
          tokensIn: 120,
          tokensOut: 80,
          cacheReadTokens: 0,
          ms: 15,
        };
      },
    };

    const outcome = await converse([{ role: 'guest', text: msg }], mockProvider);

    expect(outcome.done).toBe(true);
    expect(outcome.bffTrip).not.toBeNull();
    expect(outcome.bffValidationIssues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(outcome.handoff.bffEstimateRequest).toBeDefined();
  });
});
