import { describe, it, expect } from 'vitest';
import { splitJobRecords, expandCBRecord, isDispatchText, missingOffers } from './dispatchParsing';
import { IGNITE, TWO_OFFERS, VALKYRIES } from './dispatchParsing.fixtures';

// Every case here is a real dispatch paste that broke expandCBRecord at some
// point (verbatim, tabs and all) — the point of this file isn't "test the
// feature," it's "make sure a future fix to this regex never quietly
// resurrects a bug we already found and fixed." Add to this list the next
// time a real paste breaks something; don't just patch the regex and move on.

function expandRaw(raw: string): string[] {
  const records = splitJobRecords(raw);
  return records.flatMap(expandCBRecord);
}

describe('where one offer ends and the next begins', () => {
  const firstLine = (r: string) => r.split('\n')[0].trim();

  it('splits two offers as they arrive', () => {
    expect(splitJobRecords(TWO_OFFERS).map(firstLine)).toEqual(['2026-3926', '2026-3943']);
  });

  it('splits them when the line break after the steward is lost', () => {
    const glued = ['2026-3926\t', '11/8/26 08:00 AM', '', `${IGNITE}\t2026-3943\t`, '11/4/26 07:00 AM', '', VALKYRIES].join('\n');
    const records = splitJobRecords(glued);
    expect(records.map(firstLine)).toEqual(['2026-3926', '2026-3943']);
    expect(records[0]).toContain('DAVID CARMINITO');
    expect(records[0]).not.toContain('VALKYRIES');
  });

  it('splits them when each offer is all on one line', () => {
    const oneLine = `2026-3926\t11/8/26 08:00 AM\t${IGNITE}\n2026-3943\t11/4/26 07:00 AM\t${VALKYRIES}`;
    const records = splitJobRecords(oneLine);
    expect(records.map(firstLine)).toEqual(['2026-3926', '2026-3943']);
    // And its callbacks still expand: 11/8, 11/9, 11/20, 11/21.
    expect(expandCBRecord(records[0])).toHaveLength(4);
  });

  it('splits them when it all runs together with spaces', () => {
    const flat = '2026-3926 11/8/26 08:00 AM MSFT IGNITE DAVID CARMINITO 2026-3943 11/4/26 07:00 AM VALKYRIES PARADE JOSHUA BOYNE';
    expect(splitJobRecords(flat).map(firstLine)).toEqual(['2026-3926', '2026-3943']);
  });

  it('never takes a contract for a job number', () => {
    expect(splitJobRecords(TWO_OFFERS)).toHaveLength(2);
    expect(splitJobRecords(`2026-3926\t\n11/8/26 08:00 AM\n\nNOTE\tSKILL\t2023-2028 BASIC BREAKOUT\t2025-2027 BASIC LTE`)).toHaveLength(1);
  });

  it('knows dispatch text from a sentence', () => {
    expect(isDispatchText(TWO_OFFERS)).toBe(true);
    expect(isDispatchText('notes 2026-3926 11/8/26 08:00 AM')).toBe(true);
    expect(isDispatchText('add to today the same odeum shift i logged on monday')).toBe(false);
    expect(isDispatchText('10/24 8am-5pm Hall, $52/hr')).toBe(false);
  });

  it('finds an offer the parser skipped', () => {
    const records = splitJobRecords(TWO_OFFERS);
    expect(missingOffers(records, [{ jobNumber: '2026-3926' }, { jobNumber: '2026-3943' }])).toEqual([]);
    expect(missingOffers(records, [{ jobNumber: '2026-3926' }]).map(firstLine)).toEqual(['2026-3943']);
  });
});

