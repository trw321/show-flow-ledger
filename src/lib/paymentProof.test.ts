import { describe, it, expect } from 'vitest';
import { isDocumented, photoAgrees, photoForOlderPayment, proofFromMatch, proofKindOf } from './paymentProof';
import type { Income, Job } from './store';

const pay = (over: Partial<Income> = {}): Income => ({ id: 'i', client: 'Odeum', description: '', amount: 684, date: '2026-11-07', status: 'paid', createdAt: 'x', ...over });
const shift = (id: string, over: Partial<Job> = {}): Job => ({ id, name: 'Gala', client: 'Odeum', venue: '', date: '2026-11-01', status: 'completed', notes: '', has6th7thDayRule: false, createdAt: 'x', ...over } as Job);

describe('how a payment came in', () => {
  it('goes by what was saved first', () => {
    expect(proofKindOf(pay({ description: 'Marked paid', matchProof: { kind: 'check', at: 'x' } }))).toBe('check');
  });

  it('reads older payments from their description', () => {
    expect(proofKindOf(pay({ description: 'Pay stub' }))).toBe('stub');
    expect(proofKindOf(pay({ description: 'Earnings Statement for 09/25/2026' }))).toBe('stub');
    expect(proofKindOf(pay({ description: 'Check' }))).toBe('check');
    expect(proofKindOf(pay({ description: 'Payment via check' }))).toBe('check');
    expect(proofKindOf(pay({ description: 'Early direct deposit' }))).toBe('deposit');
    expect(proofKindOf(pay({ description: 'Invoice INV-004' }))).toBe('invoice');
    expect(proofKindOf(pay({ description: 'Marked paid' }))).toBe('marked');
    expect(proofKindOf(pay({ description: 'Payment — Full project' }))).toBe('marked');
    expect(proofKindOf(pay({ description: 'Added by hand', enteredByHand: true }))).toBe('manual');
  });

  it('tells a document from your own word', () => {
    expect(isDocumented('stub')).toBe(true);
    expect(isDocumented('deposit')).toBe(true);
    expect(isDocumented('marked')).toBe(false);
    expect(isDocumented('manual')).toBe(false);
  });
});

describe('the match, kept', () => {
  it('keeps the score and every reason', () => {
    const p = proofFromMatch('stub', { percent: 92, level: 'high', expected: 690, reasons: [{ text: 'Paid by Odeum', good: true }, { text: 'Late', good: false }] }, { amount: 684 });
    expect(p).toMatchObject({ kind: 'stub', percent: 92, level: 'high', reasons: [{ text: 'Paid by Odeum', good: true }, { text: 'Late', good: false }], read: { amount: 684 } });
    expect(p.at).toBeTruthy();
  });

  it('keeps just the kind when there was nothing to score', () => {
    expect(proofFromMatch('marked')).not.toHaveProperty('percent');
  });
});

describe('a photo for a payment from before proof was kept', () => {
  const project = [
    shift('a', { payStub: 'storage:u/a.jpg', stubParsed: { netPay: 684 } as Job['stubParsed'] }),
    shift('b', { payStub: 'storage:u/b.jpg', stubParsed: { netPay: 700 } as Job['stubParsed'] }),
    shift('c'),
  ];

  it('is one whose amount is the same to the cent', () => {
    expect(photoForOlderPayment(pay(), project)?.id).toBe('a');
  });

  it('is nothing when no amount agrees, or two do', () => {
    expect(photoForOlderPayment(pay({ amount: 690 }), project)).toBeUndefined();
    const twice = [...project, shift('d', { payStub: 'storage:u/d.jpg', stubParsed: { netPay: 684 } as Job['stubParsed'] })];
    expect(photoForOlderPayment(pay(), twice)).toBeUndefined();
  });

  it('is never needed when the payment has its own', () => {
    expect(photoForOlderPayment(pay({ proofRef: 'storage:u/proof.jpg' }), project)).toBeUndefined();
  });
});

describe('the photo against the payment', () => {
  it('says whether the amounts agree', () => {
    expect(photoAgrees(pay({ matchProof: { kind: 'stub', at: 'x', read: { amount: 684 } } }))).toBe(true);
    expect(photoAgrees(pay({ matchProof: { kind: 'stub', at: 'x', read: { amount: 648 } } }))).toBe(false);
    expect(photoAgrees(pay())).toBeUndefined();
  });
});
