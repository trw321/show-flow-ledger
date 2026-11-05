import { format, parseISO } from 'date-fns';
import type { CrewMember, CrewShift, Employer, Invoice, InvoiceLine, Job } from './store';
import { jobPayBreakdown, netHoursWorked } from './payCalc';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import { projectKeysFor } from './projectGrouping';
import { crewShiftBillRate, crewShiftHours } from './crew';

const round2 = (n: number) => Math.round(n * 100) / 100;
const day = (iso: string) => format(parseISO(iso), 'EEE MMM d');

export function invoiceTotal(invoice: Pick<Invoice, 'lines'>): number {
  return round2(invoice.lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0));
}

/** The next number in your own run: INV-0001, INV-0002… whatever came last, plus one. */
export function nextInvoiceNumber(invoices: Invoice[]): string {
  const highest = invoices.reduce((max, v) => {
    const n = Number(v.number.match(/(\d+)\s*$/)?.[1] ?? 0);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `INV-${String(highest + 1).padStart(4, '0')}`;
}

/** Shifts and crew shifts already on an invoice, so they are not billed twice. */
export function alreadyInvoiced(invoices: Invoice[], except?: string): { jobs: Map<string, string>; crewShifts: Map<string, string> } {
  const jobs = new Map<string, string>();
  const crewShifts = new Map<string, string>();
  for (const v of invoices) {
    if (v.id === except) continue;
    for (const l of v.lines) {
      if (l.jobId) jobs.set(l.jobId, v.number);
      if (l.crewShiftId) crewShifts.set(l.crewShiftId, v.number);
    }
  }
  return { jobs, crewShifts };
}

/**
 * A shift of yours as an invoice line: its day and name, the hours and the
 * rate shown, and what the pay engine says it earned — overtime, minimums and
 * all — as the amount. A day rate bills as one day.
 */
export function lineForShift(job: Job, allJobs: Job[], employers: Employer[] = [], payer: PayerProfile = EMPTY_PROFILE): InvoiceLine {
  const b = jobPayBreakdown(job, allJobs, employers, payer);
  const hours = netHoursWorked(job);
  const byDay = !job.hourlyRate && !!job.dayRate;
  return {
    description: `${day(job.date)} · ${job.name}${job.venue ? ` @ ${job.venue}` : ''}`,
    quantity: byDay ? 1 : hours || undefined,
    rate: byDay ? job.dayRate : job.hourlyRate,
    amount: round2(b.gross),
    jobId: job.id,
  };
}

/** A crew shift as an invoice line: who, which day, their hours at the rate you bill them at. */
export function lineForCrewShift(shift: CrewShift, member: CrewMember | undefined, job?: Job): InvoiceLine {
  const hours = crewShiftHours(shift);
  const rate = crewShiftBillRate(shift, member);
  return {
    description: `${day(shift.date)} · ${member?.name ?? 'Crew'}${member?.role ? ` (${member.role})` : ''}${job ? ` — ${job.name}` : shift.place ? ` — ${shift.place}` : ''}`,
    quantity: hours || undefined,
    rate: rate || undefined,
    amount: round2(hours * rate),
    crewShiftId: shift.id,
    jobId: shift.jobId,
  };
}

/** Sent, not paid, and past its due date. */
export function invoiceOverdue(invoice: Invoice, today: string): boolean {
  return invoice.status === 'sent' && !!invoice.dueDate && invoice.dueDate < today;
}

/**
 * The payments marking an invoice paid should record: one per project it
 * billed, on one of that project's shifts — so the calendar shows each of
 * them paid — and one, on no shift, for anything billed that is not a shift.
 */
export function paymentsForInvoice(invoice: Invoice, allJobs: Job[], employers: Employer[] = []): { jobId?: string; amount: number }[] {
  const keys = projectKeysFor(allJobs, employers);
  const known = new Set(allJobs.map(j => j.id));
  const byProject = new Map<string, { jobId?: string; amount: number }>();
  for (const line of invoice.lines) {
    const jobId = line.jobId && known.has(line.jobId) ? line.jobId : undefined;
    const key = jobId ? keys.get(jobId) ?? jobId : '';
    const entry = byProject.get(key) ?? { jobId, amount: 0 };
    entry.amount = round2(entry.amount + (Number(line.amount) || 0));
    byProject.set(key, entry);
  }
  return [...byProject.values()].filter(p => p.amount > 0);
}
