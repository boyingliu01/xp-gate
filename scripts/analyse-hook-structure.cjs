#!/usr/bin/env node
/**
 * Analyse the structure of githooks/pre-commit (#798).
 *
 * The hook is treated as architecture, not as a text file: this reports every
 * top-level function, the gate section each one is DEFINED in, the section each
 * one is CALLED from, and flags the two structural defects that make the file
 * unrefactorable today:
 *
 *   CROSS-SECTION FUNCTION  a function whose body spans more than one gate
 *                           banner. Mechanically moving gate blocks tears these
 *                           apart, which is exactly how a previous reorder
 *                           silently disabled Gate 5a.
 *   SECTION-LOCAL LOGIC     executable gate logic that lives outside any
 *                           function, so its position IS its execution order.
 *
 * Usage: node scripts/analyse-hook-structure.cjs [hook-path]
 */
const fs = require('fs');
const path = require('path');

const HOOK = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'githooks', 'pre-commit');
const lines = fs.readFileSync(HOOK, 'utf8').split('\n');

// ── gate sections ───────────────────────────────────────────────────────────
const BANNER = /^# ={20,}\s*$/;
const isGateBannerText = (t) => /^# GATE ?\d+[a-c]?:/i.test(t) || /^# Gate 1[2][a-c]?:/i.test(t);

const starts = [];
for (let i = 0; i < lines.length; i++) {
  if (!BANNER.test(lines[i])) continue;
  for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
    if (isGateBannerText(lines[j])) {
      starts.push({ banner: i, text: lines[j].trim() });
      break;
    }
    if (!/^#/.test(lines[j])) break;
  }
}
function keyOf(t) {
  const a = t.match(/^# GATE ?(\d+)([a-c]?):/i);
  if (a) return a[2] ? a[1] + a[2] : a[1];
  const b = t.match(/^# Gate 12([a-c]?):/i);
  if (b) return b[1] ? '12' + b[1] : '12';
  return null;
}
const sections = [];
for (let i = 0; i < starts.length; i++) {
  const s = starts[i].banner;
  const e = i + 1 < starts.length ? starts[i + 1].banner - 1 : lines.length - 1;
  const k = keyOf(starts[i].text);
  if (k) sections.push({ key: k, start: s, end: e, text: starts[i].text });
}
// Gate 13's banner carries no marker line.
{
  let g13 = -1;
  for (let i = 0; i < lines.length; i++) if (/^GATE_13_STATUS="SKIP"$/.test(lines[i])) { g13 = i; break; }
  if (g13 >= 0 && !sections.some((s) => s.key === '13')) {
    for (let i = g13; i >= 0 && g13 - i < 200; i--) {
      if (BANNER.test(lines[i])) {
        const next = sections.find((s) => s.start > i);
        if (next) next.start = Math.max(next.start, i + 1);
        sections.push({ key: '13', start: i, end: (next ? next.start : lines.length) - 1, text: '# GATE 13' });
        break;
      }
    }
    sections.sort((a, b) => a.start - b.start);
    for (let i = 0; i < sections.length - 1; i++) sections[i].end = sections[i + 1].start - 1;
  }
}
function sectionOf(lineIdx) {
  for (const s of sections) if (lineIdx >= s.start && lineIdx <= s.end) return s.key;
  return 'preamble';
}

// ── top-level functions ─────────────────────────────────────────────────────
// A definition starts at column 0 with `name() {` or `function name {`.
const defRe = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{\s*$|^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*$/;

// Strip the constructs whose braces are NOT block delimiters. Without this,
// `${var}` / `$( ... )` inside an eval'd string is counted as a block and the
// match runs to EOF: the first version of this script reported _hook_resolve as
// spanning 236-6341 when it really closes at 254.
function stripNonBlockBraces(line) {
  let s = line.replace(/\\$/g, '');
  // Remove single-quoted strings.
  s = s.replace(/'[^']*'/g, "''");
  // Remove double-quoted strings, including any ${...}/$(...) inside them.
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  // Remove remaining parameter expansions ${...} (may nest once).
  let prev;
  do {
    prev = s;
    s = s.replace(/\$\{[^{}]*\}/g, 'X');
  } while (s !== prev);
  // Remove command substitutions $( ... ) shallowly.
  s = s.replace(/\$\([^()]*\)/g, 'X');
  // Remove arithmetic $(( ... )).
  s = s.replace(/\$\(\([^()]*\)\)/g, 'X');
  // Remove comments.
  s = s.replace(/(^|\s)#.*$/, '$1');
  return s;
}

const funcs = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(defRe);
  if (!m) continue;
  const name = m[1] || m[2];
  let depth = 0;
  let end = -1;
  for (let j = i; j < lines.length; j++) {
    const code = stripNonBlockBraces(lines[j]);
    for (const ch of code) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end >= 0) break;
  }
  funcs.push({ name, start: i, end: end >= 0 ? end : lines.length - 1 });
}

// ── call sites ──────────────────────────────────────────────────────────────
const calls = new Map();
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^\s*#/.test(line)) continue;
  for (const f of funcs) {
    const re = new RegExp('(^|[^A-Za-z0-9_])' + f.name + '\\b');
    if (re.test(line) && i !== f.start) {
      if (!calls.has(f.name)) calls.set(f.name, new Set());
      calls.get(f.name).add(sectionOf(i));
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
console.log('=== sections ===');
for (const s of sections) {
  console.log('  gate ' + String(s.key).padEnd(5) + ' lines ' + (s.start + 1) + '-' + (s.end + 1) + '  (' + (s.end - s.start + 1) + ')');
}

const cross = [];
for (const f of funcs) {
  const ds = sectionOf(f.start);
  const de = sectionOf(f.end);
  if (ds !== de) cross.push({ ...f, from: ds, to: de });
}

console.log('');
console.log('=== top-level functions: ' + funcs.length + ' ===');
console.log('=== CROSS-SECTION FUNCTIONS: ' + cross.length + ' ===');
for (const c of cross) {
  console.log('  ' + c.name.padEnd(42) + ' ' + (c.start + 1) + '-' + (c.end + 1) + '  gate ' + c.from + ' -> gate ' + c.to);
}

// Executable gate logic living outside any function = order is its position.
console.log('');
console.log('=== section-local top-level statements (position IS order) ===');
const insideFunc = new Array(lines.length).fill(false);
for (const f of funcs) for (let i = f.start; i <= f.end; i++) insideFunc[i] = true;
const loose = new Map();
for (let i = 0; i < lines.length; i++) {
  if (insideFunc[i]) continue;
  const t = lines[i];
  if (!t.trim()) continue;
  if (/^\s*#/.test(t)) continue;
  if (/^\s*(fi|done|else|esac|then|do|\{|\}|\))\s*$/.test(t)) continue;
  const k = sectionOf(i);
  if (!loose.has(k)) loose.set(k, []);
  loose.get(k).push(i + 1);
}
for (const s of sections) {
  const l = loose.get(s.key) || [];
  console.log('  gate ' + String(s.key).padEnd(5) + ' ' + String(l.length).padStart(4) + ' top-level statements');
}
const pre = loose.get('preamble') || [];
console.log('  preamble ' + pre.length + ' top-level statements');
const totalLoose = [...loose.values()].reduce((a, b) => a + b.length, 0);
console.log('');
console.log('TOTAL top-level (position-dependent) statements: ' + totalLoose + ' of ' + lines.length + ' lines');