describe('expandCBRecord — regression cases from real dispatch pastes', () => {
  it('"CB 11/9, LOAD OUT 11/20 & 11/21" keeps the date behind the words', () => {
    // Bug: a part had to start with its date, so "LOAD OUT 11/20" was read as
    // a note and the 20th was lost. A two-day load out came through as one.
    const records = splitJobRecords(TWO_OFFERS).flatMap(expandCBRecord);
    const dates = records.map(r => r.match(/\d{1,2}\/\d{1,2}\/26/)![0]);
    expect(dates).toEqual(['11/8/26', '11/9/26', '11/20/26', '11/21/26', '11/4/26']);
    expect(records[1]).not.toContain('LOAD OUT');
    expect(records[2]).toContain('LOAD OUT');
    expect(records[3]).toContain('LOAD OUT');
    expect(records[3]).not.toContain('11/20');
  });

  it('reads the date when the words come first ("CB LOAD OUT 11/20 & 11/21")', () => {
    const raw = ['2026-0600\t', '11/8/26 08:00 AM', '', 'CB LOAD OUT 11/20 & 11/21\tT ELEC\tCLIENT\tCLIENT\tSite\tShow\tLoc\tNotes\tCONTRACT\t$50\tNWB\tSTEWARD'].join('\n');
    const dates = expandRaw(raw).map(r => r.match(/\d{1,2}\/\d{1,2}\/26/)![0]);
    expect(dates).toEqual(['11/8/26', '11/20/26', '11/21/26']);
  });

  it('"CB THRU 10/7 THEN LOAD OUT 10/17 & 10/18" reads those dates too', () => {
    const raw = ['2026-0601\t', '10/5/26 08:00 AM', '', 'CB THRU 10/7 THEN LOAD OUT 10/17 & 10/18\tT ELEC\tCLIENT\tCLIENT\tSite\tShow\tLoc\tNotes\tCONTRACT\t$50\tNWB\tSTEWARD'].join('\n');
    const dates = expandRaw(raw).map(r => r.match(/\d{1,2}\/\d{1,2}\/26/)![0]);
    expect(dates).toEqual(['10/5/26', '10/6/26', '10/7/26', '10/17/26', '10/18/26']);
  });

  it('"CB SAME DAY FOR LOAD OUT" stays one shift', () => {
    expect(expandCBRecord(splitJobRecords(TWO_OFFERS)[1])).toHaveLength(1);
  });

  it('"CB THRU 10/7 THEN 10/17 & 10/18" expands the "&"-joined date too, not just the first one', () => {
    // Bug: "&" wasn't treated as a date separator (only "," was), so
    // "10/17 & 10/18 FOR LOAD OUT" parsed as one chunk — matched 10/17 and
    // swallowed "& 10/18 FOR LOAD OUT" into its note instead of emitting a
    // separate entry for 10/18.
    const raw = [
      '2025-2952\t',
      '10/5/25 08:00 AM',
      '',
      '09:00 PM',
      'CB THRU 10/7 THEN 10/17 & 10/18 FOR LOAD OUT\tP VIDEO WALL EXTRA\tHUGHSTON ENGINEERING INC\tHUGHSTON ENGINEERING INC\tMOSCONE SOUTH HALL A-B-C\tDF 25 KEYNOTE\tENTER THRU PASEO FOR WRISTBAND / BACK OF HALL C\tBRING 2 FORMS OF ID FOR PAYROLL ONBOARDING / ALL CREW DARK ON 10/9\t2023-2028 BASIC ENTERTAINMENT\t$55.72\tWC\tREIN RATSEP',
    ].join('\n');

    const records = expandRaw(raw);
    // Parent (10/5) + THRU range (10/6, 10/7) + THEN dates (10/17, 10/18)
    expect(records).toHaveLength(5);
    expect(records.some(r => r.includes('10/17/25'))).toBe(true);
    expect(records.some(r => r.includes('10/18/25'))).toBe(true);
  });

  it('"CB FOR OUT" (no date, no time) does not fabricate a same-day duplicate shift', () => {
    // Bug: when the text after "CB" was neither a date nor a time — just
    // descriptive text about what the shift covers — the code still
    // created a second entry dated the same as the parent with no
    // start/end time, since it defaulted to the parent's own date.
    const raw = [
      '2026-0496\t',
      '2/21/26 08:00 AM',
      '',
      '05:00 PM',
      'SETUP: HANG, FOCUS CB FOR OUT\tT ELEC X\tMETRO MEDIA PRODUCTIONS INC\tUNION PAYROLL AGENCY INC\tMarriott - 4th & Mission\tPELOSI DINNER\tSALON 7-15\tBRING 2 FORMS OF ID OR PASSPORT\t2023-2028 BASIC ENTERTAINMENT\t$55.72\tNWB\tDAWN ROTH-GOLDEN',
    ].join('\n');

    const records = expandRaw(raw);
    expect(records).toHaveLength(1);
  });

  it('"NO/CB" (slash, no space) is recognized as a negation, same as "NO CB"', () => {
    // Bug: the negation guard only matched "NO CB" / "NO C/B" with a literal
    // space between the words, so "NO/CB" (slash) slipped past it and the
    // "CB" substring inside it was treated as a real callback notation.
    const raw = [
      '2026-0500\t',
      '3/1/26 09:00 AM',
      '',
      '06:00 PM',
      'ASSIST AS NEEDED. NO/CB\tT STAGEHAND\tSOME CLIENT INC\tSOME CLIENT INC\tSome Venue\tSome Show\tSome location\tSome notes\t2023-2028 BASIC ENTERTAINMENT\t$40.00\tYWA\tJOHN DOE',
    ].join('\n');

    const records = expandRaw(raw);
    expect(records).toHaveLength(1);
  });

  it('"NO CB" (with a space) still works — the original case this guard was written for', () => {
    const raw = [
      '2026-0501\t',
      '3/2/26 09:00 AM',
      '',
      '06:00 PM',
      'ASSIST AS NEEDED. NO CB\tT STAGEHAND\tSOME CLIENT INC\tSOME CLIENT INC\tSome Venue\tSome Show\tSome location\tSome notes\t2023-2028 BASIC ENTERTAINMENT\t$40.00\tYWA\tJOHN DOE',
    ].join('\n');

    const records = expandRaw(raw);
    expect(records).toHaveLength(1);
  });

  it('a genuine callback with a plain leading date still expands ("CB 3/18, 3/20")', () => {
    // Sanity check that fixing the "&"/negation bugs above didn't break the
    // ordinary comma-separated leading-date case.
    const raw = [
      '2026-0502\t',
      '4/1/26 08:00 AM',
      '',
      '05:00 PM',
      'CB 4/3, 4/5\tT STAGEHAND\tSOME CLIENT INC\tSOME CLIENT INC\tSome Venue\tSome Show\tSome location\tSome notes\t2023-2028 BASIC ENTERTAINMENT\t$40.00\tYWA\tJOHN DOE',
    ].join('\n');

    const records = expandRaw(raw);
    expect(records).toHaveLength(3);
    expect(records.some(r => r.includes('4/3/26'))).toBe(true);
    expect(records.some(r => r.includes('4/5/26'))).toBe(true);
  });

  it('a record with no callback language at all passes through unchanged', () => {
    const raw = [
      '2026-0503\t',
      '5/1/26 08:00 AM',
      '',
      '05:00 PM',
      'STANDARD CALL\tT STAGEHAND\tSOME CLIENT INC\tSOME CLIENT INC\tSome Venue\tSome Show\tSome location\tSome notes\t2023-2028 BASIC ENTERTAINMENT\t$40.00\tYWA\tJOHN DOE',
    ].join('\n');

    const records = expandRaw(raw);
    expect(records).toHaveLength(1);
  });
});
