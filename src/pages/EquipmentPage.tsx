import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useEffect } from 'react';
import { Speaker, Plus, Trash2, Pencil } from 'lucide-react';
import type { Equipment } from '@/lib/store';

const eqCategories = ['Audio', 'Video', 'Lighting', 'Rigging', 'Staging', 'Cables', 'Cases', 'Power', 'Communication', 'Other'];
const statusOptions = ['available', 'deployed', 'maintenance', 'retired'] as const;

function EquipmentForm({ onSubmit, initial, jobs, customJobNames, onSaveCustomJobName, onCancel }: {
  onSubmit: (equip: Omit<Equipment, 'id' | 'createdAt'>) => void;
  initial?: Partial<Equipment>;
  jobs: { id: string; name: string }[];
  customJobNames: string[];
  onSaveCustomJobName: (name: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? eqCategories[0]);
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? '');
  const [value, setValue] = useState(initial?.value?.toString() ?? '');
  const [status, setStatus] = useState<Equipment['status']>(initial?.status ?? 'available');
  // Display as job name (look up from ID) or custom string
  const [assignedRef, setAssignedRef] = useState(() => {
    if (!initial?.assignedJobId) return '';
    const job = jobs.find(j => j.id === initial.assignedJobId);
    return job ? job.name : (initial.assignedJobId ?? '');
  });
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    // If the typed value matches a real job name, store its ID; otherwise store the string
    const matchingJob = jobs.find(j => j.name.toLowerCase() === assignedRef.trim().toLowerCase());
    const finalJobId = matchingJob ? matchingJob.id : (assignedRef.trim() || undefined);
    if (assignedRef.trim() && !matchingJob) {
      onSaveCustomJobName(assignedRef.trim());
    }
    onSubmit({
      name: name.trim(), category, serialNumber: serialNumber.trim() || undefined,
      value: value ? parseFloat(value) : undefined, status,
      assignedJobId: finalJobId, notes: notes.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input placeholder="Equipment name*" value={name} onChange={e => setName(e.target.value)} required />
        <Input placeholder="Serial number" value={serialNumber} onChange={e => setSerialNumber(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{eqCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="number" step="0.01" placeholder="Value ($)" value={value} onChange={e => setValue(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select value={status} onValueChange={(v) => setStatus(v as Equipment['status'])}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <div>
          <Input
            value={assignedRef}
            onChange={e => setAssignedRef(e.target.value)}
            placeholder="Unassigned"
            list="eq-job-names"
          />
          <datalist id="eq-job-names">
            {jobs.map(j => <option key={j.id} value={j.name} />)}
            {customJobNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </div>
      </div>
      <Input placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex gap-2 justify-end">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit">{initial ? 'Update' : 'Add Equipment'}</Button>
      </div>
    </form>
  );
}

const CUSTOM_JOBS_KEY = 'av-equipment-custom-jobs';

export default function EquipmentPage() {
  const { data, addEquipment, updateEquipment, deleteEquipment } = useData();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [customJobNames, setCustomJobNames] = useState<string[]>([]);
  const editingEq = editId ? data.equipment.find(e => e.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name }));

  useEffect(() => {
    try { setCustomJobNames(JSON.parse(localStorage.getItem(CUSTOM_JOBS_KEY) ?? '[]')); } catch { /* ignore */ }
  }, []);

  const saveCustomJobName = (name: string) => {
    setCustomJobNames(prev => {
      if (prev.includes(name)) return prev;
      const next = [...prev, name];
      localStorage.setItem(CUSTOM_JOBS_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title="Equipment"
        description={`${data.equipment.length} items tracked`}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus size={16} className="mr-1" /> Add Equipment</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-mono">Add Equipment</DialogTitle></DialogHeader>
              <EquipmentForm jobs={jobs} customJobNames={customJobNames} onSaveCustomJobName={saveCustomJobName} onSubmit={(eq) => { addEquipment(eq); setOpen(false); }} />
            </DialogContent>
          </Dialog>
        }
      />

      {data.equipment.length === 0 ? (
        <EmptyState icon={Speaker} title="No equipment tracked" description="Add your AV gear to track usage and assignments." />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Serial #</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Assigned</th>
                <th className="text-right px-4 py-3">Value</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.equipment.map(eq => {
                const job = data.jobs.find(j => j.id === eq.assignedJobId);
                return (
                  <tr key={eq.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{eq.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{eq.category}</td>
                    <td className="px-4 py-3 text-mono text-xs">{eq.serialNumber || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs text-mono font-medium ${
                        eq.status === 'available' ? 'bg-success/20 text-success' :
                        eq.status === 'deployed' ? 'bg-primary/20 text-primary' :
                        eq.status === 'maintenance' ? 'bg-accent/20 text-accent' :
                        'bg-muted text-muted-foreground'
                      }`}>{eq.status}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{job?.name ?? eq.assignedJobId ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-mono">{eq.value ? `$${eq.value.toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditId(eq.id)}><Pencil size={14} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteEquipment(eq.id)}><Trash2 size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-mono">Edit Equipment</DialogTitle></DialogHeader>
          {editingEq && (
            <EquipmentForm jobs={jobs} customJobNames={customJobNames} onSaveCustomJobName={saveCustomJobName} initial={editingEq} onSubmit={(updates) => { updateEquipment(editId!, updates); setEditId(null); }} onCancel={() => setEditId(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
