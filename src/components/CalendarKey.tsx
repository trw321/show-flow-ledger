import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CONFERENCE_COLOUR } from '@/lib/conferences';
import { cn } from '@/lib/utils';

export interface KeyPlan {
  title: string;
  color: string;
  /** Days of the month it falls on. */
  days: number[];
}

/**
 * What the month's colours mean, in a little 8-bit pop-up: tap KEY to open it,
 * tap anywhere to send it away. Plans get a colour from their name, so the
 * stripes on the calendar need somewhere to say whose they are.
 */
export default function CalendarKey({ month, employers, plans, states }: {
  month: string;
  /** The month's employers: each one's colour on the grid, and its days. */
  employers: KeyPlan[];
  plans: KeyPlan[];
  /** Each state's colour on the money, and what a day shows in it. */
  states: readonly { text: string; sample: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Calendar key" className="pixel-button pick-off font-8bit shrink-0 px-2 py-1.5 text-[8px]">KEY</button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="key-8bit w-64 rounded-none border-0 p-3" onClick={() => setOpen(false)}>
        <p className="font-8bit text-[9px] text-[#ffe600]">★ KEY ★</p>

        <p className="font-8bit mt-3 text-[7px] uppercase text-white/60">Employers · {month}</p>
        {employers.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-mono text-white/60">No work this month.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5" data-testid="key-employers">
            {employers.map(e => (
              <li key={e.title} className="flex items-center gap-2 text-[11px] text-mono">
                <span className="min-w-0 flex-1 truncate font-bold" style={{ color: e.color }}>├ {e.title} ┤</span>
                <span className="shrink-0 text-white/60">{e.days.length > 5 ? `${e.days.length} days` : e.days.join(' ')}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="font-8bit mt-3 text-[7px] uppercase text-white/60">Plans · {month}</p>
        {plans.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-mono text-white/60">No plans this month.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {plans.map(p => (
              <li key={p.title} className="flex items-center gap-2 text-[11px] text-mono text-white">
                <span className="key-swatch" style={{ background: p.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="shrink-0 text-white/60">{p.days.length > 5 ? `${p.days.length} days` : p.days.join(' ')}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="font-8bit mt-3 text-[7px] uppercase text-white/60">Shifts · the colour of the money</p>
        <ul className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1">
          {states.map(s => (
            <li key={s.label} className="flex items-center gap-2 text-[11px] text-mono text-white">
              <span className={cn('w-9 shrink-0 text-right font-bold', s.text)} aria-hidden>{s.sample}</span>
              {s.label}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[10px] text-mono text-white/60">No pay to show yet: the call time.</p>

        <p className="font-8bit mt-3 text-[7px] uppercase text-white/60">Marks</p>
        <ul className="mt-1.5 space-y-1 text-[11px] text-mono text-white">
          <li className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-right font-bold" style={{ color: `hsl(${CONFERENCE_COLOUR})` }} aria-hidden>19</span>
            gold date: a conference
          </li>
          <li>📞 callback · 🤸 split, on the day's shifts</li>
        </ul>

        <p className="font-8bit mt-3 text-[7px] uppercase text-white/60">Days in a row</p>
        <ul className="mt-1.5 flex gap-2 text-[11px] text-mono">
          <li className="sheen-6 sheen-tag relative px-1.5 py-0.5 font-bold">6th 💰</li>
          <li className="sheen-7 sheen-tag relative px-1.5 py-0.5 font-bold">7th 🤑</li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
