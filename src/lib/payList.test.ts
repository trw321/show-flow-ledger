import { describe, it, expect } from 'vitest';
import { payListWeeks, readPayList } from './payList';

const TODAY = '2026-11-24';

// As it came out of Gusto, links, tabs and all.
const GUSTO = [
  '[Jun 3, 2026](https://app.gusto.com/payroll_items/12e0c187-1763-47d9-87eb-aff3a888cf59/paystub.html?x_role_id=7757869474916281)\t$595.00',
  '[May 26, 2026](https://app.gusto.com/payroll_items/6eebfa32-153e-4771-b6a8-685b44e71eb3/paystub.html?x_role_id=7757869474916281)\t$280.00',
  '[May 20, 2026](https://app.gusto.com/payroll_items/00f78535-f1ed-4da6-aa3f-cbf08f396845/paystub.html?x_role_id=7757869474916281)\t$1,400.00\t',
  '[May 8, 2026](https://app.gusto.com/payroll_items/cd4300b2-c309-4bb8-9392-9644c28fa2bf/paystub.html?x_role_id=7757869474916281)\t$350.00\t\t',
  '[Jan 6, 2026](https://app.gusto.com/payroll_items/88a0f8ad-e586-4036-95b1-16ebf715b66b/paystub.html?x_role_id=7757869474916281)\t\t$122.50',
  '[Dec 23, 2025](https://app.gusto.com/payroll_items/e42c487f-0b9e-4349-8669-3d7585a322ef/paystub.html?x_role_id=7757869474916281)\t$227.50\t',
  '[Nov 25, 2025](https://app.gusto.com/payroll_items/06968ccb-50b8-4ae1-ac8b-4ab07d17110c/paystub.html?x_role_id=7757869474916281)\t$560.00\t',
  '[Nov 18, 2025](https://app.gusto.com/payroll_items/79da01fe-fd1f-4ce7-b8a0-1c7743e9938b/paystub.html?x_role_id=7757869474916281)\t$280.00\t',
  '[Oct 7, 2025](https://app.gusto.com/payroll_items/fc9fd0e1-ea8b-4e39-b99e-9f6a4b7b724f/paystub.html?x_role_id=7757869474916281)\t  $175.00',
].join('\n');

describe('a pasted pay list', () => {
  it('reads every line of a Gusto list, and nothing from the links', () => {
    const { rows, skipped } = readPayList(GUSTO, TODAY);
    expect(skipped).toEqual([]);
    expect(rows.map(r => `${r.date} ${r.amount}`)).toEqual([
      '2026-06-03 595', '2026-05-26 280', '2026-05-20 1400', '2026-05-08 350', '2026-01-06 122.5',
      '2025-12-23 227.5', '2025-11-25 560', '2025-11-18 280', '2025-10-07 175',
    ]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(3990);
    expect(rows[0].line).toBe('Jun 3, 2026 $595.00');
  });

  it('says when an amount is in a different column from the rest', () => {
    const { rows } = readPayList(GUSTO, TODAY);
    expect(rows.filter(r => r.offColumn).map(r => r.date)).toEqual(['2026-01-06']);
  });

  it('reads the other ways dates and money get written', () => {
    const { rows } = readPayList([
      '6/3/2026  595.00', '2026-06-10, $1,400', '3 Jun 2026 - $12.5', '06/17/26 $80.00', 'June 24th, 2026 Net $300.00 Gross $400.00',
    ].join('\n'), TODAY);
    expect(rows.map(r => `${r.date} ${r.amount}`)).toEqual([
      '2026-06-03 595', '2026-06-10 1400', '2026-06-03 12.5', '2026-06-17 80', '2026-06-24 300',
    ]);
    // Only the first amount counts; the rest are shown.
    expect(rows[4].others).toEqual([400]);
  });

  it('takes the most recent year that has happened when none is written', () => {
    const { rows } = readPayList('Nov 5 $100.00\nDec 20 $50.00', TODAY);
    expect(rows.map(r => r.date)).toEqual(['2026-11-05', '2025-12-20']);
    expect(rows.every(r => r.yearAssumed)).toBe(true);
  });

  it('keeps the lines it cannot read, to show them', () => {
    const { rows, skipped } = readPayList('Pay date\tAmount\nFeb 30, 2026 $10.00\nJun 3, 2026\n\n   \nJun 4, 2026 $20.00', TODAY);
    expect(rows.map(r => r.date)).toEqual(['2026-06-04']);
    expect(skipped).toEqual(['Pay date\tAmount', 'Feb 30, 2026 $10.00', 'Jun 3, 2026']);
  });

  it('marks a line pasted twice', () => {
    const { rows } = readPayList('Jun 3, 2026 $595.00\nJun 3, 2026 $595.00\nJun 3, 2026 $100.00', TODAY);
    expect(rows.map(r => !!r.repeat)).toEqual([false, true, false]);
  });
});

describe('a pay list week by week', () => {
  const { rows } = readPayList(GUSTO, TODAY);

  it('adds up each week, Sunday to Saturday, oldest first', () => {
    const weeks = payListWeeks(rows, 6);
    expect(weeks.map(w => `${w.start}..${w.weekEnding} ${w.total}`)).toEqual([
      '2025-10-05..2025-10-11 175', '2025-11-16..2025-11-22 280', '2025-11-23..2025-11-29 560', '2025-12-21..2025-12-27 227.5',
      '2026-01-04..2026-01-10 122.5', '2026-05-03..2026-05-09 350', '2026-05-17..2026-05-23 1400', '2026-05-24..2026-05-30 280',
      '2026-05-31..2026-06-06 595',
    ]);
  });

  it('puts each in the week before, for a payroll that pays a week behind', () => {
    const weeks = payListWeeks(rows.slice(0, 1), 6, true);
    expect(weeks[0]).toMatchObject({ start: '2026-05-24', weekEnding: '2026-05-30', total: 595, dates: ['2026-06-03'] });
  });

  it('puts two paydays in one week together', () => {
    const weeks = payListWeeks([{ date: '2026-06-01', amount: 100 }, { date: '2026-06-03', amount: 50.25 }], 6);
    expect(weeks).toEqual([{ start: '2026-05-31', weekEnding: '2026-06-06', total: 150.25, dates: ['2026-06-01', '2026-06-03'] }]);
  });
});
