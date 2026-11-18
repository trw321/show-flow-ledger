import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { normaliseLocal } from '@/lib/payerProfile';
import { trainingKey, yearEarnings, type YearOfServiceRule } from '@/lib/yearOfService';
import { cn } from '@/lib/utils';

const money = (n: number) => '$' + Math.round(n).toLocaleString();

/**
 * A local's Year of Service for one year: earnings from that local's shifts
 * against what's needed, and the training to finish, ticked off here and
 * kept with the local in your synced settings.
 */
export default function YearOfServiceCard({ rule }: { rule: YearOfServiceRule }) {
  const { data } = useData();
  const { prefs, setPayer } = useUserPrefs();
  const payer = prefs.payer;
  const mine = payer.locals.find(l => normaliseLocal(l.local) === rule.local);
  const done = new Set(mine?.trainingDone ?? []);
  const earned = useMemo(() => yearEarnings(rule, data.jobs, data.employers, payer), [rule, data.jobs, data.employers, payer]);
  const items = rule.training.flatMap(g => g.items);
  const finished = items.filter(i => done.has(trainingKey(rule, i))).length;
  const percent = Math.min(100, (earned.gross / rule.earnings) * 100);

  // Ticking a course adds the local to your list if it isn't there yet.
  const toggle = (key: string) => {
    const next = done.has(key) ? [...done].filter(k => k !== key) : [...done, key];
    const locals = mine
      ? payer.locals.map(l => (l === mine ? { ...l, trainingDone: next } : l))
      : [...payer.locals, { local: rule.local, trainingDone: next }];
    setPayer({ ...payer, locals });
  };

  return (
    <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3 space-y-3" data-testid={`year-of-service-${rule.local}`}>
      <div>
        <p className="text-sm font-bold">Local {rule.local} · {rule.year} Year of Service</p>
        <p className="text-[11px] text-muted-foreground">
          {rule.forWhat.join(' · ')}. Work done in {rule.year}, counted in {rule.year + 1}.
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{rule.note}</p>
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Earnings</span>
          <span className="text-sm font-bold text-mono">{money(earned.gross)} <span className="text-muted-foreground font-normal">of {money(rule.earnings)}</span></span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
          <div className={cn('h-full', percent >= 100 ? 'bg-dot-paid' : 'bg-primary')} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Estimated gross from {earned.shifts} Local {rule.local} shift{earned.shifts === 1 ? '' : 's'} in {rule.year}.
          {percent < 100 ? ` ${money(rule.earnings - earned.gross)} to go.` : ' Reached.'} A shift counts when its local is {rule.local}.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Training</span>
          <span className="text-xs text-mono font-bold">{finished} of {items.length} done · by Dec 31</span>
        </div>
        {rule.training.map(group => (
          <div key={group.title} className="space-y-1">
            <p className="text-[11px] font-medium">{group.title}</p>
            {group.items.map(item => {
              const key = trainingKey(rule, item);
              return (
                <label key={key} className="flex items-center gap-2 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={done.has(key)} onChange={() => toggle(key)} className="rounded border-border" />
                  <span className={cn(done.has(key) && 'text-muted-foreground line-through')}>{item.label}</span>
                </label>
              );
            })}
            {group.link && (
              <a href={group.link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary underline underline-offset-2">
                {group.link.label} <ExternalLink size={11} aria-hidden />
              </a>
            )}
          </div>
        ))}
        <div className="space-y-0.5 border-t border-border/50 pt-2">
          {rule.links.map(l => (
            <a key={l.url} href={l.url} target={l.url.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer" className="block text-[11px] text-primary underline underline-offset-2">
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
