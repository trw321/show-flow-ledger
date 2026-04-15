import { useState, useRef, useCallback } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { NotebookPen, Upload, Loader2, Check, AlertTriangle, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';

// ── Types ──────────────────────────────────────────────────────────────────

interface ParsedEntry {
  rawLine: string;
  date: string;         // yyyy-MM-dd
  startTime?: string;
  endTime?: string;
  mealType?: 'YWA' | 'NWA';
  location?: string;
}

interface ReviewRow extends ParsedEntry {
  matchedJobIds: string[];   // jobs on this date
  selectedJobId: string;     // which one we'll update
  editedStart: string;
  editedEnd: string;
  editedMeal: 'YWA' | 'NWA' | '';
  hoursCalc: number;
}

// ── Parsers ────────────────────────────────────────────────────────────────

function normalizeTime(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)?$/i);
  if (!m) return raw;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] ?? '0');
  const ap = (m[3] ?? '').toLowerCase().replace(/\./g, '');
  if (ap.startsWith('p') && h < 12) h += 12;
  else if (ap.startsWith('a') && h === 12) h = 0;
  else if (!ap) {
    // No AM/PM: use AV-industry heuristic (5–11 → AM, 1–4 → PM, 12 = noon)
    if (h >= 1 && h <= 4) h += 12;
  }
  return `${h}:${String(min).padStart(2, '0')}`;
}

function calcHoursFromTimes(start?: string, end?: string, meal?: 'YWA' | 'NWA' | ''): number {
  if (!start || !end) return 0;
  const toMins = (t: string) => {
    const m = t.match(/(\d{1,2}):(\d{2})/);
    if (!m) return NaN;
    return parseInt(m[1]) * 60 + parseInt(m[2]);
  };
  let s = toMins(start), e = toMins(end);
  if (isNaN(s) || isNaN(e)) return 0;
  if (e <= s) e += 24 * 60; // overnight
  let mins = e - s;
  if (meal === 'YWA') mins -= 60; // 1hr walk away
  return Math.max(0, mins / 60);
}

function parseScratchText(text: string): ParsedEntry[] {
  const currentYear = new Date().getFullYear();
  const entries: ParsedEntry[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    let rest = line;
    let date: string | null = null;

    // ── Date ──
    // 3.17.26 or 3/17/26 or 3-17-26 (with year)
    let m = rest.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/);
    if (m) {
      const [, mo, dy, yr] = m;
      const y = parseInt(yr) < 100 ? 2000 + parseInt(yr) : parseInt(yr);
      date = `${y}-${mo.padStart(2, '0')}-${dy.padStart(2, '0')}`;
      rest = rest.slice(m[0].length).trim();
    }
    if (!date) {
      // 3/17 or 3.17
      m = rest.match(/^(\d{1,2})[./](\d{1,2})\b/);
      if (m) {
        date = `${currentYear}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        rest = rest.slice(m[0].length).trim();
      }
    }
    if (!date) {
      // Mar 17 / March 17
      m = rest.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{1,2})/i);
      if (m) {
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const mo = months.findIndex(x => m![1].toLowerCase().startsWith(x)) + 1;
        date = `${currentYear}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        rest = rest.slice(m[0].length).trim();
      }
    }
    if (!date) continue; // couldn't parse a date — skip line

    // ── Time range ──
    // Accepts: 9-4, 9am-4pm, 9:00-16:00, 7a-3p, 9:30am-5:30pm
    let startTime: string | undefined;
    let endTime: string | undefined;
    const timeRx = /(\d{1,2}(?::\d{2})?\s*(?:am?|pm?)?)[\s]*[-–to]+[\s]*(\d{1,2}(?::\d{2})?\s*(?:am?|pm?)?)/i;
    const tm = rest.match(timeRx);
    if (tm) {
      startTime = normalizeTime(tm[1]);
      endTime   = normalizeTime(tm[2]);
      rest = rest.replace(tm[0], '').trim();
    }

    // ── Meal type ──
    let mealType: 'YWA' | 'NWA' | undefined;
    if (/\bYWA\b/i.test(rest)) {
      mealType = 'YWA';
      rest = rest.replace(/\bYWA\b/gi, '').trim();
    } else if (/\bNW[AY]\b/i.test(rest)) {
      mealType = 'NWA';
      rest = rest.replace(/\bNW[AY]\b/gi, '').trim();
    }

    // Remaining = location hint
    const location = rest.replace(/^[,;\s]+|[,;\s]+$/g, '') || undefined;

    entries.push({ rawLine: line, date, startTime, endTime, mealType, location });
  }

  return entries;
}

