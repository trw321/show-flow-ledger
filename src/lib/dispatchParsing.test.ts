import { describe, it, expect } from 'vitest';
import { splitJobRecords, expandCBRecord } from './dispatchParsing';

// Every case here is a real dispatch paste that broke expandCBRecord at some
// point (verbatim, tabs and all) — the point of this file isn't "test the
// feature," it's "make sure a future fix to this regex never quietly
// resurrects a bug we already found and fixed." Add to this list the next
// time a real paste breaks something; don't just patch the regex and move on.

function expandRaw(raw: string): string[] {
  const records = splitJobRecords(raw);
  return records.flatMap(expandCBRecord);
}

describe('expandCBRecord — regression cases from real dispatch pastes', () => {
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
