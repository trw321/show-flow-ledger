import * as XLSX from 'xlsx';
import { parseISO, startOfWeek, endOfWeek, format } from 'date-fns';
import type { Job, Expense, Income } from './store';
import { calculateDayPay, getDayMultiplier } from './payCalc';

// ── helpers ──────────────────────────────────────────────────────────────────

function weekKey(dateStr: string): string {
  const d = parseISO(dateStr);
  return format(startOfWeek(d, { weekStartsOn: 0 }), 'yyyy-MM-dd');
}

function weekLabel(startStr: string): string {
  const start = parseISO(startStr);
  const end = endOfWeek(start, { weekStartsOn: 0 });
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
}

/** Compute expected gross pay for a single job (if it has hours worked). */
function jobGross(job: Job, allJobs: Job[]): number {
  const hours = job.hoursWorked ?? 0;
  if (!hours) return 0;
  const rate = job.hourlyRate ?? 0;
  const dayMult = getDayMultiplier(job.date, job.client, allJobs, job.has6th7thDayRule ?? false);
  const { totalPay } = calculateDayPay(
    hours,
    rate,
    job.minimumHours ?? 0,
    job.mealPenalties ?? 0,
    dayMult,
    job.mealType,
  );
  const vacationBonus = job.hasVacationPay ? totalPay * 0.08 : 0;
  return totalPay + vacationBonus;
}

// ── sheet builders ────────────────────────────────────────────────────────────

interface WeekRow {
  Week: string;
  'Week Start': string;
  'Week End': string;
  Jobs: number;
  'Hours Worked': number;
  'Gross Earnings': number;
  'Expenses': number;
  'Net': number;
}

function buildWeeklySummary(jobs: Job[], expenses: Expense[]): WeekRow[] {
  const weeks = new Map<string, WeekRow>();

  // Collect all weeks that have jobs
  for (const job of jobs) {
    if (!job.date) continue;
    const key = weekKey(job.date);
    if (!weeks.has(key)) {
      const start = parseISO(key);
      const end = endOfWeek(start, { weekStartsOn: 0 });
      weeks.set(key, {
        Week: weekLabel(key),
        'Week Start': format(start, 'yyyy-MM-dd'),
        'Week End': format(end, 'yyyy-MM-dd'),
        Jobs: 0,
        'Hours Worked': 0,
        'Gross Earnings': 0,
        Expenses: 0,
        Net: 0,
      });
    }
    const row = weeks.get(key)!;
    row.Jobs += 1;
    row['Hours Worked'] = parseFloat((row['Hours Worked'] + (job.hoursWorked ?? 0)).toFixed(2));
    row['Gross Earnings'] = parseFloat((row['Gross Earnings'] + jobGross(job, jobs)).toFixed(2));
  }

  // Add weekly expense totals
  for (const exp of expenses) {
    if (!exp.date) continue;
    const key = weekKey(exp.date);
    if (!weeks.has(key)) {
      const start = parseISO(key);
      const end = endOfWeek(start, { weekStartsOn: 0 });
      weeks.set(key, {
        Week: weekLabel(key),
        'Week Start': format(start, 'yyyy-MM-dd'),
        'Week End': format(end, 'yyyy-MM-dd'),
        Jobs: 0,
        'Hours Worked': 0,
        'Gross Earnings': 0,
        Expenses: 0,
        Net: 0,
      });
    }
    const row = weeks.get(key)!;
    row.Expenses = parseFloat((row.Expenses + exp.amount).toFixed(2));
  }

  // Calculate Net
  for (const row of weeks.values()) {
    row.Net = parseFloat((row['Gross Earnings'] - row.Expenses).toFixed(2));
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row);
}

