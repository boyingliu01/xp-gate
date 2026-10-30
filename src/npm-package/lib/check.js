'use strict';

const { principles } = require('./principles.js');
const { arch } = require('./arch.js');
const { getGateInfo, runGate, resolveAlias, getAliases, GATE_NOT_RUN } = require('./gate-runner.js');

/**
 * Resolve a token (gate ID or alias) to a canonical gate ID.
 * Returns null if unresolved.
 */
function resolveGateToken(token) {
  return resolveAlias(token);
}

function parseCheckArgs(args) {
  const flags = { all: false, list: false, gateIds: null, changed: false, brief: false };
  const posArgs = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--all') { flags.all = true; i++; }
    else if (arg === '--list') { flags.list = true; i++; }
    else if (arg === '--changed') { flags.changed = true; i++; }
    else if (arg === '--brief') { flags.brief = true; i++; }
    else if (arg === '--gates' && i + 1 < args.length) {
      flags.gateIds = args[i + 1].split(',').map(s => s.trim()).filter(Boolean);
      i += 2;
    }
    else if (arg.startsWith('--gates=')) {
      flags.gateIds = arg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
      i++;
    }
    else { posArgs.push(arg); i++; }
  }
  const rawTarget = posArgs[0] || null;
  // Try to resolve positional as a gate alias/number
  const resolvedGate = rawTarget ? resolveGateToken(rawTarget) : null;
  return {
    ...flags,
    positionals: posArgs,
    pathArg: resolvedGate ? posArgs[1] || null : rawTarget,
    gateNumber: resolvedGate,
  };
}

/**
 * Coerce a runGate() verdict into a valid process exit code (#657). The only
 * non-numeric verdict is GATE_NOT_RUN (a string sentinel meaning "did not run");
 * it must become 0, because a gate that honestly reported nothing to analyse is
 * not a failure — and passing the string to process.exit() crashes Node.
 * @param {number|string} verdict
 * @returns {number}
 */
function normalizeGateExit(verdict) {
  return typeof verdict === 'number' ? verdict : 0;
}

async function check(args) {
  const opts = parseCheckArgs(args);

  if (opts.list) return listGates();
  if (opts.changed) return runChangedBrief();
  // #657: runGate() can return the GATE_NOT_RUN sentinel (a string) when a gate
  // has no module/fallback. Returning it straight to the caller let it reach
  // process.exit(), which throws ERR_INVALID_ARG_TYPE and dumps a stack trace.
  // Map it to exit 0 here (the gate honestly reported "did not run"); a real
  // failure code passes through unchanged.
  if (opts.gateNumber && !opts.all && !opts.gateIds) {
    return normalizeGateExit(await runGate(opts.gateNumber, opts.pathArg));
  }
  if (opts.all) return checkAllGates(opts.pathArg);
  if (opts.gateIds && opts.gateIds.length > 0) return runGatesByIds(opts.gateIds, opts.pathArg);

  if (!opts.pathArg) {
    console.error('Usage: xp-gate check <file_or_directory|gate-or-alias> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --gates <ids>    Run specific gates (comma-separated IDs or aliases, e.g. "version,4,secrets")');
    console.error('  --all             Run all invokable gates');
    console.error('  --changed --brief Fast: run only the gates the current diff can trip, one-screen summary');
    console.error('  --list            List all available gates');
    console.error('');
    console.error('Available Gates:');
    console.error('  0/version    1/lint         2/duplicates   3/complexity');
    console.error('  4/principles 5/tests        6/architecture 7/iac');
    console.error('  8/secrets    9/sast         10/build       11/sprint');
    console.error('');
    console.error('Examples:');
    console.error('  xp-gate check src/                              # Default: principles + architecture');
    console.error('  xp-gate check 3                                 # Run Gate 3 (Complexity)');
    console.error('  xp-gate check secrets                           # Run Gate 8 via alias');
    console.error('  xp-gate check . --gates version,4,secrets       # Run gates 0, 4, and 8');
    console.error('  xp-gate check . --all                           # Run all invokable gates');
    console.error('  xp-gate check . --changed --brief               # Fast: only what this diff trips');
    console.error('  xp-gate check --list                            # List available gates');
    return 1;
  }

  return runDefaultChecks(opts.pathArg);
}

