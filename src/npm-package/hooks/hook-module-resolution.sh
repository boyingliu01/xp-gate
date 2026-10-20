#!/bin/bash
# GENERATED FILE — DO NOT EDIT.
# Source of truth: src/npm-package/lib/hook-module-resolution.js
# Regenerate: node scripts/generate-hook-resolution.cjs
#
# The module resolution order (#505) lives in one place, as data. This file
# is its shell projection. Editing it by hand makes the hook disagree with
# doctor.js, which reads the JS module directly — the exact divergence
# #495/#500 were about.
#
# Every HOOK_* constant below is read by the sourcing parent, not by this
# file. A linter checking this file alone cannot see that consumer, so each
# declaration carries a scoped directive with the reason stated at the site
# (#548 -- the same false SC2034 used to block consumer repos that vendor
# these hook modules). The directives are generated, not hand-added.

# Probe file used to pick the gate tier.
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
HOOK_GATE_PROBE="gate-3.sh"

# ADAPTER_DIR cascade, highest priority first.
# Each entry is "tier_id|base_var|probe_file".
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
HOOK_ADAPTER_DIR_TIERS=(
  'global|GLOBAL_ADAPTER_DIR|adapter-common.sh'
  'project|PROJECT_GITHOOKS|adapter-common.sh'
  'script|SCRIPT_DIR|adapter-common.sh'
)

# Adapter resolution tiers, highest priority first.
# Each entry is "tier_id|base_var|template" with {name} as the basename.
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
HOOK_ADAPTER_TIERS=(
  'adapter_flat|ADAPTER_DIR|{name}.sh'
  'adapter_nested|ADAPTER_DIR|adapters/{name}.sh'
  'project_nested|PROJECT_GITHOOKS|adapters/{name}.sh'
  'script_nested|SCRIPT_DIR|adapters/{name}.sh'
)

# Gate resolution tiers, highest priority first.
# Semantics differ from adapter tiers: each entry names the DIRECTORY that
# would hold the gate probe, so a match yields the directory (GATE_DIR), not
# the probe file itself. Entry format: "tier_id|base_var|(empty suffix)".
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
HOOK_GATE_TIERS=(
  'gate_adapter_dir|ADAPTER_DIR|'
  'gate_project|PROJECT_GITHOOKS|'
  'gate_script_dir|SCRIPT_DIR|'
)
