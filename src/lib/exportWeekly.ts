import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import type { Job, Expense, Income, Employer } from './store';
import { calculateDayPay, getDayMultiplier, calculateWeeklyOvertimeBonus, calculateNightHours } from './payCalc';
import { resolveEmployer } from './employerMatch';

function jobGross(job: Job, allJobs: Job[], employers: Employer[]): number {
  const hours = job.hoursWorked ?? 0;
  if (!hours) return 0;
  const rate = job.hourlyRate ?? 0;
  const employer = resolveEmployer(job.client, employers);
  const dayMult = getDayMultiplier(job.date, job.client, allJobs, job.has6th7thDayRule ?? false);
  const nightHours = ((employer?.nightPremiumEnabled ?? true) && job.nightPremiumConfirmed !== false && job.startTime && job.endTime)
    ? calculateNightHours(job.startTime, job.endTime, employer?.nightPremiumStartHour ?? 0, employer?.nightPremiumEndHour)
    : 0;
  const { totalPay } = calculateDayPay(hours, rate, job.minimumHours ?? 0, job.mealPenalties ?? 0, dayMult, { duration: job.mealDuration, onClock: job.mealOnClock }, {
    rule: employer?.overtimeRule ?? 'daily',
    otThresholdHours: employer?.dailyOvertimeThresholdHours,
    dtThresholdHours: employer?.dailyDoubletimeThresholdHours,
    otMultiplier: employer?.overtimeMultiplier,
    dtMultiplier: employer?.doubletimeMultiplier,
    nightHours,
    nightMultiplier: employer?.nightPremiumMultiplier,
  });
  const weeklyBonus = employer ? calculateWeeklyOvertimeBonus(job, allJobs, employer) : 0;
  const gross = totalPay + weeklyBonus;
  return gross + (job.hasVacationPay ? gross * 0.08 : 0);
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
  // Build one flat row per job
  const jobRows = [...jobs]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(j => ({
      Type: 'Job',
      Date: j.date,
      'Job #': j.jobNumber ?? '',
      Name: j.name,
      Client: j.client,
      Venue: j.venue ?? '',
      'Payroll Company': j.payrollCompany ?? '',
      Status: j.status,
      'Start Time': j.startTime ?? '',
      'End Time': j.endTime ?? '',
      'Hours Worked': j.hoursWorked ?? '',
      'Hourly Rate': j.hourlyRate ?? '',
      'Min Hours': j.minimumHours ?? '',
      'Gross Earnings': j.hoursWorked ? jobGross(j, jobs, employers).toFixed(2) : '',
      'Expense Amount': '',
      'Expense Category': '',
      'Income Amount': '',
      'Income Client': '',
      'Invoice #': '',
      'Income Status': '',
      Notes: j.notes ?? '',
    }));

  // One row per expense
  const expenseRows = [...expenses]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({
      Type: 'Expense',
      Date: e.date,
      'Job #': '',
      Name: e.description,
      Client: '',
      Venue: '',
      'Payroll Company': '',
      Status: '',
      'Start Time': '',
      'End Time': '',
      'Hours Worked': '',
      'Hourly Rate': '',
      'Min Hours': '',
      'Gross Earnings': '',
      'Expense Amount': e.amount.toFixed(2),
      'Expense Category': e.category,
      'Income Amount': '',
      'Income Client': '',
      'Invoice #': '',
      'Income Status': '',
      Notes: '',
    }));

  // One row per income entry
  const incomeRows = [...income]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(i => ({
      Type: 'Income',
      Date: i.date,
      'Job #': '',
      Name: i.description || i.client,
      Client: '',
      Venue: '',
      'Payroll Company': '',
      Status: '',
      'Start Time': '',
      'End Time': '',
      'Hours Worked': '',
      'Hourly Rate': '',
      'Min Hours': '',
      'Gross Earnings': '',
      'Expense Amount': '',
      'Expense Category': '',
      'Income Amount': i.amount.toFixed(2),
      'Income Client': i.client,
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
