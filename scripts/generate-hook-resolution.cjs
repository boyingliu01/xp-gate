#!/usr/bin/env node
/**
 * Generate githooks/hook-module-resolution.sh from
 * src/npm-package/lib/hook-module-resolution.js (#505).
 *
 * The JS module is the single source of truth for the module resolution order.
 * The hook cannot require() a JS file at gate time (no node guarantee on the
 * commit path), so the order is emitted as shell data instead of being typed a
 * second time. `--check` exits non-zero when the generated file is stale, which
 * is what the parity test asserts.
 *
 * Usage:
 *   node scripts/generate-hook-resolution.cjs          # write the file
 *   node scripts/generate-hook-resolution.cjs --check  # verify it is current
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src/npm-package/lib/hook-module-resolution.js');
const TARGET = path.join(ROOT, 'githooks/hook-module-resolution.sh');

function render() {
  // Fresh require each run so --check and write always agree.
  delete require.cache[require.resolve(SOURCE)];
  const { RESOLUTION_ORDER, GATE_RESOLUTION_ORDER, ADAPTER_DIR_ORDER, GATE_PROBE } = require(SOURCE);

  const lines = [];
  lines.push('#!/bin/bash');
  lines.push('# GENERATED FILE — DO NOT EDIT.');
  lines.push('# Source of truth: src/npm-package/lib/hook-module-resolution.js');
  lines.push('# Regenerate: node scripts/generate-hook-resolution.cjs');
  lines.push('#');
  lines.push('# The module resolution order (#505) lives in one place, as data. This file');
  lines.push('# is its shell projection. Editing it by hand makes the hook disagree with');
  lines.push('# doctor.js, which reads the JS module directly — the exact divergence');
  lines.push('# #495/#500 were about.');
  lines.push('#');
  lines.push('# Every HOOK_* constant below is read by the sourcing parent, not by this');
  lines.push('# file. A linter checking this file alone cannot see that consumer, so each');
  lines.push('# declaration carries a scoped directive with the reason stated at the site');
  lines.push('# (#548 -- the same false SC2034 used to block consumer repos that vendor');
  lines.push('# these hook modules). The directives are generated, not hand-added.');
  lines.push('');
  lines.push('# Probe file used to pick the gate tier.');
  lines.push('# Consumed by the sourcing parent, not here.');
  lines.push('# shellcheck disable=SC2034');
  lines.push(`HOOK_GATE_PROBE="${GATE_PROBE}"`);
  lines.push('');
  lines.push('# ADAPTER_DIR cascade, highest priority first.');
  lines.push('# Each entry is "tier_id|base_var|probe_file".');
  lines.push('# Consumed by the sourcing parent, not here.');
  lines.push('# shellcheck disable=SC2034');
  lines.push('HOOK_ADAPTER_DIR_TIERS=(');
  for (const t of ADAPTER_DIR_ORDER) {
    lines.push(`  '${t.tier_id}|${t.base}|${t.probe}'`);
  }
  lines.push(')');
  lines.push('');
  lines.push('# Adapter resolution tiers, highest priority first.');
  lines.push('# Each entry is "tier_id|base_var|template" with {name} as the basename.');
  lines.push('# Consumed by the sourcing parent, not here.');
  lines.push('# shellcheck disable=SC2034');
  lines.push('HOOK_ADAPTER_TIERS=(');
  for (const t of RESOLUTION_ORDER) {
    lines.push(`  '${t.tier_id}|${t.base}|${t.template}'`);
  }
  lines.push(')');
  lines.push('');
  lines.push('# Gate resolution tiers, highest priority first.');
  lines.push('# Semantics differ from adapter tiers: each entry names the DIRECTORY that');
  lines.push('# would hold the gate probe, so a match yields the directory (GATE_DIR), not');
  lines.push('# the probe file itself. Entry format: "tier_id|base_var|(empty suffix)".');
  lines.push('# Consumed by the sourcing parent, not here.');
  lines.push('# shellcheck disable=SC2034');
  lines.push('HOOK_GATE_TIERS=(');
  for (const t of GATE_RESOLUTION_ORDER) {
    lines.push(`  '${t.tier_id}|${t.base}|'`);
  }
  lines.push(')');
  lines.push('');
  return lines.join('\n');
}

const expected = render();

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (actual !== expected) {
    console.error('hook-module-resolution.sh is STALE.');
    console.error('Run: node scripts/generate-hook-resolution.cjs');
    process.exit(1);
  }
  console.log('hook-module-resolution.sh is current.');
  process.exit(0);
}

fs.writeFileSync(TARGET, expected);
console.log(`wrote ${path.relative(ROOT, TARGET)}`);
