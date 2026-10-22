import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { AppData } from '@/lib/store';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** "12 shifts, 4 payments and 2 employers" — only what is actually there. */
export function describeLedger(data: AppData): string {
  const parts = [
    data.jobs.length && plural(data.jobs.length, 'shift'),
    data.income.length && plural(data.income.length, 'payment'),
    data.expenses.length && plural(data.expenses.length, 'expense'),
    data.employers.length && plural(data.employers.length, 'employer'),
    data.payouts?.length && plural(data.payouts.length, 'crew payment'),
    data.events?.length && plural(data.events.length, 'plan'),
    data.equipment.length && plural(data.equipment.length, 'piece of gear', 'pieces of gear'),
  ].filter(Boolean) as string[];
  if (parts.length <= 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

interface Props {
  open: boolean;
  email?: string;
  device: AppData | null;
  onAdd: () => void;
  onKeepSeparate: () => void;
}

/**
 * Asked once, the first time an account signs in on a device that already
 * has data. Adding it is what most people want — it is their phone — but it
 * is not safe to assume: a second account signing in here must not inherit
 * the first one's shifts.
 */
export default function ClaimDeviceDataDialog({ open, email, device, onAdd, onKeepSeparate }: Props) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Add this device's data to your account?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                This device has{' '}
                <span className="font-semibold text-foreground">{device ? describeLedger(device) : 'data'}</span>{' '}
                from before you signed in.
              </p>
              <p>
                Add it to <span className="font-semibold text-foreground break-all">{email ?? 'your account'}</span> and
                it syncs to your other devices. Keep it separate and it stays on this device, signed out.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onKeepSeparate}>Keep separate</AlertDialogCancel>
          <AlertDialogAction onClick={onAdd}>Add to my account</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
