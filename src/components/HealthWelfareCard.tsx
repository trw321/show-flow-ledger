import { useMemo, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { LOCAL16_HW, local16Earnings, previousPeriod, quarterStanding, workPeriodFor, type WorkPeriod } from '@/lib/healthWelfare';
import { localToday } from '@/lib/today';
import { cn } from '@/lib/utils';

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const shortDate = (d: string) => new Date(d + 'T12:00:00').toLocaleString('en-US', { month: 'short', day: 'numeric' });

/** The rule itself: which three work months pay for which quarter. */
const QUARTERS = [
  ['Aug–Oct', 'Qtr 1', 'the following Jan–Mar'],
  ['Nov–Jan', 'Qtr 2', 'the following Apr–Jun'],
  ['Feb–Apr', 'Qtr 3', 'Jul–Sep'],
  ['May–Jul', 'Qtr 4', 'Oct–Dec'],
];

/**
 * Local 16 health and welfare. Earnings in each three-month work period pay
 * for a later quarter of coverage, so it lists your own recent periods with
 * the quarter each one pays for, then the plan in brief. Earnings are the
 * app's estimated gross from Local 16 shifts; the fund's records decide.
 */
export default function HealthWelfareCard({ collapsible = false }: { collapsible?: boolean } = {}) {
  // Folded shut where the page already headlines it; tap the title to open.
  const [open, setOpen] = useState(!collapsible);
  const { data } = useData();
  const { prefs } = useUserPrefs();
  const today = localToday();
  const periods = useMemo(() => {
    const list: WorkPeriod[] = [workPeriodFor(today)];
    while (list.length < 4) list.push(previousPeriod(list[list.length - 1]));
    return list.map((p, i) => ({ p, running: i === 0, gross: local16Earnings(p.start, p.end, data.jobs, data.employers, prefs.payer).gross }));
  }, [today, data.jobs, data.employers, prefs.payer]);
  const twelve = useMemo(() => {
    const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    return local16Earnings(yearAgo, today, data.jobs, data.employers, prefs.payer).gross;
  }, [today, data.jobs, data.employers, prefs.payer]);

  return (
    <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3 space-y-3" data-testid="health-welfare-16">
      <div>
        <button type="button" disabled={!collapsible} onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-default">
          <span className="text-sm font-bold">Local 16 · Health &amp; Welfare</span>
          {collapsible && <ChevronDown size={18} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />}
        </button>
        <p className={cn('text-[11px] text-muted-foreground', !open && 'hidden')}>
          Employers pay 15.5% of your Local 16 gross into the plan. Each 3 months of work pays for a later quarter of
          coverage: {money(LOCAL16_HW.quarterEarnings)} earned ({money(LOCAL16_HW.quarterContributions)} in contributions) keeps you on.
        </p>
      </div>

      <div className={open ? 'space-y-3' : 'hidden'} data-testid="hw-body">
      {/* The rule, up top: it decides everything below. */}
      <div className="rounded-md border border-warning/60 bg-warning/10 p-2" data-testid="hw-quarters">
        <p className="text-[11px] font-bold">Months worked → quarter they pay for</p>
        <div className="mt-1 grid grid-cols-[auto_auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
          {QUARTERS.map(([work, q, cover]) => (
            <div key={work} className="contents">
              <span className="font-mono font-bold">{work}</span>
              <span className="font-bold">→ {q}</span>
              <span>{cover}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2.5" data-testid="hw-periods">
        <p className="neon-label text-[hsl(188_95%_72%)]">Your months and the quarters they pay for</p>
        {periods.map(({ p, running, gross }) => {
          const s = quarterStanding(gross);
          const percent = Math.min(100, (gross / LOCAL16_HW.quarterEarnings) * 100);
          return (
            <div key={p.start} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[11px]">
                  <span className="font-bold">{p.workLabel}</span> → Qtr {p.quarter}, <span className="font-bold">{p.coverageLabel}</span>
                  {running && <span className="text-muted-foreground"> · now</span>}
                </span>
                <span className="text-xs font-bold text-mono">{money(gross)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
                <div className={cn('h-full', s.covered ? 'bg-dot-paid' : 'bg-primary')} style={{ width: `${percent}%` }} />
              </div>
              <p className={cn('text-[10px]', s.covered ? 'text-dot-paid' : running ? 'text-muted-foreground' : 'text-warning')}>
                {money(s.contributions)} of {money(LOCAL16_HW.quarterContributions)} in contributions.
                {s.covered ? ' Enough.' : running
                  ? ` ${money(LOCAL16_HW.quarterEarnings - gross)} more to earn by ${shortDate(p.end)}, or self-pay ${money(s.selfPay)} if it ends here.`
                  : ` Short: if you were on the plan, self-pay ${money(s.selfPay)} for ${p.coverageLabel}.`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="space-y-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[11px] font-medium">To qualify: last 12 months</span>
          <span className="text-xs font-bold text-mono">{money(twelve)} <span className="font-normal text-muted-foreground">of {money(LOCAL16_HW.qualifyEarnings)}</span></span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {money(LOCAL16_HW.qualifyEarnings)} within 12 months ({money(LOCAL16_HW.qualifyContributions)} in contributions) qualifies you.
          These are the app's estimates from your Local 16 shifts; the fund's records decide.
        </p>
      </div>

      <div className="space-y-1">
        <p className="neon-label text-[hsl(188_95%_72%)]">The plan in brief</p>
        {LOCAL16_HW.summary.map(section => (
          <details key={section.title} className="text-[11px]">
            <summary className="cursor-pointer font-medium">{section.title}</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {section.points.map(t => <li key={t}>{t}</li>)}
            </ul>
          </details>
        ))}
        <details className="text-[11px]">
          <summary className="cursor-pointer font-medium">Who to call</summary>
          <div className="mt-1 space-y-1">
            {LOCAL16_HW.contacts.map(c => (
              <p key={c.label}>
                <span className="font-medium">{c.label}:</span>{' '}
                {c.phones.map((ph, i) => (
                  <span key={ph}>{i > 0 && ' or '}<a href={`tel:${ph.replace(/\D/g, '')}`} className="text-primary underline underline-offset-2">{ph}</a></span>
                ))}
              </p>
            ))}
            <p className="text-muted-foreground">Mail: {LOCAL16_HW.mail.join(', ')}</p>
            <p className="text-muted-foreground">{LOCAL16_HW.claims}</p>
            <a href={LOCAL16_HW.portal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
              Your benefits online (sign up for an account first) <ExternalLink size={11} aria-hidden />
            </a>
          </div>
        </details>
      </div>
      </div>
    </div>
  );
}