function buildJobsSheet(jobs: Job[], allJobs: Job[]) {
  return [...jobs]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(j => ({
      Date: j.date,
      'Job #': j.jobNumber ?? '',
      'Job Name': j.name,
      Client: j.client,
      Venue: j.venue ?? '',
      Status: j.status,
      'Start Time': j.startTime ?? '',
      'End Time': j.endTime ?? '',
      'Hours Worked': j.hoursWorked ?? 0,
      'Hourly Rate': j.hourlyRate ?? 0,
      'Minimum Hours': j.minimumHours ?? 0,
      'Meal Type': j.mealType ?? '',
      'Meal Penalties': j.mealPenalties ?? 0,
      '6th/7th Day Rule': j.has6th7thDayRule ? 'Yes' : 'No',
      'Vacation Pay (8%)': j.hasVacationPay ? 'Yes' : 'No',
      Steward: j.steward ?? '',
      'Gross Earnings': jobGross(j, allJobs),
      'Pay Schedule': j.paySchedule ?? '',
      'Payroll Company': j.payrollCompany ?? '',
      Notes: j.notes ?? '',
    }));
}

function buildExpensesSheet(expenses: Expense[]) {
  return [...expenses]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({
      Date: e.date,
      Category: e.category,
      Description: e.description,
      Amount: e.amount,
    }));
}

function buildIncomeSheet(income: Income[]) {
  return [...income]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(i => ({
      Date: i.date,
      Client: i.client,
      Description: i.description,
      Amount: i.amount,
      Status: i.status,
      'Invoice #': i.invoiceNumber ?? '',
    }));
}

// ── number formatting helper ──────────────────────────────────────────────────

function applyDollarFormat(ws: XLSX.WorkSheet, sheet: object[], dollarCols: string[]) {
  if (!sheet.length) return;
  const headers = Object.keys(sheet[0]);
  for (const col of dollarCols) {
    const colIndex = headers.indexOf(col);
    if (colIndex < 0) continue;
    const colLetter = XLSX.utils.encode_col(colIndex);
    for (let r = 1; r <= sheet.length; r++) {
      const cellAddr = `${colLetter}${r + 1}`; // +1 for header row
      const cell = ws[cellAddr];
      if (cell && cell.t === 'n') {
        cell.z = '"$"#,##0.00';
      }
    }
  }
}

// ── main export ───────────────────────────────────────────────────────────────

export function exportWeeklyToExcel(jobs: Job[], expenses: Expense[], income: Income[]) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Weekly Summary
  const summaryRows = buildWeeklySummary(jobs, expenses);
  const ws1 = XLSX.utils.json_to_sheet(summaryRows);
  applyDollarFormat(ws1, summaryRows, ['Gross Earnings', 'Expenses', 'Net']);
  ws1['!cols'] = [
    { wch: 24 }, // Week
    { wch: 12 }, // Week Start
    { wch: 12 }, // Week End
    { wch: 6 },  // Jobs
    { wch: 14 }, // Hours Worked
    { wch: 16 }, // Gross Earnings
    { wch: 12 }, // Expenses
    { wch: 12 }, // Net
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Weekly Summary');

  // Sheet 2: Jobs Detail
  const jobRows = buildJobsSheet(jobs, jobs);
  const ws2 = XLSX.utils.json_to_sheet(jobRows);
  applyDollarFormat(ws2, jobRows, ['Hourly Rate', 'Gross Earnings']);
  ws2['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 20 }, { wch: 20 },
    { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 13 }, { wch: 12 },
    { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 15 }, { wch: 16 },
    { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Jobs');

  // Sheet 3: Expenses
  const expRows = buildExpensesSheet(expenses);
  const ws3 = XLSX.utils.json_to_sheet(expRows);
  applyDollarFormat(ws3, expRows, ['Amount']);
  ws3['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 30 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Expenses');

  // Sheet 4: Income
  const incRows = buildIncomeSheet(income);
  const ws4 = XLSX.utils.json_to_sheet(incRows);
  applyDollarFormat(ws4, incRows, ['Amount']);
  ws4['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'Income');

  // Trigger download
  const fileName = `AV-Ledger-Weekly-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
