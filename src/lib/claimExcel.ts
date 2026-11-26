/**
 * The unemployment claim as a spreadsheet, cut to what you pick: which sheets,
 * which columns on each, and which employers. The page builds every row with
 * every column (see UnemploymentPage's download); this keeps what's picked,
 * in the usual column order.
 */

export type ClaimSheet = 'weeks' | 'employers' | 'stubs';

export const CLAIM_SHEETS: { id: ClaimSheet; label: string }[] = [
  { id: 'weeks', label: 'Weeks' },
  { id: 'employers', label: 'Employers' },
  { id: 'stubs', label: 'Pay stubs' },
];

export const WEEK_COLUMNS = ['Week ending', 'From', 'Through', 'Days worked', 'Employer', 'Hours', 'Gross'] as const;
export const EMPLOYER_COLUMNS = [
  'Employer', 'On the calendar as', 'Address', 'Phone', 'Note', 'Worked for longest', 'Paid by',
  'First day', 'Last day', 'How long', 'Days worked', 'Hours', 'Gross', 'From pay stubs',
] as const;
export const STUB_COLUMNS = ['Employer', 'From', 'Through', 'Hours', 'Gross', 'Counted'] as const;

export interface ClaimExcelPicks {
  sheets: ClaimSheet[];
  weekColumns: string[];
  employerColumns: string[];
  /** Employers left out, by name. Empty: every one. */
  leaveOut: string[];
}

export const DEFAULT_EXCEL_PICKS: ClaimExcelPicks = {
  sheets: ['weeks', 'employers', 'stubs'],
  weekColumns: [...WEEK_COLUMNS],
  employerColumns: [...EMPLOYER_COLUMNS],
  leaveOut: [],
};

const strings = (value: unknown, allowed: readonly string[], fallback: string[]): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && allowed.includes(v)) : fallback;

/** Picks saved on this phone, made safe: anything unknown or mangled falls back to everything. */
export function readExcelPicks(raw: string | null): ClaimExcelPicks {
  try {
    const saved = JSON.parse(raw ?? 'null');
    if (!saved || typeof saved !== 'object') return DEFAULT_EXCEL_PICKS;
    return {
      sheets: strings(saved.sheets, CLAIM_SHEETS.map(s => s.id), DEFAULT_EXCEL_PICKS.sheets) as ClaimSheet[],
      weekColumns: strings(saved.weekColumns, WEEK_COLUMNS, DEFAULT_EXCEL_PICKS.weekColumns),
      employerColumns: strings(saved.employerColumns, EMPLOYER_COLUMNS, DEFAULT_EXCEL_PICKS.employerColumns),
      leaveOut: Array.isArray(saved.leaveOut) ? saved.leaveOut.filter((v: unknown): v is string => typeof v === 'string') : [],
    };
  } catch {
    return DEFAULT_EXCEL_PICKS;
  }
}

/** A row as the page builds it: every column, and the employer it's about (none for a week with no work). */
export type ClaimRow = Record<string, string | number> & { __employer?: string };

/**
 * One sheet's rows, cut to the picks: only employers not left out, only the
 * columns picked, in the order given. A row about no employer (a week with no
 * work) stays only while every employer is in, since leaving some out would
 * make it say "no work" where there was work.
 */
export function shapeSheet(rows: ClaimRow[], order: readonly string[], picked: string[], leaveOut: string[]): Record<string, string | number>[] {
  const columns = order.filter(c => picked.includes(c));
  if (columns.length === 0) return [];
  // A stub typed "Odeum" is the same employer as the calendar's "odeum".
  const key = (name: string) => name.trim().toLowerCase();
  const out = new Set(leaveOut.map(key));
  return rows
    .filter(r => (r.__employer === undefined ? out.size === 0 : !out.has(key(r.__employer))))
    .map(r => Object.fromEntries(columns.map(c => [c, r[c] ?? ''])));
}
