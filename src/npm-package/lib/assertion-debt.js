/**
 * `xp-gate audit assertions` — make pre-existing assertion debt visible (#668).
 *
 * Gate 5d deliberately checks only the files in the diff: a full-repo scan on
 * every commit is too slow. That has an expensive side effect. Pre-existing debt
 * blocks unrelated changes — the author who fixed `writeReport()`'s error handling
 * was stopped by four long-standing `expect(true).toBe(true)` lines in a file they
 * had merely touched — and the block reads as "this change introduced a problem".
 *
 * The worst consequence is not that one false attribution. It is what it does to
 * behaviour: noise in the attribution makes people reach for
 * `@assertion-justified` instead of fixing the test. A gate that teaches people to
 * annotate their way past it is worse than no gate. Hence a batch work queue.
 *
 * Scope: only the two shapes Gate 5d BLOCKS (tautological, empty catch). Weak-only
 * assertions and mock echoes WARN there because each can be legitimate; putting them
 * in a "debt to clear" list would invent work.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Directories that never contain hand-written assertions worth auditing. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.stryker-tmp',
  '.agent-tmp',
  // Build output mirrored from src/ — listing it again would double-count debt and
  // send a batch fixer to a file that regenerates.
  '.xp-gate',
]);

/** Test-file patterns across the ecosystems XP-Gate supports. */
function isTestFile(name) {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) ||
    /(^|\/)(__tests__)\//.test(name) ||
    /\.test\.bats$/.test(name) ||
    /^test_.*\.py$/.test(name) ||
    /_test\.(go|rs|py)$/.test(name)
  );
}

/**
 * Tautological assertions: the assertion cannot fail.
 *
 * Mirrors `classify_tautological_assertions` in githooks/lib/assertion-quality.sh.
 * The two implementations must agree, because a debt list that disagrees with the
 * gate it exists to serve sends people to fix lines that are not blocking and miss
 * the ones that are.
 */
const TAUTOLOGY_PATTERNS = [
  // (a) identical literal on both sides.
  {
    re: /expect\s*\(\s*(true|false|null|undefined|-?\d+|"[^"]*"|'[^']*')\s*\)\s*\.\s*to(?:Be|Equal|StrictEqual)\s*\(\s*\1\s*\)/,
  },
  // (b) a literal tested against the truthiness it already has.
  { re: /expect\s*\(\s*(?:true|1|-1|"[^"]+"|'[^']+')\s*\)\s*\.\s*toBeTruthy\s*\(/ },
  { re: /expect\s*\(\s*(?:false|0|null|undefined|""|'')\s*\)\s*\.\s*toBeFalsy\s*\(/ },
];

/** An empty catch body: the failure it guards is discarded. */
const EMPTY_CATCH_RE = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;

/**
 * Is this line a fixture rather than a real assertion?
 *
 * A `.bats` test that exercises the Gate 5d classifier necessarily contains
 * `'expect(true).toBe(true);'` as a quoted INPUT. Reporting it as debt would send a
 * batch fixer to delete the very strings that pin the classifier — turning the
 * "fix debt" instruction into an instruction to remove test coverage.
 *
 * The distinguishing feature is quoting: in a fixture the shape is wrapped in
 * quotes and usually sits inside a list/assignment, where a real assertion is bare
 * executable code.
 */
function isFixtureLine(trimmed) {
  // A leading quote before the assertion shape: `'expect(...)...'` or "expect(...)".
  if (/^['"`]/.test(trimmed)) return true;
  // Assertion shape appearing inside a quoted string on the line.
  if (/['"][^'"`]*expect\s*\(/.test(trimmed)) return true;
  return false;
}

/** Classify one source line, or null when it is fine. */
function classifyLine(text) {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  // A commented-out assertion is not an assertion.
  if (/^(\/\/|\*|\/\*|#)/.test(trimmed)) return null;
  if (isFixtureLine(trimmed)) return null;
  for (const { re } of TAUTOLOGY_PATTERNS) {
    if (re.test(trimmed)) return 'tautological';
  }
  if (EMPTY_CATCH_RE.test(trimmed)) return 'swallowed-error';
  return null;
}

/** Find debt in one file's text. */
function scanSource(text, file) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kind = classifyLine(lines[i]);
    if (kind) findings.push({ line: i + 1, kind, text: lines[i].trim() });
  }
  return findings.length > 0 ? [{ file, findings }] : [];
}

/** Walk the tree collecting test files, bounded to avoid node_modules. */
function listTestFiles(root, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      listTestFiles(path.join(root, entry.name), out);
      continue;
    }
    if (isTestFile(entry.name)) out.push(path.join(root, entry.name));
  }
  return out;
}

/**
 * Scan for assertion debt.
 *
 * @param {{cwd?: string, source?: string, file?: string}} opts
 * @returns {Array<{file: string, findings: Array<{line: number, kind: string, text: string}>}>}
 */
function scanForAssertionDebt(opts = {}) {
  if (typeof opts.source === 'string') {
    return scanSource(opts.source, opts.file || '<inline>');
  }
  const root = opts.cwd || process.cwd();
  const results = [];
  for (const abs of listTestFiles(root)) {
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(root, abs).split(path.sep).join('/');
    results.push(...scanSource(text, rel));
  }
  return results.sort((a, b) => b.findings.length - a.findings.length || a.file.localeCompare(b.file));
}

/** Totals for a debt run: per-kind counts plus the file count to batch over. */
function summarizeDebt(results) {
  const byKind = { tautological: 0, 'swallowed-error': 0 };
  let total = 0;
  for (const entry of results) {
    for (const finding of entry.findings) {
      byKind[finding.kind] = (byKind[finding.kind] || 0) + 1;
      total += 1;
    }
  }
  return { files: results.length, total, byKind };
}

module.exports = { classifyLine, scanForAssertionDebt, summarizeDebt, isTestFile };
