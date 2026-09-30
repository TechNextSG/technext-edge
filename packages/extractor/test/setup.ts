/**
 * "Today" for every test: 2026-09-30, 08:00 in Manila.
 *
 * The fixtures use fixed stay dates (2026-11-20 and so on), and the customer's rule `checkin-in-past` —
 * which this repo now mirrors — turns a stay that has already started into a question or a 422. On the
 * real clock those tests are green today and go red on their own once the calendar passes the fixtures.
 *
 * Done by shifting `Date` once per test file, rather than with vitest's fake timers: the clock keeps
 * running at real speed (a wait-until-deadline loop reads it), timers and promises are untouched, and a
 * test that needs a specific day or fully fake timers (`vi.useFakeTimers()` + `vi.setSystemTime(...)`) does
 * exactly what it did before — it replaces this, and puts it back afterwards.
 */
export const TEST_NOW = new Date("2026-09-30T00:00:00Z");

const RealDate = Date;
const offsetMs = TEST_NOW.getTime() - RealDate.now();

class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offsetMs);
    else super(...(args as [number]));
  }
  static override now(): number {
    return RealDate.now() + offsetMs;
  }
}

globalThis.Date = ShiftedDate as unknown as DateConstructor;
