import { describe, it, expect } from 'vitest';
import { invoiceTotal, nextInvoiceNumber, alreadyInvoiced, lineForShift, lineForCrewShift, invoiceOverdue, paymentsForInvoice } from './invoices';
import { crewShiftHours, crewShiftPay, crewShiftOwed } from './crew';
import type { CrewMember, CrewShift, Invoice, Job } from './store';

const shift = (id: string, date: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'Gala', client: 'Odeum', venue: 'Hall', date, status: 'completed', hoursWorked: 8, hourlyRate: 50,
  has6th7thDayRule: false, notes: '', createdAt: 'x', ...extra,
} as Job);
const invoice = (extra: Partial<Invoice> = {}): Invoice => ({
  id: 'v1', number: 'INV-0001', client: 'Odeum', issueDate: '2026-10-12', lines: [], status: 'draft', createdAt: 'x', ...extra,
});
const jamie: CrewMember = { id: 'c1', name: 'Jamie', role: 'A2', payRate: 40, billRate: 55, createdAt: 'x' };
const booking = (extra: Partial<CrewShift> = {}): CrewShift => ({ id: 's1', crewId: 'c1', date: '2026-10-10', startTime: '8:00 AM', endTime: '6:00 PM', createdAt: 'x', ...extra });

describe('invoice numbers', () => {
  it('starts at one', () => expect(nextInvoiceNumber([])).toBe('INV-0001'));
  it('carries on from the highest, whatever it was called', () => {
    expect(nextInvoiceNumber([invoice({ number: 'INV-0007' }), invoice({ number: 'Odeum 12' })])).toBe('INV-0013');
  });
});

describe('lines', () => {
  it('bills a shift at what the pay engine says it earned, overtime and all', () => {
    const long = shift('a', '2026-10-10', { hoursWorked: 10 });
    const line = lineForShift(long, [long]);
    expect(line.quantity).toBe(10);
    expect(line.rate).toBe(50);
    // 8 at straight time and 2 at time and a half.
    expect(line.amount).toBe(550);
    expect(line.description).toMatch(/Sat Oct 10 · Gala @ Hall/);
  });

  it('bills a day rate as one day', () => {
    const flat = shift('a', '2026-10-10', { hourlyRate: undefined, dayRate: 600, hoursWorked: 8 });
    const line = lineForShift(flat, [flat]);
    expect(line.quantity).toBe(1);
    expect(line.rate).toBe(600);
  });

  it('bills crew at their bill rate, from the call times until hours are in', () => {
    const line = lineForCrewShift(booking(), jamie);
    expect(line.quantity).toBe(10);
    expect(line.amount).toBe(550);
    expect(line.description).toMatch(/Jamie \(A2\)/);
  });

  it('adds up', () => {
    expect(invoiceTotal({ lines: [{ description: 'a', amount: 100.1 }, { description: 'b', amount: 0.2 }] })).toBe(100.3);
  });
});

describe('not billing twice', () => {
  it('knows which shifts are already on an invoice — but not the one being edited', () => {
    const v = invoice({ lines: [{ description: 'a', amount: 1, jobId: 'a' }, { description: 'b', amount: 1, crewShiftId: 's1' }] });
    expect(alreadyInvoiced([v]).jobs.get('a')).toBe('INV-0001');
    expect(alreadyInvoiced([v]).crewShifts.has('s1')).toBe(true);
    expect(alreadyInvoiced([v], 'v1').jobs.size).toBe(0);
  });
});

describe('getting paid', () => {
  it('records one payment per project billed, so each shows paid', () => {
    const jobs = [shift('a', '2026-10-10', { jobNumber: '1' }), shift('b', '2026-10-11', { jobNumber: '1' }), shift('c', '2026-10-20', { jobNumber: '2' })];
    const v = invoice({ lines: [
      { description: 'a', amount: 400, jobId: 'a' },
      { description: 'b', amount: 400, jobId: 'b' },
      { description: 'c', amount: 300, jobId: 'c' },
      { description: 'kit hire', amount: 50 },
    ] });
    const pays = paymentsForInvoice(v, jobs);
    expect(pays).toEqual([{ jobId: 'a', amount: 800 }, { jobId: 'c', amount: 300 }, { jobId: undefined, amount: 50 }]);
  });

  it('is overdue only once sent and past due', () => {
    expect(invoiceOverdue(invoice({ status: 'sent', dueDate: '2026-11-01' }), '2026-11-05')).toBe(true);
    expect(invoiceOverdue(invoice({ status: 'draft', dueDate: '2026-11-01' }), '2026-11-05')).toBe(false);
    expect(invoiceOverdue(invoice({ status: 'paid', dueDate: '2026-11-01' }), '2026-11-05')).toBe(false);
  });
});

describe('crew', () => {
  it('takes the hours worked once in, the call times until then', () => {
    expect(crewShiftHours(booking())).toBe(10);
    expect(crewShiftHours(booking({ hoursWorked: 9.5 }))).toBe(9.5);
  });

  it('pays at the shift\'s own rate before theirs', () => {
    expect(crewShiftPay(booking(), jamie)).toBe(400);
    expect(crewShiftPay(booking({ rate: 45 }), jamie)).toBe(450);
  });

  it('owes a worked shift until it is paid', () => {
    expect(crewShiftOwed(booking(), '2026-10-11')).toBe(true);
    expect(crewShiftOwed(booking({ payoutId: 'p1' }), '2026-10-11')).toBe(false);
    expect(crewShiftOwed(booking(), '2026-10-09')).toBe(false);
  });
});
