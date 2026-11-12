#!/usr/bin/env node
/**
 * Classify every `exit N` in the extracted gate entries (#798).
 *
 * Converting an entry into a function means `exit` no longer terminates the
 * hook — it would terminate only that function's caller chain, or worse, be a
 * no-op inside a subshell. Before any such conversion we must know, per exit:
 *
 *   TOPLEVEL  not inside any subshell/command-substitution → becomes `return`
 *   SUBSHELL  inside ( ... ) or $( ... ) → already scoped, leave it alone
 *
 * Guessing here is what makes a "successful" refactor silently stop blocking a
 * commit, so this prints the classification instead of transforming blindly.
 *
 * Usage: node scripts/classify-exits.cjs <entries-dir>
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'githooks', 'gate-entries'));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sh')).sort();

// Strip strings and comments so parentheses inside them are not counted.
function scrub(line) {
  let s = line.replace(/\\$/g, '');
  s = s.replace(/'[^']*'/g, "''");
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  s = s.replace(/(^|\s)#.*$/, '$1');
  return s;
}

// Track subshell depth. `(` opens, `)` closes; `$(` and `$((` open too.
function depthDelta(s) {
  let open = 0;
  let close = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') open++;
    else if (ch === ')') close++;
  }
  return { open, close };
}

let totalTop = 0;
let totalSub = 0;
const report = [];

for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  let depth = 0;
  const exits = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const s = scrub(raw);
    const isExit = /^\s*exit\s+[0-9]/.test(raw);
    const isExitCmd = /\|\|\s*exit\s+[0-9]/.test(raw) || /&&\s*exit\s+[0-9]/.test(raw);
    if (isExit || isExitCmd) {
      exits.push({ line: i + 1, depth, text: raw.trim() });
    }
    const d = depthDelta(s);
    depth += d.open - d.close;
    if (depth < 0) depth = 0;
  }
  const top = exits.filter((e) => e.depth === 0);
  const sub = exits.filter((e) => e.depth > 0);
  totalTop += top.length;
  totalSub += sub.length;
  report.push({ f, exits, top, sub });
}

console.log('=== exit classification ===');
for (const r of report) {
  if (r.exits.length === 0) continue;
  console.log('');
  console.log(r.f + '  total=' + r.exits.length + '  toplevel=' + r.top.length + '  subshell=' + r.sub.length);
  for (const e of r.exits) {
    const tag = e.depth === 0 ? 'TOPLEVEL ' : 'SUBSHELL ';
    console.log('   ' + tag + 'L' + String(e.line).padStart(5) + ' d=' + String(e.depth).padStart(2) + '  ' + e.text.slice(0, 70));
  }
}
console.log('');
console.log('TOTAL toplevel (need `return`): ' + totalTop);
console.log('TOTAL subshell (leave as-is):  ' + totalSub);