async function runDefaultChecks(target) {
  let failures = 0;
  let ran = 0;

  console.log('━━━ Gate 4: Principles ━━━');
  const principlesCode = await principles([target]);
  if (principlesCode !== 0) failures += 1;
  ran += 1;

  console.log('━━━ Gate 6: Architecture ━━━');
  const archCode = await arch([]);
  if (archCode !== 0) failures += 1;
  ran += 1;

  console.log('');
  console.log(`[xp-gate check] ${ran - failures}/${ran} gate(s) passed`);
  return failures === 0 ? 0 : 1;
}

/**
 * Render a gate tally as one honest line.
 *
 * Deliberately omits any state with a zero count, so a clean run reads
 * "10 passed / 10 total" and a run with skips reads "5 passed / 5 skipped /
 * 10 total" — the reader can see which of the two happened. The old
 * `${ran - failures}/${ran}` form produced the same "10/10" for both (#568).
 *
 * @param {{passed: number, skipped: number, failed: number, warned: number, total: number}} tally
 * @returns {string} e.g. "2 passed / 1 failed / 1 skipped / 4 total"
 */
function formatGateTally(tally) {
  const parts = [`${tally.passed} passed`];
  if (tally.failed > 0) parts.push(`${tally.failed} failed`);
  if (tally.warned > 0) parts.push(`${tally.warned} warned`);
  if (tally.skipped > 0) parts.push(`${tally.skipped} skipped`);
  parts.push(`${tally.total} total`);
  return parts.join(' / ');
}

/**
 * Run every standalone-invokable gate and report the result honestly.
 *
 * `preCommitOnly` entries are NOT invokable from the CLI: `runGate` prints
 * "SKIPPED - <reason>" and returns 0. Counting that 0 as a pass made
 * `10/10 gate(s) passed` the summary for a run where five of fifteen gates
 * never executed (#568, report §5 phase-0 action 0.2). Skips are now counted
 * separately, still do not fail the run, and always appear in the summary.
 *
 * @param {string} target - path to check
 * @returns {Promise<number>} 0 when nothing failed, 1 otherwise
 */
async function checkAllGates(target) {
  const { getAllGates } = require('./gate-runner.js');
  const allGates = getAllGates();
  const invokableGates = allGates.filter(g => !g.preCommitOnly);
  const skippedGates = allGates.filter(g => g.preCommitOnly);

  const tally = {
    passed: 0,
    skipped: skippedGates.length,
    failed: 0,
    warned: 0,
    total: allGates.length,
  };

  for (const gate of skippedGates) {
    console.log(`━━━ Gate ${gate.id}: ${gate.name} ━━━`);
    console.log(`⏭️  SKIPPED (not invokable from the CLI) - ${gate.reason || 'runs during commit'}`);
    console.log('');
  }

  for (const gate of invokableGates) {
    // #589: `--all` means the whole tree. Passing the scope keeps the gates that
    // read CHANGED_FILES from scanning an empty diff and reporting SKIP — which
    // read like a pass while checking LESS than an ordinary commit.
    const code = await runGate(gate.id, target, { scope: 'all' });
    // #618: a gate that ran nothing (no TS module, no bash fallback) returns the
    // GATE_NOT_RUN sentinel. Counting it as passed put three gates that analysed
    // nothing inside "8 passed"; it is a skip, and the summary must say so.
    if (code === GATE_NOT_RUN) tally.skipped += 1;
    else if (code === 0) tally.passed += 1;
    else tally.failed += 1;
    console.log('');
  }

  console.log(`[xp-gate check --all] ${formatGateTally(tally)}`);
  if (tally.skipped > 0) {
    // Name them: a bare count hides WHICH work did not happen, and the point of
    // the fix is that the summary can no longer imply they ran.
    console.log(
      `[xp-gate check --all] not run from the CLI: ${skippedGates.map(g => g.id).join(', ')} ` +
        '(pre-commit only; `git commit` runs them)'
    );
  }
  return tally.failed === 0 ? 0 : 1;
}

