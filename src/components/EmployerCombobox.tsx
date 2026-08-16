import { useMemo, useState } from 'react';
import { useData } from '@/lib/DataContext';
import type { Employer } from '@/lib/store';
import { bestEmployerMatch, SUGGEST_MATCH_THRESHOLD } from '@/lib/employerMatch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ChevronsUpDown, Plus, ArrowLeft, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (name: string) => void;
  onSelectEmployer?: (employer: Employer) => void;
  placeholder?: string;
  className?: string;
}

export default function EmployerCombobox({ value, onChange, onSelectEmployer, placeholder, className }: Props) {
  const { data, addEmployer } = useData();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [search, setSearch] = useState('');

  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [newRule, setNewRule] = useState<Employer['overtimeRule']>('daily');
  const [newThreshold, setNewThreshold] = useState('');
  const [newTimekeeping, setNewTimekeeping] = useState('');
  const [newNightPremium, setNewNightPremium] = useState(true);
  const [dismissedSuggestion, setDismissedSuggestion] = useState('');

  const openAdd = () => {
    setNewName(search || value);
    setNewRate('');
    setNewRule('daily');
    setNewThreshold('');
    setNewTimekeeping('');
    setNewNightPremium(true);
    setMode('add');
  };

  const handleSelect = (employer: Employer) => {
    onChange(employer.name);
    onSelectEmployer?.(employer);
    setOpen(false);
    setMode('list');
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

  const handleSave = async () => {
    if (!newName.trim()) return;
    const employer = await addEmployer({
      name: newName.trim(),
      defaultHourlyRate: newRate ? parseFloat(newRate) : undefined,
      timekeepingApp: newTimekeeping.trim() || undefined,
      overtimeRule: newRule,
      weeklyOvertimeThresholdHours: newRule === 'weekly' ? (newThreshold ? parseFloat(newThreshold) : 40) : undefined,
      dailyOvertimeThresholdHours: newRule === 'daily' ? (newThreshold ? parseFloat(newThreshold) : 8) : undefined,
      overtimeMultiplier: 1.5,
      doubletimeMultiplier: 2.0,
      nightPremiumEnabled: newNightPremium,
      nightPremiumMultiplier: 2.0,
    });
    if (employer) handleSelect(employer);
  };

  return (
    <div className="flex flex-col gap-1">
    <div className={cn('flex gap-1.5', className)}>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Client / Employer'}
        className="flex-1 text-sm"
      />
      <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) { setMode('list'); setSearch(''); } }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="shrink-0 h-10 w-10" aria-label="Choose saved employer">
            <ChevronsUpDown size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="end">
          {mode === 'list' ? (
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
          ) : (
            <div className="p-3 flex flex-col gap-2.5">
              <button onClick={() => setMode('list')} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-fit">
                <ArrowLeft size={12} /> Back
              </button>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Employer name</label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-sm" autoFocus />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Default rate ($/hr)</label>
                <Input type="number" step="0.01" value={newRate} onChange={e => setNewRate(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Timekeeping app (if not payroll)</label>
                <Input value={newTimekeeping} onChange={e => setNewTimekeeping(e.target.value)} placeholder="e.g. TimeStation, Deputy" className="h-8 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Overtime rule</label>
                <Select value={newRule} onValueChange={v => { setNewRule(v as Employer['overtimeRule']); setNewThreshold(''); }}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily (OT after N hrs/day)</SelectItem>
                    <SelectItem value="weekly">Weekly (OT after N hrs/week)</SelectItem>
                    <SelectItem value="none">No overtime</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newRule !== 'none' && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">
                    OT threshold ({newRule === 'weekly' ? 'hrs/week' : 'hrs/day'})
                  </label>
                  <Input
                    type="number"
                    placeholder={newRule === 'weekly' ? '40' : '8'}
                    value={newThreshold}
                    onChange={e => setNewThreshold(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">
                  Night premium (midnight = 2×)
                </label>
                <Switch checked={newNightPremium} onCheckedChange={setNewNightPremium} />
              </div>
              <Button size="sm" onClick={handleSave} disabled={!newName.trim()} className="mt-1">
                Save employer
              </Button>
            </div>
          )}
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
    </div>
  );
}
