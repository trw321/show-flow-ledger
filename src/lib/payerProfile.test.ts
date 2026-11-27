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

  it("withholds what the employer's W-4 says, per employer", () => {
    const r = ratesForShift(job({ local: 'ia16' }), employer({ estimatedTaxPercent: 10 }), profile);
    expect(r.estimatedTaxPercent).toBe(10);
  });

  it('uses your federal rate for an employer with none of its own', () => {
    expect(ratesForShift(job({ local: 'ia16' }), employer(), profile).estimatedTaxPercent).toBe(22);
  });

  it('can be exempt with one employer and withheld at another', () => {
    expect(ratesForShift(job(), employer({ w4Exempt: true, estimatedTaxPercent: 10 }), profile).estimatedTaxPercent).toBe(0);
    expect(ratesForShift(job(), employer({ w4Exempt: false }), { ...profile, tax: { ...profile.tax, federalExempt: true } }).estimatedTaxPercent).toBe(22);
  });

  it('withholds nothing when the W2 was filed exempt', () => {
    const exempt = { ...profile, tax: { ...profile.tax, federalExempt: true } };
    expect(ratesForShift(job({ local: 'ia16' }), employer(), exempt).estimatedTaxPercent).toBe(0);
  });

  it('uses the employer tax profile for that year and falls back outside it', () => {
    const employerWithHistory = employer({
      taxProfiles: [{ taxYear: 2026, state: 'CA', w4Exempt: true, federalWithholdingPercent: 0, stateTaxPercent: 6 }],
    });
    expect(ratesForShift(job({ date: '2026-09-21' }), employerWithHistory, profile).estimatedTaxPercent).toBe(0);
    expect(ratesForShift(job({ date: '2025-09-21' }), employerWithHistory, profile).estimatedTaxPercent).toBe(22);
  });

  it('can override a global exempt setting for one employer and tax year', () => {
    const globalExempt = { ...profile, tax: { ...profile.tax, federalExempt: true } };
    const employerWithholding = employer({ taxProfiles: [{ taxYear: 2026, w4Exempt: false, federalWithholdingPercent: 11 }] });
    expect(ratesForShift(job(), employerWithholding, globalExempt).estimatedTaxPercent).toBe(11);
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

  it('pays each call what it worked: the overtime on the later call', async () => {
    const { jobPayBreakdown, jobHoursBreakdown } = await import('./payCalc');
    // Listed night first, to show the order worked decides, not the list.
    const day = [{ ...half('b', 5), startTime: '06:00 PM', endTime: '11:00 PM' }, { ...half('a', 5), startTime: '08:00 AM', endTime: '01:00 PM' }];
    const [night, morning] = day.map(j => jobPayBreakdown(j, day, [], EMPTY_PROFILE).gross);
    expect(morning).toBe(5 * 50);
    expect(night).toBe(3 * 50 + 2 * 75);
    expect(jobHoursBreakdown(day[0], day, [], EMPTY_PROFILE)).toMatchObject({ straight: 3, overtime: 2 });
    expect(jobHoursBreakdown(day[1], day, [], EMPTY_PROFILE)).toMatchObject({ straight: 5, overtime: 0 });
  });

  it('puts the night premium on the night call (OAR, Aug 12)', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    // 9 AM to 2 PM, then a 10:30 PM to 3 AM load-out at $41.60. Local 16
    // breaks the hour, so the load-out is 5h: 1.5 before midnight, and 3.5
    // after it at double, the broken half hour falling at the end of the call.
    // Cut by hours, the load-out showed $266.02 and the morning $295.58.
    const oar = (id: string, startTime: string, endTime: string, hoursWorked: number): Job => ({
      id, name: 'OAR', client: 'LIVE NATION / MASONIC', date: '2026-08-12', jobNumber: '2026-2626', local: '16',
      status: 'completed', startTime, endTime, hoursWorked, hourlyRate: 41.6, has6th7thDayRule: false,
    } as Job);
    const day = [oar('am', '09:00 AM', '2p', 5), oar('pm', '10:30 PM', '3am', 4.5)];
    const [am, pm] = day.map(j => jobPayBreakdown(j, day, [], EMPTY_PROFILE).gross);
    expect(am).toBeCloseTo(5 * 41.6, 2);
    expect(pm).toBeCloseTo(1.5 * 41.6 + 3.5 * 83.2, 2);
    expect(am + pm).toBeCloseTo(561.6, 2);
  });
});

describe('each side of a split keeps its own minimum call', () => {
  const side = (id: string, hours: number, minimum = 4): Job => ({
    id, name: 'Masonic', client: 'Acme', date: '2026-09-10', jobNumber: '2026-5000',
    status: 'completed', hoursWorked: hours, minimumHours: minimum, hourlyRate: 50,
    has6th7thDayRule: false,
  } as Job);

  it('bills a short morning at its minimum, the padding at straight time', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    // 3h worked against a 4h minimum, then 5h at night: 9 billable. The 8
    // worked fill the straight-time ladder; the hour the minimum adds was
    // never worked, so it is straight time too, not overtime.
    const day = [side('a', 3), side('b', 5)];
    const total = day.reduce((sum, j) => sum + jobPayBreakdown(j, day, [], EMPTY_PROFILE).gross, 0);
    expect(total).toBeCloseTo(8 * 50 + 1 * 50, 2);
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

describe("a shift's local, for its dues", () => {
  const dues: PayerProfile = { locals: [{ local: '16', unionDuesPercent: 3.5 }, { local: '8', unionDuesPercent: 4 }] };
  const shift = (over: Partial<Job>) => ({ id: 's', name: 'X', client: 'X', venue: '', date: '2026-11-25', status: 'completed', has6th7thDayRule: false, notes: '', createdAt: 'x', ...over } as Job);

  it('takes Local 16 dues on a Local 16 dispatch that names no local: the job number says it', () => {
    expect(ratesForShift(shift({ jobNumber: '2026-4250', client: 'BGCA MANAGEMENT LLC' }), undefined, dues).unionDuesPercent).toBe(3.5);
    expect(ratesForShift(shift({ jobNumber: '2878', client: 'YBCA' }), undefined, dues).unionDuesPercent).toBe(3.5);
  });

  it('takes Local 8 dues where "ia8" was typed as the employer, or the shift names ia8', () => {
    expect(ratesForShift(shift({ client: 'ia8', payrollCompany: 'elliot lewis' }), undefined, dues).unionDuesPercent).toBe(4);
    expect(ratesForShift(shift({ client: 'Elliott Lewis', local: 'ia8' }), undefined, dues).unionDuesPercent).toBe(4);
  });

  it('lets a local the shift names win over the job number', () => {
    expect(ratesForShift(shift({ jobNumber: '2026-4250', local: 'ia8' }), undefined, dues).unionDuesPercent).toBe(4);
  });

  it('takes no dues on work for no local', () => {
    expect(ratesForShift(shift({ client: 'odeum' }), undefined, dues).unionDuesPercent).toBeUndefined();
    expect(ratesForShift(shift({ client: 'Live Box Digital LLC' }), undefined, dues).unionDuesPercent).toBeUndefined();
  });
});
