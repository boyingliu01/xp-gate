#!/usr/bin/env node
// Reorder the top-level gate sections of githooks/pre-commit (#798).
// CUT AND REGROUP ONLY - no gate logic is edited.
//
// Usage:  node scripts/reorder-gates.cjs [--dry-run] [--restore]
//
// The move is proven lossless: the multiset of lines is identical before and
// after. A physical cut-and-paste of 6340 lines with 76 `exit 1` sites is
// otherwise unreviewable.
//
// Target order (user-specified in #798):
//   prelude               version-consistency, sprint-flow, file-hygiene
//   1 Gate-Compile        compiler-strictness, build-integrity
//   2 Gate-StaticCheck    code-quality
//   3 Gate-SimianCheck    duplicate-code
//   4 Gate-CCNCheck       complexity
//   5 Gate-SecurityCheck  secret-scanning, sast, iac-security
//   6 Gate-RegressiveTest tests-coverage
//   tail                  architecture, principles
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'githooks', 'pre-commit');
const DRY = process.argv.includes('--dry-run');
const NL = '\n';

const lines = fs.readFileSync(HOOK, 'utf8').split(NL);
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

// Gate 13 has a banner but NO "# GATE 13:" marker line - its header explains the
// compiler reasoning and only names the gate further down ("TAIL APPEND after
// Gate 12"). Locate it by the assignment that identifies it instead, then walk
// back to the banner that opens it.
{
  let g13Assign = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^GATE_13_STATUS="SKIP"$/.test(lines[i])) {
      g13Assign = i;
      break;
    }
  }
  if (g13Assign < 0) {
    console.error('FATAL: could not locate the Gate 13 body (GATE_13_STATUS assignment)');
    process.exit(1);
  }
  let banner = -1;
  for (let i = g13Assign; i >= 0; i--) {
    if (BANNER.test(lines[i])) {
      banner = i;
      break;
    }
    // A gate 13 assignment can never sit before the previous gate's body, so a
    // long walk-back means the layout changed and the assumption is void.
    if (g13Assign - i > 200) break;
  }
  if (banner < 0) {
    console.error('FATAL: Gate 13 has no opening banner above its body');
    process.exit(1);
  }
  if (!starts.some((s) => s.banner === banner)) {
    starts.push({ banner, text: '# GATE 13: Compiler Strictness Check (no marker line)' });
  }
}
starts.sort((a, b) => a.banner - b.banner);

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
  sections.push({ key: keyOf(starts[i].text), start: s, end: e, text: starts[i].text });
}

let g8Start = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^# GATE 8: Secret Scanning/i.test(lines[i])) {
    g8Start = i;
    break;
  }
}
if (g8Start < 0) {
  console.error('FATAL: could not locate the Gate 8 (secret scanning) header');
  process.exit(1);
}
const g7 = sections.find((x) => x.key === '7');
if (!g7) {
  console.error('FATAL: could not locate the Gate 7 section');
  process.exit(1);
}
const nextBannerAfterG8 = sections.find((x) => x.start > g8Start);
const g8End = (nextBannerAfterG8 ? nextBannerAfterG8.start : lines.length) - 1;
sections.push({ key: '8', start: g8Start, end: g8End, text: lines[g8Start].trim() });
g7.end = g8Start - 1;
sections.sort((a, b) => a.start - b.start);

for (const s of sections) {
  if (!s.key) {
    console.error('FATAL: unmapped section at line ' + (s.start + 1) + ': ' + s.text);
    process.exit(1);
  }
}

console.log('=== sections detected ===');
for (const s of sections) {
  const span = s.start + 1 + '-' + (s.end + 1);
  console.log('gate ' + String(s.key).padEnd(4) + ' ' + span.padEnd(12) + ' (' + (s.end - s.start + 1) + ' lines) ' + s.text.slice(0, 58));
}

const regionStart = sections[0].start;
const preamble = lines.slice(0, regionStart);
const tail = lines.slice(sections[sections.length - 1].end + 1);

const bodies = new Map();
for (const s of sections) bodies.set(s.key, lines.slice(s.start, s.end + 1));

let cdBlock = null;
const b8 = bodies.get('8');
const cdIdx = b8.findIndex((l) => /^# Switch back to original directory/.test(l));
if (cdIdx < 0) {
  console.error('FATAL: could not find the PROJECT_SUBDIR restore block inside gate 8');
  process.exit(1);
}
cdBlock = b8.slice(cdIdx);
bodies.set('8', b8.slice(0, cdIdx));
while (bodies.get('8').length && bodies.get('8')[bodies.get('8').length - 1].trim() === '') {
  bodies.get('8').pop();
}

const ORDER = [
  '0', '11', '12', '12b', '12c',
  '13', '9',
  '1',
  '2',
  '3',
  '8', '10', '7',
  '5',
  '6', '4',
];
const SUBDIR_GATES = new Set(['0', '11', '12', '12b', '12c', '13', '9', '1', '2', '3', '8']);

const missing = ORDER.filter((k) => !bodies.has(k));
const extra = [...bodies.keys()].filter((k) => !ORDER.includes(k));
if (missing.length || extra.length) {
  console.error('FATAL: section mismatch. missing=' + JSON.stringify(missing) + ' extra=' + JSON.stringify(extra));
  process.exit(1);
}

const lastSubdirGate = [...ORDER].reverse().find((k) => SUBDIR_GATES.has(k));
console.log('last gate running inside PROJECT_SUBDIR: gate ' + lastSubdirGate);

const out = preamble.slice();
for (const key of ORDER) {
  out.push(...bodies.get(key));
  if (key === lastSubdirGate) {
    out.push('');
    out.push(...cdBlock);
  }
}
out.push(...tail);

const norm = (arr) => arr.map((s) => s.replace(/\s+$/, ''));
const counts = (arr) => {
  const m = new Map();
  for (const l of norm(arr)) m.set(l, (m.get(l) || 0) + 1);
  return m;
};
const cb = counts(lines);
const ca = counts(out);
let drift = 0;
for (const [l, n] of cb) {
  const m = ca.get(l) || 0;
  if (m !== n) {
    if (drift < 8) console.error('DRIFT: ' + JSON.stringify(l.slice(0, 70)) + ' before=' + n + ' after=' + m);
    drift++;
  }
}
for (const [l, n] of ca) {
  if (!cb.has(l)) {
    if (drift < 8) console.error('DRIFT(new): ' + JSON.stringify(l.slice(0, 70)) + ' after=' + n);
    drift++;
  }
}

console.log('');
console.log('=== result ===');
console.log('order: ' + ORDER.join(' -> '));
console.log('lines before=' + lines.length + ' after=' + out.length);
console.log('line-multiset drift=' + drift);
if (drift !== 0) {
  console.error('FATAL: reorder is lossy - refusing to write.');
  process.exit(1);
}

if (DRY) {
  const dest = path.join(__dirname, '..', 'githooks', 'pre-commit.reordered');
  fs.writeFileSync(dest, out.join(NL));
  console.log('DRY-RUN wrote ' + dest);
} else {
  fs.writeFileSync(HOOK, out.join(NL));
  console.log('WROTE ' + HOOK);
}
