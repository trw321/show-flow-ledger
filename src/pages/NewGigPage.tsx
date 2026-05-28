import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FileText, ImagePlus, Sparkles, Save, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/AuthContext';
import { parseLocal16Offer, type ParsedOffer } from '@/lib/parsers/local16';

interface FormState {
  jobNumber: string;
  local: string;
  workDate: string;
  startTime: string;
  endTime: string;
  employer: string;
  payor: string;
  hiringParty: string;
  showName: string;
  venue: string;
  jobSite: string;
  positionName: string;
  hourlyRate: string;
  steward: string;
  reportTo: string;
  dressCode: string;
}

const EMPTY_FORM: FormState = {
  jobNumber: '', local: '', workDate: '', startTime: '', endTime: '',
  employer: '', payor: '', hiringParty: '', showName: '', venue: '',
  jobSite: '', positionName: '', hourlyRate: '', steward: '', reportTo: '', dressCode: '',
};

function fromParsed(p: ParsedOffer): FormState {
  return {
    jobNumber: p.jobNumber ?? '',
    local: p.local ?? '',
    workDate: p.workDate ?? '',
    startTime: p.startTime ?? '',
    endTime: p.endTime ?? '',
    employer: p.employer ?? '',
    payor: p.payor ?? '',
    hiringParty: p.hiringParty ?? '',
    showName: p.showName ?? '',
    venue: p.venue ?? '',
    jobSite: p.jobSite ?? '',
    positionName: p.positionName ?? '',
    hourlyRate: p.hourlyRate != null ? String(p.hourlyRate) : '',
    steward: p.steward ?? '',
    reportTo: p.reportTo ?? '',
    dressCode: p.dressCode ?? '',
  };
}

