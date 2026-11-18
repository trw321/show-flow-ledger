import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { LOCAL16_HW, local16Earnings, previousPeriod, quarterStanding, workPeriodFor, type WorkPeriod } from '@/lib/healthWelfare';
import { localToday } from '@/lib/today';
import { cn } from '@/lib/utils';

const money = (n: number) => '$' + Math.round(n).toLocaleString();

/** The work-month to coverage-quarter table, which decides everything else. */
const QUARTERS = [
  ['Aug–Oct', 'Q1 · the following Jan–Mar'],
  ['Nov–Jan', 'Q2 · the following Apr–Jun'],
  ['Feb–Apr', 'Q3 · the following Jul–Sep'],
  ['May–Jul', 'Q4 · the following Oct–Dec'],
];

/**
 * Local 16 health and welfare: whether the work so far keeps you on the
 * plan. Earnings are the app's estimated gross from Local 16 shifts, so the
 * fund's own figures win where they differ.
 */
export default function HealthWelfareCard() {
  const { data } = useData();
  const { prefs } = useUserPrefs();
  const today = localToday();
  const figures = useMemo(() => {
    const now = workPeriodFor(today);
    const last = previousPeriod(now);
    const earned = (p: WorkPeriod) => local16Earnings(p.start, p.end, data.jobs, data.employers, prefs.payer);
    const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    return {
      now, last,
      nowEarned: earned(now),
      lastEarned: earned(last),
      twelve: local16Earnings(yearAgo, today, data.jobs, data.employers, prefs.payer),
    };
  }, [today, data.jobs, data.employers, prefs.payer]);

  const period = (label: string, p: WorkPeriod, gross: number, running: boolean) => {
    const s = quarterStanding(gross);
    const percent = Math.min(100, (gross / LOCAL16_HW.quarterEarnings) * 100);
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[11px] font-medium">{label}: {p.workLabel} → coverage {p.coverageLabel}</span>
          <span className="text-xs font-bold text-mono">{money(gross)} <span className="font-normal text-muted-foreground">of {money(LOCAL16_HW.quarterEarnings)}</span></span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
          <div className={cn('h-full', s.covered ? 'bg-dot-paid' : 'bg-primary')} style={{ width: `${percent}%` }} />
        </div>
        <p className={cn('text-[10px]', s.covered ? 'text-dot-paid' : running ? 'text-muted-foreground' : 'text-warning')}>
          {money(s.contributions)} of {money(LOCAL16_HW.quarterContributions)} in employer contributions.
          {s.covered ? ' Enough for the quarter.' : running
            ? ` ${money(LOCAL16_HW.quarterEarnings - gross)} more to earn by ${new Date(p.end + 'T12:00:00').toLocaleString('en-US', { month: 'short', day: 'numeric' })}, or self-pay ${money(s.selfPay)} if it ends here.`
            : ` Short: if you're on the plan, self-pay ${money(s.selfPay)} to stay on for ${p.coverageLabel}.`}
        </p>
      </div>
    );
  };

  return (
    <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3 space-y-3" data-testid="health-welfare-16">
      <div>
        <p className="text-sm font-bold">Local 16 · Health &amp; Welfare</p>
        <p className="text-[11px] text-muted-foreground">
          Employers pay 15.5% of your Local 16 gross into the plan. Stay on with {money(LOCAL16_HW.quarterEarnings)} earned
          ({money(LOCAL16_HW.quarterContributions)} in contributions) in each work period.
        </p>
      </div>

      {period('Now', figures.now, figures.nowEarned.gross, true)}
      {period('Last', figures.last, figures.lastEarned.gross, false)}

      <div className="space-y-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[11px] font-medium">To qualify: last 12 months</span>
          <span className="text-xs font-bold text-mono">{money(figures.twelve.gross)} <span className="font-normal text-muted-foreground">of {money(LOCAL16_HW.qualifyEarnings)}</span></span>
        </div>
        <p className="text-[10px] text-muted-foreground">{money(LOCAL16_HW.qualifyEarnings)} within 12 months ({money(LOCAL16_HW.qualifyContributions)} in contributions) qualifies you.</p>
      </div>

      <div className="rounded-md border border-warning/50 bg-warning/10 p-2" data-testid="hw-quarters">
        <p className="text-[11px] font-bold">Which months pay for which quarter</p>
        <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          {QUARTERS.map(([work, cover]) => (
            <div key={work} className="contents">
              <span className="font-mono font-bold">{work}</span>
              <span>{cover}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Earnings here are the app's estimate from your Local 16 shifts. The fund's own records decide.
      </p>

      <details className="text-[11px]">
        <summary className="cursor-pointer font-medium">Self-pay, the plan, and who to call</summary>
        <div className="mt-2 space-y-2">
          <ul className="list-disc space-y-0.5 pl-4">
            {LOCAL16_HW.selfPay.map(t => <li key={t}>{t}</li>)}
          </ul>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {LOCAL16_HW.plan.map(t => <li key={t}>{t}</li>)}
          </ul>
          <div className="space-y-1">
            {LOCAL16_HW.contacts.map(c => (
              <p key={c.label}>
                <span className="font-medium">{c.label}:</span>{' '}
                {c.phones.map((ph, i) => (
                  <span key={ph}>{i > 0 && ' or '}<a href={`tel:${ph.replace(/\D/g, '')}`} className="text-primary underline underline-offset-2">{ph}</a></span>
                ))}
              </p>
            ))}
            <p className="text-muted-foreground">Mail: {LOCAL16_HW.mail.join(', ')}</p>
            <a href={LOCAL16_HW.portal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
              Your benefits online (sign up for an account first) <ExternalLink size={11} aria-hidden />
            </a>
          </div>
        </div>
      </details>
    </div>
  );
}
