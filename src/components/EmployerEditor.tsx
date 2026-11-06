import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import type { Employer } from '@/lib/store';
import { EMPTY_EMPLOYER_FORM, EmployerForm, employerFromForm, employerToForm, type EmployerFormState } from './EmployerForm';

/** The employer form in a pop-up, opened from wherever you happen to be. */
export default function EmployerEditor({ employer, prefill, onClose, onSaved }: {
  /** The employer to edit. Without one, this adds a new one. */
  employer?: Employer;
  /** What is already known about a new one. */
  prefill?: Partial<EmployerFormState>;
  onClose: () => void;
  onSaved?: (employer: Employer) => void;
}) {
  const { addEmployer, updateEmployer } = useData();
  const { prefs } = useUserPrefs();
  const initial = employer
    ? employerToForm(employer, !!prefs.payer.tax?.federalExempt)
    : { ...EMPTY_EMPLOYER_FORM, ...prefill };

  const save = async (form: EmployerFormState) => {
    if (employer) {
      const updates = employerFromForm(form);
      await updateEmployer(employer.id, updates);
      onSaved?.({ ...employer, ...updates });
    } else {
      const created = await addEmployer({ ...employerFromForm(form), overtimeMultiplier: 1.5, doubletimeMultiplier: 2.0 });
      if (created) onSaved?.(created);
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-mono text-sm">{employer ? employer.name : 'New employer'}</DialogTitle>
        </DialogHeader>
        <EmployerForm initial={initial} onSave={form => void save(form)} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}
