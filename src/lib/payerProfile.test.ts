import { describe, it, expect } from 'vitest';
import { normaliseLocal, findLocalRates, ratesForShift, EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import type { Employer, Job } from './store';

const profile: PayerProfile = {
  estimatedTaxPercent: 22,
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
    const exempt = { ...profile, taxExempt: true };
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
