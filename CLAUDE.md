# Show Flow

A pay-tracking and bookkeeping app for an IATSE stagehand / AV tech. It logs
shifts, works out what each one should pay (overtime, double time, meal
penalties, 6th/7th day, union rules), matches incoming payments to shifts, and
tracks expenses, crew, invoices and tax estimates. The calendar is the home
screen. The owner mostly uses it on an iPhone.

## How to work here

- **Never guess.** Check the code, git history, logs or database before
  saying how something works. Label claims CONFIRMED / LIKELY / POSSIBLE /
  UNKNOWN, and say plainly when something couldn't be verified.
- **"It worked before" is evidence.** Look at git history for what changed
  before rewriting anything.
- Reproduce a bug before fixing it. Make the smallest safe change. Run the
  tests before saying it's done.
- **Keep replies short and plain.** The owner reads on a phone between
  shifts. Put the detail in the commit message, not the chat.
- Anything that can't be undone (deleting data or accounts) needs a direct yes.
- Real data is messier than test data. Test against bad stored values (dates
  like "Nov 5", missing fields), and check Safari/WebKit before shipping.
- Longer notes (the owner's full working rules, IATSE dispatch details,
  design direction, sign-in history) live in Claude's memory folder on the
  owner's PC, not in this repo.

## Commands

```bash
npm run dev          # local app on http://localhost:8080
npm test             # vitest, all src/**/*.test.ts(x)
npm run typecheck
npm run lint
npm run build
npm run eval:parser  # scores the shift-offer parser against fixtures/offers (needs OPENAI_API_KEY in .env.local)
```

## How it's built

- Vite + React 18 + TypeScript + Tailwind, shadcn/ui components in
  `src/components/ui`. `@/` points at `src/`.
- Pages are in `src/pages`, routes in `src/App.tsx`. Pay and matching logic is
  in `src/lib` with tests next to each file (`payCalc.ts`, `hoursMatching.ts`,
  `paymentMatch.ts`, `dispatchParsing.ts` and so on).
- **Local first.** Each device keeps the whole ledger in localStorage
  (`src/lib/store.ts`). Signing in is optional and only turns on sync.
- **Sync** (`src/lib/sync.ts`, field mapping in `src/lib/cloudSync.ts`) is
  two-way with Supabase. The newer `modifiedAt` wins, and deletions are kept as
  `deleted_at` markers so other devices hear about them.
- When checking for duplicate shifts, compare date + show name, not the job
  number: the same job can show up as `2878` on one device and `2026-2878` on
  another.

## Services

- **Supabase** project `yuoculbvburpdmgwjcem` ("av ledger"), free plan.
  Migrations are in `supabase/migrations`. Row-level security is on for every
  table (checked 2026-11-15), so each account sees only its own rows. The free plan **pauses after about a week without sign-ins or
  syncs**. If every AI read fails ("failed to parse"), check whether the
  project is paused before debugging a parser.
- **AI parsers** are Supabase edge functions in `supabase/functions`:
  parse-jobs, parse-job-image, parse-statement, parse-time-entry,
  smart-import. They call OpenAI directly through `_shared/lovable-ai.ts` (the
  name is left over from Lovable). The key is the Supabase secret
  `OPENAI_API_KEY`.
- **Deploying functions:** the GitHub workflow deploys only `parse-jobs` and
  `smart-import`, on a push to main that touches `supabase/functions`. The
  other three are deployed by hand:
  `npx supabase functions deploy <name> --project-ref yuoculbvburpdmgwjcem`
- **Vercel** hosts the web app at https://show-flow.vercel.app. `vercel.json`
  sends every path to `index.html`. Not checked on Vercel itself yet: whether
  every push to main deploys automatically.
- `.env` holds the public Supabase URL and key. `.env.local` (gitignored) holds
  `OPENAI_API_KEY` for local scripts only, and never reaches the app.

## Leftovers and works in progress

- The project started in Lovable and no longer uses it. The README is still
  Lovable's template, `lovable-tagger` still runs in dev mode, and
  `playwright.config.ts` imports a Lovable package that isn't installed.
- **Android:** Capacitor is set up (`npm run android:sync / open / run`), but
  the `android/` project hasn't been generated, so there's nothing to install
  yet.
- **Spreadsheet import:** `src/lib/spreadsheetJobs.ts` turns spreadsheet rows
  into shifts. No screen uses it yet.
- `docs/phase-a-contracts.md` is the plan for versioned union contracts
  (phases A to E).

## Commits

Work goes straight on `main`. The subject line says what changed for the
person using the app, in plain words ("Extend a job by tapping days on a
calendar"). The body explains why.
