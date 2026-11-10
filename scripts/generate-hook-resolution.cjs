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
  const {
    RESOLUTION_ORDER, GATE_RESOLUTION_ORDER, ADAPTER_DIR_ORDER, GATE_PROBE,
    HOOK_RESOLUTION_SCHEMA,
  } = require(SOURCE);

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
  lines.push(...renderSchemaAndResolver(HOOK_RESOLUTION_SCHEMA));
  return lines.join('\n');
}

/**
 * Emit the schema marker, the single traversal implementation, and its
 * load-time contract check (REQ-RESOLVE-003, schema 2).
 *
 * WHY THE FUNCTION IS GENERATED AND NOT HAND-WRITTEN IN THE HOOK
 * --------------------------------------------------------------
 * Data alone does not prevent a second implementation. pre-push used to walk
 * HOOK_ADAPTER_DIR_TIERS itself, in a hand-written global-first cascade that
 * contradicted the project-first order the data declares. Emitting the
 * traversal here leaves consumers nothing to re-implement: they call
 * `_hook_tier_dir <tier_id> <base_var>` and get the directory or an empty string.
 */
function renderSchemaAndResolver(schemaVersion) {
  return [
    '# ── Contract (schema ' + schemaVersion + ') ──────────────────────────────',
    '# Consumed by the sourcing parent, not here.',
    '# shellcheck disable=SC2034',
    `HOOK_RESOLUTION_SCHEMA=${schemaVersion}`,
    '',
    '# Resolve the directory for one tier of HOOK_ADAPTER_DIR_TIERS.',
    '#',
    '#   _hook_tier_dir <tier_id> <base_var>',
    '#     tier_id   project | global | script   (see HOOK_ADAPTER_DIR_TIERS)',
    "#     base_var  name of the variable holding that tier's root, e.g.",
    "#               PROJECT_GITHOOKS. Passed by NAME so the caller's scope decides",
    '#               the value — this function never guesses.',
    '#',
    '# Prints the resolved directory on stdout, or nothing when the tier is not',
    '# declared. Callers must treat empty output as "this tier is unavailable",',
    '# never as "use the current directory".',
    '#',
    '# shellcheck disable=SC2154,SC2086,SC2295',
    '_hook_tier_dir() {',
    '  local _tier_id="$1"',
    '  local _base_var="$2"',
    '  local _entry _entry_tier _entry_base _base_value',
    '',
    '  [ -n "$_tier_id" ] && [ -n "$_base_var" ] || return 0',
    '',
    '  for _entry in "${HOOK_ADAPTER_DIR_TIERS[@]}"; do',
    '    _entry_tier="${_entry%%|*}"',
    '    [ "$_entry_tier" = "$_tier_id" ] || continue',
    '    # "tier_id|base_var|probe_file" -> take the base_var field',
    '    _entry_base="${_entry#*|}"',
    '    _entry_base="${_entry_base%%|*}"',
    '    [ "$_entry_base" = "$_base_var" ] || continue',
    '    # Shape check before eval. Table membership already makes injection',
    '    # impossible TODAY, but that argument lives in a comment a future caller',
    '    # will not read. This makes it a property of the code: $_base_var must be',
    '    # a plain shell identifier, so nothing can reach eval that could execute.',
    '    case "$_base_var" in',
    '      *[!A-Za-z0-9_]*|"") return 0 ;;',
    '    esac',
    '    # Indirect expansion: the caller owns the variable, we only read it.',
    '    eval "_base_value=\\${$_base_var:-}"',
    '    [ -n "$_base_value" ] || return 0',
    "    printf '%s\\n' \"$_base_value\"",
    '    return 0',
    '  done',
    '  return 0',
    '}',
    '',
    '# Load-time contract check. A projection whose syntax is valid and whose',
    '# function exists, but whose behaviour does not match what consumers call,',
    '# would otherwise blow up mid-push at whichever call site runs first —',
    '# indistinguishable, in a passing suite, from a file that is fine.',
    '# Failing here turns it into a deterministic SKIP at source time.',
    '# Consumed by the sourcing parent, not here.',
    '# shellcheck disable=SC2034',
    '_HOOK_RESOLVE_BROKEN=""',
    '_hook_tier_dir_selfcheck() {',
    '  local _probe_out',
    '  if ! declare -F _hook_tier_dir >/dev/null 2>&1; then',
    '    _HOOK_RESOLVE_BROKEN="missing _hook_tier_dir"',
    '    return 1',
    '  fi',
    '  # Smoke call against a known input; the resolver takes the base by name,',
    '  # so overriding PROJECT_GITHOOKS for one command proves the indirection.',
    '  _probe_out="$(PROJECT_GITHOOKS="/__selfcheck__" _hook_tier_dir project PROJECT_GITHOOKS 2>/dev/null)"',
    '  if [ "$_probe_out" != "/__selfcheck__" ]; then',
    '    _HOOK_RESOLVE_BROKEN="selfcheck failed: tier_dir(project,PROJECT_GITHOOKS)=[${_probe_out}]"',
    '    return 1',
    '  fi',
    '  return 0',
    '}',
    '_hook_tier_dir_selfcheck || :',
    '',
  ];
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
