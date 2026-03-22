

## Plan: Bug Fixes + Core Feature Buildout

Based on your answers: fix existing bugs first, add a reset button, build voice dictation for job entry, job-linked expenses, and weekly/monthly reports.

---

### Phase 1: Bug Fixes & Cleanup (do first)

**1. Add "Clear All Data" reset button**
- Add a Settings/gear icon to the app header or dashboard
- Shows a confirmation dialog, then wipes `localStorage` and reloads
- File: `AppLayout.tsx` (add button), `store.ts` (add `clearAll` function)

**2. Verify dedup and date parsing work**
- After reset, re-import test data via photo to confirm no duplicates and correct dates
- No code changes needed — just testing the recent fixes

---

### Phase 2: Voice Dictation for Job Entry

**3. Add a "Dictate Job" button to the Jobs page**
- Uses the ElevenLabs realtime speech-to-text SDK (`@elevenlabs/react` with `useScribe`)
- User taps a mic button, speaks job details naturally (e.g., "I have a gig at the Orpheum on March 25th, call time 7am, for PRG, rate is $45")
- Audio is transcribed in real-time, then sent to the existing `parse-jobs` edge function to extract structured job data
- Shows the same inline-editable review table before saving
- Requires: ElevenLabs API key (stored as a secret), plus a small token-generating edge function

**Files:**
- New: `supabase/functions/elevenlabs-scribe-token/index.ts` (token endpoint)
- New: `src/components/JobDictateImport.tsx` (mic UI + transcription + parse flow)
- Edit: `src/pages/JobsPage.tsx` (add dictate button alongside paste/photo)

---

### Phase 3: Job-Linked Expenses

**4. Improve expense tracking with job linking**
- Already partially built — the expense form has a "Link to job" dropdown
- Enhance: auto-suggest the most recent/active job, show job-linked expense totals on the Jobs page accordion
- Add parking costs from jobs as auto-generated expenses when a job has `parkingCost > 0`

**Files:**
- Edit: `src/pages/ExpensesPage.tsx` (default to recent job, show linked totals)
- Edit: `src/pages/JobsPage.tsx` (show per-job expense summary in accordion)

---

### Phase 4: Reports

**5. Weekly summary view**
- New page or tab showing hours worked, earnings, and expenses grouped by week
- Simple table with week start date, total hours, gross pay, expenses, net

**6. Monthly P&L**
- Income vs expenses by month, net profit/loss
- Bar chart or simple table format

**7. Export to CSV/PDF**
- Download button on each report view
- CSV export using client-side generation
- PDF export using a lightweight library (e.g., jsPDF)

**Files:**
- New: `src/pages/ReportsPage.tsx` (weekly + monthly views with export)
- Edit: `src/App.tsx` (add route)
- Edit: `src/components/AppLayout.tsx` (add nav link)

---

### Technical Notes

- Voice dictation requires an ElevenLabs API key — I'll prompt you to add it as a secret
- Reports are computed client-side from existing localStorage data
- All new UI follows the existing dark theme and mobile-first layout (375px viewport)
- Total of ~5 new/edited files across all phases

---

### Suggested Order

1. Reset button (quick win, lets you start clean)
2. Test imports after reset
3. Voice dictation
4. Job-linked expense improvements
5. Reports page

