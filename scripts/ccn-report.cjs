#!/usr/bin/env node
/**
 * ccn-report — trustworthy repo-wide complexity + gate-timing report.
 *
 * Why this exists (sprint-20261018-quality REQ-A): lizard's batch mode
 * inflates function spans across files (branches of later files get charged
 * to an earlier function — measured: update-hooks.test.js reported CCN=728
 * in batch, 10 per-file). The ONLY safe invocation is one lizard process
 * per file, so measureFileArgs() must always yield exactly one positional
 * target; the regression test pins that.
 *
 * Usage:
 *   node scripts/ccn-report.cjs [--root <dir>] [--json] [--top N]
 */
'use strict';

const { execFile, execFileSync } = require('child_process');
const { stripNonCode, skipQuoted } = require('./ccn-strip-noncode.cjs');
const { findSourceFiles } = require('./ccn-find-sources.cjs');
const { printReport, productionOverThreshold } = require('./ccn-report-render.cjs');
const {
  ccnOfBody,
  verifyRowCcn,
  readSourceLines,
  classifyUnverifiedRow,
  rewriteCsvRow,
  parseCsvRowIdentity,
  stripBlockComments,
  memoizedSourceReader,
  findFunctionBody,
  locateBodyAtRow,
  parseCsvLine,
  firstNonEmpty,
  intOrZero,
  verifyCcnForRow,
  rescueBodyLines,
} = require('./ccn-verify.cjs');
const path = require('path');
const { requireEmptyOutputIsReal, requireNotTruncated } = require('./ccn-report-guards.cjs');
const fs = require('fs');

// Test-file classification. Keep equivalent to the exclusion regex in
// githooks/gate-3.sh: the gate grades exactly the population this writer
// records, so a divergence makes the ratchet report pre-existing code as new
// (a false BLOCK that no repair can clear).
//
// #634: pytest's default is `python_files = test_*.py` under a `tests/` root.
// Without the tests/-dir and test_ prefix arms every pytest module was bucketed
// 'production', so test-helper complexity entered the baseline as source debt.
// The (^|[\\/]) anchors keep `latest/`, `contest/`, `attest/` and
// `my_test_dir/` out of the test bucket.
const TEST_PATH =
  /(^|[\\/])__tests?__[\\/]|(^|[\\/])(tests?)[\\/]|\.test\.[cm]?[jt]sx?$|(^|[\\/])test_[^\\/]*\.py$|_test\.(py|go)$|Test\.java$|Tests\.java$/i;
// src/npm-package/** is a prepack-generated mirror of githooks/, skills/ and
// src/** (and plugins/*/src likewise). Measuring mirrors double-counts the
// same code and would make every refactor look like two hotspots; the
// canonical tree is what gets fixed, so it is what gets measured.
const MIRROR_PREFIX = /^src\/npm-package\//;
// Vendored plugin bundles are build outputs of plugins/*/src (same rule as
// the npm-package mirror: fix canonical, prepack regenerates the copy).
const PLUGIN_BUNDLE_PREFIX = /^plugins\/[^/]+\/src\//;
// A hand-written client entry that the HOST's module loader requires to be ONE
// closure. `plugins/dsh/client/client.js` must be a single
// `window.__ModuleLoader__.load({ id, factory })` call -- the loader evaluates exactly
// that shape and a bundler that added a prelude would register nothing (the file's own
// header says so, citing a third-party plugin that got it wrong).
//
// lizard reports the ENTIRE file's branches as `factory`'s complexity: measured at 95
// for a function whose own logic is 108 NLOC, because the inner helpers are nested
// inside the closure. That is a measurement artefact of the required shape, not a
// function anyone can split -- so it is bucketed rather than refactored.
const HOST_CLOSURE_PREFIX = /^plugins\/[^/]+\/client\//;
const ANOMALY_MAX_MS = 2 * 3600 * 1000; // anything above a 2h gate run is poisoned bookkeeping

// A lizard row whose reported span exceeds this is not a real function extent:
// lizard loses brace balance on some inputs and emits a span covering the rest of
// the file. Shared by verifyRowCcn and classifyUnverifiedRow, which must agree —
// two independent 250s drifting apart would classify the same row differently
// depending on which path reached it.
const SPAN_ARTEFACT_MAX_LINES = 250;

// The CCN the gate blocks on, named so the classification and the FAIL message
// cannot disagree about which rows carry a verdict.
const CCN_BLOCK_THRESHOLD = 10;

// How far below a row's reported start findFunctionBody will search for the body.
// Must exceed SPAN_ARTEFACT_MAX_LINES: a row whose real body sits well inside the
// span it claims has to be findable, or the rescue window and the artefact
// threshold would disagree about the same row.
const RESCUE_WINDOW_LINES = 400;

/**
 * Which population a file belongs to, in TEST order.
 *
 * A table rather than a chain of `if`s: the order matters (a test under a mirror
 * prefix is still not production), and adding a bucket should not move the enclosing
 * function's complexity.
 */
/**
 * Where a row's file belongs, first match wins.
 *
 * `TEST_PATH` must stay FIRST: the rules after it are LOCATION prefixes, so with any of
 * them ahead, `plugins/dsh/client/client.test.js` is bucketed `host-closure` -- exempt
 * from the production threshold -- and the test pattern is never consulted. Grouping the
 * prefix rules together for tidiness reintroduces that bug (review CI-01 / FC-01).
 */
const BUCKET_RULES = [
  [TEST_PATH, 'test'],
  [MIRROR_PREFIX, 'mirror'],
  [PLUGIN_BUNDLE_PREFIX, 'mirror'],
  [HOST_CLOSURE_PREFIX, 'host-closure'],
];

function bucketFor(relPath) {
  const p = relPath.replace(/\\/g, '/');
  const match = BUCKET_RULES.find(([pattern]) => pattern.test(p));
  return match ? match[1] : 'production';
}

// One positional target only — never a directory, never a batch list.
function measureFileArgs(relPath) {
  return ['--csv', path.normalize(relPath)];
}

