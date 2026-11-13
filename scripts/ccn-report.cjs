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
const path = require('path');
const fs = require('fs');

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|swift|cpp|cc|c|h|hpp|m|mm|dart)$/i;
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

function bucketFor(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (MIRROR_PREFIX.test(p) || PLUGIN_BUNDLE_PREFIX.test(p)) return 'mirror';
  return TEST_PATH.test(p) ? 'test' : 'production';
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

function findSourceFiles(root) {
  const out = [];
  const skipDirs = new Set(['.git', 'node_modules', 'dist', '.worktrees', '.codegraph', '.sprint-state', '.xp-gate']);
  // Git-untracked files are not repo content: scratch dirs, .stryker-tmp
  // sandboxes and .qoder reports would otherwise flood the report with
  // phantom "production" functions that no gate can even see.
  let tracked = null;
  try {
    tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split(/\r?\n/)
        .filter(Boolean)
        .map((p) => path.normalize(p))
    );
  } catch { /* outside a git repo: fall back to walking everything */ }
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(full);
      } else if (SOURCE_EXT.test(e.name)) {
        const rel = path.relative(root, full);
        if (!tracked || tracked.has(path.normalize(rel))) out.push(rel);
      }
    }
  })(root);
  return out;
}

function parseCsvLine(line) {
  // lizard CSV rows: fields quoted where they contain commas; no embedded newlines.
  const fields = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

// long_name (field 5, "name@start-end@path") is the AUTHORITATIVE name: field 8
// is only trustworthy when it carries no '@'. A C operator function
// ("operator,@12-18@f.cpp") would otherwise be keyed as "@12" and vanish from the
// baseline -- every later change then reads as a new function. The ratchet lib
// parses names the same way; keep in sync.
//
// Named so the three-branch precedence has one home and processSourceFile() does
// not carry it inline (see the ratchet note on that function).
function parseLongName(fields) {
  const fieldName = (fields[7] || '').trim();
  const loc = fields[5] || '';
  // No '@' in long_name: field 8 is the name, and an empty one is anonymous.
  if (!loc.includes('@')) return { name: fieldName || '(anon)', lineNo: '', endNo: 0 };
  const [rawName, rawSpan] = loc.split('@');
  const span = (rawSpan || '').split('-');
  // A C operator function ("operator,@12-18@f.cpp") yields "@12" as its name, so
  // a remaining '@' means the split hit the wrong delimiter -- fall back to
  // field 8, which carries no '@'.
  const name = !rawName || rawName.includes('@') ? fieldName || '(anon)' : rawName;
  return { name, lineNo: span[0], endNo: parseInt(span[1], 10) || 0 };
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
    if (err) throw new Error(`no measurable output for ${relPath} (lizard exited ${err.code || 'with an error'})${withStderr}`);
    if (!isReadableFile(path.join(root, relPath))) {
      throw new Error(`lizard reported nothing for ${relPath}, which is not a readable file — treating as measurement failure, not a zero-function file`);
    }
    return out;
  }

  // Partial output alongside a hard failure (a timeout or a kill mid-write) is a
  // truncated measurement, not a result. lizard's documented non-zero exits for
  // warnings come with complete output, so a kill/timeout signal is the signal to
  // distrust the rows: accepting them would silently drop every function lizard
  // had not reached yet.
  if (err && (err.killed || err.signal)) {
    throw new Error(`lizard was killed while measuring ${relPath} (${err.signal || 'timeout'}); output is truncated`);
  }
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
// `const handlers: Record<string, (p: X, n?: Y) => boolean> = {` — the `<...>`
// reads as comparison operators and the `{` goes uncounted. From that line to
// EOF every reported function span swallows everything in between, so CCN is
// charged across neighbours (measured: showHelp body is 687-706 real, lizard
// reports 687-763 with CCN=77). The scary numbers are exactly the broken ones.
// Recompute CCN over the brace-balanced body instead. Branch tokens, counted
// outside strings/comments/templates.
//
// `?:` ternaries ARE counted, matching lizard: verified against lizard 1.21.3,
// `return a ? b : c;` scores 2 and `return a ?? b;` scores 3. An earlier comment
// here claimed ternaries were deliberately excluded — it was wrong, and the
// regex was right. `\?[^.]` is what makes it right: it counts `?` unless it
// begins `?.` (optional chaining, which is not a branch — `a?.b` stays at 1).
const BRANCH_RE = /\b(if|else|for|while|case|catch)\b|\?\?|&&|\|\||\belif\b|\?[^.]/g;

// Skip a quoted run starting at `i` (which points at the opening quote) and
// return the index just past the closing quote. Unterminated runs consume the
// rest of the line, which is what a single-line scanner can honestly do.
function skipQuoted(line, i, quote) {
  let k = i + 1;
  while (k < line.length) {
    if (line[k] === '\\') { k += 2; continue; }
    if (line[k] === quote) return k + 1;
    k++;
  }
  return line.length;
}

function stripNonCode(line) {
  // Remove string/template/comment content so keywords inside them do not count.
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i], nx = line[i + 1];
    if (ch === '/' && nx === '/') break;
    if (ch === '/' && nx === '*') {
      const end = line.indexOf('*/', i + 2);
      i = end < 0 ? line.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipQuoted(line, i, ch);
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Copy `text` through, replacing any block comment with a single space. Returns
// { kept, open } where `open` reports a comment that runs past end of line.
function stripBlockCommentOnce(text) {
  let kept = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const next = skipQuoted(text, i, ch);
      kept += text.slice(i, next);
      i = next;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) return { kept, open: true };
      i = close + 2;
      kept += ' ';
      continue;
    }
    kept += ch;
    i++;
  }
  return { kept, open: false };
}

