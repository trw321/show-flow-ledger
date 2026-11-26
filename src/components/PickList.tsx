import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * One box to type in or pick from: as you type, the names that match show
 * under it, each once (case aside), and the arrow shows them all. Drawn here
 * rather than the phone's own list, which Safari draws as a white box and
 * which can't be typed in.
 *
 * `onPick` runs when a name is tapped; typing only calls `onChange`, so a
 * name not on the list can still be typed in full.
 */
export default function PickList({ value, onChange, onPick, options, placeholder, testId, className, autoFocus }: {
  value: string;
  onChange: (text: string) => void;
  onPick?: (name: string) => void;
  options: string[];
  placeholder?: string;
  testId?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const listId = useId();
  const seen = new Set<string>();
  const names = options.map(n => n.trim()).filter(n => {
    const k = n.toLowerCase();
    if (!n || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const typed = value.trim().toLowerCase();
  // The name typed in full first, then names that start with it, then a word in them that does, then the rest that hold it.
  const rank = (n: string) => {
    const l = n.toLowerCase();
    return l === typed ? -1 : l.startsWith(typed) ? 0 : l.split(/[\s/.,&-]+/).some(w => w.startsWith(typed)) ? 1 : 2;
  };
  const shown = all || !typed ? names
    : names.filter(n => n.toLowerCase().includes(typed)).sort((a, b) => rank(a) - rank(b));
  // Near the bottom of the screen the list would sit under the tab bar: bring it up, once, as it opens.
  const listRef = useRef<HTMLUListElement>(null);
  const showing = open && shown.length > 0;
  useEffect(() => {
    if (showing) listRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [showing]);
  const pick = (name: string) => {
    onChange(name);
    onPick?.(name);
    setOpen(false);
    setAll(false);
  };

  return (
    <div className={cn('relative', className)}>
      <div className="flex">
        <Input value={value} placeholder={placeholder} autoFocus={autoFocus} data-testid={testId}
          role="combobox" aria-expanded={open && shown.length > 0} aria-controls={listId} aria-autocomplete="list"
          onChange={e => { onChange(e.target.value); setOpen(true); setAll(false); }}
          onFocus={() => setOpen(true)}
          // A moment's grace: on a phone the tap on a name can land after the blur.
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => { if (e.key === 'Enter' && open && shown.length > 0 && typed) { e.preventDefault(); pick(shown[0]); } if (e.key === 'Escape') setOpen(false); }}
          className="rounded-r-none text-mono" />
        <button type="button" aria-label={open ? 'Hide the list' : 'Show the whole list'} data-testid={testId ? `${testId}-all` : undefined}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { const showing = open && all; setOpen(!showing); setAll(!showing); }}
          className="flex shrink-0 items-center border border-l-0 border-input px-2 text-[hsl(188_90%_70%)]">
          <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </div>
      {open && shown.length > 0 && (
        <ul id={listId} role="listbox" data-testid={testId ? `${testId}-options` : undefined}
          ref={listRef}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto border border-[hsl(188_95%_62%/0.5)] bg-background shadow-lg">
          {shown.map(n => (
            <li key={n} role="option" aria-selected={n.toLowerCase() === typed}>
              {/* Down, not click: a tap would blur the box and close the list first. */}
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(n)}
                className="block w-full truncate px-3 py-2 text-left text-[13px] text-mono hover:bg-secondary/40 active:bg-secondary/60">
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
