import { useUserPrefs } from '@/lib/UserPrefsContext';
import { shiftContract } from '@/lib/contracts';
import type { ContractRule } from '@/lib/payerProfile';
import {
  contractRuleFor, EARLY_CALL_BEFORE_HOUR, EARLY_CALL_UNTIL_HOUR, FORCED_CALL_REST_HOURS,
  forcedCallFor, isEarlyCall, isUnionShift, withContractRule,
} from '@/lib/premiums';
import type { Employer, Job } from '@/lib/store';
import { showDay as day } from '@/lib/today';
import { cn } from '@/lib/utils';

const EARLY_CHOICES: { value: NonNullable<ContractRule['earlyCall']>; label: string }[] = [
  { value: 'until8', label: `Until ${EARLY_CALL_UNTIL_HOUR} AM` },
  { value: 'allDay', label: 'All day' },
  { value: 'none', label: 'No premium' },
];

const hours = (h: number) => `${Math.round(h * 100) / 100}h`;

/**
 * The premiums a call can start with, on the shift: an early call (starts
 * between midnight and 7 AM) and a forced call (back with too little time
 * off). Contracts differ, so the answers are saved for the contract the shift
 * is under, or its employer when it names none, and every shift under it
 * follows them.
 */
export default function CallPremiums({ job, allJobs, employer }: { job: Job; allJobs: Job[]; employer?: Employer }) {
  const { prefs, setPayer } = useUserPrefs();
  const rule = contractRuleFor(job, employer, prefs.payer);
  const under = shiftContract(job) ?? employer?.name ?? job.client;
  const save = (change: Partial<ContractRule>) => under && setPayer(withContractRule(prefs.payer, under, change));

  const early = isEarlyCall(job);
  const forcedOn = rule?.forcedCall ?? isUnionShift(job, employer);
  const rest = rule?.restHours ?? FORCED_CALL_REST_HOURS;
  const forced = forcedCallFor(job, allJobs, rest);
  if (!early && !forced) return null;

  return (
    <div className="space-y-1.5">
      {early && (
        <div className={cn('rounded-md border px-2.5 py-2 text-[11px] leading-tight', rule?.earlyCall ? 'border-primary/40 bg-primary/10' : 'border-warning/50 bg-warning/10')} data-testid="early-call">
          <span className="font-medium">Early call · starts before {EARLY_CALL_BEFORE_HOUR} AM</span>
          <span className="block text-[10px] text-muted-foreground mt-0.5">
            {rule?.earlyCall
              ? `Saved for every shift under ${under}.`
              : `How long does the premium run under ${under}? Pick one and every shift under it follows. Nothing is counted until you do.`}
          </span>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {EARLY_CHOICES.map(c => (
              <button
                key={c.value}
                type="button"
                onClick={() => save({ earlyCall: c.value })}
                className={cn('pixel-button py-1 text-[11px] font-bold', rule?.earlyCall === c.value ? 'pick-on' : 'pick-off')}
                aria-pressed={rule?.earlyCall === c.value}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {forced && (
        <div className={cn('rounded-md border px-2.5 py-2 text-[11px] leading-tight', forcedOn ? 'border-primary/40 bg-primary/10' : 'border-border')} data-testid="forced-call">
          <span className="font-medium">{forcedOn ? 'Forced call' : 'Forced call: off for this contract'}</span>
          <span className="block text-[10px] text-muted-foreground mt-0.5">
            {hours(forced.restHours)} off since {forced.after.name} on {day(forced.after.date)} ended at {forced.after.endTime}.
            {forcedOn
              ? ` Under ${rest}h off: double time for the whole day, until you're done.`
              : ` Under ${rest}h off would pay double time for the whole day.`}
          </span>
          <button
            type="button"
            onClick={() => save({ forcedCall: !forcedOn })}
            className="mt-1 text-[10px] font-semibold text-primary underline underline-offset-2"
          >
            {forcedOn ? `${under} has no forced call` : `Count forced calls under ${under}`}
          </button>
        </div>
      )}
    </div>
  );
}
