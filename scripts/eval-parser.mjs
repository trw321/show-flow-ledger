#!/usr/bin/env node
// Scores the live offer parser against every saved format at once, so
// teaching it a new format can't silently break one that already worked.
//
//   npm run eval:parser              all fixtures
//   npm run eval:parser -- --only=cb  fixtures whose name matches "cb"
//   npm run eval:parser -- --runs=3   repeat each (the model is not deterministic)

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(root, 'fixtures', 'offers');

const args = process.argv.slice(2);
const only = args.find(a => a.startsWith('--only='))?.split('=')[1];
const runs = Number(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? 1);

const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }),
);
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !KEY) { console.error('Missing Supabase config in .env'); process.exit(1); }

if (!existsSync(fixturesDir)) { console.error(`No fixtures at ${fixturesDir}`); process.exit(1); }
const files = readdirSync(fixturesDir)
  .filter(f => f.endsWith('.json'))
  .filter(f => !only || f.includes(only));

if (files.length === 0) {
  console.error('No fixtures found. See fixtures/offers/README.md for the format.');
  process.exit(1);
}

const norm = v => (typeof v === 'string' ? v.trim().toLowerCase() : v);

// Compare only the fields a fixture actually asserts — everything else is free.
function scoreJob(expected, actual) {
  const fields = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = actual?.[key];
    fields.push({ key, want, got, ok: norm(want) === norm(got) });
  }
  return fields;
}

let totalFields = 0, okFields = 0;
const failuresByField = new Map();
const results = [];

for (const file of files) {
  const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
  for (let run = 1; run <= runs; run++) {
    let jobs = [];
    let error = null;
    try {
      const resp = await fetch(`${URL}/functions/v1/parse-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ text: fixture.input }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
      jobs = body.jobs ?? [];
    } catch (err) {
      error = err.message;
    }

    const expected = fixture.expect ?? [];
    const countOk = jobs.length === expected.length;
    const fieldResults = expected.flatMap((exp, i) => scoreJob(exp, jobs[i]));
    for (const f of fieldResults) {
      totalFields++;
      if (f.ok) okFields++;
      else failuresByField.set(f.key, (failuresByField.get(f.key) ?? 0) + 1);
    }
    results.push({ file, name: fixture.name ?? file, run, error, countOk,
                   expectedCount: expected.length, gotCount: jobs.length, fieldResults });
  }
}

for (const r of results) {
  const bad = r.fieldResults.filter(f => !f.ok);
  const pass = !r.error && r.countOk && bad.length === 0;
  const runLabel = runs > 1 ? ` (run ${r.run})` : '';
  console.log(`\n${pass ? 'PASS' : 'FAIL'}  ${r.name}${runLabel}`);
  if (r.error) { console.log(`   error: ${r.error}`); continue; }
  if (!r.countOk) console.log(`   expected ${r.expectedCount} shift(s), got ${r.gotCount}`);
  for (const f of bad) console.log(`   ${f.key}: want ${JSON.stringify(f.want)}, got ${JSON.stringify(f.got)}`);
}

const passed = results.filter(r => !r.error && r.countOk && r.fieldResults.every(f => f.ok)).length;
console.log(`\n${'='.repeat(52)}`);
console.log(`Fixtures: ${passed}/${results.length} fully correct`);
console.log(`Fields:   ${okFields}/${totalFields} correct` +
            (totalFields ? ` (${Math.round((okFields / totalFields) * 100)}%)` : ''));
if (failuresByField.size > 0) {
  // Which field is weakest across every format — that's what to fix next.
  const ranked = [...failuresByField.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Weakest:  ${ranked.map(([k, n]) => `${k} (${n})`).join(', ')}`);
}
// exitCode rather than exit(), so pending sockets close cleanly on Windows
process.exitCode = passed === results.length ? 0 : 1;
