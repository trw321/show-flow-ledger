import type { Employer, Job } from './store';
import { nameSimilarity } from './employerMatch';
import { isUnclearEmployer, suggestEmployer } from './unemployment';

/**
 * Who you worked for, from what you've worked before: every employer and
 * payroll company on your shifts and saved employers, so a new shift typed
 * as "worked for ybca today 9a-10a" can be put under YBCA YERBA BUENA CENTER
 * FOR THE ARTS, paid through whoever paid it last time.
 */

export interface KnownEmployer {
  name: string;
  /** The payroll company it was last paid through, when it was one. */
  payrollCompany?: string;
  /** Its most recent shift, YYYY-MM-DD; '' for a saved employer never worked. */
  lastDate: string;
}

const clean = (s: string | undefined) => s?.trim() || undefined;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Every employer you've worked for or saved, newest first, each with the payroll company last used with it. */
export function knownEmployers(jobs: Job[], employers: Employer[]): KnownEmployer[] {
  const byName = new Map<string, KnownEmployer>();
  const worked = jobs
    .filter(j => j.status !== 'cancelled' && clean(j.client) && !isUnclearEmployer(j.client))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const j of worked) {
    const key = j.client.trim().toLowerCase();
    const seen = byName.get(key);
    if (!seen) byName.set(key, { name: j.client.trim(), payrollCompany: clean(j.payrollCompany), lastDate: j.date });
    else if (!seen.payrollCompany && clean(j.payrollCompany)) seen.payrollCompany = clean(j.payrollCompany);
  }
  for (const e of employers) {
    if (!clean(e.name) || isUnclearEmployer(e.name)) continue;
    const key = e.name.trim().toLowerCase();
    const seen = byName.get(key);
    if (!seen) byName.set(key, { name: e.name.trim(), payrollCompany: clean(e.payrollCompany), lastDate: '' });
    else if (!seen.payrollCompany && clean(e.payrollCompany)) seen.payrollCompany = clean(e.payrollCompany);
  }
  return [...byName.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
}

/** Every payroll company you've been paid through, newest first. */
export function knownPayrolls(jobs: Job[], employers: Employer[]): string[] {
  const out: string[] = [];
  const add = (name: string | undefined) => {
    const n = clean(name);
    if (n && !isUnclearEmployer(n) && !out.some(o => same(o, n))) out.push(n);
  };
  for (const j of [...jobs].filter(j => j.status !== 'cancelled').sort((a, b) => b.date.localeCompare(a.date))) add(j.payrollCompany);
  for (const e of employers) add(e.payrollCompany);
  return out;
}

/** How close a typed name has to be to one you've worked for to be offered. */
export const WHO_SUGGEST_THRESHOLD = 0.75;

export interface WhoSuggestion {
  client: string;
  payrollCompany?: string;
  /** 0..1: how close the closest typed name came. */
  score: number;
  /** The shift it comes from, YYYY-MM-DD, when there is one. */
  lastDate: string;
}

/**
 * Who a new shift is most likely for: the names a reader pulled out of what
 * you typed (an employer, a payroll company, a venue) against everyone you've
 * worked for or been paid through, then, failing that, the words themselves
 * ("worked for island creative"). A payroll company typed points at the
 * employer last paid through it. Null when nothing comes close.
 */
export function suggestWho(names: (string | undefined)[], text: string | undefined, jobs: Job[], employers: Employer[]): WhoSuggestion | null {
  const known = knownEmployers(jobs, employers);
  if (known.length === 0) return null;
  let best: WhoSuggestion | null = null;
  const offer = (s: WhoSuggestion) => {
    if (!best || s.score > best.score || (s.score === best.score && s.lastDate > best.lastDate)) best = s;
  };
  for (const typed of names) {
    const t = clean(typed);
    if (!t || isUnclearEmployer(t)) continue;
    for (const k of known) {
      const score = nameSimilarity(t, k.name);
      if (score >= WHO_SUGGEST_THRESHOLD) offer({ client: k.name, payrollCompany: k.payrollCompany, score, lastDate: k.lastDate });
      if (k.payrollCompany && !same(k.payrollCompany, k.name)) {
        const viaPayroll = nameSimilarity(t, k.payrollCompany);
        // A little under a match on the employer itself: it names who paid, not who you worked for.
        if (viaPayroll >= WHO_SUGGEST_THRESHOLD) offer({ client: k.name, payrollCompany: k.payrollCompany, score: viaPayroll - 0.01, lastDate: k.lastDate });
      }
    }
  }
  if (best) return best;
  const named = suggestEmployer({ notes: text }, known.map(k => k.name));
  const k = named ? known.find(x => x.name === named) : undefined;
  return k ? { client: k.name, payrollCompany: k.payrollCompany, score: WHO_SUGGEST_THRESHOLD, lastDate: k.lastDate } : null;
}

/** The payroll company an employer was last paid through, for filling it in when the employer is picked. */
export function payrollFor(client: string, jobs: Job[], employers: Employer[]): string | undefined {
  return knownEmployers(jobs, employers).find(k => same(k.name, client))?.payrollCompany;
}
