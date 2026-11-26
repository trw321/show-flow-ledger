import { describe, it, expect } from 'vitest';
import { DEFAULT_EXCEL_PICKS, EMPLOYER_COLUMNS, WEEK_COLUMNS, readExcelPicks, shapeSheet, type ClaimRow } from './claimExcel';

const weeks: ClaimRow[] = [
  { 'Week ending': '2026-11-21', From: '2026-11-15', Through: '2026-11-21', 'Days worked': 2, Employer: 'FREEMAN', Hours: 9.5, Gross: 545.21, __employer: 'FREEMAN' },
  { 'Week ending': '2026-11-21', From: '2026-11-15', Through: '2026-11-21', 'Days worked': 2, Employer: 'ODEUM', Hours: 8, Gross: 320, __employer: 'ODEUM' },
  { 'Week ending': '2026-11-28', From: '2026-11-22', Through: '2026-11-28', 'Days worked': 0, Employer: 'No work', Hours: 0, Gross: 0 },
];

describe('the claim as Excel, cut to what you pick', () => {
  it('keeps every row and column when nothing is left out', () => {
    const rows = shapeSheet(weeks, WEEK_COLUMNS, [...WEEK_COLUMNS], []);
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0])).toEqual([...WEEK_COLUMNS]);
    expect(rows[0]).not.toHaveProperty('__employer');
  });

  it('keeps only the columns picked, in the usual order, whatever order they were picked in', () => {
    const rows = shapeSheet(weeks, WEEK_COLUMNS, ['Gross', 'Week ending'], []);
    expect(Object.keys(rows[0])).toEqual(['Week ending', 'Gross']);
  });

  it('leaves out an employer, and a "no work" week with it, which would no longer be true', () => {
    const rows = shapeSheet(weeks, WEEK_COLUMNS, [...WEEK_COLUMNS], ['ODEUM']);
    expect(rows.map(r => r.Employer)).toEqual(['FREEMAN']);
  });

  it('gives an empty sheet when no column is picked', () => {
    expect(shapeSheet(weeks, WEEK_COLUMNS, [], [])).toEqual([]);
  });

  it('fills a column a row lacks with a blank, not "undefined"', () => {
    const rows = shapeSheet([{ Employer: 'X', __employer: 'X' }], EMPLOYER_COLUMNS, ['Employer', 'Phone'], []);
    expect(rows[0]).toEqual({ Employer: 'X', Phone: '' });
  });

  it('reads saved picks safely: bad or old values fall back to everything', () => {
    expect(readExcelPicks(null)).toEqual(DEFAULT_EXCEL_PICKS);
    expect(readExcelPicks('not json')).toEqual(DEFAULT_EXCEL_PICKS);
    expect(readExcelPicks('"Nov 5"')).toEqual(DEFAULT_EXCEL_PICKS);
    const odd = readExcelPicks(JSON.stringify({ sheets: ['weeks', 'nonsense'], weekColumns: ['Gross', 7], employerColumns: 'all', leaveOut: ['ODEUM', null] }));
    expect(odd).toEqual({ sheets: ['weeks'], weekColumns: ['Gross'], employerColumns: [...EMPLOYER_COLUMNS], leaveOut: ['ODEUM'] });
  });
});

describe('leaving an employer out', () => {
  it('ignores capitals and spaces, so a stub typed another way goes too', () => {
    const rows = shapeSheet([{ Employer: 'Odeum ', __employer: 'Odeum ' }, { Employer: 'GSW', __employer: 'GSW' }], ['Employer'], ['Employer'], ['odeum']);
    expect(rows).toEqual([{ Employer: 'GSW' }]);
  });
});