/** True when `p` exists and is a directory we can list (issue #737). */
function isReadableDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Attach a stable code to an Error so `main` can map it to an exit status. */
function taggedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// long_name (field 5, "name@start-end@path") is the AUTHORITATIVE name: field 8
// is only trustworthy when it carries no '@'. A C operator function
// ("operator,@12-18@f.cpp") would otherwise be keyed as "@12" and vanish from the
// baseline -- every later change then reads as a new function. The ratchet lib
// parses names the same way; keep in sync.
//
// Named so the three-branch precedence has one home and processSourceFile() does
// not carry it inline (see the ratchet note on that function).
/**
 * The name to report from lizard's `long_name` field.
 *
 * A C operator function ("operator,@12-18@f.cpp") yields "@12" as its name, so a
 * remaining `@` means the split hit the wrong delimiter -- and field 8 is the one that
 * carries no `@` at all.
 */
function splitLongName(loc) {
  const [rawName, rawSpan] = loc.split('@');
  return { rawName, span: (rawSpan || '').split('-') };
}

/** A name is usable when it is non-empty and survived the split intact. */
function usableName(rawName, fieldName) {
  return !rawName || rawName.includes('@') ? fieldName || '(anon)' : rawName;
}

/** Parse the span's end, defaulting to 0 for a missing or unparseable value. */
function endLineOf(rawEnd) {
  return parseInt(rawEnd, 10) || 0;
}

function parseLongName(fields) {
  const fieldName = (fields[7] || '').trim();
  const loc = fields[5] || '';
  // No '@' in long_name: field 8 is the name, and an empty one is anonymous.
  if (!loc.includes('@')) return { name: usableName('', fieldName), lineNo: '', endNo: 0 };
  const { rawName, span } = splitLongName(loc);
  return { name: usableName(rawName, fieldName), lineNo: span[0], endNo: endLineOf(span[1]) };
}

// Decide whether a lizard run's stdout is a measurement to trust. Shared by the
// execFile callback so the failure rules live in one place instead of nesting
// four conditions inside it (which the ratchet caught as CCN 9 for a callback
// that used to be 7).

function evaluateLizardOutput({ stdout, stderr, err, root, relPath }) {
  const out = stdout || '';
  const withStderr = stderr ? `: ${String(stderr).trim().slice(0, 200)}` : '';

  // lizard exits ZERO and prints NOTHING for a path it cannot read — measured:
  // `lizard --csv /nope/zzz.js` -> exit 0, no stdout, no stderr. So empty output
  // alone cannot mean "this file has zero functions"; that reading silently
  // drops an unmeasurable file from the baseline and the ratchet. The exit status
  // is not a usable signal here, so confirm the file exists and is readable
  // before believing an empty result.
  if (out.trim() === '') {
    requireEmptyOutputIsReal({ err, root, relPath, withStderr });
    return out;
  }

  // Partial output alongside a hard failure (a timeout or a kill mid-write) is a
  // truncated measurement, not a result. lizard's documented non-zero exits for
  // warnings come with complete output, so a kill/timeout signal is the signal to
  // distrust the rows: accepting them would silently drop every function lizard
  // had not reached yet.
  requireNotTruncated({ err, relPath });
  return out;
}

// Per-file measurement cap. Without a timeout a wedged lizard process hangs the
// whole report indefinitely, and the kill/truncation guard in
// evaluateLizardOutput could never fire because nothing ever killed it — a guard
// that cannot fire is worse than no guard, because it reads like protection.
// 120s is far above the worst observed file (well under a second here) while
// still bounded.
const LIZARD_TIMEOUT_MS = 120000;