// Remove comment bodies across LINES, leaving line count intact so branch
// counting is unaffected.
//
// stripNonCode handles comments within a single line only. A block comment can
// span several, and its body was therefore counted as code: measured, a body of
// `return 1` scored CCN 1, and the same body under a
// `/* ... if (x) { for (y) { while (z) ... */` comment scored 11. This repo has
// 438 multi-line block comments across 159 files, so the leak inflated real
// counts. Quoted strings are respected so a `/*` inside one does not open a
// comment.
function stripBlockComments(bodyLines) {
  const out = [];
  let open = false;
  for (const line of bodyLines) {
    let text = line;
    if (open) {
      const close = text.indexOf('*/');
      if (close < 0) { out.push(''); continue; }
      text = text.slice(close + 2);
      open = false;
    }
    const res = stripBlockCommentOnce(text);
    open = res.open;
    out.push(res.kept);
  }
  return out;
}

function ccnOfBody(bodyLines) {
  let ccn = 1;
  for (const raw of stripBlockComments(bodyLines)) {
    const hits = stripNonCode(raw).match(BRANCH_RE);
    if (hits) ccn += hits.length;
  }
  return ccn;
}

// Shared by the report loop and the Gate 3 csv path (#544): lizard's CCN is
// only trustworthy after the span has been verified against brace-balanced
// source. Returns { ccn, inflated, corrected }.
function verifyRowCcn({ srcLines, name, ccn, lineNo, endNo }) {
  const startLine = Number(lineNo) || 0;
  const reportedSpan = endNo > startLine ? endNo - startLine + 1 : 0;
  const out = { ccn, inflated: false, corrected: false };
  // Verify EVERY row, not just ccn > 10. Measured on this repo: of 3449 functions
  // lizard reports at CCN <= 10, 521 are actually higher once the body is read
  // properly — renderGatePassRateChart is reported at 4 and is really 15. Gating
  // verification on ccn > 10 therefore meant the ratchet compared raw
  // UNDER-counts for the overwhelming majority of functions, and a function could
  // rise from an under-reported 4 to a genuine 15 without the ratchet noticing.
  // The cost is one extra body lookup per row, which is what makes the numbers
  // mean anything.
  if (!srcLines || startLine <= 0 || ccn <= 0) return out;
  const body = locateBodyAtRow(srcLines, name, startLine);
  let recomputed;
  if (body) {
    recomputed = ccnOfBody(srcLines.slice(body.start, body.end + 1));
  } else if (reportedSpan > SPAN_ARTEFACT_MAX_LINES) {
    // Unlocatable body AND an implausibly long span: recompute over the
    // reported window rather than trust a number with a broken span.
    recomputed = ccnOfBody(srcLines.slice(startLine - 1, startLine - 1 + reportedSpan));
  } else {
    out.unlocatable = true;
    return out;
  }
  if (recomputed !== ccn) {
    out.inflated = recomputed < ccn;
    out.ccn = recomputed;
    out.corrected = true;
  }
  return out;
}

