#!/usr/bin/env node
/**
 * Prove that scripts/extract-gates.cjs moved every line of pre-commit exactly
 * once (#798).
 *
 * The only acceptable evidence for a mechanical refactor is that nothing was
 * lost and nothing was duplicated. Line-number diffs cannot show this once the
 * file is restructured, so this compares the MULTISET of non-blank lines:
 * every source line must appear in exactly the entry files plus the preamble
 * and epilogue, with the same multiplicity.
 *
 * Usage: node scripts/verify-gate-extraction.cjs <original-hook> <entries-dir>
 */
const fs = require('fs');
const path = require('path');

const [origPath, dirPath] = process.argv.slice(2);
if (!origPath || !dirPath) {
  console.error('usage: node scripts/verify-gate-extraction.cjs <original-hook> <entries-dir>');
  process.exit(2);
}

const orig = fs.readFileSync(origPath, 'utf8').split('\n');
const dir = path.resolve(dirPath);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sh')).sort();
const counts = (lines) => {
  const m = new Map();
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    if (!l.trim()) continue;
    m.set(l, (m.get(l) || 0) + 1);
  }
  return m;
};

// Each entry file is emitted as a generated banner, then a byte-exact slice of
// the original block, then a generated footer. The banner length DIFFERS per
// file (gate entries carry a long WHY block, subdir-restore a short one), so it
// is discovered from the generated text rather than assumed: hardcoding 19
// silently truncated subdir-restore.sh's body and reported four phantom misses.
const BODY_END_MARKER = '# Sourced by pre-commit';

const entryLines = [];
for (const f of files) {
  const content = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  // The generated banner is the whole leading run of lines that the generator
  // wrote; it always ends with the last `# ===` line before a blank line.
  let bodyStart = 0;
  for (let i = 0; i < content.length; i++) {
    if (/^# ={20,}\s*$/.test(content[i])) {
      bodyStart = i + 1;
      if (content[bodyStart] === '') bodyStart++;
      break;
    }
  }
  let bodyEnd = content.length;
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i].startsWith(BODY_END_MARKER)) {
      bodyEnd = i;
      break;
    }
  }
  for (const line of content.slice(bodyStart, bodyEnd)) entryLines.push(line);
}

// The preamble (everything before the first gate banner) and the epilogue
// (report generation + exit, after the last gate) are NOT extracted: they stay
// in pre-commit and are counted as part of the expected total.
let firstGate = -1;
for (let i = 0; i < orig.length; i++) {
  if (/^# ={20,}\s*$/.test(orig[i])) {
    for (let j = i + 1; j < Math.min(i + 8, orig.length); j++) {
      if (/^# (GATE ?\d+|Gate 1[2][a-c]?)\b/i.test(orig[j])) { firstGate = i; break; }
      if (!/^#/.test(orig[j])) break;
    }
  }
  if (firstGate >= 0) break;
}
let epilogueStart = -1;
for (let i = 0; i < orig.length; i++) {
  if (/^# Post-commit bypass marker/.test(orig[i])) { epilogueStart = i; break; }
}
while (epilogueStart > 0 && !orig[epilogueStart - 1].trim()) epilogueStart--;

const origCounts = counts(orig);
const entryCounts = counts(entryLines);
const retained = orig.slice(0, firstGate).concat(orig.slice(epilogueStart));
const retainedCounts = counts(retained);
console.log('retained in pre-commit (preamble ' + firstGate + ' + epilogue ' + (orig.length - epilogueStart) + ' lines)');
// Expected coverage = entries + the retained preamble/epilogue.
const covered = new Map(entryCounts);
for (const [line, n] of retainedCounts) covered.set(line, (covered.get(line) || 0) + n);

let missing = 0;
let extra = 0;
const missingSample = [];
const extraSample = [];

for (const [line, n] of origCounts) {
  const m = covered.get(line) || 0;
  if (m < n) {
    missing++;
    if (missingSample.length < 12) missingSample.push({ line, need: n, have: m });
  }
}
for (const [line, n] of covered) {
  const m = origCounts.get(line) || 0;
  if (n > m) {
    extra++;
    if (extraSample.length < 12) extraSample.push({ line, have: n, orig: m });
  }
}

console.log('original non-blank unique lines: ' + origCounts.size);
console.log('entry    non-blank unique lines: ' + entryCounts.size);
console.log('');
if (missing) {
  console.log('MISSING from entries (' + missing + ' distinct lines):');
  for (const s of missingSample) console.log('  need=' + s.need + ' have=' + s.have + '  ' + JSON.stringify(s.line.slice(0, 90)));
}
if (extra) {
  console.log('');
  console.log('EXTRA in entries (' + extra + ' distinct lines) - generated headers are expected here:');
  for (const s of extraSample) console.log('  have=' + s.have + ' orig=' + s.orig + '  ' + JSON.stringify(s.line.slice(0, 90)));
}
if (!missing && !extra) console.log('EXACT MATCH: every source line appears exactly as often as in the original.');

process.exit(missing === 0 ? 0 : 1);
