import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { Job } from '@/lib/store';

const statusColors: Record<string, string> = {
  upcoming: 'bg-accent/20 text-accent border-accent/30',
  'in-progress': 'bg-primary/20 text-primary border-primary/30',
  completed: 'bg-success/20 text-success border-success/30',
  cancelled: 'bg-destructive/20 text-destructive border-destructive/30',
};

const statusLabel: Record<string, string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function LogHoursForm({ initial, onSubmit, onCancel }: {
  initial: Partial<Job>;
  onSubmit: (updates: Partial<Job>) => void;
  onCancel?: () => void;
}) {
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  const [mealType, setMealType] = useState<Job['mealType']>(initial?.mealType ?? undefined);
  const [mealPenalties, setMealPenalties] = useState(initial?.mealPenalties?.toString() ?? '0');
  const [notes, setNotes] = useState('');

  // Calculate hours from start/end
  const calcHours = (): number => {
    if (!startTime || !endTime) return 0;
    const parseTime = (t: string) => {
      const match = t.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
      if (!match) return NaN;
      let h = parseInt(match[1]);
      const m = parseInt(match[2] || '0');
      const ampm = (match[3] || '').toLowerCase();
      if (ampm.startsWith('p') && h < 12) h += 12;
      if (ampm.startsWith('a') && h === 12) h = 0;
      return h * 60 + m;
    };
    let start = parseTime(startTime);
    let end = parseTime(endTime);
    if (isNaN(start) || isNaN(end)) return 0;
    if (end <= start) end += 24 * 60; // overnight
    let mins = end - start;
    // Subtract meal break
    if (mealType === 'YWA') mins -= 60;
    return Math.max(0, mins / 60);
  };

  const hours = calcHours();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      startTime: startTime.trim() || undefined,
      endTime: endTime.trim() || undefined,
      hoursWorked: hours > 0 ? parseFloat(hours.toFixed(2)) : undefined,
      mealType: mealType || undefined,
      mealPenalties: mealPenalties ? parseInt(mealPenalties) : 0,
      notes: notes.trim(),
    });
  };

  const mealOptions: { value: Job['mealType']; label: string }[] = [
    { value: 'YWA', label: '1hr Walk Away' },
    { value: 'NWA', label: '30min On Clock' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Job info header — styled like calendar cards */}
      <div className={cn(
        "rounded-xl border p-3 space-y-1",
        initial.status ? statusColors[initial.status] : 'bg-secondary/30 border-border'
      )}>
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-sm">{initial?.name}</p>
          {initial.status && (
            <span className="text-[9px] text-mono uppercase font-semibold opacity-70 shrink-0">
              {statusLabel[initial.status] ?? initial.status}
            </span>
          )}
        </div>
        {initial.client && (
          <p className="text-xs opacity-70">{initial.client}{initial.venue ? ` • ${initial.venue}` : ''}</p>
        )}
        {initial.date && (
          <p className="text-xs text-mono opacity-60">
            {format(new Date(initial.date + 'T12:00:00'), 'EEE, MMM d, yyyy')}
            {initial.startTime && ` · ${initial.startTime}`}
          </p>
        )}
        {(initial.hoursWorked ?? 0) > 0 && initial.hourlyRate && (
          <p className="text-xs text-mono font-semibold opacity-80">
            {initial.hoursWorked}h · ${((initial.hoursWorked ?? 0) * initial.hourlyRate).toLocaleString()}
          </p>
        )}
      </div>

      {/* Start / End */}
      <div>
        <label className="text-xs text-muted-foreground text-mono uppercase tracking-wider mb-1.5 block">Times</label>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Start (7:00 AM)" value={startTime} onChange={e => setStartTime(e.target.value)} className="text-sm rounded-xl" />
          <Input autoFocus placeholder="End (5:30 PM)" value={endTime} onChange={e => setEndTime(e.target.value)} className="text-sm rounded-xl" />
        </div>
        {hours > 0 && (
          <p className="text-xs text-mono text-muted-foreground mt-1.5">
            = <span className="font-semibold text-foreground">{hours.toFixed(1)} hours</span>
            {mealType === 'YWA' && ' (after 1hr meal deduction)'}
          </p>
        )}
      </div>

      {/* Lunch */}
      <div>
        <label className="text-xs text-muted-foreground text-mono uppercase tracking-wider mb-1.5 block">Lunch</label>
        <div className="flex gap-2">
          {mealOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMealType(mealType === opt.value ? undefined : opt.value)}
              className={cn(
                "flex-1 rounded-xl border py-2.5 text-xs font-medium transition-colors",
                mealType === opt.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary/50 text-secondary-foreground border-border'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Meal Penalties */}
      <div>
        <label className="text-xs text-muted-foreground text-mono uppercase tracking-wider mb-1.5 block">Meal Penalties</label>
        <Input
          type="number"
          min="0"
          max="9"
          value={mealPenalties}
          onFocus={e => { if (e.target.value === '0') setMealPenalties(''); }}
          onBlur={e => { if (!e.target.value) setMealPenalties('0'); }}
          onChange={e => setMealPenalties(e.target.value.replace(/^0+/, '') || '0')}
          className="text-sm rounded-xl w-20"
        />
        {parseInt(mealPenalties) > 0 && (
          <p className="text-[11px] text-muted-foreground mt-1">= {mealPenalties} hr(s) straight time added</p>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs text-muted-foreground text-mono uppercase tracking-wider mb-1.5 block">Notes</label>
        <Textarea placeholder="Anything special about this day..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="text-sm rounded-xl" />
      </div>

      <div className="flex gap-2 justify-end pt-1">
        {onCancel && <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" size="sm" className="rounded-xl">Log Hours</Button>
      </div>
    </form>
  );
}
