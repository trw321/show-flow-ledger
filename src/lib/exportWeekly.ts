import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import type { Job, Expense, Income, Employer } from './store';
import { calculateDayPay, getDayMultiplier, calculateWeeklyOvertimeBonus, calculateNightHours, resolveConfirmedNightHours, effectiveHoursWorked, isOverdueUpcoming } from './payCalc';
import { resolveEmployer } from './employerMatch';

interface JobPayDetails {
  grossPay: number;
  duesAmount: number;
  premiumHours: number;
}

function jobPayDetails(job: Job, allJobs: Job[], employers: Employer[]): JobPayDetails {
  const hours = effectiveHoursWorked(job);
  if (!hours) return { grossPay: 0, duesAmount: 0, premiumHours: 0 };
  const rate = job.hourlyRate ?? 0;
  const employer = resolveEmployer(job.client, employers);
  const dayMult = getDayMultiplier(job.date, job.client, allJobs, job.has6th7thDayRule ?? false);
  const rawNightHours = ((employer?.nightPremiumEnabled ?? true) && job.startTime && job.endTime)
    ? calculateNightHours(job.startTime, job.endTime, employer?.nightPremiumStartHour ?? 0, employer?.nightPremiumEndHour)
    : 0;
  const nightHours = resolveConfirmedNightHours(rawNightHours, job.nightPremiumConfirmed, job.nightPremiumActualHours);
  const { totalPay, duesAmount, nightHours: premiumHours } = calculateDayPay(hours, rate, job.minimumHours ?? 0, job.mealPenalties ?? 0, dayMult, { duration: job.mealDuration, onClock: job.mealOnClock }, {
    rule: employer?.overtimeRule ?? 'daily',
    otThresholdHours: employer?.dailyOvertimeThresholdHours,
    dtThresholdHours: employer?.dailyDoubletimeThresholdHours,
    otMultiplier: employer?.overtimeMultiplier,
    dtMultiplier: employer?.doubletimeMultiplier,
    nightHours,
    nightMultiplier: employer?.nightPremiumMultiplier,
    unionDuesPercent: employer?.unionDuesPercent,
  });
  const weeklyBonus = employer ? calculateWeeklyOvertimeBonus(job, allJobs, employer) : 0;
  const gross = totalPay + weeklyBonus;
  return {
    grossPay: gross + (job.hasVacationPay ? gross * 0.08 : 0),
    duesAmount,
    premiumHours,
  };
}

function downloadXLSX(rows: Record<string, string | number | undefined | null>[], fileName: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = rows.length
    ? Object.keys(rows[0]).map(key => ({
        wch: Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length)) + 2,
      }))
    : [];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ledger');
  XLSX.writeFile(workbook, fileName);
}

export function exportWeeklyToExcel(jobs: Job[], expenses: Expense[], income: Income[], employers: Employer[] = []) {
  // Paid income actually received against a job, summed — separate from the
  // estimated/expected pay the calculator produces, so the two can be
  // compared side by side instead of only ever showing one number.
  const paidByJobId = new Map<string, number>();
  for (const i of income) {
    if (i.status === 'paid' && i.jobId) {
      paidByJobId.set(i.jobId, (paidByJobId.get(i.jobId) ?? 0) + i.amount);
    }
  }

  // Build one flat row per job
  const jobRows = [...jobs]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(j => {
      const { grossPay, duesAmount, premiumHours } = jobPayDetails(j, jobs, employers);
      const employer = resolveEmployer(j.client, employers);
      const actualIncome = paidByJobId.get(j.id);
      return {
        Type: 'Job',
        IATSE: employer?.unionLocal ?? '',
        'Job #': j.jobNumber ?? '',
        Project: j.name,
        Date: j.date,
        'Time In': j.startTime ?? '',
        'Time Out': j.endTime ?? '',
        MPs: j.mealPenalties ?? '',
        'Premium Hours': premiumHours || '',
        Client: j.client,
        Venue: j.venue ?? '',
        'Payroll Company': j.payrollCompany ?? '',
        Rate: j.hourlyRate ?? '',
        'Hours Worked': effectiveHoursWorked(j) || '',
        'Estimated Pay': effectiveHoursWorked(j) ? grossPay.toFixed(2) : '',
        'Actual Income': actualIncome !== undefined ? actualIncome.toFixed(2) : '',
        Taxes: '',
        Dues: duesAmount > 0 ? duesAmount.toFixed(2) : '',
        Status: isOverdueUpcoming(j) ? 'needs hours' : j.status,
        'Expense Amount': '',
        'Expense Category': '',
        'Invoice #': '',
        'Income Status': '',
        Notes: j.notes ?? '',
      };
    });

  // One row per expense
  const expenseRows = [...expenses]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({
      Type: 'Expense',
      IATSE: '',
      'Job #': '',
      Project: e.description,
      Date: e.date,
      'Time In': '',
      'Time Out': '',
      MPs: '',
      'Premium Hours': '',
      Client: '',
      Venue: '',
      'Payroll Company': '',
      Rate: '',
      'Hours Worked': '',
      'Estimated Pay': '',
      'Actual Income': '',
      Taxes: '',
      Dues: '',
      Status: '',
      'Expense Amount': e.amount.toFixed(2),
      'Expense Category': e.category,
      'Invoice #': '',
      'Income Status': '',
      Notes: '',
    }));

  // One row per income entry not already folded into a job row above
  // (job-linked paid income is already reflected in that job's Actual
  // Income column — repeating it here would double-count the same dollars).
  const incomeRows = [...income]
    .filter(i => !i.jobId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(i => ({
      Type: 'Income',
      IATSE: '',
      'Job #': '',
      Project: i.description || i.client,
      Date: i.date,
      'Time In': '',
      'Time Out': '',
      MPs: '',
      'Premium Hours': '',
      Client: i.client,
      Venue: '',
      'Payroll Company': '',
      Rate: '',
      'Hours Worked': '',
      'Estimated Pay': '',
      'Actual Income': i.amount.toFixed(2),
      Taxes: '',
      Dues: '',
      Status: '',
      'Expense Amount': '',
      'Expense Category': '',
      'Invoice #': i.invoiceNumber ?? '',
      'Income Status': i.status,
      Notes: '',
    }));

  const allRows = [...jobRows, ...expenseRows, ...incomeRows].sort((a, b) =>
    a.Date.localeCompare(b.Date)
  );

  const fileName = `AV-Ledger-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  downloadXLSX(allRows, fileName);
}