async function runGatesByIds(gateIds, target) {
  let failures = 0;
  let skipped = 0;
  let ran = 0;
  const resolvedGates = [];
  const unknown = [];

  for (const gateId of gateIds) {
    const resolved = resolveGateToken(gateId);
    if (resolved) {
      resolvedGates.push(resolved);
    } else {
      unknown.push(gateId);
    }
  }

  if (unknown.length > 0) {
    const { getAllGates } = require('./gate-runner.js');
    const allAliases = getAllGates().flatMap(g => g.aliases);
    console.error(`[xp-gate check] Unknown gate(s) in --gates list: ${unknown.join(', ')}`);
    console.error(`  Known aliases/IDs: ${allAliases.join(', ')}`);
    return 1;
  }

  for (const resolvedId of resolvedGates) {
    // #618/#657: a NOT_RUN sentinel is a skip, not a pass and not a failure.
    const code = await runGate(resolvedId, target);
    if (code === GATE_NOT_RUN) skipped += 1;
    else if (code !== 0) failures += 1;
    ran += 1;
    console.log('');
  }

  if (ran === 0) {
    console.error(`[xp-gate check] No valid gates in --gates list: ${gateIds.join(',')}`);
    console.error('  Run: xp-gate check --list  to see available gates');
    return 1;
  }

  const tally = { passed: ran - failures - skipped, failed: failures, warned: 0, skipped, total: ran };
  console.log(`[xp-gate check] ${formatGateTally(tally)}`);
  return failures === 0 ? 0 : 1;
}

/**
 * Fast "what will this commit trip?" view (P1-4, diagnosis 2026-10-30).
 *
 * `check . --all` runs the whole tree (minutes). During BUILD the developer only
 * needs to know which blocking rules the CURRENT diff touches, in one screen and
 * in seconds. This maps the diff to the gates that read changed files and runs
 * only those, so the common case (docs / a couple of sources) returns fast.
 *
 * Honest by construction: prints only gate->verdict, never implying a gate ran
 * when it was skipped. Gates not modelled here are listed as "commit-time".
 */

/** Extension of a path, lowercased, without the dot ('' when none). */
function fileExtension(file) {
  const m = /\.([a-z0-9]+)$/i.exec(file);
  return m ? m[1].toLowerCase() : '';
}

/** Wall-clock budget for one `git diff` used by the --changed resolver. */
const GIT_DIFF_TIMEOUT_MS = 10000;

/**
 * Run one git diff and split its stdout into file names. Returns null ONLY for a
 * failed diff (not a git repo); any git error is caught and mapped to null so the
 * caller can report "not a repository" instead of crashing on a null status.
 */
