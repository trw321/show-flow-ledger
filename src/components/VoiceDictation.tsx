import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';

interface VoiceDictationProps {
  onParsed: (entry: Partial<Job>) => void;
  jobs: { name: string; client: string }[];
}

export default function VoiceDictation({ onParsed, jobs }: VoiceDictationProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  const startRecording = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Speech recognition not supported on this browser');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      let t = '';
      for (let i = 0; i < event.results.length; i++) t += event.results[i][0].transcript;
      setTranscript(t);
    };
    recognition.onerror = (e: any) => {
      toast.error('Mic error: ' + e.error);
      setIsRecording(false);
    };
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setTranscript('');
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  const parseAndSubmit = useCallback(async () => {
    if (!transcript.trim()) { toast.error('No input to parse'); return; }
    setIsProcessing(true);
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-time-entry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ text: transcript, jobs }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error);
      }
      const data = await resp.json();
      const e = data.entry;
      onParsed({
        jobNumber: e.jobNumber || undefined,
        name: e.jobName || 'Voice Entry',
        client: e.client || '',
        venue: e.venue || '',
        date: e.date,
        startTime: e.startTime || undefined,
        endTime: e.endTime || undefined,
        hourlyRate: e.rate || undefined,
        hoursWorked: e.hours || undefined,
        status: 'completed',
        notes: e.description || '',
      });
      toast.success('Job parsed from voice!');
      setTranscript('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse');
    } finally {
      setIsProcessing(false);
    }
  }, [transcript, jobs, onParsed]);

  return (
    <div className="space-y-3">
      {/* Mic button - large and prominent for mobile */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant={isRecording ? 'destructive' : 'default'}
          size="lg"
          className="rounded-full h-14 w-14 p-0 shrink-0"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
        >
          {isRecording ? <MicOff size={24} /> : <Mic size={24} />}
        </Button>
        <div className="flex-1 min-w-0">
          {isRecording ? (
            <p className="text-sm text-destructive animate-pulse font-medium">● Listening... speak your job details</p>
          ) : isProcessing ? (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Loader2 size={14} className="animate-spin" /> Parsing...
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tap to dictate — e.g. "Worked at the Orpheum yesterday for PRG, call time 7am to 3pm, $45 an hour"
            </p>
          )}
        </div>
      </div>

      {/* Transcript preview */}
      {transcript && !isRecording && (
        <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
          <p className="text-sm italic text-foreground">"{transcript}"</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={parseAndSubmit} disabled={isProcessing}>
              {isProcessing ? (
                <><Loader2 size={14} className="mr-1 animate-spin" /> Parsing...</>
              ) : (
                'Add This Job'
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTranscript('')}>
              <X size={14} className="mr-1" /> Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
