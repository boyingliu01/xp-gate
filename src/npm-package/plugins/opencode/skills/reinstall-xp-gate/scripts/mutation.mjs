#!/usr/bin/env node
/**
 * Mutation runner: inject a known defect into production code, run the suite,
 * and require it to fail. Restores the original file afterwards, always.
 *
 * WHY THIS EXISTS
 * ---------------
 * A green suite proves the tests agree with the code, not that the tests would
 * notice if the code were wrong. The distinction is not academic here: the
 * first version of `pruneDeadRoots removes only copies identical to the
 * published package` passed whether or not the hash comparison existed, because
 * its edited copy was named something the loop never visited. 84/84 green,
 * silent data-loss bug unguarded.
 *
 * Every mutation below corresponds to a real safety property of this skill:
 * deleting the wrong directory, overwriting a user's edit, or reporting an
 * outdated tool as current. If a mutation survives, the property is untested.
 *
 * Usage:
 *   node scripts/mutation.mjs            # run all, report survivors
 *   node scripts/mutation.mjs --verbose  # show the failing test names
 *
 * Exit 1 if any mutation survives.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { parseFailCount } from './lib/testreport.mjs';
import { MUTATIONS } from './lib/mutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');


function runSuite() {
  // No `shell: true`: under a shell `process.execPath` is
  // "C:\Program Files\nodejs\node.exe" and the space splits the command, so
  // every mutation would report SURVIVED because the suite never ran.
  //
  // The files are enumerated here rather than passed as 'tests/*.test.mjs'.
  // Node's test runner expands a glob on Windows but NOT on Linux -- CI caught
  // this as "Could not find '.../tests/*.test.mjs'". Listing the files removes
  // the dependency on who does the expanding.
  const files = fs.readdirSync(path.join(root, 'tests'))
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => path.join('tests', f));
  const r = spawnSync(process.execPath, ['--test', ...files], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  // -1 signals "could not read a count" (see lib/testreport.mjs). Treating that
  // as 0 would report a crashed runner as a surviving mutation; treating it as
  // >0 would report every mutation as killed. Neither is true, so the caller
  // records a distinct ERROR outcome.
  return { failed: parseFailCount(out), out, status: r.status };
}

const results = [];

for (const m of MUTATIONS) {
  const abs = path.join(root, m.file);
  const original = fs.readFileSync(abs, 'utf8');

  if (!original.includes(m.from)) {
    results.push({ ...m, outcome: 'SKIPPED', detail: 'anchor not found -- mutation is stale' });
    continue;
  }

  try {
    fs.writeFileSync(abs, original.replace(m.from, m.to), 'utf8');
    const { failed, out, status } = runSuite();
    if (failed < 0) {
      // The suite could not even report a count: the runner is broken, not the
      // mutation. Reporting SURVIVED here would send the next person hunting
      // for a missing test instead of a broken invocation.
      results.push({ ...m, outcome: 'ERROR', detail: `no test count in output (exit ${status})` });
      continue;
    }
    const killed = failed > 0;
    const names = killed && verbose
      ? [...out.matchAll(/^\u2716 (.+?) \(\d/gm)].map((x) => x[1]).slice(0, 3)
      : [];
    results.push({ ...m, outcome: killed ? 'KILLED' : 'SURVIVED', failed, names });
  } finally {
    // Unconditional: a surviving mutation left in place would poison every
    // later run and any commit made in between.
    fs.writeFileSync(abs, original, 'utf8');
  }
}

const killed = results.filter((r) => r.outcome === 'KILLED').length;
const survived = results.filter((r) => r.outcome === 'SURVIVED');
const skipped = results.filter((r) => r.outcome === 'SKIPPED');
const errored = results.filter((r) => r.outcome === 'ERROR');

console.log('\nMutation report\n');
for (const r of results) {
  const mark = { KILLED: 'kill', SURVIVED: 'MISS', SKIPPED: 'skip', ERROR: 'ERR ' }[r.outcome];
  console.log(`  [${mark}] ${r.name}`);
  if (r.outcome === 'SURVIVED') console.log(`         breaks: ${r.breaks}`);
  if (r.outcome === 'SKIPPED') console.log(`         ${r.detail}: ${r.file}`);
  if (r.outcome === 'ERROR') console.log(`         runner problem, not a test gap: ${r.detail}`);
  if (verbose && r.names && r.names.length) console.log(`         caught by: ${r.names.join('; ')}`);
}

console.log(`\n  ${killed}/${MUTATIONS.length} mutations killed`);
if (skipped.length) console.log(`  ${skipped.length} skipped (stale anchor -- update the mutation)`);
if (errored.length) {
  console.log(`\n  ${errored.length} mutation(s) could not be evaluated: the runner failed, not the tests.`);
  process.exit(1);
}
if (survived.length) {
  console.log(`\n  ${survived.length} mutation(s) SURVIVED: the suite does not cover these properties.`);
  process.exit(1);
}
if (skipped.length) {
  // A stale anchor is not a pass. MEASURED: a refactor that moved eight
  // mutations left them all "[skip] anchor not found", and this script printed
  // "every mutated defect was caught" and exited 0 -- eight of nineteen checks
  // silently gone while the gate looked healthier than before. Exiting 0 here
  // would let the next refactor do the same thing.
  console.log(`\n  ${skipped.length} mutation(s) could not run: their anchor is gone.`);
  console.log('  Update the anchor in scripts/lib/mutations.mjs; a skipped property is unverified, not caught.');
  process.exit(1);
}
console.log(`  every one of the ${MUTATIONS.length} mutated defects was caught\n`);
process.exit(0);
