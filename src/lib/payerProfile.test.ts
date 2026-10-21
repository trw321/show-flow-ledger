import { describe, it, expect } from 'vitest';
import { normaliseLocal, findLocalRates, ratesForShift, EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import type { Employer, Job } from './store';

const profile: PayerProfile = {
  tax: { federalEffectivePercent: 22 },
  locals: [
    { local: 'ia16', unionDuesPercent: 3.5, vacationPercent: 8 },
    { local: 'ia8', unionDuesPercent: 4 },
  ],
};

const job = (extra: Partial<Job> = {}): Job => ({
  id: 'j1', name: 'Show', client: 'Blackpoint', date: '2026-09-21',
  status: 'completed', has6th7thDayRule: false, ...extra,
} as Job);

const employer = (extra: Partial<Employer> = {}): Employer => ({
  id: 'e1', name: 'Blackpoint', overtimeRule: 'daily', createdAt: '2026-01-01', ...extra,
} as Employer);

describe('naming a local', () => {
  it('reads the number out of however it was written', () => {
    expect(normaliseLocal('ia16')).toBe('16');
    expect(normaliseLocal('IA 16')).toBe('16');
    expect(normaliseLocal('Local 16')).toBe('16');
    expect(normaliseLocal('16')).toBe('16');
  });

  it('keeps 8 and 16 apart', () => {
    expect(normaliseLocal('ia8')).toBe('8');
    expect(normaliseLocal('ia8')).not.toBe(normaliseLocal('ia16'));
  });

  it('is nothing when no local was recorded', () => {
    expect(normaliseLocal(undefined)).toBe('');
    expect(findLocalRates(profile, undefined)).toBeUndefined();
  });
});

describe('which source owns which number', () => {
  it('takes dues and vacation from the local, whoever the employer is', () => {
    const r = ratesForShift(job({ local: 'ia16' }), employer(), profile);
    expect(r.unionDuesPercent).toBe(3.5);
    expect(r.vacationPercent).toBe(8);
  });

  it('gives a different local its own dues', () => {
    expect(ratesForShift(job({ local: 'ia8' }), employer(), profile).unionDuesPercent).toBe(4);
  });

  it('takes tax from you, not from the employer', () => {
    // An employer holding a stale 35% does not override your own estimate.
    const r = ratesForShift(job({ local: 'ia16' }), employer({ estimatedTaxPercent: 35 }), profile);
    expect(r.estimatedTaxPercent).toBe(22);
  });

  it('withholds nothing when the W2 was filed exempt', () => {
    const exempt = { ...profile, tax: { ...profile.tax, federalExempt: true } };
    expect(ratesForShift(job({ local: 'ia16' }), employer(), exempt).estimatedTaxPercent).toBe(0);
  });

  it('falls back to the employer for a ledger built before locals existed', () => {
    const r = ratesForShift(job(), employer({ unionDuesPercent: 3.5, vacationPercent: 8 }), EMPTY_PROFILE);
    expect(r.unionDuesPercent).toBe(3.5);
    expect(r.vacationPercent).toBe(8);
  });

  it('uses the employer\'s local when the shift did not record one', () => {
    const r = ratesForShift(job(), employer({ unionLocal: '8' }), profile);
    expect(r.unionDuesPercent).toBe(4);
  });

  it('leaves a rate unset when nobody knows it', () => {
    const r = ratesForShift(job({ local: 'ia33' }), employer(), profile);
    expect(r.unionDuesPercent).toBeUndefined();
    expect(r.vacationPercent).toBeUndefined();
  });
});

describe('the engine reads the right owner', () => {
  const shift = {
    id: 'j1', name: 'n', client: 'Blackpoint', date: '2026-09-10', local: 'ia16',
    status: 'completed', hoursWorked: 8, hourlyRate: 50, has6th7thDayRule: false,
  } as Job;
  const blackpoint = {
    id: 'e1', name: 'Blackpoint', overtimeRule: 'daily', createdAt: '2026-01-01',
    unionDuesPercent: 99, estimatedTaxPercent: 99, vacationPercent: 99,
  } as Employer;

  it('prefers the local and you over whatever the employer holds', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const b = jobPayBreakdown(shift, [shift], [blackpoint], profile);
    expect(b.gross).toBe(400);
    expect(b.dues).toBeCloseTo(400 * 0.035, 2);   // the local's 3.5%, not 99%
    expect(b.vacation).toBeCloseTo(400 * 0.08, 2); // the local's 8%, not 99%
  });

  it('withholds nothing for an exempt W2, however the employer is set up', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const b = jobPayBreakdown(shift, [shift], [blackpoint], { ...profile, tax: { ...profile.tax, federalExempt: true } });
    expect(b.tax).toBe(0);
  });

  it('reports an employer 401k match beside the pay, never inside it', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const odeum = { ...blackpoint, name: 'Blackpoint', retirementMatchPercent: 6 } as Employer;
    const withMatch = jobPayBreakdown(shift, [shift], [odeum], profile);
    const without = jobPayBreakdown(shift, [shift], [blackpoint], profile);
    expect(withMatch.retirementMatch).toBeCloseTo(400 * 0.06, 2);
    // It is owed to the plan, so take-home must not move.
    expect(withMatch.net).toBeCloseTo(without.net, 2);
  });

  it('keeps calculating an old ledger the same way', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const legacy = { ...shift, local: undefined } as Job;
    const old = { ...blackpoint, unionDuesPercent: 3.5, estimatedTaxPercent: 20, vacationPercent: 8 } as Employer;
    const b = jobPayBreakdown(legacy, [legacy], [old], EMPTY_PROFILE);
    expect(b.dues).toBeCloseTo(400 * 0.035, 2);
    expect(b.vacation).toBeCloseTo(400 * 0.08, 2);
  });
});