// Build a timestamptz from a date + "HH:MM" in the BROWSER's local time zone.
// Good for the common (Philly / Local 8) case; flagged in the UI for Pacific offers.
function toISO(workDate: string, time: string): string | null {
  if (!workDate || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const dt = new Date(`${workDate}T${time}:00`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

const inputCls =
  'w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-colors';
const labelCls = 'text-xs text-mono uppercase tracking-wider text-muted-foreground mb-1 block';

function Field({
  label, value, onChange, type = 'text', placeholder, mono, required, step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  step?: string;
}) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {required && <span className="text-amber-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, mono && 'text-mono')}
      />
    </div>
  );
}

export default function NewGigPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [savedInfo, setSavedInfo] = useState<{ id: string; jobNumber: string | null; workDate: string } | null>(null);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleParse = () => {
    if (!rawText.trim()) {
      toast.error('Paste an offer first.');
      return;
    }
    const res = parseLocal16Offer(rawText);
    setForm(fromParsed(res.parsed));
    setWarnings(res.warnings);
    setParsed(true);
    setSavedInfo(null);
    if (res.matched.length) {
      toast.success(`Parsed ${res.matched.length} field${res.matched.length === 1 ? '' : 's'}.`);
    } else {
      toast('Nothing auto-detected — fill in the fields below.');
    }
  };

  const handleClear = () => {
    setRawText('');
    setParsed(false);
    setWarnings([]);
    setForm(EMPTY_FORM);
    setSavedInfo(null);
  };

  const handleSave = async () => {
    if (!user) {
      toast.error('You must be signed in to save.');
      return;
    }
    if (!form.workDate) {
      toast.error('Work date is required.');
      return;
    }
    setSaving(true);
    try {
      const noteParts: string[] = [];
      if (form.employer) noteParts.push(`Employer: ${form.employer}`);
      if (form.payor) noteParts.push(`Payroll: ${form.payor}`);
      if (form.hiringParty) noteParts.push(`Hiring: ${form.hiringParty}`);
      noteParts.push('— Pasted offer —', rawText.trim());

      const rateNum = form.hourlyRate ? parseFloat(form.hourlyRate) : null;

      const payload = {
        user_id: user.id,
        work_date: form.workDate,
        job_number: form.jobNumber || null,
        local: form.local || null,
        position_name: form.positionName || null,
        show_name: form.showName || null,
        venue: form.venue || null,
        job_site: form.jobSite || null,
        steward_name: form.steward || null,
        report_to: form.reportTo || null,
        dress_code: form.dressCode || null,
        start_time: toISO(form.workDate, form.startTime),
        end_time: toISO(form.workDate, form.endTime),
        offered_hourly_rate: rateNum != null && !isNaN(rateNum) ? rateNum : null,
        status: 'offered',
        notes: noteParts.join('\n'),
      };

      // Cast: the generated Supabase types can lag the live schema (e.g. the
      // `local` / `report_to` columns). If your types are regenerated and
      // current, you can safely remove `as never`.
      const { data, error } = await supabase
        .from('gigs')
        .insert(payload as never)
        .select('id, job_number, work_date')
        .single();

      if (error) throw error;

      toast.success('Saved as an offer.');
      setSavedInfo({
        id: (data as { id: string }).id,
        jobNumber: (data as { job_number: string | null }).job_number,
        workDate: (data as { work_date: string }).work_date,
      });
      setForm(EMPTY_FORM);
      setRawText('');
      setParsed(false);
      setWarnings([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="New Gig" description="Paste an offer to auto-fill, then review and save." />

      {savedInfo && (
        <div className="mb-4 rounded-xl border border-success/40 bg-success/10 p-3 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-success shrink-0" />
          <div className="flex-1 min-w-0 text-sm">
            Saved {savedInfo.jobNumber ? `#${savedInfo.jobNumber}` : 'gig'}
            {savedInfo.workDate ? ` for ${savedInfo.workDate}` : ''} as an offer.
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/log')} className="text-primary">
            View Job Log
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Paste text */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-xs text-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <FileText size={12} /> Paste offer text
          </h3>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={10}
            placeholder="Paste your Local 16 dispatch offer here…"
            className={cn(inputCls, 'resize-y text-mono leading-relaxed min-h-[180px]')}
          />
          <div className="flex gap-2 mt-3">
            <Button onClick={handleParse} className="gap-1.5">
              <Sparkles size={15} /> Parse offer
            </Button>
            {(rawText || parsed) && (
              <Button variant="ghost" onClick={handleClear} className="gap-1.5 text-muted-foreground">
                <RotateCcw size={14} /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Photo upload — disabled (Phase 2) */}
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4 flex flex-col">
          <h3 className="text-xs text-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <ImagePlus size={12} /> Upload a photo
          </h3>
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8 gap-2">
            <ImagePlus size={28} className="text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Snap a photo of a printed call sheet</p>
            <span className="text-[10px] text-mono uppercase tracking-wider rounded-full border border-border px-2 py-0.5 text-muted-foreground">
              Coming soon
            </span>
          </div>
          <Button disabled variant="secondary" className="gap-1.5 opacity-60 cursor-not-allowed">
            <ImagePlus size={15} /> Choose photo
          </Button>
        </div>
      </div>

      {/* Review & edit */}
      {parsed && (
        <div className="mt-5 rounded-2xl border border-border bg-card p-4">
          <h3 className="text-xs text-mono uppercase tracking-wider text-muted-foreground mb-3">Review &amp; edit</h3>

          {warnings.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs font-medium mb-1">
                <AlertTriangle size={13} /> Check these
              </div>
              <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job / Gig #" value={form.jobNumber} onChange={set('jobNumber')} mono placeholder="2026-1589" />
            <Field label="Local" value={form.local} onChange={set('local')} placeholder="Local 16" />
            <Field label="Work date" value={form.workDate} onChange={set('workDate')} type="date" required />
            <Field label="Position / Classification" value={form.positionName} onChange={set('positionName')} placeholder="V UTILITY" />
            <Field label="Call time" value={form.startTime} onChange={set('startTime')} type="time" />
            <Field label="End time" value={form.endTime} onChange={set('endTime')} type="time" />
            <Field label="Hourly rate" value={form.hourlyRate} onChange={set('hourlyRate')} type="number" step="0.01" placeholder="55.72" />
            <Field label="Show / Event" value={form.showName} onChange={set('showName')} />
            <Field label="Venue" value={form.venue} onChange={set('venue')} />
            <Field label="Job site / Address" value={form.jobSite} onChange={set('jobSite')} />
            <Field label="Employer (signatory)" value={form.employer} onChange={set('employer')} />
            <Field label="Payroll company" value={form.payor} onChange={set('payor')} />
            <Field label="Hiring party" value={form.hiringParty} onChange={set('hiringParty')} />
            <Field label="Report to" value={form.reportTo} onChange={set('reportTo')} />
            <Field label="Steward" value={form.steward} onChange={set('steward')} />
            <Field label="Dress code" value={form.dressCode} onChange={set('dressCode')} />
          </div>

          <p className="text-[11px] text-muted-foreground mt-3">
            Call / end times save in your device's time zone. Employer, payroll, and hiring names are stored in notes
            until party-linking is built.
          </p>

          <div className="flex gap-2 mt-4">
            <Button onClick={handleSave} disabled={saving || !form.workDate} className="gap-1.5">
              <Save size={15} /> {saving ? 'Saving…' : 'Save as offer'}
            </Button>
            <Button variant="ghost" onClick={handleClear} className="text-muted-foreground">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
