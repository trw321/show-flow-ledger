import { useMemo } from 'react';
import { HeartPulse } from 'lucide-react';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import HealthWelfareCard from '@/components/HealthWelfareCard';
import YearOfServiceCard from '@/components/YearOfServiceCard';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { LOCAL16_HW, local16Earnings, previousPeriod, quarterStanding, workPeriodFor } from '@/lib/healthWelfare';
import { LOCAL8_2026 } from '@/lib/yearOfService';
import { localToday } from '@/lib/today';
import { cn } from '@/lib/utils';

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const shortDate = (d: string) => new Date(d + 'T12:00:00').toLocaleString('en-US', { month: 'short', day: 'numeric' });

/**
 * Your union benefits, up front: whether your work has you covered for health
 * and welfare, quarter by quarter, then the details and Local 8's Year of
 * Service. Earnings are the app's estimates; the fund's records decide.
 */
export default function BenefitsPage() {
  const { data } = useData();
  const { prefs } = useUserPrefs();
  const today = localToday();
  const { now, last, nowGross, lastGross } = useMemo(() => {
    const n = workPeriodFor(today);
    const l = previousPeriod(n);
    const earned = (p: typeof n) => local16Earnings(p.start, p.end, data.jobs, data.employers, prefs.payer).gross;
    return { now: n, last: l, nowGross: earned(n), lastGross: earned(l) };
  }, [today, data.jobs, data.employers, prefs.payer]);
  const lastStanding = quarterStanding(lastGross);
  const nowStanding = quarterStanding(nowGross);
  const nowPercent = Math.min(100, (nowGross / LOCAL16_HW.quarterEarnings) * 100);

  return (
    <SpacePageWrapper
      title={
        <div className="flex items-center gap-2.5">
          <HeartPulse size={22} aria-hidden />
          <h1 className="text-lg font-display tracking-wide leading-none">Benefits</h1>
        </div>
      }
      description="Local 16 health & welfare, and Local 8 Year of Service"
    >
      <div className="max-w-lg mx-auto space-y-4">
        {/* The headline: are you covered, and are you on track for the next quarter. */}
        <div className="grid gap-2" data-testid="benefits-headline">
          <div className={cn('rounded-lg border-2 p-3', lastStanding.covered ? 'border-dot-paid bg-dot-paid/10' : 'border-warning bg-warning/10')}>
            <p className="text-[10px] text-mono uppercase tracking-widest text-muted-foreground">Health &amp; welfare · coverage {last.coverageLabel}</p>
            <p className={cn('mt-1 text-2xl font-black leading-tight', lastStanding.covered ? 'text-dot-paid' : 'text-warning')}>
              {lastStanding.covered ? 'Covered' : 'Short'}
            </p>
            <p className="mt-0.5 text-xs">
              {last.workLabel} earnings: <span className="font-bold text-mono">{money(lastGross)}</span> of {money(LOCAL16_HW.quarterEarnings)}.
              {lastStanding.covered ? ' That pays for the quarter.' : ` If you're on the plan, self-pay ${money(lastStanding.selfPay)} to stay on.`}
            </p>
          </div>
          <div className="rounded-lg border-2 border-primary/60 bg-primary/10 p-3">
            <p className="text-[10px] text-mono uppercase tracking-widest text-muted-foreground">Next · coverage {now.coverageLabel}</p>
            <p className="mt-1 text-2xl font-black leading-tight text-primary">
              {nowStanding.covered ? 'Already earned' : `${money(LOCAL16_HW.quarterEarnings - nowGross)} to go`}
            </p>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
              <div className={cn('h-full', nowStanding.covered ? 'bg-dot-paid' : 'bg-primary')} style={{ width: `${nowPercent}%` }} />
            </div>
            <p className="mt-1 text-xs">
              {now.workLabel}: <span className="font-bold text-mono">{money(nowGross)}</span> of {money(LOCAL16_HW.quarterEarnings)} earned
              {nowStanding.covered ? '.' : `, by ${shortDate(now.end)}.`}
            </p>
            {/* What coverage costs out of pocket if the work stops where it is. */}
            {!nowStanding.covered && (
              <p className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-primary/30 pt-1.5 text-xs" data-testid="next-self-pay">
                <span>Self-pay for {now.coverageLabel} if it ends here</span>
                <span className="text-base font-black text-mono text-warning">{money(nowStanding.selfPay)}</span>
              </p>
            )}
          </div>
        </div>

        {/* A pause between the headline and the details: a few hearts down the
            middle, one to a line, so the boxes below sit a scroll away. */}
        <div className="flex flex-col items-center gap-12 py-6 text-primary" data-testid="benefits-hearts" aria-hidden>
          {[1, 0.7, 0.45, 0.25].map(opacity => <HeartPulse key={opacity} size={26} style={{ opacity }} />)}
        </div>

        <HealthWelfareCard collapsible />
        <YearOfServiceCard rule={LOCAL8_2026} collapsible />
      </div>
    </SpacePageWrapper>
  );
}
