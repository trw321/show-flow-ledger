import { useMemo, useState } from 'react';
import { useData } from '@/lib/DataContext';
import type { Employer } from '@/lib/store';
import { bestEmployerMatch, SUGGEST_MATCH_THRESHOLD } from '@/lib/employerMatch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import EmployerEditor from '@/components/EmployerEditor';
import { ChevronsUpDown, Plus, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (name: string) => void;
  onSelectEmployer?: (employer: Employer) => void;
  placeholder?: string;
  className?: string;
}

export default function EmployerCombobox({ value, onChange, onSelectEmployer, placeholder, className }: Props) {
  const { data } = useData();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // A new employer gets the same form as Settings: there is one set of details.
  const [adding, setAdding] = useState<string | null>(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState('');

  const openAdd = () => {
    setAdding(search || value);
    setOpen(false);
    setSearch('');
  };

  const handleSelect = (employer: Employer) => {
    onChange(employer.name);
    onSelectEmployer?.(employer);
    setOpen(false);
    setSearch('');
  };

  // "Did you mean…" — typed text is close to a saved employer but not an exact
  // match (typo, different casing/punctuation, abbreviation). Never auto-applies;
  // the user has to confirm before it's treated as that employer.
  const suggestion = useMemo(() => {
    if (!value.trim() || value === dismissedSuggestion) return null;
    if (data.employers.some(e => e.name.toLowerCase() === value.trim().toLowerCase())) return null;
    const match = bestEmployerMatch(value, data.employers);
    return match && match.score >= SUGGEST_MATCH_THRESHOLD && match.score < 1 ? match : null;
  }, [value, data.employers, dismissedSuggestion]);

  return (
    <div className="flex flex-col gap-1">
    <div className={cn('flex gap-1.5', className)}>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Client / Employer'}
        className="flex-1 text-sm"
      />
      <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setSearch(''); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="shrink-0 h-10 w-10" aria-label="Choose saved employer">
            <ChevronsUpDown size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="end">
          <Command shouldFilter={false}>
              <CommandInput placeholder="Search employers…" value={search} onValueChange={setSearch} />
              <CommandList>
                <CommandEmpty>No saved employers yet.</CommandEmpty>
                <CommandGroup>
                  {data.employers
                    .filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
                    .map(emp => (
                      <CommandItem key={emp.id} value={emp.id} onSelect={() => handleSelect(emp)}>
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{emp.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {emp.defaultHourlyRate ? `$${emp.defaultHourlyRate}/hr` : 'no default rate'}
                            {emp.overtimeRule === 'weekly' && ` · OT >${emp.weeklyOvertimeThresholdHours ?? 40}h/wk`}
                            {emp.overtimeRule === 'daily' && ` · OT >${emp.dailyOvertimeThresholdHours ?? 8}h/day`}
                            {emp.overtimeRule === 'none' && ` · no OT`}
                            {(emp.nightPremiumEnabled ?? true) && ` · night premium`}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
              <div className="border-t border-border p-1">
                <button
                  onClick={openAdd}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                >
                  <Plus size={14} /> Add new employer
                </button>
              </div>
            </Command>
        </PopoverContent>
      </Popover>
    </div>
      {suggestion && (
        <button
          type="button"
          onClick={() => { handleSelect(suggestion.employer); setDismissedSuggestion(''); }}
          className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 transition-colors text-left"
        >
          <Wand2 size={11} className="shrink-0" />
          <span>
            Did you mean <span className="font-semibold">{suggestion.employer.name}</span>?
          </span>
          <span
            onClick={(e) => { e.stopPropagation(); setDismissedSuggestion(value); }}
            className="ml-auto text-muted-foreground hover:text-foreground underline"
          >
            No
          </span>
        </button>
      )}
      {adding !== null && (
        <EmployerEditor
          prefill={{ name: adding }}
          onClose={() => setAdding(null)}
          onSaved={handleSelect}
        />
      )}
    </div>
  );
}