function gitChangedNames(spawnSync, args) {
  try {
    const res = spawnSync('git', args, { encoding: 'utf-8', timeout: GIT_DIFF_TIMEOUT_MS });
    if (res.status !== 0 || typeof res.stdout !== 'string') return null;
    return res.stdout.split('\n').map((f) => f.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** Diff scope mirrors pre-commit: staged first, then anything vs HEAD. */
function readChangedFiles() {
  const { spawnSync } = require('child_process');
  const staged = gitChangedNames(spawnSync, ['diff', '--cached', '--name-only', '--diff-filter=ACM']);
  if (staged === null) return null;
  if (staged.length > 0) return staged;
  const vsHead = gitChangedNames(spawnSync, ['diff', 'HEAD', '--name-only', '--diff-filter=ACM']);
  return vsHead === null ? staged : vsHead;
}

/**
 * Run the gates a diff can trip that are both diff-scoped and fast. Gate 2
 * (jscpd) is excluded on purpose: it scans the whole tree and duplicate
 * detection is a codebase-wide question, not a per-diff one. Gate 4 is handed the
 * actual files — calling it with '.' examined 0 files and printed a vacuous
 * "No violations found", the exact anti-pattern this project forbids.
 */
async function runBriefGates(sourceFiles) {
  const results = [];
  if (sourceFiles.length === 0) return results;
  results.push({ id: '3', code: await runGate('3', '.', {}) });
  const { principles } = require('./principles.js');
  results.push({ id: '4', code: await principles(sourceFiles) });
  return results;
}

const BRIEF_GATE_NAMES = { '2': 'Duplicates', '3': 'Complexity', '4': 'Principles' };
const COMMIT_TIME_GATES = ['1 lint', '5 tests', '6 Boy Scout', '7 IaC', '8 secrets', '9 sast', '10 build', '11 sprint'];

/** Print the one-screen summary; returns the number of blocking gates. */
function printBriefSummary(changed, sourceFiles, results, ms) {
  console.log('');
  console.log(`━━━ xp-gate check --changed (${changed.length} file(s), ${sourceFiles.length} source) ━━━`);
  if (sourceFiles.length === 0) {
    console.log('  No source files changed — no blocking source gate applies (docs/config only).');
  }
  let failures = 0;
  for (const r of results) {
    let verdict;
    if (r.code === 0) verdict = 'PASS';
    else if (r.code === 'NOT_RUN') verdict = 'SKIP';
    else { verdict = 'BLOCK'; failures += 1; }
    console.log(`  Gate ${r.id} ${(BRIEF_GATE_NAMES[r.id] || r.id).padEnd(12)} ${verdict}`);
  }
  const rest = sourceFiles.length > 0 ? COMMIT_TIME_GATES.filter((g) => !/^(1 |5 |6 )/.test(g)) : COMMIT_TIME_GATES;
  console.log(`  commit-time (not run here): ${rest.join(', ')}`);
  console.log(`  ${failures === 0 ? '✅ clear' : `❌ ${failures} blocking`} — ${ms} ms`);
  return failures;
}

async function runChangedBrief() {
  const { SOURCE_FILE_EXTENSIONS } = require('./gate-runner.js');
  const t0 = Date.now();

  const changed = readChangedFiles();
  if (changed === null) {
    console.error('[xp-gate check --changed] not a git repository');
    return 1;
  }
  if (changed.length === 0) {
    console.log('[xp-gate check --changed] no staged/tracked changes — nothing to gate (0 files).');
    return 0;
  }

  const srcExt = new Set(SOURCE_FILE_EXTENSIONS);
  const sourceFiles = changed.filter((f) => srcExt.has(fileExtension(f)));
  const results = await runBriefGates(sourceFiles);
  const failures = printBriefSummary(changed, sourceFiles, results, Date.now() - t0);
  return failures === 0 ? 0 : 1;
}

function listGates() {
  const { getAllGates } = require('./gate-runner.js');
  const allGates = getAllGates();

  console.log('');
  console.log('XP-Gate Quality Gates:');
  console.log('┌──────┬──────────────────────────────┬──────────────────────────────┬──────────┬──────────────────────────────────────────┐');
  console.log('│ Gate │ Name                         │ Aliases                      │ CLI      │ Description                              │');
  console.log('├──────┼──────────────────────────────┼──────────────────────────────┼──────────┼──────────────────────────────────────────┤');
  for (const gate of allGates) {
    const id = gate.id.padEnd(4);
    const name = gate.name.slice(0, 28).padEnd(28);
    const aliases = (gate.aliases || []).join(', ').slice(0, 28).padEnd(28);
    const cli = gate.preCommitOnly ? 'commit' : 'check';
    const desc = gate.description.slice(0, 40).padEnd(40);
    console.log(`│ ${id} │ ${name} │ ${aliases} │ ${cli.padEnd(8)} │ ${desc} │`);
  }
  console.log('└──────┴──────────────────────────────┴──────────────────────────────┴──────────┴──────────────────────────────────────────┘');
  console.log('');
  console.log('Legend:');
  console.log('  check   — invokable via xp-gate check <gate-id-or-alias>');
  console.log('  commit  — only runs during git commit (pre-commit hook)');
  console.log('');
  console.log('Examples:');
  console.log('  xp-gate check . --gates version,principles,secrets');
  console.log('  xp-gate check . --gates 0,4,8');
  console.log('  xp-gate check secrets');
  console.log('  xp-gate check . --all');
  console.log('');
  return 0;
}

module.exports = { check, checkAllGates, formatGateTally, runChangedBrief, fileExtension, printBriefSummary, normalizeGateExit };
