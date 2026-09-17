import { describe, it, expect } from 'vitest';
import { learnFromStubs, dismissSuggestion, consumeSkip } from './stubLearning';
import type { Job, Employer } from './store';

const employer = (over: Partial<Employer> = {}): Employer => ({
  id: 'e1',
  name: 'GSW Arena LLC',
  overtimeRule: 'daily',
  createdAt: '2026-01-01',
  ...over,
});

// gross 1000, dues 3.5% = 35, tax 22% of 965 = 212.30, vacation 6% of 752.70 = 45.16
const stubJob = (id: string, over: Partial<NonNullable<Job['stubParsed']>> = {}): Job => ({
  id,
  name: 'Show',
  client: 'GSW Arena LLC',
  venue: 'V',
  date: '2026-09-10',
  status: 'completed',
  notes: '',
  createdAt: '2026-01-01',
  stubParsed: { employer: 'GSW Arena LLC', grossPay: 1000, duesAmount: 35, taxAmount: 212.30, vacationAmount: 45.16, ...over },
});

describe('learnFromStubs', () => {
  it('derives the rates a stub actually used', () => {
    const s = learnFromStubs([stubJob('a')], [employer()]);
    const dues = s.find(x => x.field === 'unionDuesPercent')!;
    const tax = s.find(x => x.field === 'estimatedTaxPercent')!;
    const vac = s.find(x => x.field === 'vacationPercent')!;
    expect(dues.suggested).toBe(3.5);
    expect(tax.suggested).toBe(22);   // charged after dues, matching the pay engine
    expect(vac.suggested).toBe(6);
  });

  it('stays quiet when the profile already agrees', () => {
    const e = employer({ unionDuesPercent: 3.5, estimatedTaxPercent: 22, vacationPercent: 6 });
    expect(learnFromStubs([stubJob('a')], [e])).toEqual([]);
  });

  it('treats one stub as a flag and two as a strong signal', () => {
    const e = employer({ unionDuesPercent: 2 });
    const one = learnFromStubs([stubJob('a')], [e]).find(s => s.field === 'unionDuesPercent')!;
    expect(one.strength).toBe('flag');
    expect(one.sampleCount).toBe(1);

    const two = learnFromStubs([stubJob('a'), stubJob('b')], [e]).find(s => s.field === 'unionDuesPercent')!;
    expect(two.strength).toBe('strong');
    expect(two.sampleCount).toBe(2);
  });

  it('ignores rounding-level disagreement', () => {
    const e = employer({ unionDuesPercent: 3.6 });
    expect(learnFromStubs([stubJob('a')], [e]).some(s => s.field === 'unionDuesPercent')).toBe(false);
  });

  it('suggests a rate that was never configured', () => {
    const s = learnFromStubs([stubJob('a')], [employer()]).find(x => x.field === 'unionDuesPercent')!;
    expect(s.current).toBeUndefined();
    expect(s.suggested).toBe(3.5);
  });

  it('uses the median so one odd stub does not drag the rate', () => {
    const jobs = [
      stubJob('a', { duesAmount: 35 }),
      stubJob('b', { duesAmount: 35 }),
      stubJob('c', { duesAmount: 200 }), // a one-off correction on that cheque
    ];
    const s = learnFromStubs(jobs, [employer({ unionDuesPercent: 1 })]).find(x => x.field === 'unionDuesPercent')!;
    expect(s.suggested).toBe(3.5);
  });

  it('says nothing without a gross to work from', () => {
    const j = stubJob('a', { grossPay: undefined });
    expect(learnFromStubs([j], [employer()])).toEqual([]);
  });

  it('ignores stubs from an employer with no profile', () => {
    const j = stubJob('a');
    j.client = 'Someone Else Entirely';
    j.stubParsed!.employer = 'Someone Else Entirely';
    expect(learnFromStubs([j], [employer()])).toEqual([]);
  });
});

describe('dismissal cadence', () => {
  it('skips the next occurrence, then asks again', () => {
    const base = employer({ unionDuesPercent: 2 });

    // Dismissed once — the next stub must not re-ask.
    const afterDismiss = employer({ unionDuesPercent: 2, dismissedSuggestions: dismissSuggestion(base, 'unionDuesPercent') });
    expect(learnFromStubs([stubJob('a')], [afterDismiss]).some(s => s.field === 'unionDuesPercent')).toBe(false);

    // That stub burns the skip, so the one after does ask.
    const afterNext = employer({ unionDuesPercent: 2, dismissedSuggestions: consumeSkip(afterDismiss, 'unionDuesPercent') });
    expect(learnFromStubs([stubJob('a')], [afterNext]).some(s => s.field === 'unionDuesPercent')).toBe(true);
  });

  it('dismissing one field leaves the others asking', () => {
    const base = employer({ unionDuesPercent: 2, estimatedTaxPercent: 10 });
    const e = employer({ unionDuesPercent: 2, estimatedTaxPercent: 10, dismissedSuggestions: dismissSuggestion(base, 'unionDuesPercent') });
    const fields = learnFromStubs([stubJob('a')], [e]).map(s => s.field);
    expect(fields).not.toContain('unionDuesPercent');
    expect(fields).toContain('estimatedTaxPercent');
  });
});
