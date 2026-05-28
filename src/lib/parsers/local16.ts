// src/lib/parsers/local16.ts
//
// Heuristic parser for pasted IATSE Local 16 dispatch offers.
// Pure function — no React, no Supabase — so it's easy to test.
//
// HOW IT WORKS
//   1. Line-by-line "Label: value" matching against LABEL_ALIASES.
//   2. Whole-text regex fallbacks for distinctive fields (job #, local,
//      date, rate) that have recognizable shapes even without a label.
//
// TUNING: This was written without a real offer sample in front of it.
// The review form is fully editable, so imperfect parses are safe — the
// user fixes fields before saving. To improve hit-rate, add real labels
// you see in offers to the alias lists below. That's the main knob.

export interface ParsedOffer {
  jobNumber: string | null;
  local: string | null;
  workDate: string | null; // YYYY-MM-DD
  startTime: string | null; // "HH:MM" 24h when normalizable, else raw
  endTime: string | null;
  employer: string | null; // signatory employer
  payor: string | null; // payroll company
  hiringParty: string | null;
  showName: string | null;
  venue: string | null;
  jobSite: string | null;
  positionName: string | null;
  hourlyRate: number | null;
  steward: string | null;
  reportTo: string | null;
  dressCode: string | null;
  rawText: string;
}

export interface ParseResult {
  parsed: ParsedOffer;
  warnings: string[];
  matched: (keyof ParsedOffer)[];
}

