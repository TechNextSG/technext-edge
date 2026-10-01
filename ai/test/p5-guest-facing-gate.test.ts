/*
 * The guest-facing fact gate, as a function another caller can use.
 *
 * Why this test exists on the customer's side: the gate used to live *inside* `verifySynthesizedReply`,
 * which only answers for a `Trip` — the extractor's own reading. Every other piece of text that reaches
 * a guest therefore passed no gate at all, and that is not hypothetical: the TechNext quotation message
 * told a guest "your customized stay … is all confirmed, with your Standard Room" for a suite booking
 * that nothing had confirmed. Extracting the rule into `verifyGuestFacingText` is what lets both callers
 * share one set of checks instead of drifting into two.
 *
 * The cases below are the four ways guest-facing prose goes wrong, in the order of how badly:
 * money, a booking nobody made, a booking that is not this one, and a room type nobody chose.
 */
import { describe, it, expect } from 'vitest';
import { verifyGuestFacingText, verifySynthesizedReply } from '../src/application/synthesis.ts';
import { AiTripSchema } from '../src/index.ts';

/** The facts a quotation message would have: counts from the draft, types from the rooms on it. */
const suiteBooking = {
  nights: 3,
  rooms: 1,
  guests: 2,
  roomTypes: new Set(['suite']),
  knownDates: new Set(['2026-12-05', '2026-12-08']),
};

describe('verifyGuestFacingText', () => {
  it('refuses a reply that quotes a price', () => {
    const result = verifyGuestFacingText(
      'Your stay comes to PHP 31,200 in total, and the link to pay is on its way to you now.',
      suiteBooking,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unauthorized_price_quote');
  });

  it('refuses a reply that says the booking is already confirmed', () => {
    const result = verifyGuestFacingText(
      'Good news — your booking is confirmed for the suite, and the front desk will greet you.',
      suiteBooking,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('false_booking_confirmation');
  });

  it('refuses a reply that names a room type the guest did not book', () => {
    // The production sentence, almost verbatim.
    const result = verifyGuestFacingText(
      'Your customized stay of 3 nights for 2 guests is all set, with your Standard Room.',
      suiteBooking,
    );
    expect(result.ok).toBe(false);
    // Either rule firing is the gate working; this text trips the confirmation promise first, so the
    // room-type check gets its own case below.
    expect(['false_booking_confirmation', 'mismatched_room_type']).toContain(result.reason);
  });

  it('refuses a room type that contradicts the booking, on its own', () => {
    const result = verifyGuestFacingText(
      'We have noted 3 nights for 2 guests in a deluxe room, and the team will send the details.',
      suiteBooking,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatched_room_type');
  });

  it('refuses a count that contradicts the booking', () => {
    const result = verifyGuestFacingText(
      'Noted: 4 nights for 2 guests in a suite, and the reservations team will be in touch.',
      suiteBooking,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatched_nights_count');
  });

  it('refuses a date the booking does not contain', () => {
    const result = verifyGuestFacingText(
      'Your suite is held from 2026-12-06 for 3 nights, and a member of the team will write to you.',
      suiteBooking,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('fabricated_date');
  });

  it('passes a truthful reply about the same booking', () => {
    const result = verifyGuestFacingText(
      'We have your details: 3 nights from 5 December for 2 guests in a suite. A member of the Casa team will be in touch here.',
      suiteBooking,
    );
    expect(result.ok).toBe(true);
  });

  it('checks nothing it was not given, rather than refusing to run', () => {
    // A caller that knows only the guest count still gets the money and confirmation rules.
    expect(verifyGuestFacingText('Thanks for your message, a member of the Casa team will reply here soon.', {}).ok).toBe(true);
    expect(
      verifyGuestFacingText('That will be $500 for the two of you, and we will hold the room for now.', { guests: 2 }).ok,
    ).toBe(false);
  });
});

describe('verifySynthesizedReply, through the shared gate', () => {
  it('still answers for a Trip, and still refuses a false confirmation', () => {
    // The full field set their schema requires; this half of the file is about the Trip-shaped
    // caller still working after the rule moved out of it.
    const trip = AiTripSchema.parse({
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
      diveNotes: { value: null, state: 'missing', evidence: null },
      specialRequests: { value: null, state: 'missing', evidence: null },
      guestNames: { value: [], state: 'missing', evidence: null },
    });
    expect(verifySynthesizedReply('Your booking is confirmed and we will email you a confirmation of it.', trip).ok).toBe(
      false,
    );
    expect(
      verifySynthesizedReply('Thanks — we have 4 nights for 5 guests in a deluxe room on file for you now.', trip).ok,
    ).toBe(true);
  });
});
