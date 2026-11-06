import { describe, it, expect } from 'vitest';
import type { ParsedJob } from './dispatchParsing';
import { findOfferMatch, mergeOffer } from './offerMerge';
import type { Job } from './store';

// What a photo left on the calendar, as it really came.
const fromPhoto = (over: Partial<Job> = {}): Job => ({
  id: 'p', name: 'P VIDEO WALL EXTRA', client: 'FREEMAN AUDIO VISUAL SOLUTIONS INC', venue: 'Moscone North/South', date: '2026-11-08',
  startTime: '08:00 AM', status: 'upcoming', has6th7thDayRule: false, notes: 'ENTER THRU THE PASEO', jobNumber: '2026-3926', createdAt: 'x', ...over,
} as Job);
const offer = (over: Partial<ParsedJob> = {}): ParsedJob => ({
  jobNumber: '2026-3926', name: 'MSFT IGNITE 26_ACTIVATIONS LED', client: 'FREEMAN AUDIO VISUAL SOLUTIONS INC', venue: 'Moscone North/South',
  date: '2026-11-08', startTime: '08:00 AM', status: 'upcoming', payrollCompany: 'FREEMAN AUDIO VISUAL SOLUTIONS INC', hourlyRate: 57.39,
  steward: 'DAVID CARMINITO', contract: '2023-2028 BASIC BREAKOUT', notes: 'P VIDEO WALL EXTRA. ENTER THRU THE PASEO. BRING TWO FORMS OF ID OR PASSPORT', ...over,
});

describe('which shift an offer is another copy of', () => {
  it('finds it by job number and day', () => {
    expect(findOfferMatch(offer(), [fromPhoto()])?.id).toBe('p');
  });

  it('knows 2705 and 2026-2705 are one job', () => {
    expect(findOfferMatch(offer({ jobNumber: '2026-2705' }), [fromPhoto({ jobNumber: '2705' })])?.id).toBe('p');
    expect(findOfferMatch(offer({ jobNumber: '2705' }), [fromPhoto({ jobNumber: '2026-2705' })])?.id).toBe('p');
  });

  it('does not match another year of the same code', () => {
    expect(findOfferMatch(offer({ jobNumber: '2025-2705' }), [fromPhoto({ jobNumber: '2705' })])).toBeUndefined();
  });

  it('lets a shift with no time take the offer, and the other way round', () => {
    expect(findOfferMatch(offer({ startTime: undefined }), [fromPhoto()])?.id).toBe('p');
    expect(findOfferMatch(offer(), [fromPhoto({ startTime: undefined })])?.id).toBe('p');
  });

  it('keeps a callback at another time as its own shift', () => {
    expect(findOfferMatch(offer({ startTime: '06:00 PM' }), [fromPhoto()])).toBeUndefined();
  });

  it('picks the right call of a split day', () => {
    const split = [fromPhoto({ id: 'am' }), fromPhoto({ id: 'pm', startTime: '6:00 PM' })];
    expect(findOfferMatch(offer({ startTime: '06:00 PM' }), split)?.id).toBe('pm');
  });

  it('will not guess between two calls when the offer gives no time', () => {
    const split = [fromPhoto({ id: 'am' }), fromPhoto({ id: 'pm', startTime: '6:00 PM' })];
    expect(findOfferMatch(offer({ startTime: undefined }), split)).toBeUndefined();
  });

  it('uses a shift once', () => {
    expect(findOfferMatch(offer(), [fromPhoto()], new Set(['p']))).toBeUndefined();
  });

  it('finds a shift logged with no number by its employer and day', () => {
    expect(findOfferMatch(offer(), [fromPhoto({ jobNumber: undefined })])?.id).toBe('p');
    expect(findOfferMatch(offer(), [fromPhoto({ jobNumber: undefined, client: 'Blackpoint' })])).toBeUndefined();
  });

  it('leaves shifts typed in by hand alone', () => {
    expect(findOfferMatch(offer({ jobNumber: undefined }), [fromPhoto()])).toBeUndefined();
  });

  it('keeps two roles apart', () => {
    expect(findOfferMatch(offer({ role: 'A2' }), [fromPhoto({ role: 'A1' })])).toBeUndefined();
  });
});

