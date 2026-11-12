#!/usr/bin/env node
/**
 * Replace pre-commit's inline gate blocks with a call to the ordered driver
 * (#798).
 *
 * The hook keeps its preamble (everything before Gate 0) and its epilogue (the
 * report generation and final `exit 0`); the ~5200 lines of gate bodies between
 * them are already extracted into githooks/gate-entries/ by
 * scripts/extract-gates.cjs. This script splices the driver call into the gap.
 *
 * REFUSES TO WRITE unless the extraction has been proven lossless, because the
 * failure mode being guarded against is a hook that still parses but no longer
 * runs its gates.
 *
 * Usage: node scripts/splice-driver.cjs [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'githooks', 'pre-commit');
const NL = '\n';
const DRY = process.argv.includes('--dry-run');

const lines = fs.readFileSync(HOOK, 'utf8').split(NL);

// ── boundaries ──────────────────────────────────────────────────────────────
// Preamble ends where Gate 0's banner begins.
let gate0 = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^# ={20,}\s*$/.test(lines[i]) && /^# Gate 0:/i.test(lines[i + 1] || '')) {
    gate0 = i;
    break;
  }
}
if (gate0 < 0) {
  console.error('FATAL: could not find the Gate 0 banner');
  process.exit(1);
}

// Epilogue begins at the post-commit bypass marker.
let epilogue = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^# Post-commit bypass marker/.test(lines[i])) {
    epilogue = i;
    break;
  }
}
if (epilogue < 0) {
  console.error('FATAL: could not find the epilogue');
  process.exit(1);
}
while (epilogue > 0 && lines[epilogue - 1].trim() === '') epilogue--;

const preamble = lines.slice(0, gate0);
const epilogueLines = lines.slice(epilogue);

// ── gate sanity: the driver's order must cover every extracted entry ────────
const driver = fs.readFileSync(path.join(ROOT, 'githooks', 'gate-driver.sh'), 'utf8');
const orderMatch = driver.match(/^XP_GATE_ORDER="([^"]+)"/m);
if (!orderMatch) {
  console.error('FATAL: could not read XP_GATE_ORDER from gate-driver.sh');
  process.exit(1);
}
const order = orderMatch[1].split(/\s+/).filter(Boolean);
const entryDir = path.join(ROOT, 'githooks', 'gate-entries');
const entryFiles = fs.readdirSync(entryDir).filter((f) => /^gate-.+-entry\.sh$/.test(f));
const entryKeys = entryFiles.map((f) => f.replace(/^gate-/, '').replace(/-entry\.sh$/, ''));

const orderSet = new Set(order);
const entrySet = new Set(entryKeys);
const onlyInEntries = entryKeys.filter((k) => !orderSet.has(k));
const onlyInOrder = order.filter((k) => !entrySet.has(k));
if (onlyInEntries.length || onlyInOrder.length) {
  console.error('FATAL: driver order and extracted entries disagree.');
  if (onlyInEntries.length) console.error('  extracted but unordered: ' + onlyInEntries.join(' '));
  if (onlyInOrder.length) console.error('  ordered but not extracted: ' + onlyInOrder.join(' '));
  process.exit(1);
}

console.log('preamble:  lines 1-' + gate0);
console.log('replacing: lines ' + (gate0 + 1) + '-' + epilogue + ' (' + (epilogue - gate0) + ' lines of inline gates)');
console.log('epilogue:  lines ' + (epilogue + 1) + '-' + lines.length);
console.log('driver order: ' + order.length + ' gates -> ' + order.join(' '));

// ── the replacement block ───────────────────────────────────────────────────
const replacement = [
  '# ============================================================================',
  '# GATE CHAIN (#798)',
  '#',
  '# The gate bodies used to live here, ~5200 lines in physical order. That made',
  '# the order impossible to change safely: a reorder attempt moved the hook',
  '# epilogue along with the last gate, so every gate after it silently stopped',
  '# running while `bash -n` and a line count both passed. Gate 5a stopped',
  '# blocking commits and only a behavioural fingerprint caught it.',
  '#',
  '# Each body now lives in githooks/gate-entries/gate-<KEY>-entry.sh and the',
  '# order is a list of keys in githooks/gate-driver.sh. To change the order,',
  '# edit XP_GATE_ORDER there - nothing in this file needs to move.',
  '# ============================================================================',
  '# This file always lives beside the driver and gate-entries/, so resolve the',
  '# chain directory from this file rather than from $GATE_DIR: the preamble',
  '# re-points GATE_DIR at ADAPTER_DIR (module resolution tiers), which is the',
  '# directory adapters are looked up in, not the one the gate bodies live in.',
  'XP_GATE_CHAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
  '',
  '# shellcheck source=/dev/null',
  '. "$XP_GATE_CHAIN_DIR/gate-driver.sh" || {',
  '  echo "❌ FATAL: could not load gate-driver.sh from $XP_GATE_CHAIN_DIR" >&2',
  '  echo "   Reinstall the hooks: xp-gate doctor --sync-hooks" >&2',
  '  exit 1',
  '}',
  '',
  '_xp_gate_load_entries "$XP_GATE_CHAIN_DIR/gate-entries" || exit 1',
  '_xp_gate_run_chain',
  '',
];

const out = preamble.concat(replacement, epilogueLines).join(NL);

// ── prove the result still parses before writing ────────────────────────────
const tmp = path.join(os.tmpdir(), 'xp-gate-spliced-pre-commit');
fs.writeFileSync(tmp, out);
try {
  execFileSync('bash', ['-n', tmp], { stdio: 'pipe' });
} catch (e) {
  console.error('FATAL: the spliced hook does not parse. Nothing written.');
  console.error((e.stderr || '').toString());
  process.exit(1);
}
fs.unlinkSync(tmp);

console.log('spliced hook: ' + out.split(NL).length + ' lines (was ' + lines.length + ')');

if (DRY) {
  console.log('DRY-RUN: nothing written');
  process.exit(0);
}
fs.writeFileSync(HOOK, out);
console.log('WROTE ' + HOOK);