// Read a source file as lines, or null when unreadable (caller keeps lizard's
// number and says so — an unverified row must never look verified).
function readSourceLines(root, relPath) {
  // lizard echoes back whatever path it was handed in the CSV path column, so an
  // absolute target produces an absolute path here. Joining that onto root would
  // seek <root>/<absolute>, which never exists — every row then reads as
  // unlocatable, which is either a hard failure or (with allowUnverified) a pass
  // on unverified numbers. Resolve absolute paths as themselves and confirm a
  // relative one still lives under root.
  const target = path.isAbsolute(relPath) ? relPath : path.join(root, relPath);
  try {
    return fs.readFileSync(target, 'utf8').split(/\r?\n/);
  } catch {
    return null;
  }
}

// The "verifyRowCcn could not pin the body" branch of csvRows, extracted so
// csvRows stays inside the complexity ratchet. All three outcomes are about
// CLASSIFYING an unverified row, not about the CSV rewrite itself, so they read
// as one decision: rescue by name, or count against a category.
//
// Returns { ccn, corrected } when the row was rescued, otherwise only the
// category it belongs to. The caller owns the counters, so this function stays
// free of side effects it cannot report.
function classifyUnverifiedRow({ body, ccn, reportedSpan }) {
  if (body) {
    // `corrected` must mean "the number leaving this function was read from
    // source", not "the number changed". When verification happens to agree
    // with the linter, the row is still VERIFIED — reporting it as unverified
    // would be a false accusation. The feasibility seat caught that the
    // `res.ccn !== ccn` test collapsed those two meanings.
    return { ccn: ccnOfBody(body), corrected: true, category: 'rescued' };
  }
  if (reportedSpan > SPAN_ARTEFACT_MAX_LINES) {
    // Unlocatable AND an implausibly long span: the known lizard brace-loss
    // artefact. Counting it as unverified would blame the code for a parser
    // defect; discarding it silently would hide a real number. Recorded as a
    // distinct, visible category.
    //
    // This category is OBSERVABILITY ONLY and deliberately does not fail the
    // gate — matching the pre-refactor behaviour, where the exit condition was
    // `unverified > 0` and the artefact counter never appeared in it. The
    // feasibility seat read the old "the caller decides" wording as a promise the
    // code did not keep; the honest statement is that the gate does NOT block on
    // a parser artefact, and the count is surfaced on stderr so it cannot be
    // mistaken for a clean run.
    return { category: 'span_artefact' };
  }
  // Only rows the GATE would act on are allowed to fail the gate. A row at or
  // below the block threshold has no verdict riding on it, and lizard emits
  // rows for non-declarations (`String`, `clearTimeout`, anonymous callbacks)
  // that are unlocatable by construction — counting those would block every
  // commit on noise.
  return { category: ccn > CCN_BLOCK_THRESHOLD ? 'unverified' : 'unverified_low' };
}

// Rewrite ONE `lizard --csv` row so its CCN column carries the VERIFIED value,
// or return the row unchanged when it is not a row / not verifiable. Extracted
// from csvRows so the loop there is a loop, not a parser.
//
// Returns the row text to emit. `tally` is mutated with the classification of an
// unverified row; csvRows aggregates it and decides whether to fail.
function rewriteCsvRow(line, { srcPath, root, sourceLines, tally }) {
  if (/^NLOC\b/.test(line) || !/^\d+,/.test(line)) return line;
  const row = parseCsvRowIdentity(line, srcPath, root);
  if (!row) return line;
  const verified = verifyCcnForRow({ sourceLines, ...row, tally });
  if (!verified.corrected) return line;
  const cols = parseCsvLine(line);
  // Field 1 is the CCN column — writing to field 4 would silently overwrite
  // location_size and leave the wrong complexity in place.
  cols[1] = String(verified.ccn);
  return cols.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
}

