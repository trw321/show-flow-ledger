// src/lib/parsers/local16.ts
// Parser for Local 16 dispatch offers.
//
// PRIMARY mode — tab-delimited rows copied from the web dispatch portal.
//   The portal columns are always in the same order (14 of them). Blank cells
//   copy across as empty columns; we preserve them so nothing shifts.
// FALLBACK mode — labeled "Field: value" text (an offer pasted from email/SMS).

export interface ParsedOffer {
  jobNumber: string | null;
  local: string | null;
  workDate: string | null;    // YYYY-MM-DD
  startTime: string | null;   // HH:MM (24h)
  endTime: string | null;     // HH:MM (24h)
  employer: string | null;
  payor: string | null;
  hiringParty: string | null;
  showName: string | null;
  venue: string | null;
  jobSite: string | null;
  positionName: string | null;
  hourlyRate: number | null;
  steward: string | null;
  reportTo: string | null;
  dressCode: string | null;
  contractRef: string | null;
  notes: string | null;
  callbackDates: string[];
  rawText: string;
}

export interface ParseResult {
  parsed: ParsedOffer;
  matched: string[];
  warnings: string[];
}

// Fixed column order of a Local 16 portal row.
const LOCAL16_COLUMNS = [
  'jobNumber',     // 0
  'dateTime',      // 1  -> workDate + startTime
  'lineNotes',     // 2  -> notes
  'positionName',  // 3
  'employer',      // 4
  'payor',         // 5
  'venue',         // 6
  'showName',      // 7
  'jobSite',       // 8
  'instructions',  // 9  -> notes
  'contractRef',   // 10
  'hourlyRate',    // 11
  'dressCode',     // 12
  'reportTo',      // 13
] as const;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function normalizeDate(s: string): string | null {
  let m = s.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const mo = +m[1], d = +m[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,)?\s+(\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(+m[2])}`;
  }
  m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function normalizeTime(raw: string): string | null {
  let m = raw.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (m) {
    let h = +m[1];
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${pad(h)}:${m[2]}`;
  }
  m = raw.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (m) {
    let h = +m[1];
    const ap = m[2].toLowerCase();
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${pad(h)}:00`;
  }
  return null;
}
function extractCallbackDates(
  text: string,
  baseDate?: string | null
): string[] {
  const match = text.match(/\bCB\b\s+(.+?)(?:FOR|$)/i);

  if (!match) return [];

  const year =
    baseDate
      ? Number(baseDate.slice(0, 4))
      : new Date().getFullYear();

  const found =
    match[1].match(/\d{1,2}\/\d{1,2}/g) ?? [];

  return found.map((d) => {
    const [month, day] = d.split('/').map(Number);

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });
}

function parseRate(s: string): number | null {
  const trimmed = s.trim();

  const m = trimmed.match(
    /^(?:\$)?\s*(\d{1,3}(?:\.\d{1,2})?)$/
  );

  if (!m) return null;

  const n = parseFloat(m[1]);

  if (isNaN(n)) return null;
  if (n < 10 || n > 200) return null;

  return n;
}

const isJobNum = (s: string) =>
  /^20\d{2}-\d{2,5}$/.test(s.trim()) && !/^20\d{2}-20\d{2}$/.test(s.trim());

const isContractRef = (s: string) =>
  /20\d{2}-20\d{2}/.test(s) || /breakout|basic|agreement/i.test(s);

function emptyOffer(rawText: string): ParsedOffer {
  return {
    jobNumber: null, local: 'Local 16', workDate: null, startTime: null, endTime: null,
    employer: null, payor: null, hiringParty: null, showName: null, venue: null,
    jobSite: null, positionName: null, hourlyRate: null, steward: null, reportTo: null,
    dressCode: null, contractRef: null, notes: null, callbackDates: [], rawText,
  };
}

// Split a paste into cells. Stray newlines (common when copying from the
// portal) collapse into a single tab; genuine empty cells (\t\t) are kept so
// column positions stay aligned.
function cellsFromPaste(text: string): string[] {
  const cleaned = text.replace(/\r/g, '');

  // First try: preserve real tab structure
  let cells = cleaned
    .split('\t')
    .map(c => c.trim());

  // If copy/paste collapsed structure, rebuild from lines
  if (cells.length < 10) {
    const lines = cleaned
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    const rebuilt: string[] = [];

    for (const line of lines) {
      if (line.includes('\t')) {
        rebuilt.push(
          ...line.split('\t').map(c => c.trim())
        );
      } else {
        rebuilt.push(line);
      }
    }

    cells = rebuilt;
  }

  while (cells[0] === '') cells.shift();
  while (cells[cells.length - 1] === '') cells.pop();

  return cells;
}

const LABEL_MAP: Array<[keyof ParsedOffer, RegExp]> = [
  ['jobNumber', /\b(?:job|gig|dispatch|call)\s*(?:#|no\.?|number)?\s*[:#]\s*(.+)/i],
  ['workDate', /\b(?:date|work\s*date|day)\s*[:]\s*(.+)/i],
  ['startTime', /\b(?:call|call\s*time|start|report\s*time)\s*[:]\s*(.+)/i],
  ['positionName', /\b(?:position|classification|craft|role)\s*[:]\s*(.+)/i],
  ['employer', /\b(?:employer|company|hired\s*by)\s*[:]\s*(.+)/i],
  ['payor', /\b(?:payroll|paid\s*by|payor|payer)\s*[:]\s*(.+)/i],
  ['venue', /\b(?:venue|location)\s*[:]\s*(.+)/i],
  ['showName', /\b(?:show|event|production)\s*[:]\s*(.+)/i],
  ['jobSite', /\b(?:job\s*site|site|room)\s*[:]\s*(.+)/i],
  ['hourlyRate', /\b(?:rate|pay|hourly|wage)\s*[:]\s*(.+)/i],
  ['reportTo', /\b(?:report\s*to|contact|supervisor)\s*[:]\s*(.+)/i],
  ['steward', /\b(?:steward)\s*[:]\s*(.+)/i],
  ['dressCode', /\b(?:dress\s*code|dress|attire|wardrobe)\s*[:]\s*(.+)/i],
];

export function parseLocal16Offer(text: string): ParseResult {
  const p = emptyOffer(text);
  const matched: string[] = [];
  const warnings: string[] = [];

  if (text.includes('\t')) {
    // ---- PRIMARY: columnar ----
    const cells = cellsFromPaste(text);
    const noteBits: string[] = [];

    const hasZeroRate = cells.some((c) =>
      /^\$?0(?:\.0+)?$/.test(c.trim())
    );

    if (hasZeroRate) {
      warnings.push(
        'Offer contained a $0 rate placeholder — wage may not be posted yet.'
      );
    }

    cells.forEach((cell, i) => {
      if (i >= LOCAL16_COLUMNS.length || !cell) return;
      const col = LOCAL16_COLUMNS[i];
      switch (col) {
        case 'dateTime': {
          const d = normalizeDate(cell);
          if (d) { p.workDate = d; matched.push('workDate'); }
          const t = normalizeTime(cell);
          if (t) { p.startTime = t; matched.push('startTime'); }
          break;
        }
        case 'hourlyRate': {
          const r = parseRate(cell);
          if (r != null) { p.hourlyRate = r; matched.push('hourlyRate'); }
          break;
        }
        case 'lineNotes':
        case 'instructions':
          noteBits.push(cell);
          break;
        case 'contractRef':
          p.contractRef = cell; matched.push('contractRef');
          break;
        default:
          (p as Record<string, unknown>)[col] = cell;
          matched.push(col);
      }
    });

   if (noteBits.length) {
  const noteText = noteBits.join(' • ');

  p.notes = noteText;
  matched.push('notes');

  // Parse callback dates from notes
  p.callbackDates = extractCallbackDates(
    noteText,
    p.workDate
  );

  // Detect common Local 16 portal shift:
  // note text accidentally lands in position field
  // Hard remap for Local 16 shifted portal copies
// Format:
// notes | position | employer | payor | venue | show | site | instructions | contract | rate | dress | report

p.notes = cells[2] ?? null;
p.positionName = cells[3] ?? null;
p.employer = cells[4] ?? null;
p.payor = cells[5] ?? null;
p.venue = cells[6] ?? null;
p.showName = cells[7] ?? null;
p.jobSite = cells[8] ?? null;

const instructions = cells[9];
if (instructions) {
  p.notes = p.notes
    ? `${p.notes} • ${instructions}`
    : instructions;
}

p.contractRef = cells.find(isContractRef) ?? null;

const rateCell = cells.find(c =>
  /^\$?\d+\.\d{2}$/.test(c)
);

p.hourlyRate =
  rateCell ? parseRate(rateCell) : null;

p.dressCode =
  cells.find(c => /^[A-Z]{2,4}$/.test(c))
  ?? null;

p.reportTo =
  cells.find(c =>
    /^[A-Z]+(?:[- ][A-Z]+)+$/i.test(c)
  )
  ?? null; {
    
// Save originals before fixing shift
const originalPosition = p.positionName;
const originalEmployer = p.employer;
const originalPayor = p.payor;
const originalVenue = p.venue;
const originalShow = p.showName;
const originalJobSite = p.jobSite;

// Notes came from shifted position
p.notes = originalPosition;

// Correct the shifted columns

// Position was already correct in this format
p.positionName = originalPosition;

// Employer / payroll
p.employer = originalEmployer;
p.payor = originalPayor;

// Venue / show / site
p.venue = originalVenue;
p.showName = originalShow;
p.jobSite = originalJobSite;
    
// Recover hourly rate
const rateCell = cells.find(c =>
  /^\$?\d+\.\d{2}$/.test(c)
);

if (rateCell) {
  const r = parseRate(rateCell);

  if (r != null) {
    p.hourlyRate = r;

    if (!matched.includes('hourlyRate')) {
      matched.push('hourlyRate');
    }
  }
}
    // Recover dress code
    const shortCode = cells.find(c =>
      /^[A-Z]{2,4}$/.test(c)
    );

    if (shortCode) {
      p.dressCode = shortCode;

      if (!matched.includes('dressCode')) {
        matched.push('dressCode');
      }
    }

    // Recover report-to name
    const person = cells.find(c =>
      /^[A-Z]+(?:[- ][A-Z]+)+$/i.test(c)
    );

    if (person) {
      p.reportTo = person;

      if (!matched.includes('reportTo')) {
        matched.push('reportTo');
      }
    }

    // Recover contract reference
    const contractCell = cells.find(isContractRef);

    if (contractCell) {
      p.contractRef = contractCell;

      if (!matched.includes('contractRef')) {
        matched.push('contractRef');
      }
    }
  }
}
    // Content rescues — recover the high-signal fields if a collapsed blank
    // cell shifted things.
    if (!p.jobNumber || !isJobNum(p.jobNumber)) {
      const c = cells.find(isJobNum);
      if (c) { p.jobNumber = c; if (!matched.includes('jobNumber')) matched.push('jobNumber'); }
    }
    if (!p.workDate) {
      for (const c of cells) {
        const d = normalizeDate(c);
        if (d) { p.workDate = d; matched.push('workDate'); break; }
      }
    }
    if (p.hourlyRate == null) {
      const c = cells.find((x) => x.includes('$'));
      if (c) { const r = parseRate(c); if (r != null) { p.hourlyRate = r; matched.push('hourlyRate'); } }
    }
    if (!p.contractRef) {
      const c = cells.find(isContractRef);
      if (c) { p.contractRef = c; matched.push('contractRef'); }
    }

    if (cells.length < 10) {
      warnings.push(
        `Read ${cells.length} columns (expected ${LOCAL16_COLUMNS.length}). ` +
        `A blank column may have shifted things — double-check venue, show, and job site.`
      );
    }
  } else {
    // ---- FALLBACK: labeled text ----
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      for (const [field, re] of LABEL_MAP) {
        if (p[field]) continue;
        const m = l.match(re);
        if (m && m[1].trim()) {
          const val = m[1].trim();
          if (field === 'hourlyRate') {
            const r = parseRate(val);
            if (r != null) { p.hourlyRate = r; matched.push('hourlyRate'); }
          } else if (field === 'workDate') {
            const d = normalizeDate(val);
            p.workDate = d ?? val; matched.push('workDate');
          } else if (field === 'startTime') {
            const t = normalizeTime(val);
            p.startTime = t ?? val; matched.push('startTime');
          } else {
            (p as Record<string, unknown>)[field] = val;
            matched.push(field);
          }
          break;
        }
      }
    }
  }

  if (!p.workDate) warnings.push('No work date found — required to save.');
  if (!p.jobNumber) warnings.push('No job / gig number found.');
  if (!p.positionName) warnings.push('No position / classification found.');
  if (p.hourlyRate == null) warnings.push('No hourly rate found.');
  if (matched.length === 0) warnings.push('Nothing auto-detected — fill the fields in manually.');

  return { parsed: p, matched: [...new Set(matched)], warnings };
}
