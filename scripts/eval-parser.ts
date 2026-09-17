#!/usr/bin/env vite-node
// Scores the offer parser against every saved format at once, so teaching it a
// new format can't silently break one that already worked.
//
//   npm run eval:parser                all fixtures
//   npm run eval:parser -- --only=cb   fixtures whose filename matches "cb"
//   npm run eval:parser -- --runs=3    repeat each (the model is not deterministic)
//   npm run eval:parser -- --verbose   print every parsed shift, not just failures
//
// Runs the same pipeline the app does — client-side record splitting and
// callback expansion, then the AI, then the deterministic THRU backstop —
// so a fixture reflects what a paste actually produces, not just the model.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { splitJobRecords, expandCBRecord, expandThruNotesForBatch, type ParsedJob } from '../src/lib/dispatchParsing';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(root, 'fixtures', 'offers');

const args = process.argv.slice(2);
const only = args.find(a => a.startsWith('--only='))?.split('=')[1];
const runs = Number(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? 1);
const verbose = args.includes('--verbose');
const model = args.find(a => a.startsWith('--model='))?.split('=')[1];
const effort = args.find(a => a.startsWith('--effort='))?.split('=')[1];

const readEnv = (file: string): Record<string, string> => {
  const path = join(root, file);
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }),
  );
};
// .env.local is gitignored, so secrets live there and win over .env
const env = { ...readEnv('.env'), ...readEnv('.env.local') };
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing Supabase config in .env'); process.exit(1); }

interface Fixture {
  name?: string;
  input: string;
  expect: Record<string, unknown>[];
}

async function callFn(fn: string, body: unknown) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

/** Mirrors NewGigPage.handleParse so fixtures measure the real paste path. */
async function parseOffer(text: string): Promise<ParsedJob[]> {
  if (/^\d{4}-\d{4}/m.test(text)) {
    const expanded = splitJobRecords(text).flatMap(rec => expandCBRecord(rec));
    const jobs: ParsedJob[] = [];
    for (let i = 0; i < expanded.length; i += 5) {
      const batch = expanded.slice(i, i + 5).join('\n\n');
      jobs.push(...((await callFn('parse-jobs', { text: batch, model, reasoningEffort: effort })).jobs ?? []));
    }
    return expandThruNotesForBatch(jobs);
  }
  // Informal text (a steward's message, an email) is classified first.
  const result = await callFn('smart-import', { text, model, reasoningEffort: effort });
  return result.type === 'jobs' || !result.type ? (result.jobs ?? []) : [];
}

if (!existsSync(fixturesDir)) { console.error(`No fixtures at ${fixturesDir}`); process.exit(1); }
const files = readdirSync(fixturesDir).filter(f => f.endsWith('.json')).filter(f => !only || f.includes(only));
if (files.length === 0) { console.error('No fixtures found. See fixtures/offers/README.md'); process.exit(1); }

// null and undefined both mean "the offer didn't state it"
const norm = (v: unknown) => (v == null ? null : typeof v === 'string' ? v.trim().toLowerCase() : v);

let totalFields = 0, okFields = 0;
const failuresByField = new Map<string, number>();
const results: Array<{ name: string; run: number; error?: string; countOk: boolean; expectedCount: number; gotCount: number; bad: Array<{ key: string; want: unknown; got: unknown }>; jobs: ParsedJob[] }> = [];

for (const file of files) {
  const fixture: Fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
  for (let run = 1; run <= runs; run++) {
    let jobs: ParsedJob[] = [];
    let error: string | undefined;
    try { jobs = await parseOffer(fixture.input); }
    catch (err) { error = err instanceof Error ? err.message : String(err); }

    // Compare in date order; a fixture lists shifts the same way.
    const sorted = [...jobs].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const bad: Array<{ key: string; want: unknown; got: unknown }> = [];
    fixture.expect.forEach((exp, i) => {
      for (const [key, want] of Object.entries(exp)) {
        const got = (sorted[i] as Record<string, unknown> | undefined)?.[key];
        totalFields++;
        if (norm(want) === norm(got)) okFields++;
        else { bad.push({ key: `[${i}].${key}`, want, got }); failuresByField.set(key, (failuresByField.get(key) ?? 0) + 1); }
      }
    });
    results.push({ name: fixture.name ?? file, run, error, countOk: sorted.length === fixture.expect.length,
                   expectedCount: fixture.expect.length, gotCount: sorted.length, bad, jobs: sorted });
  }
}

for (const r of results) {
  const pass = !r.error && r.countOk && r.bad.length === 0;
  console.log(`\n${pass ? 'PASS' : 'FAIL'}  ${r.name}${runs > 1 ? ` (run ${r.run})` : ''}`);
  if (r.error) { console.log(`   error: ${r.error}`); continue; }
  if (!r.countOk) console.log(`   expected ${r.expectedCount} shift(s), got ${r.gotCount}`);
  for (const f of r.bad) console.log(`   ${f.key}: want ${JSON.stringify(f.want)}, got ${JSON.stringify(f.got)}`);
  if (verbose) for (const j of r.jobs) console.log(`      · ${j.date} ${j.startTime ?? '--'} | ${j.name} @ ${j.venue}`);
}

const passed = results.filter(r => !r.error && r.countOk && r.bad.length === 0).length;
console.log(`\n${'='.repeat(52)}`);
console.log(`Model:    ${model ?? "(deployed default)"}`);
console.log(`Fixtures: ${passed}/${results.length} fully correct`);
console.log(`Fields:   ${okFields}/${totalFields} correct` + (totalFields ? ` (${Math.round((okFields / totalFields) * 100)}%)` : ''));
if (failuresByField.size > 0) {
  const ranked = [...failuresByField.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Weakest:  ${ranked.map(([k, n]) => `${k} (${n})`).join(', ')}`);
}
// exitCode rather than exit(), so pending sockets close cleanly on Windows
process.exitCode = passed === results.length ? 0 : 1;
