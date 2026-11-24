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
const { isGateBannerText, keyOf, findGateBanners } = require('./gate-banner-locator.cjs');

const starts = findGateBanners(lines);
const sections = [];
for (let i = 0; i < starts.length; i++) {
  const s = starts[i].banner;
  const e = i + 1 < starts.length ? starts[i + 1].banner - 1 : lines.length - 1;
  const k = keyOf(starts[i].text);
  if (k) sections.push({ key: k, start: s, end: e, text: starts[i].text });
}

/**
 * Add Gate 13's section, which has a banner but no `# GATE 13:` title.
 *
 * The marker is a status assignment in its BODY, so the section is found by walking
 * UP from that line to the nearest rule. Without this Gate 13 had no section at all
 * and every line in it was attributed to the gate before it.
 *
 * @param {string[]} lines
 * @param {Array<{key: string, start: number, end: number}>} sections mutated in place
 */
/** The line that marks Gate 13's section, which has no banner of its own. */
const GATE13_MARKER = /^GATE_13_STATUS="SKIP"$/;

/** Whether a section is already the Gate 13 one. */
function isGate13Section(section) {
  return section.key === '13';
}

/**
 * Add Gate 13's section, which has a banner but no `# GATE 13:` title.
 *
 * The marker lives in the gate's BODY, so the section is found by walking UP from that
 * line to the nearest rule. Without this Gate 13 had no section at all and every line
 * in it was attributed to the gate before it.
 *
 * Three guards, all of them "nothing to do": no marker, already present, no rule above.
 * Written as early returns so the happy path is the last statement and needs no nesting.
 */
function locateGate13(lines, sections) {
  const marker = lines.findIndex((l) => GATE13_MARKER.test(l));
  if (marker < 0) return;
  if (sections.some(isGate13Section)) return;

  const banner = findRuleAbove(lines, marker);
  if (banner < 0) return;

  const next = sections.find((sec) => sec.start > banner);
  if (next) next.start = Math.max(next.start, banner + 1);
  sections.push({ key: '13', start: banner, end: sectionEnd(next, lines), text: '# GATE 13' });
  resequenceSections(sections);
}

/**
 * Where Gate 13's section ends.
 *
 * It ends where the NEXT section begins, or at the end of the file -- minus one,
 * because `start` is inclusive on both ends.
 */
function sectionEnd(next, lines) {
  return (next ? next.start : lines.length) - 1;
}

// Gate 13's banner carries no marker line, so its section is located from the
// status assignment in its body. Done here, after the definitions it uses.
locateGate13(lines, sections);

/**
 * The nearest rule line at or above `from`, within 200 lines.
 *
 * The bound keeps a missing rule from walking to the top of the file and claiming
 * the preamble for this gate.
 *
 * @returns the index, or -1
 */
function findRuleAbove(lines, from) {
  for (let i = from; i >= 0 && from - i < 200; i--) {
    if (BANNER.test(lines[i])) return i;
  }
  return -1;
}

/** Sort by start and make each section end where the next begins. */
function resequenceSections(sections) {
  sections.sort((a, b) => a.start - b.start);
  for (let i = 0; i < sections.length - 1; i++) sections[i].end = sections[i + 1].start - 1;
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
/**
 * The constructs whose braces are NOT block delimiters, in the order they must be
 * removed.
 *
 * Order is load-bearing: a double-quoted string is stripped before parameter
 * expansions, because `"${x}"` contains a `${}` that would otherwise be replaced
 * while still inside the string's quotes.
 */
const NON_BLOCK_STRIPPERS = [
  // A line continuation is not content.
  [/\\$/g, ''],
  // Single-quoted strings hold no expansions.
  [/'[^']*'/g, "''"],
  // Double-quoted strings, including any ${...}/$(...) inside them.
  [/"(?:[^"\\]|\\.)*"/g, '""'],
  // Parameter expansions ${...} (may nest once, hence the loop below).
  [/\$\{[^{}]*\}/g, 'X'],
  // Command substitutions $( ... ), shallowly.
  [/\$\([^()]*\)/g, 'X'],
  // Arithmetic $(( ... )).
  [/\$\(\([^()]*\)\)/g, 'X'],
  // Comments.
  [/(^|\s)#.*$/, '$1'],
];

/** Expansions may nest once, so apply the expansion stripper until it settles. */
function settleNestedExpansions(text) {
  let prev = text;
  let next = text;
  do {
    prev = next;
    next = prev.replace(/\$\{[^{}]*\}/g, 'X');
  } while (next !== prev);
  return next;
}

/**
 * Remove the constructs whose braces are not block delimiters.
 *
 * Without this, `${var}` / `$( ... )` inside an eval'd string is counted as a block
 * and the match runs to EOF: the first version of this script reported _hook_resolve
 * as spanning 236-6341 when it really closes at 254.
 */
function stripNonBlockBraces(line) {
  const [continuation, ...rest] = NON_BLOCK_STRIPPERS;
  const unescaped = line.replace(continuation[0], continuation[1]);
  const [single, double, ...afterStrings] = rest;
  const quoted = unescaped.replace(single[0], single[1]).replace(double[0], double[1]);
  const expanded = settleNestedExpansions(quoted);
  return afterStrings.reduce((acc, [re, rep]) => acc.replace(re, rep), expanded);
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