describe('a split day is one day for overtime', () => {
  const half = (id: string, hours: number): Job => ({
    id, name: 'Masonic', client: 'Acme', date: '2026-09-10', jobNumber: '2026-5000',
    status: 'completed', hoursWorked: hours, hourlyRate: 50, has6th7thDayRule: false,
  } as Job);

  it('bills the second half into overtime, not back at straight time', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    // 5h in the morning and 5h at night is a 10-hour day: 8 straight, 2 at OT.
    const day = [half('a', 5), half('b', 5)];
    const total = day.reduce((sum, j) => sum + jobPayBreakdown(j, day, [], EMPTY_PROFILE).gross, 0);
    expect(total).toBe(8 * 50 + 2 * 75);
  });

  it('does not invent overtime on two unrelated shifts the same day', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    // Different employers, so each is its own day's work.
    const a = half('a', 5);
    const b = { ...half('b', 5), client: 'Other', jobNumber: '2026-6000' } as Job;
    const total = jobPayBreakdown(a, [a, b], [], EMPTY_PROFILE).gross
      + jobPayBreakdown(b, [a, b], [], EMPTY_PROFILE).gross;
    expect(total).toBe(10 * 50);
  });

  it('leaves an ordinary single shift exactly as it was', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const only = half('a', 10);
    expect(jobPayBreakdown(only, [only], [], EMPTY_PROFILE).gross).toBe(8 * 50 + 2 * 75);
  });
});

describe('each side of a split keeps its own minimum call', () => {
  const side = (id: string, hours: number, minimum = 4): Job => ({
    id, name: 'Masonic', client: 'Acme', date: '2026-09-10', jobNumber: '2026-5000',
    status: 'completed', hoursWorked: hours, minimumHours: minimum, hourlyRate: 50,
    has6th7thDayRule: false,
  } as Job);

  it('bills a short morning at its minimum, not the hours stood there', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    // 3h worked against a 4h minimum, then 5h at night: 4 + 5 = 9 billable.
    const day = [side('a', 3), side('b', 5)];
    const total = day.reduce((sum, j) => sum + jobPayBreakdown(j, day, [], EMPTY_PROFILE).gross, 0);
    expect(total).toBeCloseTo(8 * 50 + 1 * 75, 2);
  });

  it('applies the minimum once per side, never to the whole day', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    // Two 5h halves against a 5h minimum is 10 billable, not floored at 5.
    const day = [side('a', 5, 5), side('b', 5, 5)];
    const total = day.reduce((sum, j) => sum + jobPayBreakdown(j, day, [], EMPTY_PROFILE).gross, 0);
    expect(total).toBeCloseTo(8 * 50 + 2 * 75, 2);
  });

  it('pays a short half its minimum even when the other half is long', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const day = [side('a', 1), side('b', 8)];
    const short = jobPayBreakdown(day[0], day, [], EMPTY_PROFILE).gross;
    // One hour worked, four hours owed — that is the point of a minimum.
    expect(short).toBeGreaterThan(1 * 50);
  });

  it('leaves a single shift minimum working as it always did', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const only = side('a', 2, 5);
    expect(jobPayBreakdown(only, [only], [], EMPTY_PROFILE).gross).toBe(5 * 50);
  });
});

describe('a day-rate shift through the engine', () => {
  const dayShift = (extra: Partial<Job> = {}): Job => ({
    id: 'd1', name: 'Corporate', client: 'Odeum', date: '2026-09-10',
    status: 'completed', hoursWorked: 12, dayRate: 400, dayRateHours: 10,
    has6th7thDayRule: false, ...extra,
  } as Job);

  it('pays the day rate plus overtime past it, with no hourly rate on the shift', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const s = dayShift();
    // $400 covers 10h; 2h past at $40 x 1.5 = $120.
    expect(jobPayBreakdown(s, [s], [], EMPTY_PROFILE).gross).toBe(520);
  });

  it('pays a meal penalty at the day rate\'s hourly equivalent', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const s = dayShift({ hoursWorked: 10, mealPenalties: 1 });
    // No hourly rate set, so an hour is $400 / 10 = $40.
    expect(jobPayBreakdown(s, [s], [], EMPTY_PROFILE).gross).toBe(440);
  });

  it('agrees with what the Money page reconciles against', async () => {
    const { jobPayBreakdown, calculateExpectedPay } = await import('./payCalc');
    const s = dayShift();
    const perShift = jobPayBreakdown(s, [s], [], EMPTY_PROFILE).gross;
    const expected = calculateExpectedPay([s], s, [s]).total;
    // Two paths to one figure: they must not disagree about the same day.
    expect(expected).toBeCloseTo(perShift, 2);
  });
});
