import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import type { Job, Expense, Income, Employer } from './store';
import { effectiveHoursWorked, isOverdueUpcoming, jobHoursBreakdown, jobPayBreakdown, netHoursWorked } from './payCalc';
import { resolveEmployer } from './employerMatch';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';

/**
 * A shift's figures for the spreadsheet: exactly what the app shows for it,
 * from the same calculation (jobPayBreakdown, jobHoursBreakdown). The export
 * used to keep its own older copy of the pay math, which left out breaking
 * the hour, early-call and holiday premiums, split days, day rates and your
 * locals' dues, and came out under the app. It must never have its own again.
 */
function jobFigures(job: Job, allJobs: Job[], employers: Employer[], payer: PayerProfile) {
  const pay = jobPayBreakdown(job, allJobs, employers, payer);
  const hours = jobHoursBreakdown(job, allJobs, employers, payer);
  return { ...pay, nightHours: hours.night };
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

/** Every row of the ledger spreadsheet: shifts, expenses, and payments with no shift, by date. */
export function ledgerRows(jobs: Job[], expenses: Expense[], income: Income[], employers: Employer[] = [], payer: PayerProfile = EMPTY_PROFILE) {
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
      const figures = jobFigures(j, jobs, employers, payer);
      const worked = effectiveHoursWorked(j) > 0;
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
        'Premium Hours': figures.nightHours || '',
        Client: j.client,
        Venue: j.venue ?? '',
        'Payroll Company': j.payrollCompany ?? '',
        Rate: j.hourlyRate ?? '',
        'Hours Worked': netHoursWorked(j) || '',
        // The same Est. gross and Est. net the app shows for the shift.
        'Estimated Gross': worked ? figures.gross.toFixed(2) : '',
        'Estimated Net': worked ? figures.net.toFixed(2) : '',
        'Actual Income': actualIncome !== undefined ? actualIncome.toFixed(2) : '',
        Taxes: figures.tax > 0 ? figures.tax.toFixed(2) : '',
        Dues: figures.dues > 0 ? figures.dues.toFixed(2) : '',
        Vacation: figures.vacation > 0 ? figures.vacation.toFixed(2) : '',
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
      'Estimated Gross': '',
      'Estimated Net': '',
      'Actual Income': '',
      Taxes: '',
      Dues: '',
      Vacation: '',
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
      'Estimated Gross': '',
      'Estimated Net': '',
      'Actual Income': i.amount.toFixed(2),
      Taxes: '',
      Dues: '',
      Vacation: '',
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

  return allRows;
}

/** The ledger as an Excel file: see ledgerRows. */
export function exportWeeklyToExcel(jobs: Job[], expenses: Expense[], income: Income[], employers: Employer[] = [], payer: PayerProfile = EMPTY_PROFILE) {
  const fileName = `AV-Ledger-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  downloadXLSX(ledgerRows(jobs, expenses, income, employers, payer), fileName);
}
