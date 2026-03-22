import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';

const statusOptions = ['upcoming', 'in-progress', 'completed', 'cancelled'] as const;

export default function JobForm({ onSubmit, initial, onCancel }: {
  onSubmit: (job: Omit<Job, 'id' | 'createdAt'>) => void;
  initial?: Partial<Job>;
  onCancel?: () => void;
}) {
  const [jobNumber, setJobNumber] = useState(initial?.jobNumber ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [client, setClient] = useState(initial?.client ?? '');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  const [status, setStatus] = useState<Job['status']>(initial?.status ?? 'upcoming');
  const [paySchedule, setPaySchedule] = useState<Job['paySchedule']>(initial?.paySchedule ?? undefined);
  const [payPeriodStart, setPayPeriodStart] = useState(initial?.payPeriodStart ?? '');
  const [payrollCompany, setPayrollCompany] = useState(initial?.payrollCompany ?? '');
  const [hourlyRate, setHourlyRate] = useState(initial?.hourlyRate?.toString() ?? '');
  const [minimumHours, setMinimumHours] = useState(initial?.minimumHours?.toString() ?? '');
  const [has6th7thDayRule, setHas6th7thDayRule] = useState(initial?.has6th7thDayRule ?? false);
  const [steward, setSteward] = useState(initial?.steward ?? '');
  const [parkingCost, setParkingCost] = useState(initial?.parkingCost?.toString() ?? '');
  const [hoursWorked, setHoursWorked] = useState(initial?.hoursWorked?.toString() ?? '');
  const [mealPenalties, setMealPenalties] = useState(initial?.mealPenalties?.toString() ?? '0');
  const [mealType, setMealType] = useState<Job['mealType']>(initial?.mealType ?? undefined);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [attachments, setAttachments] = useState<string[]>(initial?.attachments ?? []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > 5 * 1024 * 1024) { toast.error('File too large (max 5MB)'); return; }
      const reader = new FileReader();
      reader.onload = () => setAttachments(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (idx: number) => setAttachments(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      jobNumber: jobNumber.trim() || undefined,
      name: name.trim(), client: client.trim(), venue: venue.trim(), date, status, notes: notes.trim(),
      startTime: startTime.trim() || undefined,
      endTime: endTime.trim() || undefined,
      paySchedule: paySchedule || undefined,
      payPeriodStart: payPeriodStart || undefined,
      payrollCompany: payrollCompany.trim() || undefined,
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : undefined,
      minimumHours: minimumHours ? parseFloat(minimumHours) : undefined,
      has6th7thDayRule,
      steward: steward.trim() || undefined,
      parkingCost: parkingCost ? parseFloat(parkingCost) : undefined,
      hoursWorked: hoursWorked ? parseFloat(hoursWorked) : undefined,
      mealPenalties: mealPenalties ? parseInt(mealPenalties) : 0,
      mealType: mealType || undefined,
      attachments,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Input placeholder="Job # (last 4)" value={jobNumber} onChange={e => setJobNumber(e.target.value)} />
        <Input placeholder="Job name*" value={name} onChange={e => setName(e.target.value)} required className="col-span-2" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input placeholder="Client / Production Co." value={client} onChange={e => setClient(e.target.value)} />
        <Input placeholder="Venue" value={venue} onChange={e => setVenue(e.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <Input placeholder="Start time (e.g. 08:00 AM)" value={startTime} onChange={e => setStartTime(e.target.value)} />
        <Input placeholder="End time (e.g. 05:00 PM)" value={endTime} onChange={e => setEndTime(e.target.value)} />
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Input type="number" step="0.25" min="0" placeholder="Hours worked" value={hoursWorked} onChange={e => setHoursWorked(e.target.value)} />
        <Input type="number" step="0.01" min="0" placeholder="Hourly rate ($)" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
        <Input type="number" min="0" placeholder="Meal penalties" value={mealPenalties} onChange={e => setMealPenalties(e.target.value)} />
        <Select value={mealType || 'none'} onValueChange={(v) => setMealType(v === 'none' ? undefined : v as Job['mealType'])}>
          <SelectTrigger><SelectValue placeholder="Meal type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No meal break</SelectItem>
            <SelectItem value="YWA">YWA — 1hr off clock</SelectItem>
            <SelectItem value="NWA">NWA — 30min on clock</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Select value={status} onValueChange={(v) => setStatus(v as Job['status'])}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-3 gap-4">
        <Input placeholder="Payroll company" value={payrollCompany} onChange={e => setPayrollCompany(e.target.value)} />
        <Input placeholder="Steward / Contact" value={steward} onChange={e => setSteward(e.target.value)} />
        <Input type="number" step="0.5" min="0" placeholder="Min hours (e.g. 5)" value={minimumHours} onChange={e => setMinimumHours(e.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Select value={paySchedule || 'none'} onValueChange={(v) => setPaySchedule(v === 'none' ? undefined : v as Job['paySchedule'])}>
          <SelectTrigger><SelectValue placeholder="Pay schedule" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No schedule</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
            <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="per-project">Per project</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" placeholder="Pay period start" value={payPeriodStart} onChange={e => setPayPeriodStart(e.target.value)} />
        <Input type="number" step="0.01" placeholder="Parking cost" value={parkingCost} onChange={e => setParkingCost(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={has6th7thDayRule} onChange={e => setHas6th7thDayRule(e.target.checked)} className="rounded border-border" />
        <span>6th/7th day rule (1.5× / 2×)</span>
      </label>
      <Textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />

      <div>
        <div className="flex items-center gap-2 mb-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={14} className="mr-1" /> Attach Notes/Photos
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt" multiple className="hidden" onChange={handleFileUpload} />
          {attachments.length > 0 && <span className="text-xs text-muted-foreground">{attachments.length} file(s)</span>}
        </div>
        {attachments.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {attachments.map((att, i) => (
              <div key={i} className="relative group">
                {att.startsWith('data:image') ? (
                  <img src={att} alt={`Attachment ${i + 1}`} className="h-16 w-16 rounded border border-border object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded border border-border bg-secondary/50 flex items-center justify-center text-xs text-muted-foreground">File</div>
                )}
                <button type="button" onClick={() => removeAttachment(i)} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit">{initial ? 'Update' : 'Add Job'}</Button>
      </div>
    </form>
  );
}
