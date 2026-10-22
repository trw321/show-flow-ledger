import { describe, it, expect } from 'vitest';
import { alreadyRecorded, repeatsInUpload } from './paymentRepeats';
import type { Income } from './store';

describe('one paycheck read twice', () => {
  it('flags a stub and its check as the same payment', () => {
    // The stub's pay date and the check's date, a couple of days apart.
    const read = [
      { amount: 612.4, date: '2026-10-16', client: 'Blackpoint Productions' },
      { amount: 612.4, date: '2026-10-17', client: 'Blackpoint Productions' },
    ];
    expect(repeatsInUpload(read)).toEqual([undefined, 0]);
  });

  it('leaves different amounts alone', () => {
    expect(repeatsInUpload([
      { amount: 612.4, date: '2026-10-16' },
      { amount: 540, date: '2026-10-16' },
    ])).toEqual([undefined, undefined]);
  });

  it('leaves the same amount weeks apart alone — two real paychecks', () => {
    expect(repeatsInUpload([
      { amount: 500, date: '2026-10-01' },
      { amount: 500, date: '2026-10-15' },
    ])).toEqual([undefined, undefined]);
  });
});

describe('a payment already in the ledger', () => {
  const income: Income[] = [
    { id: 'i1', client: 'Blackpoint Productions', description: 'Pay stub', amount: 612.4, date: '2026-10-16', status: 'paid', createdAt: 'x' },
  ];

  it('is found when the same stub is uploaded again', () => {
    expect(alreadyRecorded({ amount: 612.4, date: '2026-10-17', client: 'Blackpoint' }, income)?.id).toBe('i1');
  });

  it('is not confused with a different payer of the same amount', () => {
    expect(alreadyRecorded({ amount: 612.4, date: '2026-10-17', client: 'Odeum Events' }, income)).toBeUndefined();
  });

  it('is not confused with the same amount months later', () => {
    expect(alreadyRecorded({ amount: 612.4, date: '2026-12-17', client: 'Blackpoint' }, income)).toBeUndefined();
  });
});
