import type { ParsedJob } from './dispatchParsing';

export const SPREADSHEET_FIELDS = [
  { key: 'date', label: 'Work date', required: true, aliases: ['date', 'work date', 'shift date'] },
  { key: 'client', label: 'Employer', required: false, aliases: ['employer', 'client', 'company', 'payer'] },
  { key: 'name', label: 'Event / job', required: false, aliases: ['event', 'job', 'project', 'show'] },
  { key: 'venue', label: 'Venue', required: false, aliases: ['venue', 'location', 'site'] },
  { key: 'startTime', label: 'Start time', required: false, aliases: ['start', 'start time', 'call time', 'in'] },
  { key: 'endTime', label: 'End time', required: false, aliases: ['end', 'end time', 'wrap', 'out'] },
  { key: 'hoursWorked', label: 'Hours worked', required: false, aliases: ['hours', 'hours worked', 'total hours'] },
  { key: 'hourlyRate', label: 'Hourly rate', required: false, aliases: ['rate', 'hourly rate', 'pay rate'] },
  { key: 'jobNumber', label: 'Job number', required: false, aliases: ['job number', 'job #', 'dispatch', 'reference'] },
  { key: 'notes', label: 'Notes', required: false, aliases: ['notes', 'description', 'details'] },
] as const;

export type SpreadsheetJobField = typeof SPREADSHEET_FIELDS[number]['key'];
export type SpreadsheetMapping = Partial<Record<SpreadsheetJobField, number>>;
export type SpreadsheetRow = unknown[];

const cleanHeader = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

export function suggestSpreadsheetMapping(headers: unknown[]): SpreadsheetMapping {
  const mapping: SpreadsheetMapping = {};
  for (const field of SPREADSHEET_FIELDS) {
    const aliases: readonly string[] = field.aliases;
    const index = headers.findIndex(header => aliases.includes(cleanHeader(header)));
    if (index >= 0) mapping[field.key] = index;
  }
  return mapping;
}

function cellAt(row: SpreadsheetRow, mapping: SpreadsheetMapping, field: SpreadsheetJobField): unknown {
  const index = mapping[field];
  return index === undefined ? undefined : row[index];
}

export function spreadsheetDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const mdy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdy) {
    const year = Number(mdy[3]) < 100 ? 2000 + Number(mdy[3]) : Number(mdy[3]);
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return undefined;
}

function cellText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').replace(/[$,\s]/g, '');
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

function timeText(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hours = value.getUTCHours();
    const minutes = value.getUTCMinutes();
    return formatTime(hours * 60 + minutes);
  }
  if (typeof value === 'number' && value >= 0 && value < 1) return formatTime(Math.round(value * 1440));
  return cellText(value);
}

function formatTime(totalMinutes: number): string {
  const minutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

export function spreadsheetRowsToJobs(
  rows: SpreadsheetRow[],
  mapping: SpreadsheetMapping,
  defaults: { client?: string; name?: string; venue?: string } = {},
  today = new Date().toISOString().slice(0, 10),
): ParsedJob[] {
  return rows.flatMap(row => {
    const date = spreadsheetDate(cellAt(row, mapping, 'date'));
    if (!date) return [];
    const client = cellText(cellAt(row, mapping, 'client')) ?? defaults.client?.trim();
    if (!client) return [];
    const name = cellText(cellAt(row, mapping, 'name')) ?? defaults.name?.trim() ?? client;
    const venue = cellText(cellAt(row, mapping, 'venue')) ?? defaults.venue?.trim() ?? '';
    const rate = numericValue(cellAt(row, mapping, 'hourlyRate'));
    const hours = numericValue(cellAt(row, mapping, 'hoursWorked'));
    return [{
      jobNumber: cellText(cellAt(row, mapping, 'jobNumber')),
      date,
      client,
      name,
      venue,
      startTime: timeText(cellAt(row, mapping, 'startTime')),
      endTime: timeText(cellAt(row, mapping, 'endTime')),
      hoursWorked: hours,
      hourlyRate: rate,
      notes: cellText(cellAt(row, mapping, 'notes')),
      status: date < today ? 'completed' : 'upcoming',
    }];
  });
}