import { describe, expect, it } from 'vitest';
import { spreadsheetDate, spreadsheetRowsToJobs, suggestSpreadsheetMapping } from './spreadsheetJobs';

describe('spreadsheet calendar import', () => {
  it('suggests columns from common headings', () => {
    expect(suggestSpreadsheetMapping(['Work Date', 'Employer', 'Show', 'Start Time', 'Hours Worked'])).toMatchObject({
      date: 0,
      client: 1,
      name: 2,
      startTime: 3,
      hoursWorked: 4,
    });
  });

  it('reads ISO, US, and Excel serial dates', () => {
    expect(spreadsheetDate('2026-11-09')).toBe('2026-11-09');
    expect(spreadsheetDate('11/9/26')).toBe('2026-11-09');
    expect(spreadsheetDate(46_965)).toBe('2028-07-31');
  });

  it("maps one person's rows into calendar jobs and skips blank dates", () => {
    const jobs = spreadsheetRowsToJobs([
      ['2026-11-09', 'Local Crew Co', 'Load in', 'Hall A', 0.333333, 0.5, 8, '$42.50', 'notes'],
      ['', 'Local Crew Co', 'No date', 'Hall A', '', '', 4, 40, 'skip'],
    ], {
      date: 0, client: 1, name: 2, venue: 3, startTime: 4, endTime: 5,
      hoursWorked: 6, hourlyRate: 7, notes: 8,
    }, {}, '2026-11-12');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      date: '2026-11-09',
      client: 'Local Crew Co',
      name: 'Load in',
      startTime: '08:00 AM',
      endTime: '12:00 PM',
      hoursWorked: 8,
      hourlyRate: 42.5,
      status: 'completed',
    });
  });

  it('uses the supplied individual/employer defaults when those columns are absent', () => {
    const jobs = spreadsheetRowsToJobs([['2026-11-12', 6]], { date: 0, hoursWorked: 1 }, { client: 'My Employer' }, '2026-11-12');
    expect(jobs[0]).toMatchObject({ client: 'My Employer', name: 'My Employer', hoursWorked: 6, status: 'upcoming' });
  });
});