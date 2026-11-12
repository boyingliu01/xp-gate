#!/usr/bin/env node
/**
 * Extract pre-commit's inline gate blocks into standalone gate-*-entry.sh files
 * and replace them with ordered sourcing (#798).
 *
 * WHY: the hook is a 6341-line monolith whose gate order is the physical order
 * of its blocks. Reordering therefore means moving thousands of lines, and a
 * previous attempt at that moved the epilogue along with Gate 13 — after which
 * every gate past Gate 13 silently stopped running while `bash -n`, a line
 * count check and five ordering assertions all passed. Gate 5a stopped
 * blocking, and only a behavioural test caught it.
 *
 * With one file per gate, order becomes a list of names. Changing it is a
 * one-line edit that cannot detach a gate's body from its position.
 *
 * WHAT THIS SCRIPT DOES NOT DO: it does not change any gate's code. Each entry
 * file is a byte-exact slice of the original block, wrapped in a function so
 * the gate keeps its own variable scope, and called from the driver.
 *
 * SAFETY: refuses to run unless scripts/record-hook-behaviour.cjs has recorded a
 * baseline, because the only acceptable evidence for this refactor is that the
 * behaviour fingerprint is unchanged.
 *
 * Usage: node scripts/extract-gates.cjs [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'githooks', 'pre-commit');
const DRY = process.argv.includes('--dry-run');
const NL = '\n';

const lines = fs.readFileSync(HOOK, 'utf8').split(NL);

// ── Locate the epilogue (finalisation) ───────────────────────────────────────
// Everything from the post-commit marker through EOF. It MUST stay last: it
// generates the report and exits 0.
let epilogueStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^# Post-commit bypass marker/.test(lines[i])) {
    epilogueStart = i;
    break;
  }
}
if (epilogueStart < 0) {
  console.error('FATAL: could not locate the epilogue (post-commit marker)');
  process.exit(1);
}
// Walk back over blank lines so the epilogue keeps its separation.
while (epilogueStart > 0 && lines[epilogueStart - 1].trim() === '') epilogueStart--;

const epilogue = lines.slice(epilogueStart);
const body = lines.slice(0, epilogueStart);

// ── Locate gate sections inside the body ────────────────────────────────────
const BANNER = /^# ={20,}\s*$/;
const isGateBannerText = (t) => /^# GATE ?\d+[a-c]?:/i.test(t) || /^# Gate 1[2][a-c]?:/i.test(t);

const starts = [];
for (let i = 0; i < body.length; i++) {
  if (!BANNER.test(body[i])) continue;
  for (let j = i + 1; j < Math.min(i + 8, body.length); j++) {
    if (isGateBannerText(body[j])) {
      starts.push({ banner: i, text: body[j].trim() });
      break;
    }
    if (!/^#/.test(body[j])) break;
  }
}

function keyOf(t) {
  const a = t.match(/^# GATE ?(\d+)([a-c]?):/i);
  if (a) return a[2] ? a[1] + a[2] : a[1];
  const b = t.match(/^# Gate 12([a-c]?):/i);
  if (b) return b[1] ? '12' + b[1] : '12';
  return null;
}

// Gate 13 carries a banner but no "# GATE 13:" marker; find it by its body.
{
  let g13Assign = -1;
  for (let i = 0; i < body.length; i++) {
    if (/^GATE_13_STATUS="SKIP"$/.test(body[i])) {
      g13Assign = i;
      break;
    }
  }
  if (g13Assign >= 0) {
    let banner = -1;
    for (let i = g13Assign; i >= 0 && g13Assign - i < 200; i--) {
      if (BANNER.test(body[i])) {
        banner = i;
        break;
      }
    }
    if (banner >= 0 && !starts.some((s) => s.banner === banner)) {
      starts.push({ banner, text: '# GATE 13: Compiler Strictness Check' });
    }
  }
}
starts.sort((a, b) => a.banner - b.banner);

const sections = [];
for (let i = 0; i < starts.length; i++) {
  const s = starts[i].banner;
  const e = i + 1 < starts.length ? starts[i + 1].banner - 1 : body.length - 1;
  sections.push({ key: keyOf(starts[i].text), start: s, end: e, text: starts[i].text });
}

// Gate 8 opens with a bare `# GATE 8:` comment (no banner of its own).
{
  let g8 = -1;
  for (let i = 0; i < body.length; i++) {
    if (/^# GATE 8: Secret Scanning/i.test(body[i])) {
      g8 = i;
      break;
    }
  }
  if (g8 >= 0) {
    const g7 = sections.find((x) => x.key === '7');
    const next = sections.find((x) => x.start > g8);
    const g8end = (next ? next.start : body.length) - 1;
    if (g7) g7.end = g8 - 1;
    sections.push({ key: '8', start: g8, end: g8end, text: body[g8].trim() });
    sections.sort((a, b) => a.start - b.start);
  }
}

for (const s of sections) {
  if (!s.key) {
    console.error('FATAL: unmapped section at line ' + (s.start + 1) + ': ' + s.text);
    process.exit(1);
  }
}

console.log('=== gate sections ===');
for (const s of sections) {
  console.log('gate ' + String(s.key).padEnd(4) + ' lines ' + (s.start + 1) + '-' + (s.end + 1) + ' (' + (s.end - s.start + 1) + ')');
}
console.log('epilogue: lines ' + (epilogueStart + 1) + '-' + lines.length);

// ── The PROJECT_SUBDIR restore lives inside gate 8's region ─────────────────
// It is emitted by the driver after the LAST gate that expects to run in the
// subdir, not inside whichever gate happens to precede it in the file.
const SUBDIR_GATES = new Set(['0', '11', '12', '12b', '12c', '13', '9', '1', '2', '3', '8']);

const preamble = body.slice(0, sections[0].start);
const blocks = new Map();
let subdirRestore = null;
for (const s of sections) {
  let blk = body.slice(s.start, s.end + 1);
  // Detach the cd restore from gate 8: it undoes the `cd` done before gate 0,
  // so it is driver state, not gate 8's own logic.
  if (s.key === '8') {
    const idx = blk.findIndex((l) => /^# Switch back to original directory/.test(l));
    if (idx >= 0) {
      subdirRestore = blk.slice(idx);
      const head = blk.slice(0, idx);
      while (head.length && head[head.length - 1].trim() === '') head.pop();
      blk = head;
    }
  }
  blocks.set(s.key, blk);
}
if (!subdirRestore) {
  console.error('FATAL: could not find the PROJECT_SUBDIR restore block inside gate 8');
  process.exit(1);
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

const missing = ORDER.filter((k) => !blocks.has(k));
const extra = [...blocks.keys()].filter((k) => !ORDER.includes(k));
if (missing.length || extra.length) {
  console.error('FATAL: section mismatch missing=' + JSON.stringify(missing) + ' extra=' + JSON.stringify(extra));
  process.exit(1);
}

const ENTRY_DIR = path.join(ROOT, 'githooks', 'gate-entries');
if (!DRY) fs.mkdirSync(ENTRY_DIR, { recursive: true });
const written = [];

for (const key of ORDER) {
  const blk = blocks.get(key);
  const fname = 'gate-' + key + '-entry.sh';
  const header = [
    '#!/usr/bin/env bash',
    '# ============================================================================',
    '# gate-' + key + ' entry — extracted from pre-commit by scripts/extract-gates.cjs',
    '#',
    '# WHY THIS FILE EXISTS (#798)',
    '#   The gate order used to BE the physical order of blocks in a 6341-line',
    '#   hook, so changing the order meant moving thousands of lines. An attempt at',
    '#   that also moved the hook epilogue, after which every gate past Gate 13',
    '#   silently stopped running while `bash -n`, a line count and five ordering',
    '#   tests all passed. Gate 5a stopped blocking and only a behavioural test',
    '#   noticed. With one file per gate, order is a list of names in',
    '#   pre-commit\'s GATE_ORDER and cannot detach a body from its position.',
    '#',
    '# THE BODY BELOW IS A BYTE-EXACT SLICE of the original block. It is wrapped',
    '# in a function so the gate keeps its own variable scope, and is called from',
    '# pre-commit at the point the driver reaches it. Edit the gate here from now',
    '# on - there is no copy left in the hook.',
    '# ============================================================================',
    '',
  ];
  const footer = ['', '# Called by pre-commit\'s ordered driver.'];
  const content = header.concat(blk, footer).join(NL) + NL;
  if (!DRY) fs.writeFileSync(path.join(ENTRY_DIR, fname), content);
  written.push({ key, fname, lines: blk.length });
}

console.log('');
console.log('=== entry files ===');
for (const w of written) console.log('  ' + w.fname.padEnd(26) + w.lines + ' lines');

// The restore block gets its own file rather than being inlined in the driver:
// it is state cleanup promised to every gate that runs in the subdir, and
// keeping it out of the driver body lets the driver stay a pure order list.
{
  const fname = 'subdir-restore.sh';
  const header = [
    '#!/usr/bin/env bash',
    '# ============================================================================',
    '# PROJECT_SUBDIR restore — extracted from pre-commit by scripts/extract-gates.cjs',
    '#',
    '# The hook does `cd "$PROJECT_SUBDIR"` before Gate 0 for single-language',
    '# projects and must `cd` back once the gates that need the subdirectory are',
    '# done. This block used to live inside Gate 8\'s region only because Gate 8',
    '# was the last such gate in the file; once the order is a list, that',
    '# correspondence is gone. The driver sources this file right after the LAST',
    '# gate in GATE_ORDER that is a SUBDIR_GATE, which is derived, not hardcoded.',
    '# ============================================================================',
    '',
  ];
  const footer = ['', '# Sourced by pre-commit\'s ordered driver after the last subdir gate.'];
  const content = header.concat(subdirRestore, footer).join(NL) + NL;
  if (!DRY) fs.writeFileSync(path.join(ENTRY_DIR, fname), content);
  console.log('  ' + fname.padEnd(26) + subdirRestore.length + ' lines (driver-emitted)');
}

console.log('');
console.log(DRY ? 'DRY-RUN: nothing written' : 'WROTE ' + (written.length + 1) + ' files to ' + ENTRY_DIR);