function buildReviewRows(entries: ParsedEntry[], jobs: Job[]): ReviewRow[] {
  return entries.map(e => {
    // Jobs on the same date
    const same = jobs.filter(j => j.date === e.date);

    // If location hint given, prefer jobs whose venue/client/name contains it
    let sorted = same;
    if (e.location) {
      const loc = e.location.toLowerCase();
      sorted = [
        ...same.filter(j =>
          [j.venue, j.client, j.name].some(s => s?.toLowerCase().includes(loc))
        ),
        ...same.filter(j =>
          ![j.venue, j.client, j.name].some(s => s?.toLowerCase().includes(loc))
        ),
      ];
    }

    const best = sorted[0] ?? null;
    const editedMeal: 'YWA' | 'NWA' | '' = e.mealType ?? '';
    const editedStart = e.startTime ?? '';
    const editedEnd = e.endTime ?? '';
    return {
      ...e,
      matchedJobIds: sorted.map(j => j.id),
      selectedJobId: best?.id ?? '',
      editedStart,
      editedEnd,
      editedMeal,
      hoursCalc: calcHoursFromTimes(editedStart, editedEnd, editedMeal),
    };
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function HoursNoteImport() {
  const { data, updateJob } = useData();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleParse = () => {
    const entries = parseScratchText(text);
    if (!entries.length) { toast.error('No entries found — check the format'); return; }
    const reviewRows = buildReviewRows(entries, data.jobs);
    setRows(reviewRows);
    setSelected(new Set(reviewRows.map((_, i) => i).filter(i => reviewRows[i].selectedJobId)));
    setStep('review');
  };

  const handleImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    setLoading(true);
    setOpen(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let bin = ''; for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      const base64 = btoa(bin);
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-statement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type, type: 'hours_log' }),
      });
      const json = await resp.json();
      // Expect { text: "..." } or { lines: [...] } — fall back to raw text pasting
      const extracted: string = json.text ?? json.lines?.join('\n') ?? '';
      if (extracted.trim()) {
        setText(extracted);
        toast.success('Image scanned — review and confirm below');
      } else {
        toast.info('Paste the text from your notes below');
      }
    } catch {
      toast.info('Could not auto-read image — paste the text below');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateRow = (idx: number, patch: Partial<ReviewRow>) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, ...patch };
      next.hoursCalc = calcHoursFromTimes(next.editedStart, next.editedEnd, next.editedMeal);
      return next;
    }));
  };

  const handleSave = () => {
    let saved = 0;
    rows.forEach((row, i) => {
      if (!selected.has(i) || !row.selectedJobId) return;
      const hours = row.hoursCalc;
      const updates: Partial<Job> = { status: 'completed' };
      if (row.editedStart) updates.startTime = row.editedStart;
      if (row.editedEnd)   updates.endTime   = row.editedEnd;
      if (hours > 0)       updates.hoursWorked = parseFloat(hours.toFixed(2));
      if (row.editedMeal === 'YWA') updates.mealType = 'YWA';
      if (row.editedMeal === 'NWA') updates.mealType = 'NWA';
      updateJob(row.selectedJobId, updates);
      saved++;
    });
    toast.success(`${saved} job${saved !== 1 ? 's' : ''} updated`);
    setOpen(false);
    setStep('input'); setText(''); setRows([]);
  };

  const mealLabel = (m: string) =>
    m === 'YWA' ? '1hr walk away' : m === 'NWA' ? '30min on clock' : '—';

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleImage(f); e.currentTarget.value = ''; }} />

      {/* Trigger tile */}
      <div
        className={cn(
          "w-full flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 cursor-pointer transition-all",
          dragging ? "border-primary bg-primary/10 scale-[1.01]" : "border-border hover:border-primary/50 hover:bg-secondary/30"
        )}
        onClick={() => setOpen(true)}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleImage(f); }}
      >
        <div className={cn("rounded-full p-4 transition-colors", dragging ? "bg-primary/20" : "bg-secondary")}>
          <NotebookPen size={28} className={dragging ? "text-primary" : "text-muted-foreground"} />
        </div>
        <div className="text-center">
          <p className="font-semibold text-sm">{dragging ? "Drop to scan" : "Log Hours from Notes"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Paste or photo your scratch notes — <span className="text-mono">3/17 9-4 YWA venue</span>
          </p>
          <p className="text-xs text-primary font-medium mt-2">Matches dates to existing jobs</p>
        </div>
      </div>

      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) { setStep('input'); setText(''); setRows([]); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-mono">Log Hours from Scratch Notes</DialogTitle>
          </DialogHeader>

          {step === 'input' && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                One entry per line. Format: <span className="text-mono bg-secondary px-1 rounded">date  start-end  YWA/NWA  location (optional)</span>
              </p>
              <div className="grid grid-cols-3 gap-2 text-[10px] text-mono text-muted-foreground/70 bg-secondary/20 rounded-xl p-3">
                <span>3/17  9-4  YWA  Staples Ctr</span>
                <span>3.18.26  7am-3pm  NWA</span>
                <span>Mar 19  8-6  YWA  Hollywood Bowl</span>
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8">
                  <Loader2 size={20} className="animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Scanning image...</p>
                </div>
              ) : (
                <Textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={"3/17  9-4  YWA  Staples Center\n3/18  7am-3pm  NWA\n3/19  8-6  YWA  Hollywood Bowl"}
                  rows={8}
                  className="font-mono text-sm"
                />
              )}

              <div className="flex items-center justify-between gap-2">
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={13} /> Scan a photo instead
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button size="sm" disabled={!text.trim()} onClick={handleParse}>
                    Parse Notes →
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {rows.length} entr{rows.length !== 1 ? 'ies' : 'y'} parsed —
                  <span className="text-success ml-1">{rows.filter(r => r.selectedJobId).length} matched</span>
                  {rows.filter(r => !r.selectedJobId).length > 0 && (
                    <span className="text-destructive ml-1">· {rows.filter(r => !r.selectedJobId).length} unmatched</span>
                  )}
                </p>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelected(selected.size === rows.filter(r => r.selectedJobId).length
                    ? new Set()
                    : new Set(rows.map((_, i) => i).filter(i => rows[i].selectedJobId)))}
                >
                  {selected.size > 0 ? 'Deselect all' : 'Select matched'}
                </button>
              </div>

              <div className="space-y-2">
                {rows.map((row, i) => {
                  const isSelected = selected.has(i);
                  const hasMatch = !!row.selectedJobId;
                  const matchedJob = data.jobs.find(j => j.id === row.selectedJobId);

                  return (
                    <div
                      key={i}
                      className={cn(
                        "rounded-xl border p-3 transition-colors",
                        !hasMatch ? "border-border/40 opacity-60 bg-secondary/10" :
                        isSelected ? "border-primary/30 bg-primary/5" : "border-border opacity-60"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected && hasMatch}
                          disabled={!hasMatch}
                          onChange={() => setSelected(prev => {
                            const next = new Set(prev);
                            next.has(i) ? next.delete(i) : next.add(i);
                            return next;
                          })}
                          className="mt-1 rounded accent-primary shrink-0"
                        />

                        <div className="flex-1 space-y-2 min-w-0">
                          {/* Raw line + match status */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] text-mono text-muted-foreground/60 bg-secondary px-1.5 py-0.5 rounded">
                              {row.rawLine}
                            </span>
                            {hasMatch ? (
                              <span className="text-[10px] text-success flex items-center gap-1">
                                <Check size={10} /> {format(new Date(row.date + 'T12:00:00'), 'EEE MMM d')}
                              </span>
                            ) : (
                              <span className="text-[10px] text-destructive flex items-center gap-1">
                                <AlertTriangle size={10} /> no job on {row.date}
                              </span>
                            )}
                          </div>

                          {/* Job picker */}
                          {row.matchedJobIds.length > 0 && (
                            <select
                              value={row.selectedJobId}
                              onChange={e => updateRow(i, { selectedJobId: e.target.value })}
                              className="w-full h-8 rounded-lg border border-border bg-background px-2 text-xs"
                            >
                              {row.matchedJobIds.map(id => {
                                const j = data.jobs.find(x => x.id === id)!;
                                return <option key={id} value={id}>{j.name} · {j.client}{j.venue ? ` · ${j.venue}` : ''}</option>;
                              })}
                            </select>
                          )}

                          {/* Editable time + meal */}
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div>
                              <p className="text-[9px] text-muted-foreground/50 mb-0.5">start</p>
                              <Input value={row.editedStart} onChange={e => updateRow(i, { editedStart: e.target.value })}
                                placeholder="e.g. 9:00" className="h-7 text-xs text-mono" />
                            </div>
                            <div>
                              <p className="text-[9px] text-muted-foreground/50 mb-0.5">end</p>
                              <Input value={row.editedEnd} onChange={e => updateRow(i, { editedEnd: e.target.value })}
                                placeholder="e.g. 17:00" className="h-7 text-xs text-mono" />
                            </div>
                            <div className="col-span-2">
                              <p className="text-[9px] text-muted-foreground/50 mb-0.5">meal break</p>
                              <div className="flex gap-1">
                                {(['', 'YWA', 'NWA'] as const).map(opt => (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => updateRow(i, { editedMeal: opt })}
                                    className={cn(
                                      "flex-1 rounded-lg border text-[10px] py-1 transition-colors",
                                      row.editedMeal === opt
                                        ? "bg-primary/15 border-primary/50 text-primary font-semibold"
                                        : "border-border text-muted-foreground hover:border-primary/30"
                                    )}
                                  >
                                    {opt === '' ? 'none' : opt}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Hours preview */}
                          {row.hoursCalc > 0 && (
                            <p className="text-[10px] text-mono text-primary">
                              = {row.hoursCalc.toFixed(2)}h paid
                              {row.editedMeal === 'YWA' && <span className="text-muted-foreground ml-1">(−1h walk away)</span>}
                              {row.editedMeal === 'NWA' && <span className="text-muted-foreground ml-1">(30min on clock)</span>}
                              {matchedJob?.hourlyRate ? (
                                <span className="text-success ml-2">
                                  ${(row.hoursCalc * matchedJob.hourlyRate).toFixed(0)}
                                </span>
                              ) : null}
                            </p>
                          )}
                        </div>

                        {!hasMatch && <X size={14} className="text-destructive/50 shrink-0 mt-1" />}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={() => setStep('input')}>← Back</Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button size="sm" disabled={selected.size === 0} onClick={handleSave}>
                    <Check size={14} className="mr-1" /> Save {selected.size} entr{selected.size !== 1 ? 'ies' : 'y'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
