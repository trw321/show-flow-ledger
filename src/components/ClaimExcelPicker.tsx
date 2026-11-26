import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { CLAIM_SHEETS, EMPLOYER_COLUMNS, WEEK_COLUMNS, readExcelPicks, type ClaimExcelPicks, type ClaimSheet } from '@/lib/claimExcel';
import { cn } from '@/lib/utils';

const LABEL = 'neon-label text-[hsl(188_95%_72%)]';
const PICKS_KEY = 'show-flow-claim-excel';
const chip = (on: boolean) => cn('pixel-button px-2 py-1 text-[11px] font-bold text-mono', on ? 'pick-on' : 'pick-off');

/**
 * The claim's Excel download, with you picking what goes in it: which sheets
 * (weeks, employers, pay stubs), which columns on each, and which employers.
 * The picks are remembered on this phone.
 */
export default function ClaimExcelPicker({ employers, hasStubs, onDownload }: {
  /** Every employer in the claim: [name as listed, name as shown]. */
  employers: { name: string; shown: string }[];
  hasStubs: boolean;
  onDownload: (picks: ClaimExcelPicks) => void;
}) {
  const [picks, setPicks] = useState<ClaimExcelPicks>(() => {
    try { return readExcelPicks(localStorage.getItem(PICKS_KEY)); } catch { return readExcelPicks(null); }
  });
  useEffect(() => {
    try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* only a convenience */ }
  }, [picks]);

  const flip = <K extends 'weekColumns' | 'employerColumns' | 'leaveOut'>(key: K, value: string) =>
    setPicks(p => ({ ...p, [key]: p[key].includes(value) ? p[key].filter(v => v !== value) : [...p[key], value] }));
  const flipSheet = (id: ClaimSheet) =>
    setPicks(p => ({ ...p, sheets: p.sheets.includes(id) ? p.sheets.filter(s => s !== id) : [...p.sheets, id] }));

  const sheets = CLAIM_SHEETS.filter(s => s.id !== 'stubs' || hasStubs);
  const on = (id: ClaimSheet) => picks.sheets.includes(id);
  const leftOut = new Set(picks.leaveOut);
  const included = employers.filter(e => !leftOut.has(e.name)).length;
  // Something to put in it: a sheet picked that has columns, and an employer.
  const usable = (on('weeks') && picks.weekColumns.length > 0) || (on('employers') && picks.employerColumns.length > 0) || (on('stubs') && hasStubs);
  const ready = usable && included > 0;

  return (
    <div className="neon-well space-y-3 p-2.5" data-testid="excel-picker">
      <div className="space-y-1.5">
        <p className={LABEL}>Sheets</p>
        <div className="flex flex-wrap gap-1.5">
          {sheets.map(s => (
            <button key={s.id} type="button" onClick={() => flipSheet(s.id)} aria-pressed={on(s.id)} className={chip(on(s.id))} data-testid="excel-sheet">{s.label}</button>
          ))}
        </div>
      </div>
      {on('employers') && (
        <div className="space-y-1.5">
          <p className={LABEL}>Employer columns</p>
          <div className="flex flex-wrap gap-1.5">
            {EMPLOYER_COLUMNS.map(c => (
              <button key={c} type="button" onClick={() => flip('employerColumns', c)} aria-pressed={picks.employerColumns.includes(c)} className={chip(picks.employerColumns.includes(c))}>{c}</button>
            ))}
          </div>
        </div>
      )}
      {on('weeks') && (
        <div className="space-y-1.5">
          <p className={LABEL}>Week columns</p>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_COLUMNS.map(c => (
              <button key={c} type="button" onClick={() => flip('weekColumns', c)} aria-pressed={picks.weekColumns.includes(c)} className={chip(picks.weekColumns.includes(c))}>{c}</button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className={LABEL}>Employers · {included} of {employers.length}</p>
          <button type="button" onClick={() => setPicks(p => ({ ...p, leaveOut: included === employers.length ? employers.map(e => e.name) : [] }))}
            className="text-[11px] font-bold text-mono text-[hsl(312_95%_75%)] active:opacity-70" data-testid="excel-all">
            {included === employers.length ? 'None' : 'All'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {employers.map(e => (
            <button key={e.name} type="button" onClick={() => flip('leaveOut', e.name)} aria-pressed={!leftOut.has(e.name)} className={chip(!leftOut.has(e.name))} data-testid="excel-employer">
              {e.shown}
            </button>
          ))}
        </div>
      </div>
      <button type="button" disabled={!ready} onClick={() => onDownload(picks)} data-testid="excel-download"
        className="pixel-button pick-on flex w-full items-center justify-center gap-1.5 py-2 text-xs font-bold text-mono disabled:opacity-40">
        <Download size={14} aria-hidden /> Download Excel
      </button>
    </div>
  );
}
