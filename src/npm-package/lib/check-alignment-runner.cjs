#!/usr/bin/env node
/**
 * check-alignment-runner.cjs — Thin argv shim for test-alignment.ts
 *
 * Bridges the `xp-gate check-alignment` CLI to the TypeScript engine without
 * shell-command interpolation of user-supplied paths (#392-#6).
 *
 * It is designed to be launched EITHER way:
 *   1. In-repo (fast path): `node` loads this file after xp-gate.js already
 *      called `require('tsx/cjs')`, so requiring `./test-alignment.ts` works.
 *   2. Published global install (zero-install path): `npx -y tsx` runs this
 *      file, and npx self-provisions tsx on demand (never a package dep), so
 *      `./test-alignment.ts` loads even though the package ships zero deps.
 *
 * All user-supplied paths are passed as discrete argv elements, never embedded
 * into a shell command string, preserving the #392-#6 injection fix.
 */
'use strict';

const { execFileSync } = require('child_process');

// --- argv parsing ----------------------------------------------------------
function argValue(argv, flag) {
  const idx = argv.indexOf(flag);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
}
function argFlag(argv, flag) {
  return argv.includes(flag);
}

const specPath = argValue(process.argv, '--spec');
const testDirsArg = argValue(process.argv, '--tests');
const outputPath = argValue(process.argv, '--output');
const jsonMode = argFlag(process.argv, '--json');

if (!specPath) {
  console.error('check-alignment: --spec <path> is required');
  process.exit(1);
}

const testDirs = testDirsArg ? [testDirsArg] : undefined;

let headCommit = 'unknown';
try {
  headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || 'unknown';
} catch (err) {
  headCommit = 'unknown';
}

const { runFullAlignment } = require('./test-alignment.ts');

let report;
try {
  report = runFullAlignment({
    specPath,
    testDirs,
    headCommit,
    outputPath: outputPath || undefined,
  });
} catch (err) {
  console.error('check-alignment failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Status:', report.alignment_status);
  console.log('Score:', report.score);
  console.log('Misaligned:', report.misaligned_tests.length);

  // #573 (recurrence of #57): a non-PASS verdict used to print only the status
  // and counters. On a real run that read:
  //     Status: BLOCKED
  //     Score: 0
  //     Misaligned: 0
  // which contradicts itself — zero misaligned tests, yet blocked — while the
  // actual reason sat in report.errors that nothing ever printed. A gate that
  // blocks without saying why is not actionable, and the usual response to an
  // unactionable red is to bypass it, which is how dead gates are made.
  if (report.alignment_status !== 'PASS') {
    const reasons = Array.isArray(report.errors) ? report.errors : [];
    if (reasons.length > 0) {
      console.error('Reasons:');
      for (const reason of reasons) console.error('  -', reason);
    } else {
      // Saying so is the point: a blocked verdict with no recorded reason is a
      // defect in whoever produced the report, not something the reader can fix
      // by editing their own files.
      console.error('Reasons: (none recorded) — this is a bug in the report producer:');
      console.error('  a non-PASS alignment verdict must carry at least one entry in report.errors.');
    }
  }
}
// Set exitCode instead of process.exit() so buffered stdout (notably the
// --json document) flushes fully before the process terminates (#392 review).
process.exitCode = report.alignment_status === 'PASS' ? 0 : 1;
