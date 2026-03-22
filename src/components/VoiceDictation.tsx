import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mic, MicOff, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';

interface VoiceDictationProps {
  onParsed: (entry: Omit<Job, 'id' | 'createdAt'>) => void;
  jobs: { name: string; client: string }[];
}

const blankJob = {
  name: '',
  client: '',
  venue: '',
  date: new Date().toISOString().split('T')[0],
  startTime: '',
  endTime: '',
  status: 'completed' as const,
  notes: '',
  mealType: '' as '' | 'YWA' | 'NWA',
  mealPenalties: '0',
  contractNotes: '',
};

export default function VoiceDictation({ onParsed, jobs }: VoiceDictationProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fields, setFields] = useState(blankJob);
  const [hasParsed, setHasParsed] = useState(false);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef('');

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));

  const startRecording = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error('Speech not supported — try Chrome or Safari'); return; }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      let t = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) t += event.results[i][0].transcript + ' ';
      }
      transcriptRef.current = t.trim();
    };
    recognition.onerror = (e: any) => {
      if (e.error !== 'aborted') toast.error('Mic error: ' + e.error);
      setIsRecording(false);
    };
    recognition.onend = () => {
      setIsRecording(false);
      if (transcriptRef.current) parseTranscript(transcriptRef.current);
    };
    recognitionRef.current = recognition;
    transcriptRef.current = '';
    recognition.start();
    setIsRecording(true);
  }, [jobs]);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const parseTranscript = async (text: string) => {
    setIsProcessing(true);
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-time-entry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ text, jobs }),
      });
      if (!resp.ok) throw new Error('Failed to parse');
      const data = await resp.json();
      const e = data.entry;
      setFields({
        name: e.jobName || '',
        client: e.client || '',
        venue: e.venue || '',
        date: e.date || new Date().toISOString().split('T')[0],
        startTime: e.startTime || '',
        endTime: e.endTime || '',
        status: 'completed',
        notes: e.description || '',
        mealType: e.mealType || '',
        mealPenalties: e.mealPenalties?.toString() || '0',
        contractNotes: e.contractNotes || '',
      });
      setHasParsed(true);
      toast.success('Got it! Review the details below');
    } catch {
      toast.error('Couldn\'t parse — fill in manually');
      setHasParsed(true);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = () => {
    if (!fields.name.trim()) { toast.error('Job name is required'); return; }
    onParsed({
      name: fields.name.trim(),
      client: fields.client.trim(),
      venue: fields.venue.trim(),
      date: fields.date,
      startTime: fields.startTime.trim() || undefined,
      endTime: fields.endTime.trim() || undefined,
      status: fields.status,
      notes: fields.notes.trim(),
      mealType: fields.mealType === 'YWA' || fields.mealType === 'NWA' ? fields.mealType : undefined,
      mealPenalties: fields.mealPenalties ? parseInt(fields.mealPenalties) : 0,
    });
    setFields(blankJob);
    setHasParsed(false);
    transcriptRef.current = '';
  };

  // Mad-lib sentence style
  const MadLibField = ({ value, onChange, placeholder, width = 'w-24' }: {
    value: string; onChange: (v: string) => void; placeholder: string; width?: string;
  }) => (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${width} inline-block border-b-2 border-primary/40 bg-transparent text-foreground font-medium 
        text-center px-1 py-0.5 focus:outline-none focus:border-primary transition-colors
        placeholder:text-muted-foreground/50 placeholder:font-normal text-sm`}
    />
  );

  return (
    <div className="space-y-4">
      {/* Mic button */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant={isRecording ? 'destructive' : 'default'}
          size="lg"
          className="rounded-full h-14 w-14 p-0 shrink-0"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
        >
          {isProcessing ? <Loader2 size={24} className="animate-spin" /> : isRecording ? <MicOff size={24} /> : <Mic size={24} />}
        </Button>
        <div className="flex-1 min-w-0">
          {isRecording ? (
            <p className="text-sm text-destructive animate-pulse font-medium">● Listening… tap to stop</p>
          ) : isProcessing ? (
            <p className="text-sm text-muted-foreground">Filling in your details…</p>
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Tap the mic and say something like:<br />
              <span className="italic">"Worked at the Orpheum yesterday for PRG, 7am to 3pm, $45 an hour"</span>
            </p>
          )}
        </div>
      </div>

      {/* Mad-lib form — always visible */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Job Details</p>

        <p className="text-sm leading-loose text-foreground/80">
          I worked on{' '}
          <MadLibField value={fields.name} onChange={v => set('name', v)} placeholder="job name" width="w-28" />
          {' '}for{' '}
          <MadLibField value={fields.client} onChange={v => set('client', v)} placeholder="client" width="w-24" />
          {' '}at{' '}
          <MadLibField value={fields.venue} onChange={v => set('venue', v)} placeholder="venue" width="w-28" />
        </p>

        <p className="text-sm leading-loose text-foreground/80">
          on{' '}
          <input
            type="date"
            value={fields.date}
            onChange={e => set('date', e.target.value)}
            className="inline-block border-b-2 border-primary/40 bg-transparent text-foreground font-medium 
              px-1 py-0.5 focus:outline-none focus:border-primary transition-colors text-sm"
          />
          {' '}from{' '}
          <MadLibField value={fields.startTime} onChange={v => set('startTime', v)} placeholder="start" width="w-20" />
          {' '}to{' '}
          <MadLibField value={fields.endTime} onChange={v => set('endTime', v)} placeholder="end" width="w-20" />
        </p>

        {/* Meal section */}
        <div className="pt-1 space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Lunch & Penalties</p>
          <div className="flex gap-2">
            {(['', 'YWA', 'NWA'] as const).map(opt => (
              <button
                key={opt || 'none'}
                type="button"
                onClick={() => set('mealType', opt)}
                className={`flex-1 text-xs py-2 px-2 rounded-xl border transition-colors ${
                  fields.mealType === opt
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border text-muted-foreground hover:border-primary/40'
                }`}
              >
                {opt === '' ? 'No lunch' : opt === 'YWA' ? 'Walk Away' : 'Non Walk Away'}
              </button>
            ))}
          </div>
          <p className="text-sm leading-loose text-foreground/80">
            <MadLibField value={fields.mealPenalties} onChange={v => set('mealPenalties', v)} placeholder="0" width="w-10" />
            {' '}meal {parseInt(fields.mealPenalties || '0') === 1 ? 'penalty' : 'penalties'}
            <span className="text-xs text-muted-foreground ml-1">(1hr straight time each)</span>
          </p>
        </div>

        {/* Contract notes */}
        <div className="pt-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Contract Notes</p>
          <textarea
            value={fields.contractNotes}
            onChange={e => set('contractNotes', e.target.value)}
            placeholder="Rate details, minimums, special terms…"
            rows={2}
            className="w-full rounded-xl border border-border bg-transparent text-sm px-3 py-2 placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors resize-none"
          />
        </div>

        <div className="pt-2">
          <Button onClick={handleSubmit} size="sm" className="w-full rounded-xl">
            <Send size={14} className="mr-1.5" /> Save Job
          </Button>
        </div>
      </div>
    </div>
  );
}
