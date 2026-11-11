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
  // The generated banner ends at the last `# ====` that appears BEFORE the
  // "# Called by/Sourced by" footer and before the first non-comment code.
  let lastRule = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^# ={20,}\s*$/.test(lines[i])) lastRule = i;
    // Stop scanning once real code starts: the banner is entirely comments.
    if (lines[i].trim() && !lines[i].startsWith('#')) break;
  }
  let bodyStart = lastRule + 1;
  if (lines[bodyStart] === '') bodyStart++;
  let bodyEnd = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^# (Called by|Sourced by) pre-commit/.test(lines[i])) {
      bodyEnd = i;
      break;
    }
  }
  while (bodyEnd > bodyStart && lines[bodyEnd - 1].trim() === '') bodyEnd--;
  return { header: lines.slice(0, bodyStart), body: lines.slice(bodyStart, bodyEnd), footer: lines.slice(bodyEnd) };
}

function fnNameFor(file) {
  const m = file.match(/^gate-(\d+)([a-c]?)-entry\.sh$/);
  if (m) return 'gate_' + m[1] + (m[2] || '') + '_run';
  if (file === 'subdir-restore.sh') return 'xp_gate_subdir_restore';
  return null;
}

function rewriteExits(bodyLines) {
  const out = [];
  let depth = 0;
  const changes = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const raw = bodyLines[i];
    const s = scrub(raw);
    let newLine = raw;

    if (depth === 0) {
      // `exit N` as a whole statement.
      const whole = raw.match(/^(\s*)exit\s+([0-9]+)\s*$/);
      if (whole) {
        newLine = whole[1] + 'return ' + whole[2];
        changes.push({ line: i + 1, from: raw.trim(), to: newLine.trim() });
      } else {
        // `cmd || exit N` / `cmd && exit N` — both legal with `return`.
        const cond = raw.match(/^(\s*.*(?:&&|\|\|)\s*)exit\s+([0-9]+)\s*$/);
        if (cond) {
          newLine = cond[1] + 'return ' + cond[2];
          changes.push({ line: i + 1, from: raw.trim(), to: newLine.trim() });
        }
      }
    }
    out.push(newLine);

    const d = scrub(raw);
    let open = 0;
    let close = 0;
    for (const ch of d) {
      if (ch === '(') open++;
      else if (ch === ')') close++;
    }
    depth += open - close;
    if (depth < 0) depth = 0;
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
