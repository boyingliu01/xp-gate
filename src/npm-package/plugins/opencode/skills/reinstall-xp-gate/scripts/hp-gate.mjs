#!/usr/bin/env node
/**
 * hp-gate: Harness Plugin Gate.
 *
 * WHAT THIS IS
 * ------------
 * xp-gate is a JavaScript product whose own quality gates cannot read
 * JavaScript. Gate 3 (complexity) and Gate 10 (SAST) filter files through
 *
 *   const LIZARD_EXTENSIONS = /\.(ts|tsx|js|jsx|py|go|...)$/;
 *   const SEMGREP_EXTENSIONS = /\.(ts|tsx|js|jsx|py|go|...)$/;
 *
 * (xp-gate v0.38.74, `gates/common.ts`). Neither lists `mjs` or `cjs`. Measured
 * on a throwaway repo with one trivial `src/a.mjs`:
 *
 *   xp-gate check 3   ->  "SKIPPED - Complexity (no source files to check)"
 *   xp-gate check 3   ->  "PASSED"  when the same function sits in `src/a.js`
 *
 * So on the upstream repository every `.mjs` file reports PASS/SKIP while nobody
 * inspects it (upstream xp-gate#732). This script closes that hole for this
 * repository by running the SAME tools xp-gate would run, on the `.mjs` sources
 * xp-gate cannot see, using xp-gate's own thresholds so the verdict means the
 * same thing.
 *
 * WHY NOT JUST RENAME FILES TO .js
 * --------------------------------
 * Considered and rejected: `.mjs` is what makes the ESM contract explicit, the
 * package sets `"type": "module"`, and the sibling directories hold untracked
 * `.js` copies that get committed by accident (`git add -A` staged 34 of them
 * during this investigation). Renaming buys visibility inside one gate and
 * loses a real signal elsewhere.
 *
 * USAGE
 *   node scripts/hp-gate.mjs            # complexity + lint, human output
 *   node scripts/hp-gate.mjs --json     # machine-readable
 *   node scripts/hp-gate.mjs --ccn 8    # override the CCN block threshold
 *
 * Exit 1 if any file violates a threshold.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { effectivePath } from './lib/proc.mjs';
import { listFiles } from './lib/util.mjs';
import { parseLizardCsv, ccnViolations } from './lib/ccn.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const ccnArg = argv.indexOf('--ccn');
/** Same default as Gate 3's `CCN_THRESHOLD`; only the ignore list is wider. */
const CCN_THRESHOLD = ccnArg >= 0 ? Number(argv[ccnArg + 1]) : 5;

const SOURCE_EXT = /\.(mjs|cjs)$/;

/**
 * Collect the sources xp-gate cannot see.
 *
 * `tests/` is included deliberately: a copy of production logic in a test file
 * is still a copy, and this repository's own history has a test that passed for
 * the wrong reason.
 */
function sourceFiles(dir = root) {
  return listFiles(dir)
    .map((rel) => path.join(dir, rel))
    .filter((abs) => SOURCE_EXT.test(abs) && !abs.split(path.sep).includes('node_modules'));
}

const ENV = { ...process.env, PATH: effectivePath() };

/**
 * Run lizard over the given files and return its CSV rows.
 *
 * `--csv` is not optional. Without it lizard prints a human table plus
 * `... has N NLOC, M CCN ...` warnings on stderr, stdout stays empty, and the
 * parser finds zero functions -- which the caller then reports as "every
 * function within the threshold". Measured: without `--csv` this script passed
 * a tree containing a CCN-22 function.
 *
 * `-C` sets the reporting cut-off. It is passed as the script's own threshold
 * rather than a constant so the tool and the verdict cannot disagree.
 */
function lizardCsv(files) {
  const r = spawnSync('lizard', ['--csv', '-l', 'javascript', '-C', String(CCN_THRESHOLD), ...files], {
    encoding: 'utf8',
    env: ENV,
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const failure = describeSpawnFailure(r);
  return failure ? { error: failure } : { csv: String(r.stdout || '') };
}

/** Turn a spawnSync result into one line a human can act on, or null on success. */
function describeSpawnFailure(r) {
  if (r.error) return 'lizard not runnable: ' + r.error.message;
  if (r.status === 0) return null;
  return 'lizard exited ' + r.status + ': ' + firstLine(r.stderr);
}

/** First non-empty line of a tool stderr, for a single-line error message. */
function firstLine(text) {
  return String(text || '').split(String.fromCharCode(10)).map((l) => l.trim()).find(Boolean) || '';
}

/**
 * `node --check` per file: the cheapest proof that nothing here would fail at
 * parse time. xp-gate's Gate 1 skips `.mjs` for the same reason Gate 3 does, so
 * a syntax error in this repository has no gate at all.
 */
function syntaxErrors(files) {
  const out = [];
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', env: ENV, timeout: 30000 });
    if (r.status !== 0) {
      out.push({ file: path.relative(root, file), error: String(r.stderr || '').split(/\r?\n/).find(Boolean) || 'parse error' });
    }
  }
  return out;
}

const files = sourceFiles();
const report = { threshold: CCN_THRESHOLD, files: files.length, violations: [], syntax: [], tools: {} };

const syntax = syntaxErrors(files);
report.syntax = syntax;

let ccn = [];
const liz = lizardCsv(files);
const lizardOk = !liz.error;
if (liz.error) report.tools.lizard = liz.error;
else report.tools.lizard = 'ok';
if (lizardOk) {
  ccn = parseLizardCsv(liz.csv).map((row) => ({ ...row, file: path.relative(root, row.file).split(path.sep).join('/') }));
}
report.violations = ccnViolations(ccn, CCN_THRESHOLD);

// "Scanned 30 files and found 0 functions" is a parsing failure wearing a pass
// verdict. Treat a silent lizard as a hard error, not as clean code.
const scanBroken = files.length > 0 && lizardOk && ccn.length === 0;

if (asJson) {
  console.log(JSON.stringify({ ...report, scanBroken, allFunctions: ccn }, null, 2));
} else {
  console.log(`\n=== hp-gate: sources xp-gate cannot see (.mjs/.cjs) ===`);
  console.log(`  files scanned : ${report.files}`);
  console.log(`  lizard        : ${report.tools.lizard}`);
  console.log(`  CCN threshold : > ${CCN_THRESHOLD} blocks (same as Gate 3)`);
  console.log(`  functions     : ${ccn.length}`);
  console.log(`  syntax errors : ${syntax.length}`);

  if (scanBroken) {
    console.log('\n  ✗ lizard returned no functions for a non-empty source set --');
    console.log('    the scan is broken, which is not the same as the code being clean.');
  }

  if (syntax.length) {
    console.log('\n  ✗ unparseable files');
    for (const s of syntax) console.log(`    ${s.file}: ${s.error}`);
  }

  if (report.violations.length) {
    console.log(`\n  ✗ ${report.violations.length} function(s) above CCN ${CCN_THRESHOLD}`);
    for (const v of report.violations.sort((a, b) => b.ccn - a.ccn)) {
      console.log(`    ${String(v.ccn).padStart(3)}  ${v.name}  (${v.file}:${v.line})`);
    }
  } else if (!scanBroken) {
    console.log(`\n  ✓ every function within CCN ${CCN_THRESHOLD}`);
  }
}

const ok = report.violations.length === 0 && syntax.length === 0 && !scanBroken;
if (!asJson) console.log(`\n  ${ok ? '✓ hp-gate passed' : '✗ hp-gate failed'}\n`);
process.exit(ok ? 0 : 1);
