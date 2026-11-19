#!/usr/bin/env node
/**
 * Generate .xp-gate/lint-baseline.json from the current tree.
 *
 * WHY THIS EXISTS
 *
 * Gate 1 compares "shellcheck issues in the staged files" against a per-file
 * baseline and blocks when the current count EXCEEDS it. If the baseline file is
 * absent or empty the baseline is 0, so every pre-existing warning in the repo
 * counts as a new one and no shell script can ever be committed again.
 *
 * And nothing could produce that file. The gate's own advice was:
 *
 *     Run 'xp-gate baseline reset' after fixing to update the baseline.
 *
 * but `xp-gate baseline` is not a subcommand -- the suggestion pointed at a command
 * that does not exist. Measured 2026-11-20 on this repository: pre-push carried 15
 * shellcheck findings, the baseline was `{}`, and every commit touching a shell file
 * was blocked with "14 NEW shellcheck issue(s) (baseline: 0)". The same finding
 * surfaced under a different number on each run, because only STAGED files are
 * scanned and the staged set changes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It records the CURRENT number, it does not lower the bar. Refreshing a baseline to
 * hide a finding is forbidden by this repository's rules, and this tool cannot do it:
 * it always writes what the tree actually measures. Fixing the warnings is the only
 * way to make the number go down.
 *
 * Usage:
 *   node scripts/gen-lint-baseline.cjs           # write .xp-gate/lint-baseline.json
 *   node scripts/gen-lint-baseline.cjs --check    # report drift, write nothing
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, '.xp-gate', 'lint-baseline.json');

// The extensionless hooks are the two largest shell programs in this repository and
// the most common source of findings, so they must be in the measured population.
const SHELL_GLOBS = [
  'githooks/pre-commit',
  'githooks/pre-push',
  'githooks/post-commit',
  'githooks/post-merge',
];

/** Every shell file the gate would ever scan: tracked .sh/.bash plus the hooks. */
function shellFiles() {
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files', '*.sh', '*.bash'], {
      cwd: ROOT,
      encoding: 'utf-8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    tracked = [];
  }
  const hooks = SHELL_GLOBS.filter((f) => fs.existsSync(path.join(ROOT, f)));
  // git ls-files still lists files deleted from the working tree, and shellcheck
  // fails the whole run on a path that does not exist -- which silently truncated
  // this baseline once, dropping every file sorted after the missing one.
  return [...new Set([...tracked, ...hooks])].filter((f) =>
    fs.existsSync(path.join(ROOT, f))
  );
}

/** shellcheck's structured output, or [] when it is absent or found nothing. */
function shellcheckFindings(files) {
  if (files.length === 0) return [];
  let raw;
  try {
    raw = execFileSync('shellcheck', ['-f', 'json', ...files], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // shellcheck exits non-zero precisely when it HAS findings, and stdout carries
    // the JSON in that case too. An ENOENT means the tool is not installed: that is
    // "not measured", not "clean", so say so rather than writing a zero baseline.
    if (err.code === 'ENOENT') {
      console.error('shellcheck not found -- nothing measured, baseline NOT written.');
      process.exit(2);
    }
    raw = err.stdout;
  }
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('shellcheck output was not JSON -- nothing measured, baseline NOT written.');
    process.exit(2);
  }
}

function buildBaseline(findings) {
  const out = {};
  for (const f of findings) {
    const rel = path.posix.normalize(String(f.file).replace(/\\/g, '/'));
    out[rel] = out[rel] || { totalWarnings: 0 };
    out[rel].totalWarnings += 1;
  }
  return out;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const files = shellFiles();
  const findings = shellcheckFindings(files);
  const baseline = buildBaseline(findings);

  const total = Object.values(baseline).reduce((n, e) => n + e.totalWarnings, 0);
  const fileCount = Object.keys(baseline).length;

  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
  } catch {
    previous = null;
  }
  const previousTotal = previous
    ? Object.values(previous).reduce((n, e) => n + (e.totalWarnings || 0), 0)
    : 0;

  if (checkOnly) {
    if (total === previousTotal) {
      console.log(`baseline matches: ${total} finding(s) across ${fileCount} file(s)`);
      return;
    }
    console.log(`baseline drift: recorded ${previousTotal}, measured ${total}`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(
    `wrote ${path.relative(ROOT, BASELINE)}: ${total} finding(s) across ${fileCount} file(s)` +
      (previous === null ? ' (no previous baseline)' : ` (previously ${previousTotal})`)
  );
  if (total > previousTotal) {
    console.log(
      'The baseline went UP. That records new debt rather than clearing it; ' +
        'fix the findings before committing if any are yours.'
    );
  }
}

main();
