import { forwardRef, useMemo } from 'react';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import DateWheels from '@/components/DateWheels';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { localToday } from '@/lib/today';
import { afterCertifying, certifyPeriod, certifyStatus, dueText, reminderOn, startCertify } from '@/lib/reminders';
import { claimDay, claimMoney, claimSummary, weeksAsText, type WeekEnd } from '@/lib/unemployment';
import { cn } from '@/lib/utils';

/**
 * Certifying for unemployment: the state wants an update every two weeks
 * (every week in some places). Set when the next one is due, and Preamp
 * reminds you from the day before; the weeks it covers are here with their
 * hours and pay, ready to copy. "I certified" moves it on a cycle. The
 * reminder can be switched off here or in Settings.
 */
const CertifyPanel = forwardRef<HTMLElement, { weekEnd: WeekEnd }>(function CertifyPanel({ weekEnd }, ref) {
  const { data } = useData();
  const { prefs, setCertify, setReminder } = useUserPrefs();
  const today = localToday();
  const schedule = prefs.certify;
  const on = !!schedule && reminderOn(prefs.reminders, 'certify');
  const status = schedule ? certifyStatus(schedule, today) : null;
  const period = schedule ? certifyPeriod(schedule, weekEnd) : null;
  const weeks = useMemo(
    () => (period ? claimSummary(data.jobs, data.employers, prefs.payer, period.from, period.through, weekEnd).weeks : []),
    [period?.from, period?.through, data.jobs, data.employers, prefs.payer, weekEnd], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const thisYear = Number(today.slice(0, 4));

  const toggle = (want: boolean) => {
    if (want && !schedule) setCertify(startCertify(today, weekEnd), true);
    else setReminder('certify', want);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(weeksAsText(weeks));
      toast.success(`Copied ${weeks.length} week${weeks.length === 1 ? '' : 's'}`);
    } catch {
      toast.error("Couldn't copy here.");
    }
  };

  const certified = () => {
    if (!schedule) return;
    const next = afterCertifying(schedule, today);
    setCertify(next);
    toast.success(`Next one due ${claimDay(next.next)}`);
  };

  return (
    <section ref={ref} className="space-y-3 border border-[hsl(188_95%_62%/0.5)] bg-[#0b0614]/70 p-3" data-testid="certify">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-8bit text-[8px] uppercase text-[hsl(188_95%_72%)]">Certify</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {schedule ? `Every ${schedule.every === 14 ? '2 weeks' : 'week'}` : 'A reminder when your update to the state is due'}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[11px] text-mono">
          Remind me
          <Switch checked={on} onCheckedChange={toggle} aria-label="Remind me to certify" data-testid="certify-switch" />
        </label>
      </div>

      {schedule && status && period && (
        <>
          <p className={cn('text-sm font-bold text-mono', status.days < 0 ? 'text-dot-late' : status.days <= 1 ? 'text-primary' : 'text-foreground')} data-testid="certify-status">
            Next one {dueText(status.days)} · {claimDay(schedule.next)}
          </p>
          <DateWheels label="Next one due" value={schedule.next} firstYear={thisYear - 1} lastYear={thisYear + 1}
            onChange={next => setCertify({ ...schedule, next })} testId="certify-next" />
          <div className="flex gap-2">
            {([14, 7] as const).map(every => (
              <button key={every} type="button" onClick={() => setCertify({ ...schedule, every })}
                className={cn('pixel-button flex-1 py-1.5 text-[11px] font-bold', schedule.every === every ? 'pick-on' : 'pick-off')}>
                Every {every === 14 ? '2 weeks' : 'week'}
              </button>
            ))}
          </div>

          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">
              It covers {claimDay(period.from, false)} to {claimDay(period.through, false)}:
            </p>
            <ul className="divide-y divide-border/60 border border-border text-[12px] text-mono" data-testid="certify-weeks">
              {weeks.map(w => (
                <li key={w.weekEnding} className="flex items-baseline justify-between gap-2 px-2.5 py-1.5">
                  <span className="min-w-0 truncate">Week ending {claimDay(w.weekEnding, false)}</span>
                  <span className={cn('shrink-0', w.lines.length === 0 && 'text-muted-foreground')}>
                    {w.lines.length === 0 ? 'No work' : `${w.hours} h · ${claimMoney(w.gross)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => void copy()} className="pixel-button pick-off flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold">
              <Copy size={13} aria-hidden /> Copy these weeks
            </button>
            <button type="button" onClick={certified} data-testid="certify-done"
              className="pixel-button pick-on flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold">
              <Check size={13} aria-hidden /> I certified
            </button>
          </div>
        </>
      )}
    </section>
  );
});

export default CertifyPanel;