function runLizardOne(lizardCmd, root, relPath) {
  return new Promise((resolve, reject) => {
    execFile(lizardCmd, measureFileArgs(relPath), { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: LIZARD_TIMEOUT_MS }, (err, stdout, stderr) => {
      // Accept BOTH resolve and reject. Throwing inside this callback does NOT
      // reject the surrounding promise — the executor has already returned by
      // the time the callback runs, so a throw escapes as an unhandled
      // exception, leaving the promise pending forever (the report would hang
      // with no error). Reported independently by three walkthrough seats.
      try {
        resolve(evaluateLizardOutput({ stdout, stderr, err, root, relPath }));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function isReadableFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

// Lizard's TS parser loses brace balance on generic-arrow fields such as
// `const handlers: Record<string, (p: X, n?: Y) => boolean> = {`: `<...>` reads as
// comparison operators, the `{` goes uncounted, and every span from there to EOF swallows
// its neighbours (measured: showHelp body 687-706 real, lizard reports 687-763 at CCN=77).
// So CCN is recomputed over the brace-balanced body, counting branch tokens outside
// strings/comments/templates. Verified against lizard 1.21.3: `a ? b : c` scores 2 and
// `a ?? b` scores 3, so ternaries ARE counted -- `\?[^.]` counts `?` unless it begins
// `?.` (chaining is not a branch). `else` is NOT a token: measured on lizard 1.26.1,
// `if(x){} else {}` and `if(x){}` both score 2, so counting it charged every function an
// extra point -- on java.ts that read as a uniform baseline+1 while lizard's CSV matched.

// Gate 3 (#544): rewrite `lizard --csv` rows with the VERIFIED CCN so the gate
// and the ratchet baseline speak the same numbers. Fatal (exit 1) on a row
// whose span cannot be verified above threshold — Gate 3 is fail-closed, so an
// unverifiable hotspot must BLOCK instead of passing on an unvalidated count.
/**
 * A source-line reader that reads each file once.
 *
 * A CSV row repeats its file, so the naive reader re-reads the same source tens of
 * times per run; the cache is what keeps verification proportional to the number of
 * FILES rather than the number of functions.
 *
 * @param {string} root repo root
 * @returns {(rel: string) => string[]|null}
 */

/**
 * Exit rather than emit a complexity number nobody verified.
 *
 * An unverified row above the threshold is the case where a wrong number would drive
 * a wrong decision, and the caller cannot tell it from a verified one.
 */
/** The default refusal: print and exit. Tests pass `opts.fail` instead. */
function exitWithFailure(message) {
  console.error(message);
  process.exit(1);
}

function refuseUnverifiedRows(tally, srcPath, allowUnverified, fail) {
  if (tally.unverified === 0) return;
  if (allowUnverified) {
    // Say so: without the warning these rows are indistinguishable from verified ones.
    console.error(
      `WARN - ${tally.unverified} function(s) above CCN ${CCN_BLOCK_THRESHOLD} could not be `
        + `span-verified in ${srcPath}; --allow-unverified was given, so they are emitted UNVERIFIED`,
    );
    return;
  }
  // Injected so the refusal path is testable (review technical CI-02).
  fail(unverifiedFailure(tally.unverified, srcPath));
}

/** What a run without the flag says before refusing. */
function unverifiedFailure(count, srcPath) {
  return `FAIL - ${count} function(s) above CCN ${CCN_BLOCK_THRESHOLD} could not be span-verified `
    + `(${srcPath}); refusing to emit unverified complexity`;
}

/**
 * Say what the verification actually did.
 *
 * These counters were incremented and thrown away, so "0 unverified" could not be told
 * apart from "the guard never examined anything". Reported on stderr so stdout stays
 * exactly the rewritten CSV.
 */
function reportTally(tally, srcPath, wanted) {
  if (!wanted) return;
  console.error(`[ccn-report] ${srcPath}: ${tally.rescued} row(s) rescued by name, ${tally.span_artefact} span artefact(s), ${tally.unverified} unverified`);
}

function csvRows(srcPath, root, opts = {}) {
  // The CSV is the input contract of this whole function. Failing to read it
  // must name the file, or the caller sees an empty row set and reads that as
  // "nothing to verify" -- the exact conflation this module exists to prevent.
  let lines;
  try {
    lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);
  } catch (err) {
    throw taggedError('ENOCSV', `cannot read lizard CSV at ${srcPath}: ${err.message}`);
  }
  const sourceLines = memoizedSourceReader(root);
  const out = [];
  // One counter per classification, so the tally in the row loop is a lookup
  // instead of a four-way branch chain — the chain was part of what pushed this
  // function past the complexity ratchet.
  //   unverified     — rows at/above the block threshold that could not be located
  //   rescued        — rows findFunctionBody located after verifyRowCcn failed
  //   span_artefact  — unlocatable AND a >250-line span: lizard brace-loss artefact
  //   unverified_low — unlocatable but below the threshold, so no verdict rides on it
  const tally = { unverified: 0, rescued: 0, span_artefact: 0, unverified_low: 0 };
  for (const line of lines) {
    const rewritten = rewriteCsvRow(line, { srcPath, root, sourceLines, tally });
    out.push(rewritten);
  }
  refuseUnverifiedRows(tally, srcPath, opts.allowUnverified, opts.fail ?? exitWithFailure);
  reportTally(tally, srcPath, opts.reportStats);
  // Only rows were rewritten; the trailing summary table is emitted by lizard
  // on a separate stream (stderr) when no --csv, so nothing else to fix here.
  return out.join('\n');
}

// The CSV column positions in this file are that of lizard 1.21.3 (11 fields,
// CCN at index 1, function locator at 5, path at 6). A different major/minor
// could reorder them and every number here would be silently wrong — the exact
// class of bug this sprint fixed. Verify the shape once per run, before trusting
// any row, rather than assuming.
const SUPPORTED_LIZARD_MAJOR = 1;

/**
 * Lizard version resolved from `--version`, or null when the probe is
 * unsupported.
 *
 * The version is RETURNED, not just validated, because a major-only check is not
 * enough to make a ratchet sound. Measured on this repo: lizard 1.25.0 and
 * 1.21.3 both report major 1, and they disagree about the same functions —
 * `csharp.extractFunctions` measures 9 under one and 18 under the other, because
 * they differ on how nested callback and regex-literal bodies are charged. A
 * baseline written by one and enforced by the other therefore reports a wall of
 * violations that no code change caused, and "fixes" them by inflating the
 * ceiling of whichever analyzer happened to run last. The pin in
 * `.lizard-version` only helps CI; nothing stopped a developer machine from
 * silently grading against a different analyzer. Recording the exact version in
 * the baseline is what lets the ratchet refuse that comparison instead of
 * inventing debt.
 */
function checkLizardVersion(lizardCmd) {
  let out;
  try {
    out = execFileSync(lizardCmd, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null; // version probe unsupported; the row-shape check below still guards
  }
  const m = String(out).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  if (major !== SUPPORTED_LIZARD_MAJOR) {
    throw new Error(
      `lizard ${m[0]} is not the supported ${SUPPORTED_LIZARD_MAJOR}.x series; the CSV column layout in this file was verified against 1.21.3 and a different major may reorder it`
    );
  }
  return m[0];
}

function resolveLizard() {
  try {
    execFileSync('lizard', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const version = checkLizardVersion('lizard');
    return { cmd: 'lizard', version };
  } catch { /* fall through */ }
  const local = path.join(process.env.HOME || '', '.local', 'bin', 'lizard');
  if (fs.existsSync(local)) {
    const version = checkLizardVersion(local);
    return { cmd: local, version };
  }
  throw new Error('lizard not found (pip install lizard)');
}

// A row that names a real declaration and above threshold must verify. Rows lizard
// emits for non-declarations (a `String`/`clearTimeout`/`CCN` identifier, an
// anonymous callback) cannot be located by name at all and are a separate, older
// problem -- flagging them here would block the baseline on noise. What must never
// happen is a row that CLAIMS a named function and carries an unverified number
// into the baseline.
function noteUnverifiedRow({ verified, bucket, name, srcLines, lineNo, ccn, rel, unverifiedRows }) {
  const namesDeclaration = name && name !== '(anonymous)' && name !== '(anon)';
  if (!verified.unlocatable || bucket !== 'production' || !namesDeclaration || !srcLines) return;
  const from = Math.max(0, lineNo - 1);
  const pattern = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[(<]');
  const declLine = srcLines.slice(from, from + 400).find((l) => pattern.test(l));
  if (declLine !== undefined) unverifiedRows.push(`${rel}:${lineNo} ${name} CCN=${ccn}`);
}

// Parse one file's lizard CSV into rows, verifying each span before its CCN is
// trusted (REQ-A: trust but verify lizard). Extracted from run()'s loop body:
// the per-file work is 90 lines of brace-matched parsing that has nothing to do
// with discovery or resolution, and inlining it pushed run() past the very
// threshold this tool reports. Behaviour is unchanged -- it still mutates the
// shared `functions`/`byRowKey`/`unverifiedRows` accumulators in place, because
// de-duplication is per (file, name, start line) across the whole run.
/** The file's lines, or null when it cannot be read -- null means "cannot verify". */
function readSourceLinesOrNull(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/);
  } catch {
    return null;
  }
}

/** Count a function twice under the same identity? Keep the widest span. */
function mergeDuplicateRow({ functions, byRowKey, rowKey, ccn, nloc }) {
  const prior = byRowKey.get(rowKey);
  if (prior === undefined) return false;
  if (functions[prior].ccn < ccn) {
    functions[prior] = { ...functions[prior], ccn, nloc };
  }
  return true;
}

// Turn one file's lizard CSV into rows, recording the two facts that separate "no
// functions here" from "nothing ran": whether any data row was seen, and whether lizard
// printed its header at all. Those two flags are the caller's silent-zero guard.
// What a raw CSV line is, before any parsing.
//   'skip'   -- blank or not a data row
//   'header' -- lizard's column header (`NLOC,CCN,...`); printed once per file
//               WITH function rows, and on its own when a file yields none, so it
//               is what separates "empty spawn output" from "no functions here"
//               -- silent zeros are exactly the failure this tool exists to kill
//   'data'   -- a row to parse
function classifyCsvLine(line) {
  if (!line) return 'skip';
  if (/^NLOC\b/.test(line)) return 'header';
  return /^\d+,/.test(line) ? 'data' : 'skip';
}

function collectCsvRows({ csv, rel, bucket, srcLines, functions, byRowKey, unverifiedRows }) {
  let dataRows = 0;
  let sawHeader = false;
  for (const line of csv.split(/\r?\n/)) {
    const kind = classifyCsvLine(line);
    if (kind === 'header') { sawHeader = true; continue; }
    if (kind === 'skip') continue;
    dataRows++;
    const f = parseCsvLine(line);
    // Field 1 is CCN; field 4 is location_size. See the column map in csvRows.
    let ccn = parseInt(f[1], 10);
    if (!Number.isFinite(ccn)) continue;
    const { name, lineNo, endNo } = parseLongName(f);
    let inflated = false;
    // Verify lizard's span before trusting its CCN. Lizard's TS parser can
    // lose brace balance (see the BRANCH_RE comment) and charge a function
    // its neighbours' branches. Proof of damage: locate the real body from
    // the reported START line — when it is shorter than the reported END,
    // lizard swallowed following functions into this span. Recompute over
    // the balanced extent. Honest rows have no such gap and pass untouched.
    // Shared with the Gate 3 csv path so gate and baseline cannot drift.
    const verified = verifyRowCcn({ srcLines, name, ccn, lineNo, endNo });
    // A row that names a real declaration and above threshold must verify.
    // Rows lizard emits for non-declarations (a `String`/`clearTimeout`/`CCN`
    // identifier, an anonymous callback) cannot be located by name at all and
    // are a separate, older problem — flagging them here would block the
    // baseline on noise. What must never happen is a row that CLAIMS a named
    // function and carrying an unverified number into the baseline.
    noteUnverifiedRow({ verified, bucket, name, srcLines, lineNo, ccn, rel, unverifiedRows });
    inflated = verified.inflated;
    ccn = verified.ccn;
    // lizard can emit the SAME function twice with different end offsets — an
    // object-literal arrow member such as `check: (a, b) => {...}` shows up as
    // both `check@71-76` and `check@71-77` — and the two rows disagree about
    // CCN. Keeping both makes the baseline record whichever was parsed last
    // while the ratchet compares every copy, so a function "regresses" against
    // its own sibling. One row per (file, name, start line) is the identity a
    // declaration actually has; keep the widest span, which is the row whose
    // body the verifier measured.
    const rowKey = `${rel.replace(/\\/g, '/')}::${name}::${lineNo}`;
    const nloc = parseInt(f[0], 10) || 0;
    if (mergeDuplicateRow({ functions, byRowKey, rowKey, ccn, nloc })) continue;
    byRowKey.set(rowKey, functions.length);
    functions.push({ _rowKey: rowKey, file: rel.replace(/\\/g, '/'), bucket, name, ccn, nloc, line: parseInt(lineNo, 10) || 0, span_inflated: inflated || undefined });
  }
  return { dataRows, sawHeader };
}

async function processSourceFile({ rel, lizard, root, functions, byRowKey, unverifiedRows }) {
  const csv = await runLizardOne(lizard, root, rel);
  const bucket = bucketFor(rel);
  const srcLines = readSourceLinesOrNull(root, rel);
  const { dataRows, sawHeader } = collectCsvRows({
    csv, rel, bucket, srcLines, functions, byRowKey, unverifiedRows,
  });
  if (!dataRows && !sawHeader) {
    // Not a silent-zero risk: lizard emits NO header at all for files with
    // no parsable functions (empty config shims, type-only modules). Record
    // them so the report can prove coverage instead of hiding gaps.
    functions.push({ file: rel.replace(/\\/g, '/'), bucket, name: '(no parsable output)', ccn: 0, nloc: 0, line: 0 });
  }
}

/**
 * Scan every file, one lizard process each, with a bounded process pool.
 *
 * The pool is bounded by PROCESS count, not by sharing state. That distinction is
 * the whole design and it was learned the hard way: this function used to be
 * strictly sequential, with a comment saying a concurrent pool "corrupts rows in
 * ways that silently zero the report (observed: 779 -> 0 with an 8-wide pool on
 * Windows)". The corruption was real; the diagnosis was one level too deep.
 *
 * lizard is a pure function of its own argv: eight concurrent invocations produce
 * byte-identical output to eight sequential ones (verified directly before this
 * change). What cannot be shared is THIS module's mutable state -- `functions`,
 * `byRowKey` and `unverifiedRows` are appended to from inside the per-file
 * callback, so interleaved async completions corrupted them.
 *
 * So: lizard processes run concurrently, result merging does not. Each task
 * collects into its own buffers, and when every task has settled the buffers are
 * appended to the shared state IN FILE ORDER, with byRowKey re-derived during the
 * merge. Isolation is preserved exactly (one process, one file, one result set),
 * ordering is deterministic, and the sequential and concurrent paths produce
 * identical state -- which is what scripts/__tests__/ccn-report.test.cjs pins.
 *
 * Why it matters: `lizard --version` alone costs ~330ms (interpreter startup plus
 * import, independent of input), so 831 tracked sources cost ~274s of pure process
 * startup, inside a pre-commit hook, on every source-touching commit. Measured
 * 2026-11-23: 175.2s sequential vs 60.3s pooled.
 */
async function scanFiles({ files, lizard, root, functions, byRowKey, unverifiedRows }) {
  const collected = await collectAll(files, { lizard, root });
  mergeCollected(collected, { functions, byRowKey, unverifiedRows });
}

/**
 * How many files to scan at once.
 *
 * XP_GATE_CCN_CONCURRENCY exists so a test can pin the pool width; the default tracks
 * the machine, because the cost is process startup and not CPU analysis.
 *
 * @returns {number}
 */
function scanWidth() {
  const parsed = parseInt(process.env.XP_GATE_CCN_CONCURRENCY || '', 10);
  const defaultWidth = Math.max(1, Math.min(require('os').cpus().length || 4, 8));
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultWidth;
  return Math.min(parsed, 32);
}

/**
 * Scan every file, `width` at a time, keeping results in INPUT ORDER.
 *
 * The order matters: the report and the baseline are compared as text, so a scan
 * that emitted files in completion order would churn the diff on every refresh.
 *
 * @returns {Promise<Array<{ownFunctions: object[], ownUnverified: object[]} | null>>}
 */
async function collectAll(files, ctx) {
  const width = scanWidth();
  const collected = new Array(files.length);
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      const ownFunctions = [];
      const ownByKey = new Map();
      const ownUnverified = [];
      await processSourceFile({
        rel: files[index], ...ctx,
        functions: ownFunctions, byRowKey: ownByKey, unverifiedRows: ownUnverified,
      });
      collected[index] = { ownFunctions, ownUnverified };
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(width, files.length); i += 1) workers.push(worker());
  await Promise.all(workers);
  return collected;
}

/**
 * Fold the per-file batches into the caller's accumulators.
 *
 * An empty slot means a file produced no batch; skipping it is correct, and the
 * alternative -- writing nulls into the accumulators -- would break every consumer.
 */
function mergeCollected(collected, { functions, byRowKey, unverifiedRows }) {
  for (const batch of collected) {
    if (!batch) continue;
    for (const fn of batch.ownFunctions) {
      if (fn._rowKey !== undefined) byRowKey.set(fn._rowKey, functions.length);
      functions.push(fn);
    }
    for (const row of batch.ownUnverified) unverifiedRows.push(row);
  }
}

async function run(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  // "No evidence" must never look like "clean tree" (issue #737). A scan that
  // reads zero files produces a report where every bucket is 0, which is
  // indistinguishable from a debt-free codebase — and the exit code was 0. This
  // was reachable whenever --root was mistyped or pointed at a tree with no
  // matching sources.
  //
  // Only an EXPLICITLY named root is fatal. The default root is process.cwd(),
  // and callers legitimately run this from a directory holding no sources (a
  // tools/ subdir, a CI step that only wants --check against a baseline).
  // Making that fatal would break every such caller, so it stays tolerant.
  if (options.rootExplicit && !isReadableDir(root)) {
    throw taggedError('ENOROOT', `scan root does not exist or is not a directory: ${root}`);
  }
  // `resolveLizard()` returns both the command and the exact version it
  // measured. The version travels with the report so `--write-baseline` can
  // record it and `--check` can refuse to grade against a baseline written by a
  // different analyzer (see checkLizardVersion).
  const resolved = options.lizardCmd ? { cmd: options.lizardCmd, version: null } : resolveLizard();
  const lizard = resolved.cmd;
  const lizardVersion = resolved.version ?? null;
  const files = findSourceFiles(root);
  if (options.rootExplicit && files.length === 0) {
    throw taggedError(
      'ENOFILES',
      `scan root contains no source files: ${root}\n` +
        'A report over zero files says nothing about complexity. Check the path, ' +
        'or drop --root to scan the current directory.'
    );
  }
  // Concurrency lives in scanFiles(), which carries the reasoning and the
  // measurement that justify it. The state below is created here and passed in,
  // so scanFiles never becomes the owner of what the caller reports.
  const functions = [];
  // Index into `functions` by row key so dedup is O(1). A linear findIndex per
  // row made a full scan O(rows x functions), which on this repo's ~770
  // production functions is invisible but grows quadratically in a monorepo.
  const byRowKey = new Map();
  const unverifiedRows = [];

  await scanFiles({ files, lizard, root, functions, byRowKey, unverifiedRows });
  return { root, filesScanned: files.length, functions, unverified_rows: unverifiedRows, lizardVersion };
}

/**
 * Baseline key for one measured function. This is the single source of truth:
 * the writer, the ratchet check, and the shell gate's awk all have to agree, or
 * a function is graded against a stranger's number.
 *
 * - Anonymous callbacks: keyed by line. A file holds dozens; a bare
 *   `(anonymous)` key kept only one and blocked every sibling against it.
 * - A name that occurs more than once in a file: keyed by line. Two distinct
 *   declarations can share a name (`walk` in two nested helpers), and lizard
 *   also files a whole construct under a name merely CALLED in it, which yields
 *   a second row for the same name at the call site. A name-only key collides
 *   and the ratchet then compares each row against the other's number.
 * - Otherwise: plain `path::name`, so renames stay visible and a move is
 *   treated as new code rather than laundering debt.
 *
 * `nameCounts` maps `${file}::${name}` to how many rows carried that name.
 */
/** Names that identify a row positionally, because they repeat within a file. */
const ANONYMOUS_NAMES = new Set(['(anonymous)', '(anon)']);

/**
 * The baseline key for one function.
 *
 * A key is `file::name` UNLESS the name cannot identify the row on its own -- an
 * anonymous function, or a name that appears twice in the same file -- in which case
 * the line is appended. Without that, moving a duplicate silently reassigns one
 * function's ceiling to the other.
 */
function baselineKey(f, nameCounts) {
  const base = `${f.file}::${f.name}`;
  if (ANONYMOUS_NAMES.has(f.name)) return `${f.file}::(anonymous)@${f.line}`;
  const seen = nameCounts?.get(base) ?? 1;
  return seen > 1 ? `${base}@${f.line}` : base;
}

/** Count how many rows carry each `${file}::${name}` pair. */
function countNames(functions) {
  const counts = new Map();
  for (const f of functions) {
    const k = `${f.file}::${f.name}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function gateTimingStats(rows) {
  const ok = rows
    .filter((r) => Number.isFinite(r.duration_ms) && r.duration_ms >= 0 && r.duration_ms <= ANOMALY_MAX_MS && r.duration_anomaly !== true)
    .map((r) => r.duration_ms)
    .sort((a, b) => a - b);
  return { count: ok.length, p50: percentile(ok, 0.5), p95: percentile(ok, 0.95), max: ok.length ? ok[ok.length - 1] : null };
}

function readAuditRows(auditPath) {
  const rows = [];
  if (!fs.existsSync(auditPath)) return rows;
  for (const line of fs.readFileSync(auditPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* tolerate torn lines */ }
  }
  return rows;
}

/**
 * Compare the measured functions against the recorded baseline and report every
 * function that got worse. Mirrors githooks/lib/ccn-ratchet.sh, so CI and the
 * pre-commit hook cannot disagree about what a violation is.
 *
 * Rules, in the order they fire:
 *   - row in baseline and CCN greater  -> BLOCK (regression past its ceiling)
 *   - row in baseline and CCN equal    -> pass
 *   - row not in baseline, CCN > block -> BLOCK (new code over the block line)
 *   - row not in baseline, CCN > warn  -> WARN, non-fatal
 *
 * Returns the list of blocking findings. Unverifiable rows block too: a
 * complexity number the engine could not confirm is not evidence of compliance.
 */
function ratchetFindings(report, baseline, warnThreshold = 5, blockThreshold = 10) {
  const findings = [];
  const nameCounts = countNames(report.functions);
  for (const f of report.functions) {
    if (f.bucket !== 'production' || f.name === '(no parsable output)') continue;
    const key = baselineKey(f, nameCounts);
    const recorded = Object.prototype.hasOwnProperty.call(baseline, key) ? baseline[key] : undefined;
    if (recorded !== undefined) {
      if (f.ccn > recorded) {
        findings.push(`BLOCK ${f.file}:${f.line} ${f.name} CCN=${f.ccn} baseline=${recorded} (ratchet: worse than recorded)`);
      }
      continue;
    }
    if (f.ccn > blockThreshold) {
      findings.push(`BLOCK ${f.file}:${f.line} ${f.name} CCN=${f.ccn} (new function over block threshold ${blockThreshold})`);
    }
  }
  for (const row of report.unverified_rows) {
    // No parentheses or backticks beyond the message's own delimiters, and none
    // in this comment either. lizard 1.21.3 -- the analyzer .lizard-version
    // pins -- loses brace balance on both: it takes a "(" inside a template
    // literal for the start of a parameter list, and it takes a backtick inside
    // a comment for the start of a template literal. Either one makes it swallow
    // every following function into a single phantom node. Measured on this
    // file: 287 lines and CCN 221 attributed to a "}" node, then to a "`" node
    // once the first trigger was removed. Same twelve findings either way.
    findings.push(`BLOCK ${row} - CCN could not be span-verified`);
  }
  return findings;
}

// What set of sources this baseline was written from, so the gate can grade the
// same population instead of assuming one (#617). Without it, a repo that scans
// fewer roots/extensions than Gate 3 recognises gets pre-existing code graded as
// "new" -- a false BLOCK with no repair, because the file has no entry to ratchet.
//
// Sorted + de-duplicated so a re-run on unchanged inputs produces a
// byte-identical file; an unordered declaration would churn the diff on every
// refresh and make "did the population change?" unreadable.
//
// Both axes are derived from f.file, NOT from the baseline KEY: keys embed `::` and
// `@line` (baselineKey), so path.extname() on a key reads a symbol suffix as an extension.
// Named rather than inlined: the two chains sat in main() as four arrow callbacks, and
// lizard scores each as its own anonymous function -- six of them over the CCN-10
// threshold, in the tool whose job is to report exactly that.
function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

/** False for the repo root ('.') and for empty strings: neither is a real root. */
function isRealRootDir(dir) {
  return Boolean(dir) && dir !== '.';
}

function baselinePopulation(functions) {
  const scored = functions.filter((f) => f.bucket === 'production' && f.name !== '(no parsable output)');
  const dirs = scored.map((f) => path.dirname(f.file).replace(/\\/g, '/')).filter(isRealRootDir);
  const exts = scored.map((f) => path.extname(f.file).toLowerCase()).filter(Boolean);
  return { roots: uniqueSorted(dirs), extensions: uniqueSorted(exts) };
}

// CI / local enforcement mode (slice E). Without this the report only ever
// printed numbers; nothing in the pipeline could fail a build for complexity.
//
// Extracted from main() so this command has one exit path and main() keeps only
// the mode dispatch. It ends the process on failure and returns on success,
// which is why the call site reads `return checkAgainstBaseline(...)`.
// Baseline refresh (REQ-D): record every production function's CURRENT CCN keyed
// by path::name. Gate 3 then blocks only regressions past these ceilings.
// Renames/moves intentionally fall out of the key space and are treated as new
// code -- moving debt around must not launder it.
//
// Extracted from main() alongside checkAgainstBaseline(): both modes had grown
// into 60-line blocks inside a single dispatch function, which is what pushed
// main()'s own CCN past the threshold this file exists to report.
function writeBaseline(report) {
  if (report.unverified_rows.length) {
    // Same reason as `refuseUnverifiedRows`: a baseline is a CEILING, so recording an
    // unverified number there decides future verdicts on a measurement nobody checked.
    console.error(unverifiedFailure(report.unverified_rows.length, 'baseline write'));
    for (const row of report.unverified_rows.slice(0, 20)) console.error(`  ${row}`);
    process.exit(1);
  }
  const baseline = {};
  const nameCounts = countNames(report.functions);
  for (const f of report.functions) {
    if (f.bucket !== 'production' || f.name === '(no parsable output)') continue;
    // Key identity lives in baselineKey() so the ratchet cannot disagree with
    // the writer about which entry a row belongs to.
    baseline[baselineKey(f, nameCounts)] = f.ccn;
  }
  const target = path.join(report.root, '.ccn-baseline.json');
  // #617: declare the population this baseline was actually written from, so the
  // gate can grade the same set instead of assuming one. Without this, a repo that
  // scans fewer roots/extensions than Gate 3 recognises gets pre-existing code
  // graded as "new" -- a false BLOCK with no repair, because the file has no
  // baseline entry to ratchet.
  //
  // Sorted + de-duplicated so a re-run on unchanged inputs produces a
  // byte-identical file; an unordered declaration would churn the diff on every
  // refresh and make "did the population change?" unreadable.
  //
  // Both axes are derived from f.file, NOT from the baseline KEY: keys embed
  // `::` and `@line` (baselineKey), so path.extname() on a key would read the
  // suffix of a symbol name as an extension.
  const population = baselinePopulation(report.functions);
  // Which analyzer produced these numbers. Without it a baseline is
  // indistinguishable from one written by any other lizard release, and the
  // ratchet happily compares across versions that disagree about the same
  // functions (see checkLizardVersion). `null` when the version probe is unsupported; the
  // reader treats null as "unknown, compare anyway" so an older toolchain still works.
  const document = { analyzer: { tool: 'lizard', version: report.lizardVersion ?? null }, population, entries: baseline };
  // A refused write must be loud: otherwise "wrote N entries" prints for a file that does
  // not exist, and the next gate grades the OLD baseline believing it was refreshed.
  try {
    fs.writeFileSync(target, JSON.stringify(document, null, 2) + '\n');
  } catch (err) {
    throw taggedError('ENOWRITE', `cannot write the complexity baseline to ${target}: ${err.message}`);
  }
  console.log(`wrote ${Object.keys(baseline).length} entries -> ${target}`);
  console.log(`  analyzer: lizard ${report.lizardVersion ?? '(version unknown)'}`);
  // Both shapes parse (ccn-ratchet.sh): a flat map and {population, entries}, so an
  // older gate still loads a file this version wrote.
}

// A ratchet is only sound if the same analyzer wrote the ceiling and took today's
// measurement. lizard releases inside the supported 1.x series disagree about the
// same functions -- measured on this repo, 1.21.3 calls `csharp.extractFunctions`
// 18 where 1.25.0 calls it 9 -- so comparing across versions produces violations
// no code change caused, and the only way to clear them is to inflate the ceiling
// to whichever analyzer ran last. Refuse the comparison and say how to repair it.
//
// A baseline with no `analyzer` block predates this record; it is compared anyway
// with a warning rather than rejected, so an older file is not a hard outage.
// `null` means the writer could not probe a version, which is unknown rather than
// a mismatch.
// The version the baseline was written with, or null when the file predates the
// record or the writer could not probe one. Kept separate from the comparison so
// the shape-handling (three nested optional reads) is not folded into it.
/**
 * A plain object, or null.
 *
 * Sprinkled through the readers below because a baseline is USER-EDITABLE JSON: every
 * level can be absent, and a missing level means "not recorded", never a crash.
 */
function asObject(value) {
  return value && typeof value === 'object' ? value : null;
}

/** The lizard version a baseline records, or null when it records none. */
function recordedLizardVersion(baselineRaw) {
  const analyzer = asObject(asObject(baselineRaw)?.analyzer);
  return analyzer?.version ?? null;
}

function assertAnalyzerMatches(baselineRaw, baselinePath, report) {
  const recordedVersion = recordedLizardVersion(baselineRaw);
  const currentVersion = report.lizardVersion ?? null;
  if (recordedVersion && currentVersion && recordedVersion !== currentVersion) {
    console.error(`FAIL — ${path.basename(baselinePath)} was written by lizard ${recordedVersion}, but this run measured with lizard ${currentVersion}.`);
    console.error('Different lizard releases disagree about the same functions, so this comparison would report debt that no change caused.');
    console.error(`Fix: install the pinned analyzer (\`pip install lizard==${recordedVersion}\`, see .lizard-version), or refresh the baseline deliberately with --write-baseline.`);
    process.exit(1);
  }
  if (!recordedVersion && currentVersion) {
    console.error(`WARN — ${path.basename(baselinePath)} does not record which lizard wrote it; comparing against lizard ${currentVersion}. Run --write-baseline to record it.`);
  }
}

// Read the baseline and normalise it to the flat `key -> ceiling` map the ratchet
// consumes. Ends the process when the file is missing or unparseable: a ratchet
// with no readable baseline grades every function as new code, which is a hard
// failure rather than something to defer to the caller.
function loadBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    console.error(`FAIL — baseline not found: ${baselinePath}`);
    console.error('A ratchet with no baseline grades every function as new code. Run --write-baseline first.');
    process.exit(1);
  }
  let baselineRaw;
  try {
    baselineRaw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch (e) {
    console.error(`FAIL — cannot parse baseline ${baselinePath}: ${String(e.message || e)}`);
    process.exit(1);
  }
  return baselineRaw;
}

function checkAgainstBaseline(report, get) {
  const baselinePath = path.resolve(get('--baseline') || path.join(report.root, '.ccn-baseline.json'));
  const baselineRaw = loadBaseline(baselinePath);
  // #617 turned the baseline file into `{ population, entries }` so it could
  // declare what it covers, but this call was never updated: the whole document
  // was handed to the ratchet, so `baseline["<file>::<fn>"]` was ALWAYS undefined
  // and every function above the block threshold was reported as new code.
  //
  // The failure mode is the bad one: the ratchet kept a 976-entry record of
  // accepted debt and could not read a single one of them, so it failed the build
  // on eight functions that were all recorded at exactly their current CCN.
  // A baseline that is never consulted is indistinguishable from no baseline --
  // except that it looks like one.
  //
  // Accept both shapes: `entries` when present, otherwise the legacy flat map
  // (a hand-edited or pre-#617 file).
  const baseline = baselineRaw && typeof baselineRaw === 'object' && baselineRaw.entries
    ? baselineRaw.entries
    : baselineRaw;

  // A ratchet is only sound if the same analyzer wrote the ceiling and took
  // today's measurement. lizard releases inside the supported 1.x series
  // disagree about the same functions -- measured on this repo, 1.21.3 calls
  // `csharp.extractFunctions` 18 where 1.25.0 calls it 9 -- so comparing
  // across versions produces violations no code change caused, and the only
  // way to clear them is to inflate the ceiling to whichever analyzer ran
  // last. Refuse the comparison and say how to repair it.
  //
  // A baseline with no `analyzer` block predates this record; it is compared
  // anyway with a warning rather than rejected, so an older file is not a hard
  // outage. `null` means the writer could not probe a version, which is
  // unknown rather than a mismatch.
  assertAnalyzerMatches(baselineRaw, baselinePath, report);
  const warnThreshold = parseInt(get('--warn') || '5', 10);
  const blockThreshold = parseInt(get('--block') || '10', 10);
  const findings = ratchetFindings(report, baseline, warnThreshold, blockThreshold);
  const blocked = findings.filter((line) => line.startsWith('BLOCK'));
  for (const line of findings) console.log(line);
  if (blocked.length) {
    console.error(`\nFAIL — ${blocked.length} complexity violation(s) against ${path.basename(baselinePath)}`);
    process.exit(1);
  }
  console.log(`OK — ${report.functions.filter((f) => f.bucket === 'production').length} production function(s) within the ratchet`);
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const explicitRoot = get('--root');
  // Pass `rootExplicit` so `run` can distinguish "the user pointed me at a tree"
  // from "I defaulted to the cwd" — only the former is fatal when it is empty
  // (issue #737).
  let report;
  try {
    report = await run({ root: explicitRoot || process.cwd(), rootExplicit: Boolean(explicitRoot) });
  } catch (err) {
    if (err && (err.code === 'ENOROOT' || err.code === 'ENOFILES')) {
      console.error(`FAIL — ${err.message}`);
      // Exit 2, deliberately distinct from 1 ("debt found"): "no evidence" is a
      // different verdict from "too much debt", and conflating them is what made
      // this bug silent for so long.
      process.exit(2);
    }
    throw err;
  }

  // CI / local enforcement mode (slice E). Without this the report only ever
  // printed numbers; nothing in the pipeline could fail a build for complexity.
  if (argv.includes('--check')) return checkAgainstBaseline(report, get);

  // Baseline refresh (REQ-D): record every production function's CURRENT CCN
  // keyed by path::name. Gate 3 then blocks only regressions past these
  // ceilings. Renames/moves intentionally fall out of the key space and are
  // treated as new code — moving debt around must not launder it.
  if (argv.includes('--write-baseline')) return writeBaseline(report);

  printReport(report, get, { readAuditRows, gateTimingStats });
}

// baselineKey/countNames are exported so the bats cross-check can prove the
// shell ratchet's awk key derivation agrees with the writer's. Two independent
// implementations of the same rule is the exact shape of the bug this sprint
// fixed; making them comparable is what keeps them from drifting again.
module.exports = { run, measureFileArgs, bucketFor, gateTimingStats, findSourceFiles, findFunctionBody, ccnOfBody, verifyRowCcn, readSourceLines, ratchetFindings, baselineKey, countNames, runLizardOne };

if (require.main === module) {
  const argv = process.argv.slice(2);
  // Gate 3 (#544): stdin = `lizard --csv <file>` output, argv[2] = the file
  // that was measured, --root = repo root. Prints the same CSV with every
  // above-threshold CCN replaced by its brace-verified value, so the gate's
  // ratchet compares the baseline's numbers against the same engine.
  const csvIdx = argv.indexOf('--csv-verified');
  if (csvIdx >= 0) {
    const target = argv[csvIdx + 1];
    const rootIdx = argv.indexOf('--root');
    const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : process.cwd();
    if (!target) { console.error('--csv-verified requires the measured file path'); process.exit(1); }
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { input += c; });
    process.stdin.on('end', () => {
      // csvRows reads the CSV from srcPath, and the measured source paths are
      const tmp = path.join(require('os').tmpdir(), `ccn-verified-${process.pid}.csv`);
      fs.writeFileSync(tmp, input);
      try {
        // stderr only: the gate's parser must see nothing but rewritten CSV on stdout.
        // Dead until now: nothing ever set `allowUnverified` (review FC-02).
        const allowUnverified = process.argv.slice(2).includes('--allow-unverified');
        process.stdout.write(csvRows(tmp, root, { reportStats: true, allowUnverified }));
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* best effort */ }
      }
    });
    return;
  }
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