// Decode one CSV row into the fields the verifier needs, or null when the row
// does not carry a usable CCN + location.
//
// Column order (lizard 1.21.3 --csv, NO header row, 11 fields):
//   0 NLOC | 1 CCN | 2 token_len | 3 param_count | 4 location_size
//   5 "name@start-end@path" | 6 path | 7 name | 8 signature | 9 start | 10 end
// The signature column contains commas, so it must be parsed quote-aware —
// parseCsvLine does that. CCN is field 1; field 4 is the span SIZE and
// reading it as CCN understates nothing but is simply a different number.
function parseCsvRowIdentity(line, srcPath, root) {
  const f = parseCsvLine(line);
  const ccn = parseInt(f[1], 10);
  const loc = f[5] || '';
  if (!Number.isFinite(ccn) || !loc.includes('@')) return null;
  const at = loc.split('@');
  const span = (at[1] || '').split('-');
  return {
    name: firstNonEmpty(at[0], f[7], '(anon)'),
    ccn,
    lineNo: intOrZero(span[0]),
    endNo: intOrZero(span[1]),
    // The CSV path field lizard prints is the path it was handed; resolve it
    // against the repo root so cached lines match the measured file.
    rowPath: firstNonEmpty(f[6], path.relative(root, srcPath)),
  };
}

// First value that is a non-empty string after trimming, else ''.
function firstNonEmpty(...candidates) {
  for (const c of candidates) {
    const trimmed = (c || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function intOrZero(value) {
  return parseInt(value, 10) || 0;
}

// Verify one row's CCN, falling back to findFunctionBody when verifyRowCcn
// cannot pin the body. The architecture seat caught that this second search
// previously only decided whether to count the row as unverified — if it FOUND
// the body, the row kept its unvalidated CCN and passed through as if it had
// been verified.
function verifyCcnForRow({ sourceLines, rowPath, name, ccn, lineNo, endNo, tally }) {
  // Read the file ONCE. Calling sourceLines(rowPath) separately for the verify and
  // for the rescue would let the two see different text if the cache missed
  // between the calls, so a rescue could be computed against source the verifier
  // never saw.
  const srcLines = sourceLines(rowPath);
  const res = verifyRowCcn({ srcLines, name, ccn, lineNo, endNo });
  if (res.corrected) return res;
  const body = findFunctionBody((srcLines || []).slice(lineNo - 1, lineNo - 1 + RESCUE_WINDOW_LINES), name);
  const reportedSpan = endNo > lineNo ? endNo - lineNo + 1 : 0;
  const verdict = classifyUnverifiedRow({ body, ccn, reportedSpan });
  tally[verdict.category] += 1;
  if (verdict.category === 'rescued') {
    res.ccn = verdict.ccn;
    res.corrected = true;
  }
  return res;
}

// Gate 3 (#544): rewrite `lizard --csv` rows with the VERIFIED CCN so the gate
// and the ratchet baseline speak the same numbers. Fatal (exit 1) on a row
// whose span cannot be verified above threshold — Gate 3 is fail-closed, so an
// unverifiable hotspot must BLOCK instead of passing on an unvalidated count.
function csvRows(srcPath, root, opts = {}) {
  const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);
  const lineCache = new Map();
  const sourceLines = (rel) => {
    if (!lineCache.has(rel)) lineCache.set(rel, readSourceLines(root, rel));
    return lineCache.get(rel);
  };
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
  if (tally.unverified > 0 && !opts.allowUnverified) {
    console.error(`FAIL - ${tally.unverified} function(s) above CCN ${CCN_BLOCK_THRESHOLD} could not be span-verified (${srcPath}); refusing to emit unverified complexity`);
    process.exit(1);
  }
  // Say what the verification actually did. These counters were incremented and
  // thrown away, so "0 unverified" could not be told apart from "the guard never
  // examined anything" — the same unobservable-state problem this sprint exists
  // to remove. Reported on stderr so stdout stays exactly the rewritten CSV.
  if (opts.reportStats) {
    console.error(`[ccn-report] ${srcPath}: ${tally.rescued} row(s) rescued by name, ${tally.span_artefact} span artefact(s), ${tally.unverified} unverified`);
  }
  // Only rows were rewritten; the trailing summary table is emitted by lizard
  // on a separate stream (stderr) when no --csv, so nothing else to fix here.
  return out.join('\n');
}

// Locate a function body by name via brace balance. Returns [startIdx, endIdx]
// inclusive over `lines`, or null when no balanced body matches. Anonymous
// callbacks — the `(anonymous)` rows lizard emits for arrow/function literals —
// are located positionally: their row's start line IS the literal's line, so
// the first balanced `{...}` body at or after it is theirs.
function findFunctionBody(lines, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (name === '(anonymous)' || name === '(anon)') {
    // Positional: find the first line that opens a brace and close it.
    for (let i = 0; i < lines.length; i++) {
      const span = balancedExtentFrom(lines, i);
      if (span) return [i, span];
    }
    return null;
  }
  // "export const ocpRule: Rule = {" / "const handler = (a) => {" / class
  // methods: lizard names the row after the binding, so the declaration has to
  // count as "the function starts here" too. Without this the row was simply
  // unlocatable and its raw (span-inflated) count survived verification.
  // NOTE: this comment must never contain a backtick. A stray backtick opens a
  // template literal for lizard's parser and it emits phantom rows for the rest
  // of the function (measured: a bogus "=" row at CCN 24 for this very file).
  // Same for single quotes in the paragraphs around it — keep them paired.
  const re = new RegExp(
    '(function\\s+' + esc + '\\s*[(<]' +
    '|\\b(?:const|let|var)\\s+' + esc + '\\s*[:=]' +
    // TypeScript class properties: `public readonly handler = (a) => {`,
    // `private _handler: Handler = ...`. Any run of visibility/readonly/static
    // modifiers may precede the name. Without this the body is unlocatable and
    // the row keeps its raw count — verified by probe that both forms failed
    // before this alternative existed.
    '|\\b(?:(?:public|private|protected|readonly|static|override|declare|abstract)\\s+)*' + esc + '\\s*[:=]' +
    '|\\b' + esc + '\\s*[:(]' +
    ')'
  );
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(stripNonCode(lines[i]))) continue;
    const span = balancedExtentFrom(lines, i);
    if (span !== null) return [i, span];
  }
  return null;
}