// Canonical field -> accepted labels (lowercased, exact-match after normalize).
// Add new labels here as you encounter them in real offers.
const LABEL_ALIASES: Record<string, string[]> = {
  jobNumber: ['job number', 'job #', 'job#', 'gig number', 'gig #', 'call number', 'call #', 'dispatch', 'dispatch #', 'work order', 'wo #', 'order #', 'ref', 'reference'],
  local: ['local', 'union', 'chapter'],
  workDate: ['date', 'work date', 'call date', 'show date', 'day', 'dates'],
  startTime: ['call', 'call time', 'start', 'start time', 'report time', 'time in', 'in'],
  endTime: ['end', 'end time', 'time out', 'out', 'wrap', 'expected end'],
  employer: ['employer', 'signatory', 'signatory employer', 'company', 'contractor'],
  payor: ['payroll', 'payroll company', 'payroll co', 'payor', 'paymaster', 'paid by'],
  hiringParty: ['hiring', 'hiring party', 'hired by', 'dispatcher', 'agent'],
  showName: ['show', 'show name', 'event', 'event name', 'production'],
  venue: ['venue', 'location'],
  jobSite: ['job site', 'jobsite', 'address', 'work location', 'site'],
  positionName: ['position', 'classification', 'class', 'role', 'title', 'craft', 'department', 'dept'],
  hourlyRate: ['rate', 'hourly', 'hourly rate', 'rate/hr', 'rate/hour', 'pay rate', 'wage', 'scale'],
  steward: ['steward', 'shop steward'],
  reportTo: ['report to', 'reports to', 'report', 'contact', 'supervisor', 'foreman', 'lead'],
  dressCode: ['dress', 'dress code', 'attire', 'wardrobe'],
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  // MM/DD/YYYY, MM/DD/YY, M-D-YY, M.D.YYYY
  let m = s.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
  if (m) {
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    const mon = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${year}-${pad(mon)}-${pad(day)}`;
  }
  // Month DD, YYYY
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,)?\s+(\d{4})\b/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${pad(mon)}-${pad(parseInt(m[2], 10))}`;
  }
  // DD Month YYYY
  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${pad(mon)}-${pad(parseInt(m[1], 10))}`;
  }
  // Already ISO
  m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function normalizeTime(raw: string): string | null {
  const m = raw.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${pad(h)}:${m[2]}`;
  }
  // bare hour with am/pm, e.g. "8 AM"
  const m2 = raw.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (m2) {
    let h = parseInt(m2[1], 10);
    const ap = m2[2].toLowerCase();
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${pad(h)}:00`;
  }
  return null;
}

function parseRate(raw: string): number | null {
  const m = raw.match(/\$?\s*(\d{1,3}(?:\.\d{1,2})?)/);
  if (m) {
    const n = parseFloat(m[1]);
    if (!isNaN(n) && n > 0 && n < 1000) return n;
  }
  return null;
}

function assignField(p: ParsedOffer, field: keyof ParsedOffer, value: string): void {
  switch (field) {
    case 'workDate': {
      const d = normalizeDate(value);
      if (d) p.workDate = d;
      break;
    }
    case 'startTime':
      p.startTime = normalizeTime(value) ?? value;
      break;
    case 'endTime':
      p.endTime = normalizeTime(value) ?? value;
      break;
    case 'hourlyRate': {
      const r = parseRate(value);
      if (r != null) p.hourlyRate = r;
      break;
    }
    case 'local': {
      const m = value.match(/(\d{1,3})/);
      p.local = m ? `Local ${m[1]}` : value;
      break;
    }
    default:
      // string fields
      (p as Record<string, unknown>)[field] = value;
  }
}

export function parseLocal16Offer(text: string): ParseResult {
  const parsed: ParsedOffer = {
    jobNumber: null, local: null, workDate: null, startTime: null, endTime: null,
    employer: null, payor: null, hiringParty: null, showName: null, venue: null,
    jobSite: null, positionName: null, hourlyRate: null, steward: null,
    reportTo: null, dressCode: null, rawText: text,
  };
  const matched: (keyof ParsedOffer)[] = [];
  const warnings: string[] = [];

  const aliasToField = new Map<string, keyof ParsedOffer>();
  for (const [field, aliases] of Object.entries(LABEL_ALIASES)) {
    for (const a of aliases) aliasToField.set(a, field as keyof ParsedOffer);
  }

  const lines = text.split(/\r?\n/);

  // Pass 1 — label: value lines
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    const label = line
      .slice(0, idx)
      .toLowerCase()
      .replace(/\(.*?\)/g, '') // strip parentheticals e.g. "(PT)"
      .replace(/[^a-z0-9 #/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const field = aliasToField.get(label);
    if (!field) continue;
    if (parsed[field] != null) continue; // first occurrence wins
    assignField(parsed, field, value);
    if (parsed[field] != null && !matched.includes(field)) matched.push(field);
  }

  // Pass 2 — whole-text fallbacks for distinctive fields
  if (!parsed.jobNumber) {
    const m =
      text.match(/\b(20\d{2}-\d{3,5})\b/) || // 2026-1589 style
      text.match(/\bjob\s*#?\s*(\d{3,6})\b/i) ||
      text.match(/#\s*(\d{3,6})\b/);
    if (m) {
      parsed.jobNumber = m[1];
      matched.push('jobNumber');
    }
  }
  if (!parsed.local) {
    const m = text.match(/\blocal\s+(\d{1,3})\b/i);
    if (m) {
      parsed.local = `Local ${m[1]}`;
      matched.push('local');
    }
  }
  if (!parsed.workDate) {
    const d = normalizeDate(text);
    if (d) {
      parsed.workDate = d;
      matched.push('workDate');
    }
  }
  if (!parsed.hourlyRate) {
    for (const line of lines) {
      if (/\b(rate|scale|wage|hourly|hr)\b/i.test(line)) {
        const m = line.match(/\$?\s*(\d{2,3}(?:\.\d{1,2})?)/);
        if (m) {
          const n = parseFloat(m[1]);
          if (n >= 10 && n < 1000) {
            parsed.hourlyRate = n;
            matched.push('hourlyRate');
            break;
          }
        }
      }
    }
  }

  // Warnings — surfaced in the review UI, never block
  if (!parsed.workDate) warnings.push('No work date found — this is required to save.');
  if (!parsed.jobNumber) warnings.push('No job / gig number found.');
  if (!parsed.positionName) warnings.push('No position / classification found.');
  if (!parsed.hourlyRate) warnings.push('No hourly rate found.');
  if (matched.length === 0) warnings.push('Nothing auto-detected. Check the format, or just fill in the fields manually.');

  return { parsed, warnings, matched };
}
