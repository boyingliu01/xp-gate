#!/usr/bin/env node
/**
 * Convert extracted gate entry bodies into callable functions (#798).
 *
 * Each entry currently holds a byte-exact slice of the old hook, including its
 * `exit N` statements. Sourced into the driver, an `exit 1` inside an entry
 * would terminate the whole hook from the middle of a gate — which is actually
 * what happened before, but it makes the DRIVER unable to tell "this gate
 * blocked" from "the hook finished".
 *
 * The conversion wraps the body in `gate_NN_run() { ... }` and rewrites
 * TOP-LEVEL `exit N` to `return N`. That pairing is exactly equivalent:
 *   - the exit status is preserved,
 *   - the driver then does `exit N`, so the EXIT trap (quality report) still
 *     fires on the same status,
 *   - SUB-SHELL `exit N` is left untouched: inside `( ... )` or `$( ... )` it
 *     never terminated the hook and rewriting it would change behaviour.
 *
 * Idempotent: a file already carrying its wrapper is returned unchanged, so
 * re-running after an edit never double-wraps.
 *
 * Usage: node scripts/wrap-gate-entries.cjs [entries-dir] [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..', 'githooks', 'gate-entries'));
const DRY = process.argv.includes('--dry-run');
const NL = '\n';

function scrub(line) {
  let s = line.replace(/\\$/g, '');
  s = s.replace(/'[^']*'/g, "''");
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  s = s.replace(/(^|\s)#.*$/, '$1');
  return s;
}

// Split an entry file into generated banner / body / generated footer.
//
// The banner is delimited by its own LAST `# ====` line, not the first one:
// line 2 of every file is already a `# ====` rule under the shebang, so
// stopping at the first one swallowed the whole banner plus the gate body and
// wrapped nothing — a defect a syntax check cannot see.
function splitEntry(content) {
  const lines = content.split('\n');
  const bodyStart = bodyStartOf(lines);
  const bodyEnd = bodyEndOf(lines, bodyStart);
  return { header: lines.slice(0, bodyStart), body: lines.slice(bodyStart, bodyEnd), footer: lines.slice(bodyEnd) };
}

/** A `# ====` rule line, which frames the generated banner. */
const BANNER_RULE = /^# ={20,}\s*$/;

/** The generated banner's footer, which marks where the gate body ends. */
const BANNER_FOOTER = /^# (Called by|Sourced by) pre-commit/;

/**
 * The first line AFTER the generated banner.
 *
 * The banner ends at its LAST `# ====`, and the scan stops at the first non-comment line:
 * the banner is entirely comments, so real code can only come after it. Continuing past
 * that point would find a `# ====` INSIDE the gate body and cut it in half.
 */
function bodyStartOf(lines) {
  let lastRule = -1;
  for (let i = 0; i < lines.length; i++) {
    if (BANNER_RULE.test(lines[i])) lastRule = i;
    if (isCode(lines[i])) break;
  }
  // One blank line belongs to the banner rather than to the body.
  const start = lastRule + 1;
  return lines[start] === '' ? start + 1 : start;
}

/** Whether this line carries real code rather than a comment. */
function isCode(line) {
  return Boolean(line.trim()) && !line.startsWith('#');
}

/**
 * The line where the gate body ends.
 *
 * Trailing blank lines are trimmed so a re-wrap does not accumulate them, and the footer
 * itself is kept whole because it is regenerated from its own marker.
 */
function bodyEndOf(lines, bodyStart) {
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (BANNER_FOOTER.test(lines[i])) {
      end = i;
      break;
    }
  }
  while (end > bodyStart && lines[end - 1].trim() === '') end--;
  return end;
}

function fnNameFor(file) {
  const m = file.match(/^gate-(\d+)([a-c]?)-entry\.sh$/);
  if (m) return 'gate_' + m[1] + (m[2] || '') + '_run';
  if (file === 'subdir-restore.sh') return 'xp_gate_subdir_restore';
  return null;
}

// The two statement shapes a top-level `exit N` can take. A subshell exit is
// deliberately NOT rewritten: `( ... exit 1 )` already terminates only the
// subshell, and `return` there would unwind the gate body instead.
const EXIT_PATTERNS = [
  // `exit N` as a whole statement.
  /^(\s*)exit\s+([0-9]+)\s*$/,
  // `cmd || exit N` / `cmd && exit N` -- both legal with `return`.
  /^(\s*.*(?:&&|\|\|)\s*)exit\s+([0-9]+)\s*$/,
];

/** The `return N` replacement for one body line, or null when it stays as-is. */
function rewriteExitLine(raw, atTopLevel) {
  if (!atTopLevel) return null;
  for (const pattern of EXIT_PATTERNS) {
    const m = raw.match(pattern);
    if (m) return m[1] + 'return ' + m[2];
  }
  return null;
}

/** Net paren balance of a line, so `depth` tracks whether we are inside `( )`. */
function parenDelta(line) {
  let delta = 0;
  for (const ch of scrub(line)) {
    if (ch === '(') delta += 1;
    else if (ch === ')') delta -= 1;
  }
  return delta;
}

function rewriteExits(bodyLines) {
  const out = [];
  let depth = 0;
  const changes = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const raw = bodyLines[i];
    const newLine = rewriteExitLine(raw, depth === 0) ?? raw;
    if (newLine !== raw) changes.push({ line: i + 1, from: raw.trim(), to: newLine.trim() });
    out.push(newLine);
    depth = Math.max(0, depth + parenDelta(raw));
  }
  return { lines: out, changes };
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sh')).sort();
let wrapped = 0;
let skipped = 0;
const summary = [];

for (const file of files) {
  const full = path.join(dir, file);
  const content = fs.readFileSync(full, 'utf8');
  const fn = fnNameFor(file);
  if (!fn) {
    summary.push({ file, action: 'SKIP (unknown name)' });
    continue;
  }
  if (new RegExp('^' + fn + '\\(\\)\\s*\\{', 'm').test(content)) {
    summary.push({ file, action: 'already wrapped', changes: 0 });
    skipped++;
    continue;
  }
  const { header, body, footer } = splitEntry(content);
  const { lines, changes } = rewriteExits(body);

  const wrapper = [
    '# Gate body. `return` is used instead of `exit` so the driver decides to',
    '# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent',
    '# here, and why sub-shell exits are deliberately left as `exit`.',
    fn + '() {',
    ...lines,
    '  return 0',
    '}',
    '',
  ];

  const newContent = header.concat(wrapper, footer).join(NL) + NL;
  if (!DRY) fs.writeFileSync(full, newContent);
  wrapped++;
  summary.push({ file, action: 'wrapped', fn, changes: changes.length, detail: changes });
}

console.log('=== wrap gate entries ===');
for (const s of summary) {
  if (s.action === 'wrapped') {
    console.log('  ' + s.file.padEnd(24) + s.fn.padEnd(22) + 'exits->return: ' + s.changes);
  } else {
    console.log('  ' + s.file.padEnd(24) + s.action);
  }
}
console.log('');
console.log(DRY ? 'DRY-RUN: nothing written' : 'wrapped=' + wrapped + ' already-wrapped=' + skipped);