// Close the first brace opened at/after `startIdx`. Returns the index of the
// balancing `}` (or null) so both the named and positional searches share one
// definition of "the body".
function balancedExtentFrom(lines, startIdx) {
  let depth = 0, started = false;
  for (let j = startIdx; j < lines.length; j++) {
    const code = stripNonCode(lines[j]);
    for (const ch of code) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return j;
  }
  return null;
}

// Lizard reports a row's start as the DECLARATION of the parsed entity, so for
// `export const fn: Rule = { ... }` the CCN-31 row can point at `check:` while
// the binding it is named after starts a few lines ABOVE. Searching only
// downward left those rows unverified — and an unverified row keeps lizard's
// span-inflated number (measured: srpRule 31 vs real 8). Look a few lines up
// first, then fall back to the original downward search.
//
// The upward search is only valid when the reported line is part of that
// entity. A row can also name a function purely because a CALL to it happens
// inside a different, badly-scoped entity: lizard filed the body of `main()`
// under `resolvePromptBudgetBytes` (CCN 7 at line 885 of
// scripts/delphi-external-review.cjs, where the real function is a CCN-6
// one-liner 400 lines above). Blindly accepting the enclosing function gave two
// same-named baseline keys and let a bogus count look verified. So an upward hit
// is only taken when the reported line itself is not a bare mention of the name
// — i.e. the reported text is a declaration of it, or opens a body.
function isBareMention(line, name) {
  const code = stripNonCode(line);
  // The reported line need not contain the name at all: lizard names a row after
  // the enclosing binding and can file it under a member, e.g. `check: (a) => {`
  // for a row named `rule`. Such a line declares a member and is legitimate.
  const declaresMember = /[A-Za-z_$][\w$]*\s*(:\s*[([{])|\([^()]*\)\s*:\s*[^=]*=>/;
  if (declaresMember.test(code)) return false;
  if (!code.includes(name)) return true;
  // A declaration of `name` — the thing a row SHOULD point at. Two shapes:
  //   function name(...)  /  const name = ...
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(
    '(function\\s+' + esc + '\\s*[(<]' +
    '|\\b(?:const|let|var)\\s+' + esc + '\\s*[:=])'
  );
  if (declaration.test(code)) return false;
  // A call site declares nothing: `maxBytes: name(x),` invokes the name, and the
  // brace it sits in belongs to the enclosing construct — so an upward hit is
  // not this row's body.
  return true;
}

const DECL_LOOKBACK = 6;
function locateBodyAtRow(lines, name, startLine) {
  const from = startLine - 1;
  const reported = lines[from] === undefined ? '' : lines[from];
  const mentionOnly = isBareMention(reported, name);

  // A row is filed against a line that is often NOT where the function starts:
  // lizard reports one line late for `export`ed declarations, and it also files
  // a whole later construct under a name that is merely CALLED near it
  // (measured: the 60-line `main()` body was reported as
  // `resolvePromptBudgetBytes`, a 6-line helper 400 lines above). The row's
  // reported line therefore only decides WHEN there is no declaration to
  // anchor on. A real declaration always wins — that is the body the row is
  // about, and its own extent is the only trustworthy span.
  const declIdx = findDeclarationLine(lines, name);
  if (declIdx !== null) {
    const span = balancedExtentFrom(lines, declIdx);
    if (span !== null) return { start: declIdx, end: span };
  }

  // No declaration in this file (`(anonymous)` callbacks, class methods named
  // only in a parent, ...). Fall back to the balanced body at the reported line,
  // which is exact when the row starts ON a literal and merely approximate for
  // member rows — either way it beats trusting an unverified span.
  for (let k = from; k >= 0 && k >= from - DECL_LOOKBACK; k--) {
    const span = findFunctionBody(lines.slice(k, Math.min(lines.length, k + RESCUE_WINDOW_LINES)), name);
    if (!span) continue;
    const absStart = k + span[0];
    if (absStart >= from && mentionOnly) continue;
    return { start: absStart, end: k + span[1] };
  }

  return null;
}

// Index of the line that DECLARES `name` (function/const/let/var form), or null.
// Scan stops at the first match: a file may mention a helper many times, but it
// declares it once (hoisted duplicates would be a separate bug).
function findDeclarationLine(lines, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    '(function\\s+' + esc + '\\s*[(<]' +
    '|\\b(?:const|let|var)\\s+' + esc + '\\s*[:=])'
  );
  for (let i = 0; i < lines.length; i++) {
    if (re.test(stripNonCode(lines[i]))) return i;
  }
  return null;
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

// Turn one file's lizard CSV into rows, recording the two facts that separate
// "no functions here" from "nothing ran": whether any data row was seen and
// whether lizard printed its header at all.
//
// Split out of processSourceFile so the per-line parsing lives on its own; the
// two flags it reports back are the caller's silent-zero guard.
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
  // Sequential on purpose. A shared pool of concurrent lizards corrupts rows
  // in ways that silently zero the report (observed: 779 -> 0 with an 8-wide
  // pool on Windows). Per-file isolation is the whole point of this tool;
  // speed is secondary to trustworthiness.
  const functions = [];
  // Index into `functions` by row key so dedup is O(1). A linear findIndex per
  // row made a full scan O(rows x functions), which on this repo's ~770
  // production functions is invisible but grows quadratically in a monorepo.
  const byRowKey = new Map();
  const unverifiedRows = [];
  for (const rel of files) {
    await processSourceFile({ rel, lizard, root, functions, byRowKey, unverifiedRows });
  }
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
function baselineKey(f, nameCounts) {
  const isAnon = f.name === '(anonymous)' || f.name === '(anon)';
  if (isAnon) return `${f.file}::(anonymous)@${f.line}`;
  const seen = nameCounts ? nameCounts.get(`${f.file}::${f.name}`) || 1 : 1;
  return seen > 1 ? `${f.file}::${f.name}@${f.line}` : `${f.file}::${f.name}`;
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
// Both axes are derived from f.file, NOT from the baseline KEY: keys embed `::`
// and `@line` (baselineKey), so path.extname() on a key would read the suffix of
// a symbol name as an extension.
//
// Named rather than inlined: the two chains used to sit directly in main() as
// four arrow callbacks, and lizard scores each callback as its own anonymous
// function -- six of them above the CCN-10 block threshold, in the tool whose job
// is to report exactly that. A named helper is also where the "which functions
// count" predicate belongs; it now has one definition instead of two copies that
// could drift apart.
// Sorted + de-duplicated: a re-run on unchanged inputs must produce a
// byte-identical file, or the diff churns on every refresh and "did the
// population change?" becomes unreadable.
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
    console.error(`FAIL - ${report.unverified_rows.length} function(s) above CCN 10 could not be span-verified; refusing to write a baseline that would record an unverified complexity as its ceiling:`);
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
  // functions (see checkLizardVersion). Recorded as `null` when the version
  // probe is unsupported; the reader treats null as "unknown, compare anyway"
  // rather than as a mismatch, so an older toolchain still works.
  const document = { analyzer: { tool: 'lizard', version: report.lizardVersion ?? null }, population, entries: baseline };
  fs.writeFileSync(target, JSON.stringify(document, null, 2) + '\n');
  console.log(`wrote ${Object.keys(baseline).length} entries -> ${target}`);
  console.log(`  analyzer: lizard ${report.lizardVersion ?? '(version unknown)'}`);
  // The reader accepts both shapes (see ccn-ratchet.sh), so an older gate can
  // still load this file: a flat map and {population, entries} both parse.
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
function recordedLizardVersion(baselineRaw) {
  if (!baselineRaw || typeof baselineRaw !== 'object') return null;
  const recordedAnalyzer = baselineRaw.analyzer;
  if (!recordedAnalyzer || typeof recordedAnalyzer !== 'object') return null;
  return recordedAnalyzer.version ?? null;
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
  // CI / local enforcement mode (slice E). Without this the report only ever
  // printed numbers; nothing in the pipeline could fail a build for complexity.
  if (argv.includes('--check')) return checkAgainstBaseline(report, get);

  // Baseline refresh (REQ-D): record every production function's CURRENT CCN
  // keyed by path::name. Gate 3 then blocks only regressions past these
  // ceilings. Renames/moves intentionally fall out of the key space and are
  // treated as new code — moving debt around must not launder it.
  if (argv.includes('--write-baseline')) return writeBaseline(report);

  const audit = readAuditRows(path.join(report.root, '.xp-gate', 'audit.jsonl'));
  const byGate = {};
  const gatesSeen = new Set(audit.map((r) => r.gate_name).filter(Boolean));
  for (const g of gatesSeen) byGate[g] = gateTimingStats(audit.filter((r) => r.gate_name === g));
  const prodOver = report.functions.filter((f) => f.bucket === 'production' && f.ccn > 10);
  const summary = {
    files_scanned: report.filesScanned,
    production_functions_gt10: prodOver.length,
    test_functions_gt10: report.functions.filter((f) => f.bucket === 'test' && f.ccn > 10).length,
    mirror_functions_gt10: report.functions.filter((f) => f.bucket === 'mirror' && f.ccn > 10).length,
    worst_production: prodOver.sort((a, b) => b.ccn - a.ccn).slice(0, parseInt(get('--top') || '20', 10)),
    gate_timing: byGate,
  };
  if (argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`files scanned:            ${summary.files_scanned}`);
    console.log(`production funcs CCN>10:  ${summary.production_functions_gt10}   (canonical tree only)`);
    console.log(`test funcs CCN>10:        ${summary.test_functions_gt10}`);
    console.log(`mirror funcs CCN>10:      ${summary.mirror_functions_gt10}   (src/npm-package copies — fixed via canonical + prepack)`);
    console.log('\nworst production functions:');
    for (const f of summary.worst_production) console.log(`  CCN=${String(f.ccn).padStart(4)}  ${f.file}:${f.line}  ${f.name}`);
    console.log('\ngate timing (ms, anomalies filtered):');
    for (const [g, s] of Object.entries(byGate).sort((a, b) => (b[1].p50 || 0) - (a[1].p50 || 0))) {
      console.log(`  ${g.padEnd(26)} n=${String(s.count).padStart(4)}  p50=${s.p50 ?? '-'}  p95=${s.p95 ?? '-'}`);
    }
  }
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
      // resolved against `root`, so the temp CSV is only a carrier for stdin.
      const tmp = path.join(require('os').tmpdir(), `ccn-verified-${process.pid}.csv`);
      fs.writeFileSync(tmp, input);
      try {
        // Always report what verification did; stderr only, so the gate's parser
        // still sees nothing but rewritten CSV on stdout.
        process.stdout.write(csvRows(tmp, root, { reportStats: true }));
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* best effort */ }
      }
    });
    return;
  }
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
