import type { Job } from '@/lib/store';

// Ported from the retired CatScratchButton's parser/matcher — the scoring
// and matching logic is unchanged, only the entry source changed (AI-parsed
// hourUpdates from smart-import, instead of a local regex parser).

export function parseTimeToMins(t: string): number {
  const m = t.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
  if (!m) return NaN;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] || '0');
  const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  return h * 60 + min;
}

export function calcHours(start: string, end: string): number {
  let s = parseTimeToMins(start);
  let e = parseTimeToMins(end);
  if (isNaN(s) || isNaN(e)) return 0;
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
}

export interface HoursEntry {
  date: string;
  venue?: string;
  startTime?: string;
  endTime?: string;
  mealDuration?: 0 | 30 | 45 | 60;
  mealOnClock?: boolean;
  mealPenalties?: number;
  paid: boolean;
  grossPay?: number;
  netPay?: number;
  payrollCompany?: string;
  position?: string;
  minimumHours?: number;
  notes?: string;
  client?: string;
  hoursWorked?: number;
  hourlyRate?: number;
}

// Shape returned by smart-import's "hours" classification (supabase/functions/smart-import).
export interface SmartImportHourUpdate {
  date: string;
  startTime?: string;
  endTime?: string;
  hoursWorked?: number;
  venue?: string;
  steward?: string;
  hourlyRate?: number;
  mealType?: 'YWA' | 'NWA';
  notes?: string;
}

export function hourUpdateToEntry(u: SmartImportHourUpdate): HoursEntry {
  return {
    date: u.date,
    venue: u.venue,
    startTime: u.startTime,
    endTime: u.endTime,
    mealDuration: u.mealType === 'YWA' ? 60 : u.mealType === 'NWA' ? 30 : undefined,
    mealOnClock: u.mealType === 'YWA' ? false : u.mealType === 'NWA' ? true : undefined,
    paid: false,
    position: u.steward,
    notes: u.notes,
    hoursWorked: u.hoursWorked,
    hourlyRate: u.hourlyRate,
  };
}

export interface MatchResult {
  entry: HoursEntry;
  matchedJob: Job | null;
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  conflicts: string[];
}

export function scoreMatch(entry: HoursEntry, job: Job): { score: number; conflicts: string[] } {
  let score = 0;
  const conflicts: string[] = [];

  // Date match is prerequisite
  if (job.date !== entry.date) return { score: 0, conflicts: [] };
  score += 50;

  // Venue fuzzy match
  if (entry.venue && job.venue) {
    const ev = entry.venue.toLowerCase();
    const jv = job.venue.toLowerCase();
    const evWords = ev.split(/\s+/);
    const jvWords = jv.split(/\s+/);
    const shared = evWords.filter(w => w.length > 2 && jvWords.some(jw => jw.includes(w) || w.includes(jw)));
    if (shared.length > 0) score += Math.min(30, shared.length * 15);
    else if (ev.length > 2 && jv.includes(ev.slice(0, 4))) score += 10;
    else conflicts.push(`Venue: note says "${entry.venue}", job says "${job.venue}"`);
  } else if (entry.venue && job.client) {
    const ev = entry.venue.toLowerCase();
    const jc = job.client.toLowerCase();
    if (ev.includes(jc.slice(0, 4)) || jc.includes(ev.slice(0, 4))) score += 15;
  }

  // Start time match
  if (entry.startTime && job.startTime) {
    const em = parseTimeToMins(entry.startTime);
    const jm = parseTimeToMins(job.startTime);
    if (!isNaN(em) && !isNaN(jm)) {
      const diff = Math.abs(em - jm);
      if (diff === 0) score += 20;
      else if (diff <= 30) score += 10;
      else conflicts.push(`Start time: note says ${entry.startTime}, job says ${job.startTime}`);
    }
  }

  return { score, conflicts };
}

export function matchEntries(entries: HoursEntry[], jobs: Job[]): MatchResult[] {
  return entries.map(entry => {
    const candidates = jobs.filter(j => j.date === entry.date);
    if (candidates.length === 0) {
      return { entry, matchedJob: null, score: 0, confidence: 'none', conflicts: [] };
    }

    let best: Job | null = null;
    let bestScore = 0;
    let bestConflicts: string[] = [];

    for (const job of candidates) {
      const { score, conflicts } = scoreMatch(entry, job);
      if (score > bestScore) { best = job; bestScore = score; bestConflicts = conflicts; }
    }

    const confidence: MatchResult['confidence'] =
      bestScore >= 80 ? 'high' :
      bestScore >= 50 ? 'medium' :
      bestScore > 0 ? 'low' : 'none';

    return { entry, matchedJob: best, score: bestScore, confidence, conflicts: bestConflicts };
  });
}
