import { useState } from 'react';
import { Bug, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { readScreen, sendProblemReport } from '@/lib/problemLog';
import { cn } from '@/lib/utils';

/**
 * The button for something that just went wrong. The screen is read the moment
 * it is tapped, before this dialog covers it.
 */
export default function ReportProblem({ withLabel, className }: { withLabel?: boolean; className?: string }) {
  const [screen, setScreen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    const result = await sendProblemReport({ kind: 'report', note, screen: screen ?? undefined });
    setSending(false);
    if (result === 'sent') {
      toast.success('Report sent');
      setNote('');
      setScreen(null);
    } else if (result === 'signed-out') {
      toast.error('Sign in first, so the report has somewhere to go');
    } else {
      toast.error("Couldn't send it. Check your connection and try again.");
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Report a problem"
        onClick={() => setScreen(readScreen())}
        className={cn(
          'inline-flex items-center gap-3 rounded-md text-muted-foreground transition-colors hover:text-foreground',
          withLabel ? 'w-full px-3 py-2.5 text-sm font-body hover:bg-muted/50' : 'h-8 w-8 justify-center',
          className,
        )}
      >
        <Bug size={18} />
        {withLabel && 'Report a problem'}
      </button>
      <Dialog open={screen !== null} onOpenChange={open => { if (!open) setScreen(null); }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle className="text-mono text-sm">What just happened?</DialogTitle></DialogHeader>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Say what you expected and what it did instead. You can leave this blank."
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            Sends your last taps and the words on this screen, including any pay shown, to your own account. Nothing you typed into a form.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setScreen(null)}>Cancel</Button>
            <Button size="sm" disabled={sending} onClick={() => void send()} className="gap-1.5">
              {sending && <Loader2 size={13} className="animate-spin" />} Send
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
