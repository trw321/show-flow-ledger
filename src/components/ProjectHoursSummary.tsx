import { roundHours } from '@/lib/hoursFormat';
import { showDay } from '@/lib/today';
import { cn } from '@/lib/utils';
import type { ProjectHours } from '@/lib/projectHours';

/**
 * A project's hours at a glance: the total, what they were paid at (in the
 * pay ladder's colours: straight green, overtime amber, double time red), and
 * what's paid, owed or still missing. Lines with nothing to say are left out.
 */
export function ProjectHoursSummary({ hours, title = 'Hours', className }: { hours: ProjectHours; title?: string; className?: string }) {
  if (hours.worked <= 0 && hours.needHours === 0) return null;
  const h = (n: number) => `${roundHours(n)}h`;
  const tiers = [
    { n: hours.straight, label: 'straight', tone: 'text-success' },
    { n: hours.overtime, label: 'OT', tone: 'text-warning' },
    { n: hours.double, label: 'DT', tone: 'text-destructive' },
    { n: hours.night, label: 'after midnight', tone: 'text-destructive' },
    { n: hours.minimum, label: 'minimum call', tone: 'text-muted-foreground' },
    { n: hours.pto, label: 'PTO', tone: 'text-muted-foreground' },
  ].filter(t => roundHours(t.n) > 0);
  const paidMore = roundHours(hours.paid) > roundHours(hours.worked);
  return (
    <div className={cn('space-y-0.5 text-[11px] text-mono', className)} data-testid="project-hours">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
          {title}{hours.days > 0 && ` · ${hours.days} day${hours.days === 1 ? '' : 's'}`}
        </p>
        <p className="shrink-0 whitespace-nowrap text-sm font-bold text-foreground" data-testid="project-hours-total">{h(hours.worked)} worked</p>
      </div>
      {tiers.length > 0 && (
        <p className="flex flex-wrap gap-x-2" data-testid="project-hours-tiers">
          {tiers.map(t => (
            <span key={t.label} className={t.tone}><span className="font-bold">{h(t.n)}</span> {t.label}</span>
          ))}
        </p>
      )}
      {paidMore && (
        <p className="text-muted-foreground">
          Paid on {h(hours.paid)}{roundHours(hours.roundedUp) > 0 && ` · ${h(hours.roundedUp)} from part hours paid whole`}
        </p>
      )}
      {roundHours(hours.premiumDay) > 0 && (
        <p className="text-muted-foreground">{h(hours.premiumDay)} on a 6th or 7th day, at its rate or better</p>
      )}
      {roundHours(hours.holiday) > 0 && (
        <p className="text-muted-foreground">{h(hours.holiday)} on a holiday, with half time on top</p>
      )}
      {roundHours(hours.paidFor) > 0 && roundHours(hours.owed) > 0 && (
        <p data-testid="project-hours-paid">
          <span className="text-dot-paid">{h(hours.paidFor)} paid</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-dot-pending">{h(hours.owed)} still owed</span>
        </p>
      )}
      {hours.longest && hours.days > 1 && (
        <p className="text-muted-foreground">
          Longest {showDay(hours.longest.date, 'EEE MMM d')} · {h(hours.longest.hours)} · about {Math.round((hours.worked / hours.days) * 10) / 10}h a day
        </p>
      )}
      {hours.needHours > 0 && (
        <p className="text-warning">{hours.needHours === 1 ? '1 day still needs' : `${hours.needHours} days still need`} hours, so this is short</p>
      )}
    </div>
  );
}
