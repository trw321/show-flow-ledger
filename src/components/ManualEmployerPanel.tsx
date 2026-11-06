import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import EmployerEditor from '@/components/EmployerEditor';
import { employerSummary, type EmployerFormState } from '@/components/EmployerForm';
import { useData } from '@/lib/DataContext';
import { resolveEmployer } from '@/lib/employerMatch';
import type { EmployerRole } from '@/lib/store';
import { cn } from '@/lib/utils';

const pay = (r: EmployerRole) => (r.dayRate ? `$${r.dayRate}/day` : r.hourlyRate ? `$${r.hourlyRate}/hr` : 'no rate');

/**
 * The employer behind a shift being typed in. These are the same details as
 * Settings, not a copy: Edit opens the same form, and a role added here is
 * added to the employer.
 */
export default function ManualEmployerPanel({ name, role, prefill, onPickRole }: {
  /** What is typed in the employer box. */
  name: string;
  /** The role picked for this shift. */
  role: string;
  /** What has been typed so far, to start a new employer from. */
  prefill: Partial<EmployerFormState>;
  /** A role picked, or null for none. */
  onPickRole: (role: EmployerRole | null) => void;
}) {
  const { data, updateEmployer } = useData();
  const employer = resolveEmployer(name, data.employers);
  const [editing, setEditing] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [byDay, setByDay] = useState(false);

  if (!name.trim()) return null;

  const addRole = async () => {
    if (!employer || !newName.trim()) return;
    const rate = parseFloat(newRate);
    const created: EmployerRole = {
      name: newName.trim(),
      ...(rate > 0 ? (byDay ? { dayRate: rate } : { hourlyRate: rate }) : {}),
    };
    await updateEmployer(employer.id, { roles: [...(employer.roles ?? []), created] });
    onPickRole(created);
    setAddingRole(false);
    setNewName('');
    setNewRate('');
    setByDay(false);
  };

  return (
    <div className="pixel-panel space-y-2 p-2.5">
      {employer ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-[11px] text-mono text-muted-foreground">{employerSummary(employer)}</p>
            <button type="button" onClick={() => setEditing(true)} className="pixel-button pick-off flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] font-bold">
              <Pencil size={11} /> Edit employer
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(employer.roles ?? []).map(r => (
              <button
                key={r.name}
                type="button"
                aria-pressed={role === r.name}
                onClick={() => onPickRole(role === r.name ? null : r)}
                className={cn('pixel-button px-2 py-1 text-[11px] font-bold', role === r.name ? 'pick-on' : 'pick-off')}
              >
                {r.name} · {pay(r)}
              </button>
            ))}
            {!addingRole && (
              <button type="button" onClick={() => setAddingRole(true)} className="pixel-button pick-off flex items-center gap-1 px-2 py-1 text-[11px] font-bold">
                <Plus size={11} /> Role
              </button>
            )}
          </div>
          {addingRole && (
            <div className="flex items-center gap-1.5">
              <Input autoFocus placeholder="Role (e.g. A1)" aria-label="New role" value={newName} onChange={e => setNewName(e.target.value)} className="h-8 min-w-0 flex-1 text-xs" />
              <Input type="number" step="0.01" placeholder="$" aria-label="New role's pay" value={newRate} onChange={e => setNewRate(e.target.value)} className="h-8 w-20 text-xs" />
              <button type="button" onClick={() => setByDay(d => !d)} aria-label={`Paid by the ${byDay ? 'day' : 'hour'}. Tap to change.`} className="pixel-button pick-off h-8 w-12 shrink-0 text-[11px] font-bold">
                {byDay ? '/day' : '/hr'}
              </button>
              <button type="button" disabled={!newName.trim()} onClick={() => void addRole()} className="pixel-button pick-on h-8 shrink-0 px-2 text-[11px] font-bold disabled:opacity-40">
                Add
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-[11px] text-muted-foreground">Not saved as an employer yet, so its rules and roles aren't set.</p>
          <button type="button" onClick={() => setEditing(true)} className="pixel-button pick-off flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] font-bold">
            <Plus size={11} /> Save employer
          </button>
        </div>
      )}
      {editing && (
        <EmployerEditor
          employer={employer}
          prefill={{ ...prefill, name: name.trim() }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
