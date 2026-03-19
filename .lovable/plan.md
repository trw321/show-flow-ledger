

## Problem

The current dedup key is too specific — it checks date + client + name + jobNumber + startTime. So if you re-import the same shift with a slightly different name or client spelling, it creates a duplicate. Since you're one person and can only be in one place at a time, the logic should be simpler.

## New Dedup Logic

**Rule: Same date + same start time = same job.** You can't be in two places at once.

- If both entries have a `startTime`: match on `date + startTime` only (ignore name/client/jobNumber differences)
- If `startTime` is missing on either side: fall back to `date + client + name` to avoid false matches on days with split shifts that just lack time data

This means:
- Re-importing the same shift (even with slightly different naming) won't create duplicates
- Split shifts on the same day with different start times are still preserved
- Timesheet merges still work correctly

## Files to Change

1. **`src/lib/jobDedup.ts`** — Update `getJobDedupKey` to use `date|startTime` as the primary key when startTime exists, falling back to `date|client|name` when it doesn't. Update `isDuplicateJob` to use the same two-tier matching.

No other files need changes — all import components and `addJob` already use these functions.

