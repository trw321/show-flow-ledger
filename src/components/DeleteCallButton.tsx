import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { roundHours } from '@/lib/hoursFormat';
import { netHoursWorked } from '@/lib/payCalc';
import type { Job } from '@/lib/store';

/** "the 5:30 PM call": one call of a split day, by its start. */
export const callLabel = (call: Pick<Job, 'startTime'>) => (call.startTime ? `the ${call.startTime} call` : 'the call with no time');

/**
 * Delete one call of a split day, not the day: a trash button that asks
 * first, naming the call and saying the rest of the day stays. Its taps
 * don't reach the row it sits on (which would open the call).
 */
export default function DeleteCallButton({ call, others, dateText, onDelete }: {
  call: Job;
  /** How many calls the day keeps. */
  others: number;
  /** "Sat, Sep 19". */
  dateText: string;
  onDelete: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const hours = netHoursWorked(call);
  return (
    <>
      <button type="button" aria-label={`Delete ${callLabel(call)} on ${dateText}`} data-testid="delete-call"
        onClick={e => { e.stopPropagation(); setAsking(true); }}
        onKeyDown={e => e.stopPropagation()}
        className="shrink-0 p-1.5 text-muted-foreground transition-colors hover:text-destructive active:opacity-70">
        <Trash2 size={14} aria-hidden />
      </button>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        {/* Portalled, but React still bubbles its clicks to the row: stop them here. */}
        <AlertDialogContent onClick={e => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {callLabel(call)}?</AlertDialogTitle>
            <AlertDialogDescription>
              {call.name}, {dateText}: {call.startTime ?? 'no time'}{call.endTime ? ` – ${call.endTime}` : ', no end time'}{hours > 0 ? `, ${roundHours(hours)}h` : ', no hours'}.
              {' '}Only this call goes. The other {others} call{others === 1 ? '' : 's'} of the day stay{others === 1 ? 's' : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="delete-call-confirm">
              Delete this call
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
