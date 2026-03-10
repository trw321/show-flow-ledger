import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Speaker, Plus, Trash2, Pencil } from 'lucide-react';
import type { Equipment } from '@/lib/store';

const eqCategories = ['Audio', 'Video', 'Lighting', 'Rigging', 'Staging', 'Cables', 'Cases', 'Power', 'Communication', 'Other'];
const statusOptions = ['available', 'deployed', 'maintenance', 'retired'] as const;

function EquipmentForm({ onSubmit, initial, jobs, onCancel }: {
  onSubmit: (equip: Omit<Equipment, 'id' | 'createdAt'>) => void;
  initial?: Partial<Equipment>;
  jobs: { id: string; name: string }[];
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? eqCategories[0]);
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? '');
  const [value, setValue] = useState(initial?.value?.toString() ?? '');
  const [status, setStatus] = useState<Equipment['status']>(initial?.status ?? 'available');
  const [assignedJobId, setAssignedJobId] = useState(initial?.assignedJobId ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(), category, serialNumber: serialNumber.trim() || undefined,
      value: value ? parseFloat(value) : undefined, status,
      assignedJobId: assignedJobId || undefined, notes: notes.trim(),
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
        <Select value={assignedJobId || 'none'} onValueChange={v => setAssignedJobId(v === 'none' ? '' : v)}>
          <SelectTrigger><SelectValue placeholder="Assign to job" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Input placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex gap-2 justify-end">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit">{initial ? 'Update' : 'Add Equipment'}</Button>
      </div>
    </form>
  );
}

export default function EquipmentPage() {
  const { data, addEquipment, updateEquipment, deleteEquipment } = useData();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const editingEq = editId ? data.equipment.find(e => e.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name }));

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
              <EquipmentForm jobs={jobs} onSubmit={(eq) => { addEquipment(eq); setOpen(false); }} />
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
                    <td className="px-4 py-3 text-muted-foreground">{job?.name ?? '—'}</td>
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
            <EquipmentForm jobs={jobs} initial={editingEq} onSubmit={(updates) => { updateEquipment(editId!, updates); setEditId(null); }} onCancel={() => setEditId(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
