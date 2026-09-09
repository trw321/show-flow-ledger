// Deterministic pre-processing for the structured tab-delimited dispatch
// paste format — expands "CB"/"CB THRU"/callback shorthand into separate
// job records in plain JS, before the AI ever sees the text, since this one
// input format is regular enough to parse with certainty (an LLM doing the
// same date math isn't reliably right every call). Extracted into its own
// module (out of NewGigPage.tsx) so it's unit-testable without dragging in
// the whole page component and its UI dependencies — see
// dispatchParsing.test.ts, which pins down every real dispatch text that
// has broken this logic so a future fix can't silently re-break an earlier
// one.

import type { Job } from './store';

export interface ParsedJob {
  jobNumber?: string;
  name: string;
  client: string;
  venue: string;
  date: string;
  startTime?: string;
  endTime?: string;
  status: Job['status'];
  payrollCompany?: string;
  hourlyRate?: number;
  steward?: string;
  parkingCost?: number;
  notes?: string;
}

function toAmPm(s: string): string {
  const u = s.toUpperCase();
  return u === 'A' ? 'AM' : u === 'P' ? 'PM' : u;
}

export function normTime(t: string): string {
  t = t.replace(/[Oo]/g, '0').trim();
  let m: RegExpMatchArray | null;
  m = t.match(/^@?(\d{1,2}):(\d{2})\s*(A(?:M)?|P(?:M)?)$/i);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]} ${toAmPm(m[3])}`;
  m = t.match(/^@?(\d{1,2})(\d{2})\s*(A(?:M)?|P(?:M)?)$/i);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]} ${toAmPm(m[3])}`;
  m = t.match(/^@?(\d{1,2})\s*(A(?:M)?|P(?:M)?)$/i);
  if (m) return `${m[1].padStart(2, '0')}:00 ${toAmPm(m[2])}`;
  m = t.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const h = parseInt(m[1]);
    if (h < 24) {
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${String(h12).padStart(2, '0')}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
    }
  }
  return t;
}

export function isTimeToken(tok: string): boolean {
  const c = tok.replace(/[Oo]/g, '0');
  return (
    /^@?\d{1,2}(?::\d{2})?\s*(?:A(?:M)?|P(?:M)?)$/i.test(c) ||
    /^@?\d{1,2}\d{2}\s*(?:A(?:M)?|P(?:M)?)$/i.test(c) ||
    /^\d{4}$/.test(c)
  );
}