describe('what the full offer brings', () => {
  it('fills in what a photo left out and corrects what it misread', () => {
    const m = mergeOffer(fromPhoto(), offer(), true);
    expect(m.updates).toMatchObject({
      name: 'MSFT IGNITE 26_ACTIVATIONS LED', hourlyRate: 57.39, steward: 'DAVID CARMINITO', contract: '2023-2028 BASIC BREAKOUT',
      payrollCompany: 'FREEMAN AUDIO VISUAL SOLUTIONS INC',
    });
    expect(m.changes).toEqual(['name', 'payroll company', 'rate', 'contract', 'steward', 'notes']);
  });

  it('never touches what happened on the day', () => {
    const worked = fromPhoto({ status: 'completed', hoursWorked: 9, startTime: '7:30 AM', endTime: '5:00 PM', mealDuration: 30, mealOnClock: false });
    const m = mergeOffer(worked, offer({ startTime: '08:00 AM', endTime: '06:00 PM', status: 'upcoming' }), true);
    for (const field of ['status', 'hoursWorked', 'startTime', 'endTime', 'mealDuration', 'mealOnClock', 'date'] as const) {
      expect(m.updates).not.toHaveProperty(field);
    }
  });

  it('fills a time that was blank', () => {
    expect(mergeOffer(fromPhoto({ startTime: undefined }), offer(), true).updates.startTime).toBe('08:00 AM');
  });

  it('keeps both sets of notes, without repeating them', () => {
    expect(mergeOffer(fromPhoto(), offer(), true).updates.notes).toBe('P VIDEO WALL EXTRA. ENTER THRU THE PASEO. BRING TWO FORMS OF ID OR PASSPORT');
    expect(mergeOffer(fromPhoto({ notes: 'Parked in lot B' }), offer({ notes: 'BRING ID' }), true).updates.notes).toBe('Parked in lot B\nBRING ID');
    expect(mergeOffer(fromPhoto({ notes: 'BRING ID and more' }), offer({ notes: 'bring id' }), true).updates).not.toHaveProperty('notes');
  });

  it('does not pile notes up when the same offer is read differently', () => {
    const first = fromPhoto({ notes: 'P VIDEO WALL EXTRA. ENTER THRU THE PASEO. BRING TWO FORMS OF ID OR PASSPORT' });
    const again = offer({ notes: 'P VIDEO WALL EXTRA; ENTER THRU THE PASEO; BRING TWO FORMS OF ID OR PASSPORT' });
    expect(mergeOffer(first, again, true).updates).not.toHaveProperty('notes');
  });

  it('leaves an employer picked by hand', () => {
    expect(mergeOffer(fromPhoto({ client: 'Freeman' }), offer(), true).updates).not.toHaveProperty('client');
  });

  it('leaves a rate a stub corrected', () => {
    const corrected = fromPhoto({ hourlyRate: 60, stubCorrections: [{ field: 'rate', was: 57.39, now: 60, at: 'x' }] });
    expect(mergeOffer(corrected, offer(), true).updates).not.toHaveProperty('hourlyRate');
    expect(mergeOffer(fromPhoto({ hourlyRate: 60 }), offer(), true).updates.hourlyRate).toBe(57.39);
  });

  it('writes the job number out in full', () => {
    const m = mergeOffer(fromPhoto({ jobNumber: '3926' }), offer(), true);
    expect(m.updates.jobNumber).toBe('2026-3926');
    expect(m.changes).not.toContain('job number');
  });

  it('clears the flag when the offer names the payroll company', () => {
    const flagged = fromPhoto({ needsReview: true, payrollCompany: 'FREEMAN AUDIO VISUAL SOLUTIONS INC' });
    const m = mergeOffer(flagged, offer(), true);
    expect(m.updates).toHaveProperty('needsReview', undefined);
    expect(mergeOffer(fromPhoto({ needsReview: true }), offer({ payrollCompany: undefined }), true).updates).not.toHaveProperty('needsReview');
  });

  it('has nothing to do when it is all there already', () => {
    const full = fromPhoto({
      name: 'MSFT IGNITE 26_ACTIVATIONS LED', hourlyRate: 57.39, steward: 'DAVID CARMINITO', contract: '2023-2028 BASIC BREAKOUT',
      payrollCompany: 'FREEMAN AUDIO VISUAL SOLUTIONS INC', notes: 'P VIDEO WALL EXTRA. ENTER THRU THE PASEO. BRING TWO FORMS OF ID OR PASSPORT',
    });
    expect(mergeOffer(full, offer(), true)).toMatchObject({ updates: {}, changes: [] });
  });
});

describe('a photo arriving second', () => {
  const full = () => fromPhoto({ name: 'MSFT IGNITE 26_ACTIVATIONS LED', hourlyRate: 57.39, steward: 'DAVID CARMINITO' });

  it('never overwrites what the text said', () => {
    const m = mergeOffer(full(), offer({ name: 'P VIDEO WALL EXTRA', hourlyRate: 51, steward: 'D CARMINTO', venue: 'Moscone' }), false);
    expect(m.updates).not.toHaveProperty('name');
    expect(m.updates).not.toHaveProperty('hourlyRate');
    expect(m.updates).not.toHaveProperty('steward');
    expect(m.updates).not.toHaveProperty('venue');
  });

  it('still fills a blank', () => {
    expect(mergeOffer(full(), offer({ contract: '2023-2028 BASIC BREAKOUT' }), false).updates.contract).toBe('2023-2028 BASIC BREAKOUT');
  });
});
