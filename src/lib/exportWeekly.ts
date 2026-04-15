import { format } from 'date-fns';
import type { Job, Expense, Income } from './store';
import { calculateDayPay, getDayMultiplier } from './payCalc';

function jobGross(job: Job, allJobs: Job[]): number {
  const hours = job.hoursWorked ?? 0;
  if (!hours) return 0;
  const rate = job.hourlyRate ?? 0;
  const dayMult = getDayMultiplier(job.date, job.client, allJobs, job.has6th7thDayRule ?? false);
  const { totalPay } = calculateDayPay(hours, rate, job.minimumHours ?? 0, job.mealPenalties ?? 0, dayMult, job.mealType);
  return totalPay + (job.hasVacationPay ? totalPay * 0.08 : 0);
}

function escapeCell(val: string | number | undefined | null): string {
  const s = val == null ? '' : String(val);
  // Wrap in quotes if it contains a comma, quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(rows: Record<string, string | number | undefined | null>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map(row => headers.map(h => escapeCell(row[h])).join(',')),
  ];
  return lines.join('\r\n');
}

function downloadCSV(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportWeeklyToExcel(jobs: Job[], expenses: Expense[], income: Income[]) {
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
      'Gross Earnings': j.hoursWorked ? jobGross(j, jobs).toFixed(2) : '',
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

  const csv = toCSV(allRows);
  const fileName = `AV-Ledger-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  downloadCSV(csv, fileName);
}