export function splitJobRecords(raw: string): string[] {
  const parts = raw.split(/(?=^\d{4}-\d{4}[\t ]*\r?$)/m);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

export function expandCBRecord(record: string): string[] {
  const lines = record.split('\n');
  let dateLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\d+\/\d+\/\d{2}/.test(lines[i])) { dateLineIdx = i; break; }
  }
  if (dateLineIdx === -1) return [record];

  const dateLine = lines[dateLineIdx];
  const dateHasTabs = dateLine.includes('\t');
  let dataLineIdx: number;
  let lineNotes: string;
  let rest: string;

  if (dateHasTabs) {
    dataLineIdx = dateLineIdx;
    const fields = dateLine.split('\t');
    lineNotes = (fields[1] ?? '').trim();
    rest = '\t' + fields.slice(2).join('\t');
  } else {
    dataLineIdx = -1;
    for (let i = dateLineIdx + 1; i < lines.length; i++) {
      if (lines[i].includes('\t')) { dataLineIdx = i; break; }
    }
    if (dataLineIdx === -1) {
      lineNotes = lines.slice(dateLineIdx + 1).map(l => l.trim()).filter(Boolean).join(' ');
      rest = '';
      dataLineIdx = lines.length;
    } else {
      const dataLine = lines[dataLineIdx];
      const firstTab = dataLine.indexOf('\t');
      const wrapped = lines.slice(dateLineIdx + 1, dataLineIdx).map(l => l.trim()).filter(Boolean);
      lineNotes = [...wrapped, dataLine.slice(0, firstTab).trim()].join(' ');
      rest = dataLine.slice(firstTab);
    }
  }

  lineNotes = lineNotes.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  if (!/\bC\/?B\b/i.test(lineNotes)) return [record];
  if (/\bNO[\s/-]*C\/?B\b/i.test(lineNotes)) return [record];

  const dtMatch = dateLine.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+([^\t\n]*))/);
  if (!dtMatch) return [record];
  const parentM = parseInt(dtMatch[1]);
  const parentD = parseInt(dtMatch[2]);
  const yr = dtMatch[3];
  const fullYr = 2000 + parseInt(yr);
  const parentTime = (dtMatch[4] ?? '').trim();
  const parentDate = new Date(fullYr, parentM - 1, parentD);
  const parentDateOnly = `${parentM}/${parentD}/${yr}`;

  const cbKeyMatch = lineNotes.match(/^(.*?)\s*\bC\/?B(?:'?[Ss])?\b[,\s]*/i);
  if (!cbKeyMatch) return [record];
  const prefix = cbKeyMatch[1].trim();
  let cbContent = lineNotes.slice(cbKeyMatch[0].length).trim();
  cbContent = cbContent.replace(/^SAME\s*DAY\s*,?\s*/i, '').replace(/^@\s*/, '').replace(/^,\s*/, '').trim();

  const parseMD = (md: string): Date => {
    const [m, d] = md.split('/').map(Number);
    return new Date(fullYr, m - 1, d);
  };
  const fmtDate = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()}/${yr}`;

  const makeRecord = (dateOnly: string, notePfx: string, timeOverride?: string): string => {
    const tPart = timeOverride !== undefined ? timeOverride : parentTime;
    const dateTime = tPart ? `${dateOnly} ${tPart}` : dateOnly;
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!dateHasTabs && i > dateLineIdx && i < dataLineIdx) continue;
      if (i === dateLineIdx && dateHasTabs) {
        out.push(`${dateTime}\t${notePfx}${rest}`);
      } else if (i === dateLineIdx) {
        out.push(dateTime);
      } else if (!dateHasTabs && i === dataLineIdx) {
        out.push(notePfx + rest);
      } else {
        out.push(lines[i]);
      }
    }
    if (!dateHasTabs && dataLineIdx >= lines.length && notePfx) out.push(notePfx);
    return out.join('\n');
  };

  type CBEntry = { date: Date; time?: string; note?: string };
  const cbEntries: CBEntry[] = [];
  const hasLeadingDate = /^\d{1,2}\/\d{1,2}/.test(cbContent);
  const hasThru = /^THRU\b/i.test(cbContent);

  if (hasThru) {
    const thruM = cbContent.match(/^THRU\s+(\d{1,2}\/\d{1,2})(.*)/i)!;
    const thruEnd = parseMD(thruM[1]);
    let rem = thruM[2].trim();
    const dark = new Set<string>();
    rem = rem.replace(/,?\s*\bDARK\s+(\d{1,2}\/\d{1,2})/gi, (_: string, d: string) => { dark.add(d.trim()); return ''; }).trim();
    const cur = new Date(parentDate);
    cur.setDate(cur.getDate() + 1);
    while (cur <= thruEnd) {
      const md = `${cur.getMonth() + 1}/${cur.getDate()}`;
      if (!dark.has(md)) cbEntries.push({ date: new Date(cur) });
      cur.setDate(cur.getDate() + 1);
    }
    const thenMatch = rem.match(/\b(THEN|AND)\b(.*)/i);
    if (thenMatch) {
      // "AND THEN 8/30" — the regex above only consumes whichever connector
      // word ("AND") comes first, leaving a literal "THEN " still prefixed
      // on the remainder, which broke the date match below. Strip it too.
      const thenPart = thenMatch[2].trim().replace(/^(?:AND|THEN)\s+/i, '').replace(/\bAT\s+/gi, '@');
      const parts = thenPart.split(/\s*(?:,|&)\s*/);
      let trailingTime: string | undefined;
      let trailingNote: string | undefined;
      const thenEntries: CBEntry[] = [];
      for (const part of parts) {
        const dm = part.match(/^(\d{1,2}\/\d{1,2})(.*)/);
        if (!dm) { if (part.trim()) trailingNote = part.trim(); continue; }
        let rem2 = dm[2].trim();
        let timeOverride: string | undefined;
        const atM = rem2.match(/^(@\S+)\s*(.*)/);
        if (atM && isTimeToken(atM[1])) { timeOverride = normTime(atM[1]); trailingTime = timeOverride; rem2 = atM[2].trim(); }
        if (rem2) trailingNote = rem2;
        thenEntries.push({ date: parseMD(dm[1]), time: timeOverride, note: rem2 || undefined });
      }
      for (const e of thenEntries) {
        if (!e.time && trailingTime) e.time = trailingTime;
        if (!e.note && trailingNote) e.note = trailingNote;
      }
      cbEntries.push(...thenEntries);
    } else {
      const noteM = rem.match(/\b(FOR|WITH)\b\s*(.+)/i);
      if (noteM) for (const e of cbEntries) e.note = noteM[0].trim();
    }
  } else if (hasLeadingDate) {
    const parts = cbContent.split(/\s*(?:,|&)\s*/);
    let trailingNote = '';
    for (const part of parts) {
      const dm = part.match(/^(\d{1,2}\/\d{1,2})(.*)/);
      if (!dm) { if (part.trim()) trailingNote = part.trim(); continue; }
      let rem2 = dm[2].trim();
      let timeOverride: string | undefined;
      const atM = rem2.match(/^(@\S+)\s*(.*)/);
      if (atM && isTimeToken(atM[1])) { timeOverride = normTime(atM[1]); rem2 = atM[2].trim(); }
      if (rem2) trailingNote = rem2;
      cbEntries.push({ date: parseMD(dm[1]), time: timeOverride, note: rem2 || undefined });
    }
    if (trailingNote) for (const e of cbEntries) if (!e.note) e.note = trailingNote;
  } else {
    const trailingDateM = cbContent.match(/^(.+)\s+(\d{1,2}\/\d{1,2})\s*$/);
    if (trailingDateM) {
      cbEntries.push({ date: parseMD(trailingDateM[2]), time: '', note: trailingDateM[1].trim() || undefined });
    } else {
      const tokM = cbContent.match(/^(@?\S+)\s*(.*)/);
      if (tokM && isTimeToken(tokM[1])) {
        // "CB 6PM" — a real second call later the same day, distinguishable
        // from plain descriptive text by actually starting with a time.
        cbEntries.push({ date: new Date(parentDate), time: normTime(tokM[1]), note: tokM[2].trim() || undefined });
      }
      // Neither a trailing date nor a leading time — e.g. "CB FOR OUT" or
      // "CB FOR LOAD OUT" is describing what this same shift covers, not
      // naming a second dated/timed call. Nothing to expand; falls through
      // to the cbEntries.length === 0 check below and returns the record
      // unchanged instead of fabricating a same-day duplicate.
    }
  }

  if (cbEntries.length === 0) return [record];
  const parentRecord = makeRecord(parentDateOnly, prefix);
  const cbRecords = cbEntries.map(e => makeRecord(fmtDate(e.date), e.note ?? '', e.time ?? ''));
  return [parentRecord, ...cbRecords];
}

// Deterministic fallback for "CB THRU <date> [DARK <date>] [AND/THEN <date>...]"
// left unexpanded in a parsed job's notes. The text-paste path already expands
// this in JS before the AI ever sees it (expandCBRecord above), so it's
// reliable there — but the photo path asks GPT-4o vision to both read the
// image AND do this date-range expansion itself, and that's not consistent
// call to call. Rather than re-prompt-engineer indefinitely, catch whatever
// the AI left unexpanded and do the date math here instead, same as the text
// path already does. No-op (returns the job unchanged) when there's nothing
// to expand, so it's safe to run over every parsed job regardless of source.
export function expandThruNotes(job: ParsedJob): ParsedJob[] {
  const notes = job.notes ?? '';
  const cbMatch = notes.match(/^(.*?)\s*\bC\/?B(?:'?[Ss])?\b[,\s]*/i);
  if (!cbMatch || !job.date) return [job];
  if (/\bNO[\s/-]*C\/?B\b/i.test(notes)) return [job];

  const prefix = cbMatch[1].trim();
  let cbContent = notes.slice(cbMatch[0].length).trim();
  cbContent = cbContent.replace(/^SAME\s*DAY\s*,?\s*/i, '').trim();
  if (!/^THRU\b/i.test(cbContent)) return [job];

  // Built at midnight (not noon-anchored) to match parseMD below exactly —
  // mixing time-of-day between the two caused an off-by-one that silently
  // dropped the range's last day.
  const [py, pm, pd] = job.date.split('-').map(Number);
  if (!py || !pm || !pd) return [job];
  const parentDate = new Date(py, pm - 1, pd);
  const year = py;
  const parseMD = (md: string): Date | null => {
    const [m, d] = md.split('/').map(Number);
    return m && d ? new Date(year, m - 1, d) : null;
  };
  const fmtISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const thruM = cbContent.match(/^THRU\s+(\d{1,2}\/\d{1,2})(.*)/i);
  const thruEnd = thruM ? parseMD(thruM[1]) : null;
  if (!thruM || !thruEnd) return [job];
  let rem = thruM[2].trim();

  const dark = new Set<string>();
  rem = rem.replace(/,?\s*\bDARK\s+(\d{1,2}\/\d{1,2})/gi, (_m, d: string) => { dark.add(d.trim()); return ''; }).trim();

  const dailyDates: Date[] = [];
  const cur = new Date(parentDate);
  cur.setDate(cur.getDate() + 1);
  while (cur <= thruEnd) {
    const md = `${cur.getMonth() + 1}/${cur.getDate()}`;
    if (!dark.has(md)) dailyDates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }

  const extraEntries: { date: Date; note?: string }[] = [];
  const thenMatch = rem.match(/\b(THEN|AND)\b(.*)/i);
  if (thenMatch) {
    const thenPart = thenMatch[2].trim().replace(/^(?:AND|THEN)\s+/i, '');
    let trailingNote: string | undefined;
    for (const part of thenPart.split(/\s*(?:,|&)\s*/)) {
      const dm = part.match(/^(\d{1,2}\/\d{1,2})(.*)/);
      if (!dm) { if (part.trim()) trailingNote = part.trim(); continue; }
      const d = parseMD(dm[1]);
      if (!d) continue;
      const noteText = dm[2].trim() || undefined;
      if (noteText) trailingNote = noteText;
      extraEntries.push({ date: d, note: noteText });
    }
    for (const e of extraEntries) if (!e.note && trailingNote) e.note = trailingNote;
  }

  if (dailyDates.length === 0 && extraEntries.length === 0) return [job];

  // Callback entries almost never come with a real end time — the one on the
  // template job (if any) belongs to that specific day, not every day in the
  // range, so it's dropped rather than copied onto every generated entry.
  const parentJob: ParsedJob = { ...job, notes: prefix || undefined };
  const dailyJobs: ParsedJob[] = dailyDates.map(d => ({ ...job, date: fmtISO(d), notes: undefined, endTime: undefined }));
  const extraJobs: ParsedJob[] = extraEntries.map(e => ({ ...job, date: fmtISO(e.date), notes: e.note, endTime: undefined }));
  return [parentJob, ...dailyJobs, ...extraJobs];
}

/**
 * Runs expandThruNotes across a whole parsed batch, but guards against
 * re-expanding a job number the AI already split into multiple entries —
 * without this, a batch where the AI partially expanded a range (e.g. 3 of 7
 * days, each still carrying the original "CB THRU..." text in its notes)
 * would have every one of those entries independently re-expand the full
 * range again, producing a quadratic explosion of duplicates instead of the
 * intended 7. If ANY entry in a job-number group still has unexpanded THRU
 * text, the whole group is discarded and rebuilt fresh from one template
 * entry; groups with nothing left to expand pass through untouched.
 */
export function expandThruNotesForBatch(jobs: ParsedJob[]): ParsedJob[] {
  const groups = new Map<string, ParsedJob[]>();
  const order: string[] = [];
  jobs.forEach(j => {
    const key = j.jobNumber?.trim() || `${j.date}__${j.client}__${j.venue}__${j.name}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(j);
  });

  const result: ParsedJob[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    const unexpandedIdx = group.findIndex(j => expandThruNotes(j).length > 1);
    if (unexpandedIdx === -1) {
      result.push(...group);
    } else {
      result.push(...expandThruNotes(group[unexpandedIdx]));
    }
  }
  // A shift can't legitimately end at the exact moment it starts — that's
  // always a bad extraction, not a real zero-duration call. Applied broadly,
  // not just to entries this function generated.
  const normTimeForCompare = (t?: string) => (t ?? '').trim().toLowerCase().replace(/^0/, '');
  return result.map(j =>
    j.startTime && j.endTime && normTimeForCompare(j.startTime) === normTimeForCompare(j.endTime)
      ? { ...j, endTime: undefined }
      : j
  );
}
