#!/usr/bin/env bash
# ============================================================================
# Gate 11 Sprint Flow reporting helpers (issue #476)
#
# Extracted from pre-commit so the resolution chain and the decision translation
# are unit-testable without executing the hook, and reachable from an installed
# hook through the lib/ directory install.sh copies beside it.
# ============================================================================

# Echo the first <dir>/sprint-gate.sh that exists among the given directories.
#
# The chain used to stop after three tiers that all point at *gate script*
# directories. The flat global layout ($HOME/.config/xp-gate/adapters) holds
# gate-3/4/7/8/9/10.sh but not sprint-gate.sh, which update-hooks installs under
# $HOME/.config/xp-gate/hooks instead -- so a machine with the canonical install
# reported "sprint-gate.sh not found" about a file that was there (#476).
#
# Returns non-zero when nothing matched; the caller must then name every place it
# looked.
resolve_sprint_gate_script() {
  local _dir
  for _dir in "$@"; do
    [ -n "$_dir" ] || continue
    if [ -f "$_dir/sprint-gate.sh" ]; then
      printf '%s\n' "$_dir/sprint-gate.sh"
      return 0
    fi
  done
  return 1
}

# Echo the decision verb from a sprint-gate JSON line: allow, deny, skip, or
# unknown when the text carries no recognisable decision at all.
#
# jq is not a dependency of the hooks, so this reads the field the way it is
# actually written by sprint-gate.sh: one flat object per line.
sprint_gate_decision() {
  local _decision
  _decision=$(printf '%s' "${1:-}" | sed -n 's/.*"decision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | tail -1)
  case "$_decision" in
    allow|deny|skip) printf '%s\n' "$_decision" ;;
    *) printf 'unknown\n' ;;
  esac
}

# Echo the human-readable detail of a decision (reason, message, or warning --
# in that order of preference), or nothing when the gate gave none.
sprint_gate_detail() {
  local _out="${1:-}" _field _detail
  for _field in reason message warning; do
    _detail=$(printf '%s' "$_out" | sed -n "s/.*\"$_field\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | tail -1)
    if [ -n "$_detail" ]; then
      printf '%s\n' "$_detail"
      return 0
    fi
  done
  return 0
}

# Echo WHY sprint-gate.sh allowed the commit (#584).
#
# `allow` on its own is ambiguous: it certifies a validated sprint, but it also
# covers "the sprint has not reached this gate's phase" and "no JSON parser, so
# nothing could be read". pre-commit mapped every one of those to Gate 11 PASS,
# so a gate that examined nothing raised the score and left the verdict alone.
#
# Only `checks-passed` licenses a PASS. Anything else -- including an `allow`
# from an older sprint-gate.sh that carries no reason at all -- means "not
# evaluated", and the caller must report SKIP. Defaulting the other way would
# reinstate the defect for every consumer who has not re-installed.
sprint_gate_allow_reason() {
  local _out="${1:-}" _reason
  _reason=$(printf '%s' "$_out" | sed -n 's/.*"allow_reason"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | tail -1)
  if [ -n "$_reason" ]; then
    printf '%s\n' "$_reason"
    return 0
  fi
  # No reason given. The decision may still be an `allow`; the caller decides.
  printf 'unspecified\n'
  return 0
}
