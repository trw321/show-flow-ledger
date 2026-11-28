import { describe, it, expect } from 'vitest';
import { claimSummary, cleanStubs, shiftsStubFits, type ClaimStub } from './unemployment';
import { EMPTY_PROFILE } from './payerProfile';
import type { Job } from './store';

// Blackpoint, from the real ledger: Brandi Carlile on Sep 19 in two calls, Portola Fest Sep 21-24,
// and one pay stub for Sep 14-25 that says 13 hours, $925.83.
const shift = (id: string, date: string, startTime: string, endTime: string, hoursWorked: number, name: string, rate: number): Job => ({
  id, date, startTime, endTime, hoursWorked, name, hourlyRate: rate, client: 'BLACKPOINT PRODUCTION INC.', payrollCompany: 'BLACKPOINT PRODUCTION INC.',
  venue: '', jobNumber: '2026-2956', status: 'completed', has6th7thDayRule: false, notes: '', createdAt: 'x',
} as Job);
const jobs = [
  shift('bc-am', '2026-09-19', '09:00 AM', '2:00 PM', 5, 'STANFORD-BRANDI CARLILE', 57.39),
  shift('bc-pm', '2026-09-19', '6:30 PM', '1:00 AM', 6.5, 'STANFORD-BRANDI CARLILE', 57.39),
  shift('p1', '2026-09-21', '08:00 AM', '7:00 PM', 11, 'PORTOLA FEST 2026', 52.48),
  shift('p2', '2026-09-22', '8:00 AM', '6:00 PM', 10, 'PORTOLA FEST 2026', 52.48),
  shift('p3', '2026-09-23', '8:00 AM', '7:00 PM', 11, 'PORTOLA FEST 2026', 52.48),
  shift('p4', '2026-09-24', '8:00 AM', '6:00 PM', 10, 'PORTOLA FEST 2026', 52.48),
];
const stub: ClaimStub = { id: 'bp', employer: 'BLACKPOINT PRODUCTION INC.', start: '2026-09-14', end: '2026-09-25', hours: 13, gross: 925.83, createdAt: 'x' };
const summary = (s: ClaimStub) => claimSummary(jobs, [], EMPTY_PROFILE, '2025-07-01', '2026-09-30', 6, [s]);
const blackpoint = (s: ClaimStub) => summary(s).employers.find(e => /blackpoint/i.test(e.name))!;

describe('a pay stub that paid only some of the shifts in its dates', () => {
  it('stands in for all of them until told otherwise: Portola\'s 42 hours vanish into the stub\'s 13', () => {
    const e = blackpoint(stub);
    expect(e.hours).toBe(13);
    expect(e.gross).toBeCloseTo(925.83, 2);
  });

  it('suggests the shifts its 13 hours fit: Sep 19\'s two calls', () => {
    const use = summary(stub).stubs.find(u => u.stub.id === 'bp')!;
    expect(use.fits?.sort()).toEqual(['bc-am', 'bc-pm']);
  });

  it('kept to Sep 19, counts Portola from the calendar beside it, and lists Portola as not on the stub', () => {
    const kept = { ...stub, shiftIds: ['bc-am', 'bc-pm'] };
    const e = blackpoint(kept);
    expect(e.hours).toBeCloseTo(13 + 42, 2);
    // Portola's own estimates: 11 h days are 8 straight and 3 at 1.5×, 10 h days 8 and 2.
    const portola = 2 * (8 * 52.48 + 3 * 52.48 * 1.5) + 2 * (8 * 52.48 + 2 * 52.48 * 1.5);
    expect(e.gross).toBeCloseTo(925.83 + portola, 2);
    expect(e.days).toBe(5);
    const use = summary(kept).stubs.find(u => u.stub.id === 'bp')!;
    expect(use.left?.map(c => c.jobId)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(use.fits).toBeUndefined();
  });

  it('keeps a stub\'s shifts when stored, and drops junk in them', () => {
    const [clean] = cleanStubs([{ ...stub, shiftIds: ['bc-am', 7, null, 'bc-pm'] }]);
    expect(clean.shiftIds).toEqual(['bc-am', 'bc-pm']);
    expect(cleanStubs([stub])[0].shiftIds).toBeUndefined();
  });

  it('suggests nothing when two sets fit as well, or the hours aren\'t short', () => {
    const two = [{ jobId: 'a', date: '2026-09-21', hours: 10 }, { jobId: 'b', date: '2026-09-22', hours: 10 }, { jobId: 'c', date: '2026-09-23', hours: 4 }];
    expect(shiftsStubFits({ hours: 10 }, two)).toBeUndefined();
    expect(shiftsStubFits({ hours: 23 }, two)).toBeUndefined();
    expect(shiftsStubFits({ hours: 4 }, two)).toEqual(['c']);
  });
});

describe('fitting a stub to whole days', () => {
  it('matches Sep 19 against Portola days with an hour\'s lunch off (10, 9, 10, 9), never a morning plus another day', () => {
    const real = [
      { jobId: 'bc-pm', date: '2026-09-19', hours: 6.5 }, { jobId: 'bc-am', date: '2026-09-19', hours: 5 },
      { jobId: 'p1', date: '2026-09-21', hours: 10 }, { jobId: 'p2', date: '2026-09-22', hours: 9 },
      { jobId: 'p3', date: '2026-09-23', hours: 10 }, { jobId: 'p4', date: '2026-09-24', hours: 9 },
    ];
    expect(shiftsStubFits({ hours: 13 }, real)?.sort()).toEqual(['bc-am', 'bc-pm']);
  });
});
