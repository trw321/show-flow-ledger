import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import EmployerCombobox from '@/components/EmployerCombobox';
import { Paperclip, X, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import type { Job, Employer } from '@/lib/store';

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
  const [hasVacationPay, setHasVacationPay] = useState(initial?.hasVacationPay ?? false);
  const [steward, setSteward] = useState(initial?.steward ?? '');
  const [parkingCost, setParkingCost] = useState(initial?.parkingCost?.toString() ?? '');
  const [hoursWorked, setHoursWorked] = useState(initial?.hoursWorked?.toString() ?? '');
  const [mealPenalties, setMealPenalties] = useState(initial?.mealPenalties?.toString() ?? '0');
  const [mealDuration, setMealDuration] = useState<Job['mealDuration']>(initial?.mealDuration ?? undefined);
  const [mealOnClock, setMealOnClock] = useState(initial?.mealOnClock ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [attachments, setAttachments] = useState<string[]>(initial?.attachments ?? []);
  const [showPayDetails, setShowPayDetails] = useState(false);
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

  const handleSelectEmployer = (employer: Employer) => {
    if (!hourlyRate && employer.defaultHourlyRate) setHourlyRate(employer.defaultHourlyRate.toString());
    if (!payrollCompany && employer.payrollCompany) setPayrollCompany(employer.payrollCompany);
    if (!paySchedule && employer.paySchedule) setPaySchedule(employer.paySchedule);
  };

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
      hasVacationPay,
      steward: steward.trim() || undefined,
      parkingCost: parkingCost ? parseFloat(parkingCost) : undefined,
      hoursWorked: hoursWorked ? parseFloat(hoursWorked) : undefined,
      mealPenalties: mealPenalties ? parseInt(mealPenalties) : 0,
      mealDuration,
      mealOnClock: mealDuration ? mealOnClock : undefined,
      attachments,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Core info */}
      <div className="grid grid-cols-3 gap-2">
        <Input placeholder="Job #" value={jobNumber} onChange={e => setJobNumber(e.target.value)} className="text-sm" />
        <Input placeholder="Job name*" value={name} onChange={e => setName(e.target.value)} required className="col-span-2 text-sm" />
      </div>
      <EmployerCombobox value={client} onChange={setClient} onSelectEmployer={handleSelectEmployer} placeholder="Client / Production Co." />
      <Input placeholder="Venue / Location" value={venue} onChange={e => setVenue(e.target.value)} className="text-sm" />

      {/* Date & times */}
      <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Start (e.g. 08:00 AM)" value={startTime} onChange={e => setStartTime(e.target.value)} className="text-sm" />
        <Input placeholder="End (e.g. 05:00 PM)" value={endTime} onChange={e => setEndTime(e.target.value)} className="text-sm" />
      </div>

      {/* Hours & pay — most important */}
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" step="0.25" min="0" placeholder="Hours worked" value={hoursWorked} onChange={e => setHoursWorked(e.target.value)} className="text-sm" />
        <Input type="number" step="0.01" min="0" placeholder="Rate ($/hr)" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} className="text-sm" />
      </div>

      {/* Meals */}
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" min="0" placeholder="Meal penalties" value={mealPenalties} onChange={e => setMealPenalties(e.target.value)} className="text-sm" />
        <Select
          value={mealDuration === undefined ? 'none' : `${mealDuration}-${mealOnClock ? 'on' : 'off'}`}
          onValueChange={(v) => {
            if (v === 'none') { setMealDuration(undefined); return; }
            const [mins, onOff] = v.split('-');
            setMealDuration(parseInt(mins) as Job['mealDuration']);
            setMealOnClock(onOff === 'on');
          }}
        >
          <SelectTrigger className="text-sm"><SelectValue placeholder="Meal type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No meal break</SelectItem>
            <SelectItem value="0-off">Zero — meal penalty owed</SelectItem>
            <SelectItem value="30-on">30min on clock</SelectItem>
            <SelectItem value="45-on">45min on clock</SelectItem>
            <SelectItem value="60-off">1hr off clock</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Status */}
      <Select value={status} onValueChange={(v) => setStatus(v as Job['status'])}>
        <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* Collapsible pay/payroll details */}
      <button
        type="button"
        onClick={() => setShowPayDetails(!showPayDetails)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-1"
      >
        {showPayDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Payroll & advanced details</span>
      </button>

      {showPayDetails && (
        <div className="space-y-3 pl-1 border-l-2 border-border ml-1">
          <Input placeholder="Payroll company" value={payrollCompany} onChange={e => setPayrollCompany(e.target.value)} className="text-sm" />
          <Input placeholder="Steward / Contact" value={steward} onChange={e => setSteward(e.target.value)} className="text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" step="0.5" min="0" placeholder="Min hours (e.g. 5)" value={minimumHours} onChange={e => setMinimumHours(e.target.value)} className="text-sm" />
            <Input type="number" step="0.01" placeholder="Parking ($)" value={parkingCost} onChange={e => setParkingCost(e.target.value)} className="text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={paySchedule || 'none'} onValueChange={(v) => setPaySchedule(v === 'none' ? undefined : v as Job['paySchedule'])}>
              <SelectTrigger className="text-sm"><SelectValue placeholder="Pay schedule" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No schedule</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="per-project">Per project</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" placeholder="Pay period start" value={payPeriodStart} onChange={e => setPayPeriodStart(e.target.value)} className="text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={has6th7thDayRule} onChange={e => setHas6th7thDayRule(e.target.checked)} className="rounded border-border" />
            <span className="text-xs">6th/7th day rule (1.5× / 2×)</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={hasVacationPay} onChange={e => setHasVacationPay(e.target.checked)} className="rounded border-border" />
            <span className="text-xs">Vacation pay (8% of gross)</span>
          </label>
        </div>
      )}

      <Textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="text-sm" />

      {/* Attachments */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={14} className="mr-1" /> Attach
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt" multiple className="hidden" onChange={handleFileUpload} />
          {attachments.length > 0 && <span className="text-xs text-muted-foreground">{attachments.length} file(s)</span>}
        </div>
        {attachments.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {attachments.map((att, i) => (
              <div key={i} className="relative group">
                {att.startsWith('data:image') ? (
                  <img src={att} alt={`Attachment ${i + 1}`} className="h-14 w-14 rounded border border-border object-cover" />
                ) : (
                  <div className="h-14 w-14 rounded border border-border bg-secondary/50 flex items-center justify-center text-xs text-muted-foreground">File</div>
                )}
                <button type="button" onClick={() => removeAttachment(i)} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end pt-1">
        {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" size="sm">{initial ? 'Update' : 'Add Job'}</Button>
      </div>
    </form>
  );
}
