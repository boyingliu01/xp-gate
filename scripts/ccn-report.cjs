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
const TEST_PATH = /(^|[\\/])__tests__?[\\/]|\.test\.[cm]?[jt]sx?$|_test\.(py|go)$|Test\.java$|Tests\.java$/i;
// src/npm-package/** is a prepack-generated mirror of githooks/, skills/ and
// src/** (and plugins/*/src likewise). Measuring mirrors double-counts the
// same code and would make every refactor look like two hotspots; the
// canonical tree is what gets fixed, so it is what gets measured.
const MIRROR_PREFIX = /^src\/npm-package\//;
// Vendored plugin bundles are build outputs of plugins/*/src (same rule as
// the npm-package mirror: fix canonical, prepack regenerates the copy).
const PLUGIN_BUNDLE_PREFIX = /^plugins\/[^/]+\/src\//;
const ANOMALY_MAX_MS = 2 * 3600 * 1000; // anything above a 2h gate run is poisoned bookkeeping

function bucketFor(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (MIRROR_PREFIX.test(p) || PLUGIN_BUNDLE_PREFIX.test(p)) return 'mirror';
  return TEST_PATH.test(p) ? 'test' : 'production';
}

// One positional target only — never a directory, never a batch list.
function measureFileArgs(relPath) {
  return ['--csv', path.normalize(relPath)];
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

function runLizardOne(lizardCmd, root, relPath) {
  return new Promise((resolve, reject) => {
    execFile(lizardCmd, measureFileArgs(relPath), { cwd: root, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      // Accept BOTH resolve and reject. Throwing inside this callback does NOT
      // reject the surrounding promise — the executor has already returned by
      // the time the callback runs, so a throw escapes as an unhandled
      // exception, leaving the promise pending forever (the report would hang
      // with no error). Reported independently by all three walkthrough seats.
      // lizard exits non-zero when warnings exist, so a non-zero exit alone
      // proves nothing. But a crashed or timed-out run ALSO prints nothing, and
      // treating that as "this file has zero functions" would silently drop it
      // from the baseline and the ratchet.
      //
      // A file with genuinely no functions prints nothing at all with exit 0
      // (verified: `lizard --csv eslint.config.js`), so the exit status is the
      // only thing separating a real zero from a failed measurement.
      const out = stdout || '';
      if (out.trim() === '' && err) {
        const why = `lizard exited ${err.code || 'with an error'}`;
        reject(new Error(`no measurable output for ${relPath} (${why})${stderr ? `: ${String(stderr).trim().slice(0, 200)}` : ''}`));
        return;
      }
      // Partial output alongside a hard failure (a timeout or a kill mid-write)
      // is a truncated measurement, not a result. lizard's documented non-zero
      // exits for warnings come with complete output, so a kill/timeout signal
      // is the signal to distrust the rows: accepting them would silently drop
      // every function lizard had not reached yet.
      if (err && (err.killed || err.signal)) {
        reject(new Error(`lizard was killed while measuring ${relPath} (${err.signal || 'timeout'}); output is truncated`));
        return;
      }
      resolve(out);
    });
  });
}

// Lizard's TS parser loses brace balance on generic-arrow fields such as
// `const handlers: Record<string, (p: X, n?: Y) => boolean> = {` — the `<...>`
// reads as comparison operators and the `{` goes uncounted. From that line to
// EOF every reported function span swallows everything in between, so CCN is
// charged across neighbours (measured: showHelp body is 687-706 real, lizard
// reports 687-763 with CCN=77). The scary numbers are exactly the broken ones.
// Recompute CCN over the brace-balanced body instead. Branch tokens, counted
// outside strings/comments/templates — deliberately NOT counting `?:`
// ternaries, which lizard does not count either (mixing the two conventions
// invented hotspots that exist in no tool).
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
  } else if (reportedSpan > 250) {
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
  let unverified = 0;
  // Rows rescued by findFunctionBody after verifyRowCcn could not pin the body.
  // Reported so "0 unverified" is a measured statement rather than a silent one.
  let _rescued = 0;
  // Rows that are unlocatable AND carry a >250-line span: the known lizard
  // brace-loss artefact. Counted separately so they are visible rather than
  // silently trusted or wrongly blamed on the source code.
  let _spanArtefacts = 0;
  for (const line of lines) {
    if (/^NLOC\b/.test(line) || !/^\d+,/.test(line)) { out.push(line); continue; }
    const f = parseCsvLine(line);
    // Column order (lizard 1.21.3 --csv, NO header row, 11 fields):
    //   0 NLOC | 1 CCN | 2 token_len | 3 param_count | 4 location_size
    //   5 "name@start-end@path" | 6 path | 7 name | 8 signature | 9 start | 10 end
    // The signature column contains commas, so it must be parsed quote-aware —
    // parseCsvLine does that. CCN is field 1; field 4 is the span SIZE and
    // reading it as CCN understates nothing but is simply a different number.
    const ccn = parseInt(f[1], 10);
    const loc = f[5] || '';
    if (!Number.isFinite(ccn) || !loc.includes('@')) { out.push(line); continue; }
    const at = loc.split('@');
    const span = (at[1] || '').split('-');
    const name = (at[0] || f[7] || '(anon)').trim() || '(anon)';
    const lineNo = parseInt(span[0], 10) || 0;
    const endNo = parseInt(span[1], 10) || 0;
    // The CSV path field lizard prints is the path it was handed; resolve it
    // against the repo root so cached lines match the measured file.
    const rowPath = (f[6] || '').trim() || path.relative(root, srcPath);
    const res = verifyRowCcn({ srcLines: sourceLines(rowPath), name, ccn, lineNo, endNo });
    if (!res.corrected) {
      // verifyRowCcn could not pin the body. Before falling through with the raw
      // number, give it one more chance: findFunctionBody locates a declaration
      // by name over a wider window. The architecture seat caught that this
      // second search previously only decided whether to count the row as
      // unverified — if it FOUND the body, the row kept its unvalidated CCN and
      // passed through as if it had been verified. Finding the body is exactly
      // the evidence needed to correct it, so correct it.
      const body = findFunctionBody((sourceLines(rowPath) || []).slice(lineNo - 1, lineNo - 1 + 400), name);
      const reportedSpan = endNo > lineNo ? endNo - lineNo + 1 : 0;
      if (body) {
        _rescued++;
        res.ccn = ccnOfBody(body);
        // `corrected` must mean "the number leaving this function was read from
        // source", not "the number changed". When verification happens to agree
        // with the linter, the row is still VERIFIED — reporting it as
        // unverified would be a false accusation, and letting it leave as
        // uncorrected would hand the caller an unvalidated value under a flag
        // that says otherwise. The feasibility seat caught that the
        // `res.ccn !== ccn` test collapsed those two meanings.
        res.corrected = true;
      } else if (reportedSpan <= 250) {
        // Both conditions must be parenthesised. The original read
        // `!searched && !(span) > 250`, which JavaScript parses as
        // `!searched && ((!(span)) > 250)` — comparing a boolean to 250, which is
        // ALWAYS false, so no row was ever counted as unverified. A row that
        // cannot be located is suspicious REGARDLESS of its reported span;
        // treating span 0 as safe was a second hole in the same guard.
        unverified++;
      } else {
        // Unlocatable AND an implausibly long span: the known lizard brace-loss
        // artefact. verifyRowCcn already tried this window internally; if it
        // still failed, the row is neither corrected nor provably fine. Counting
        // it as unverified would blame the code for a parser defect and (with
        // the default fail-closed behaviour) block on it; discarding it silently
        // would hide a real number. So it is recorded as a distinct, visible
        // category and the caller decides — the important part is that it stops
        // being invisible.
        _spanArtefacts++;
      }
    }
    if (!res.corrected) { out.push(line); continue; }
    const cols = parseCsvLine(line);
    // Field 1 is the CCN column — writing to field 4 would silently overwrite
    // location_size and leave the wrong complexity in place.
    cols[1] = String(res.ccn);
    out.push(cols.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','));
  }
  if (unverified > 0 && !opts.allowUnverified) {
    console.error(`FAIL - ${unverified} function(s) above CCN 10 could not be span-verified (${srcPath}); refusing to emit unverified complexity`);
    process.exit(1);
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
    '|\\b' + esc + '\\s*[:(])'
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
    const span = findFunctionBody(lines.slice(k, Math.min(lines.length, k + 400)), name);
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

function resolveLizard() {
  try {
    execFileSync('lizard', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return 'lizard';
  } catch { /* fall through */ }
  const local = path.join(process.env.HOME || '', '.local', 'bin', 'lizard');
  if (fs.existsSync(local)) return local;
  throw new Error('lizard not found (pip install lizard)');
}

async function run(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const lizard = options.lizardCmd || resolveLizard();
  const files = findSourceFiles(root);
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
    const csv = await runLizardOne(lizard, root, rel);
    const bucket = bucketFor(rel);
    // Source lines for span verification (REQ-A: trust but verify lizard).
    let srcLines = null;
    try {
      srcLines = fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/);
    } catch { srcLines = null; }
    let dataRows = 0;
    let sawHeader = false;
    for (const line of csv.split(/\r?\n/)) {
      if (!line) continue;
      // CSV header (`NLOC,CCN,...`): printed once per file WITH function rows,
      // and also on its own when a file yields none. Track it so an empty
      // spawn output can be told apart from a genuinely function-less file —
      // silent zeros are exactly the failure mode this tool exists to kill.
      if (/^NLOC\b/.test(line)) { sawHeader = true; continue; }
      if (!/^\d+,/.test(line)) continue;
      dataRows++;
      const f = parseCsvLine(line);
      // Field 1 is CCN; field 4 is location_size. See the column map in csvRows.
      let ccn = parseInt(f[1], 10);
      if (!Number.isFinite(ccn)) continue;
      const nameField = f[7] || '(anon)';
      // long_name (field 5, "name@start-end@path") is the AUTHORITATIVE name:
      // field 8 is only trustworthy when it carries no '@'. A C operator
      // function ("operator,@12-18@f.cpp") would otherwise be keyed as "@12"
      // and vanish from the baseline — every later change then reads as a new
      // function. The ratchet lib parses names the same way; keep in sync.
      const loc = f[5] || '';
      let name = (nameField || '').trim();
      let lineNo = '';
      let endNo = 0;
      if (loc.includes('@')) {
        const at = loc.split('@');
        name = at[0];
        const span = (at[1] || '').split('-');
        lineNo = span[0];
        endNo = parseInt(span[1], 10) || 0;
        if (!name || /@/.test(name)) name = (nameField || '(anon)').trim();
      } else if (!name) {
        name = '(anon)';
      }
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
      const namesDeclaration = name && name !== '(anonymous)' && name !== '(anon)';
      if (verified.unlocatable && bucket === 'production' && namesDeclaration && srcLines) {
        const declLine = srcLines.slice(Math.max(0, lineNo - 1), Math.max(0, lineNo - 1) + 400).find((l) =>
          new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[(<]').test(l));
        if (declLine !== undefined) {
          unverifiedRows.push(`${rel}:${lineNo} ${name} CCN=${ccn}`);
        }
      }
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
      const prior = byRowKey.get(rowKey);
      if (prior !== undefined) {
        if (functions[prior].ccn < ccn) functions[prior] = { ...functions[prior], ccn, nloc: parseInt(f[0], 10) || 0 };
        continue;
      }
      byRowKey.set(rowKey, functions.length);
      functions.push({ _rowKey: rowKey, file: rel.replace(/\\/g, '/'), bucket, name, ccn, nloc: parseInt(f[0], 10) || 0, line: parseInt(lineNo, 10) || 0, span_inflated: inflated || undefined });
    }
    if (!dataRows && !sawHeader) {
      // Not a silent-zero risk: lizard emits NO header at all for files with
      // no parsable functions (empty config shims, type-only modules). Record
      // them so the report can prove coverage instead of hiding gaps.
      functions.push({ file: rel.replace(/\\/g, '/'), bucket, name: '(no parsable output)', ccn: 0, nloc: 0, line: 0 });
    }
  }
  return { root, filesScanned: files.length, functions, unverified_rows: unverifiedRows };
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
    findings.push(`BLOCK ${row} (CCN could not be span-verified)`);
  }
  return findings;
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const report = await run({ root: get('--root') || process.cwd() });

  // CI / local enforcement mode (slice E). Without this the report only ever
  // printed numbers; nothing in the pipeline could fail a build for complexity.
  if (argv.includes('--check')) {
    const baselinePath = path.resolve(get('--baseline') || path.join(report.root, '.ccn-baseline.json'));
    if (!fs.existsSync(baselinePath)) {
      console.error(`FAIL — baseline not found: ${baselinePath}`);
      console.error('A ratchet with no baseline grades every function as new code. Run --write-baseline first.');
      process.exit(1);
    }
    let baseline;
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    } catch (e) {
      console.error(`FAIL — cannot parse baseline ${baselinePath}: ${String(e.message || e)}`);
      process.exit(1);
    }
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
    return;
  }

  // Baseline refresh (REQ-D): record every production function's CURRENT CCN
  // keyed by path::name. Gate 3 then blocks only regressions past these
  // ceilings. Renames/moves intentionally fall out of the key space and are
  // treated as new code — moving debt around must not launder it.
  if (argv.includes('--write-baseline')) {
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
    fs.writeFileSync(target, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`wrote ${Object.keys(baseline).length} entries -> ${target}`);
    return;
  }

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
        process.stdout.write(csvRows(tmp, root));
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* best effort */ }
      }
    });
    return;
  }
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
