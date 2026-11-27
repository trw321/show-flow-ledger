import { describe, it, expect } from 'vitest';
import { ledgerRows } from './exportWeekly';
import { jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import type { Job } from './store';

const job = (over: Partial<Job>): Job => ({
  id: Math.random().toString(36).slice(2), name: 'X', client: 'X', venue: '', date: '2026-09-01', status: 'completed',
  has6th7thDayRule: false, notes: '', attachments: [], createdAt: 'x', ...over,
} as Job);

// Shifts the export's old math got wrong, from the real ledger.
const lacy = job({ id: 'lacy', name: 'STEVE LACY', client: 'BGCA MANAGEMENT LLC', venue: 'Civic Auditorium', contract: 'BGCA CONCERTS&COMEDY20242029', jobNumber: '2026-4250', date: '2026-11-25', startTime: '10:00 PM', endTime: '1:30 AM', hoursWorked: 3.5, hourlyRate: 43.72 });
const oarAm = job({ id: 'oar-am', name: 'OAR', client: 'LIVE NATION / MASONIC', jobNumber: '2026-2626', date: '2026-08-12', startTime: '9:00 AM', endTime: '2:00 PM', hoursWorked: 5, hourlyRate: 41.6 });
const oarPm = job({ id: 'oar-pm', name: 'OAR', client: 'LIVE NATION / MASONIC', jobNumber: '2026-2626', date: '2026-08-12', startTime: '10:30 PM', endTime: '3:00 AM', hoursWorked: 4.5, hourlyRate: 41.6 });
const earlyCall = job({ id: 'cio', name: 'CIO SUMMIT', client: 'PRODUCTION SUPPORT SERVICES INC', contract: 'PSS 2025-2030 ENTERTAINMENT', jobNumber: '2026-4046', date: '2026-11-18', startTime: '6:30 AM', endTime: '10:03 PM', hoursWorked: 16, hourlyRate: 70.4 });
const dues: PayerProfile = { locals: [{ local: '16', unionDuesPercent: 3.5 }], contractRules: [{ name: 'PSS 2025-2030 ENTERTAINMENT', earlyCall: 'until8' }] };
const jobs = [lacy, oarAm, oarPm, earlyCall];

const rowFor = (id: string, payer: PayerProfile = EMPTY_PROFILE) => {
  const j = jobs.find(x => x.id === id)!;
  return ledgerRows(jobs, [], [], [], payer).find(r => r.Type === 'Job' && r.Date === j.date && r['Time In'] === j.startTime)!;
};

describe('the Excel ledger shows what the app shows', () => {
  it('gives every shift the app\'s own gross and net, to the cent', () => {
    for (const payer of [EMPTY_PROFILE, dues]) {
      for (const j of jobs) {
        const app = jobPayBreakdown(j, jobs, [], payer);
        expect(rowFor(j.id, payer)['Estimated Gross']).toBe(app.gross.toFixed(2));
        expect(rowFor(j.id, payer)['Estimated Net']).toBe(app.net.toFixed(2));
      }
    }
  });

  it('pays Thanksgiving and the half-hour rule at the Civic Auditorium: $251.39, not $218.60', () => {
    expect(rowFor('lacy')['Estimated Gross']).toBe('251.39');
  });

  it('prices a split day as one day, each call its own share: the night call carries the overtime', () => {
    const am = Number(rowFor('oar-am')['Estimated Gross']);
    const pm = Number(rowFor('oar-pm')['Estimated Gross']);
    expect(am).toBeCloseTo(208, 2);
    expect(pm).toBeCloseTo(353.6, 2);
  });

  it('takes dues from your locals, as the app does', () => {
    const marked = { ...lacy, local: '16' };
    const row = ledgerRows([marked], [], [], [], dues)[0];
    expect(Number(row.Dues)).toBeCloseTo(251.39 * 0.035, 2);
    expect(row.Dues).toBe(jobPayBreakdown(marked, [marked], [], dues).dues.toFixed(2));
  });

  it('keeps the same columns on every kind of row', () => {
    const rows = ledgerRows([lacy], [{ id: 'e', description: 'Gaff tape', amount: 12, date: '2026-11-25', category: 'supplies', createdAt: 'x' } as never],
      [{ id: 'i', client: 'Somebody', amount: 50, date: '2026-11-24', status: 'paid', createdAt: 'x' } as never]);
    const keys = rows.map(r => Object.keys(r).join('|'));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toContain('Estimated Gross|Estimated Net');
    expect(keys[0]).toContain('Vacation');
  });
});
