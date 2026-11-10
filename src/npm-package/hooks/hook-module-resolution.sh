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
  'project|PROJECT_GITHOOKS|adapter-common.sh'
  'global|GLOBAL_ADAPTER_DIR|adapter-common.sh'
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

# ── Contract (schema 2) ──────────────────────────────
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
HOOK_RESOLUTION_SCHEMA=2

# Resolve the directory for one tier of HOOK_ADAPTER_DIR_TIERS.
#
#   _hook_tier_dir <tier_id> <base_var>
#     tier_id   project | global | script   (see HOOK_ADAPTER_DIR_TIERS)
#     base_var  name of the variable holding that tier's root, e.g.
#               PROJECT_GITHOOKS. Passed by NAME so the caller's scope decides
#               the value — this function never guesses.
#
# Prints the resolved directory on stdout, or nothing when the tier is not
# declared. Callers must treat empty output as "this tier is unavailable",
# never as "use the current directory".
#
# shellcheck disable=SC2154,SC2086,SC2295
_hook_tier_dir() {
  local _tier_id="$1"
  local _base_var="$2"
  local _entry _entry_tier _entry_base _base_value

  [ -n "$_tier_id" ] && [ -n "$_base_var" ] || return 0

  for _entry in "${HOOK_ADAPTER_DIR_TIERS[@]}"; do
    _entry_tier="${_entry%%|*}"
    [ "$_entry_tier" = "$_tier_id" ] || continue
    # "tier_id|base_var|probe_file" -> take the base_var field
    _entry_base="${_entry#*|}"
    _entry_base="${_entry_base%%|*}"
    [ "$_entry_base" = "$_base_var" ] || continue
    # Shape check before eval. Table membership already makes injection
    # impossible TODAY, but that argument lives in a comment a future caller
    # will not read. This makes it a property of the code: $_base_var must be
    # a plain shell identifier, so nothing can reach eval that could execute.
    case "$_base_var" in
      *[!A-Za-z0-9_]*|"") return 0 ;;
    esac
    # Indirect expansion: the caller owns the variable, we only read it.
    eval "_base_value=\${$_base_var:-}"
    [ -n "$_base_value" ] || return 0
    printf '%s\n' "$_base_value"
    return 0
  done
  return 0
}

# Load-time contract check. A projection whose syntax is valid and whose
# function exists, but whose behaviour does not match what consumers call,
# would otherwise blow up mid-push at whichever call site runs first —
# indistinguishable, in a passing suite, from a file that is fine.
# Failing here turns it into a deterministic SKIP at source time.
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
_HOOK_RESOLVE_BROKEN=""
_hook_tier_dir_selfcheck() {
  local _probe_out
  if ! declare -F _hook_tier_dir >/dev/null 2>&1; then
    _HOOK_RESOLVE_BROKEN="missing _hook_tier_dir"
    return 1
  fi
  # Smoke call against a known input; the resolver takes the base by name,
  # so overriding PROJECT_GITHOOKS for one command proves the indirection.
  _probe_out="$(PROJECT_GITHOOKS="/__selfcheck__" _hook_tier_dir project PROJECT_GITHOOKS 2>/dev/null)"
  if [ "$_probe_out" != "/__selfcheck__" ]; then
    _HOOK_RESOLVE_BROKEN="selfcheck failed: tier_dir(project,PROJECT_GITHOOKS)=[${_probe_out}]"
    return 1
  fi
  return 0
}
_hook_tier_dir_selfcheck || :
