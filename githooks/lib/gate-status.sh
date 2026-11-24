#!/bin/bash
# Gate status severity: one rule for every gate that walks several languages.
#
# WHY THIS FILE EXISTS
# --------------------
# A gate that iterates `PROJECT_LANGS` collects one verdict per language. Two
# defects followed from letting each iteration write the gate's status directly:
#
#   1. LAST WRITER WINS. Languages are walked in config order
#      (typescript, shell, powershell, iac). A language that had nothing to
#      measure ran AFTER one that did, and overwrote its verdict.
#
#      Measured 2026-11-24 over 343 audit records:
#        gate-5  0 PASS / 21 SKIP -- all skips "powershell: no Pester tests",
#                in a repo carrying thousands of TypeScript tests.
#        gate-6  0 PASS / 14 SKIP -- all "not configured for iac", including
#                runs where archlint genuinely executed for TypeScript.
#        gate-1  0 PASS / 19 WARN -- all "PSSA module not installed", so a real
#                eslint pass could never be the gate's verdict.
#
#   2. DOWNGRADE. A branch could LOWER an existing verdict, turning "checked and
#      clean" into "not checked". That is the fail-open direction: it makes the
#      gate quieter without making it correct.
#
# THE RULE
# --------
# Carry the strongest verdict any language produced.
#
#   BLOCK > WARN > SKIP > PASS
#
# A gate reports the worst thing that happened to it, never the last. `PASS` is
# "checked and clean", so ANY other state outranks it: an incomplete check must
# never be presented as a clean one.
#
# `SKIP` outranks `PASS` but is outranked by `WARN`, because:
#   - SKIP says nothing was verified, and a neighbour that DID verify something
#     successfully must not mask that with a PASS;
#   - WARN says something was verified and came back imperfect, which is more
#     informative than "nothing happened" and must not be buried by a later
#     SKIP.
#
# CALL CONTRACT (round-3 review, expert B)
# ----------------------------------------
# Both helpers modify a variable in the CALLER'S shell through `printf -v`. A
# call made inside a pipeline (`... | while read x; do xp_gate_detail_append ...`)
# or a command substitution runs in a SUBSHELL and the update is silently
# discarded -- same shape as the defect this file exists to fix, and harder to
# see because the line still runs.
#
#   # WRONG: the update is lost
#   printf '%s\n' "$list" | while read -r _x; do xp_gate_detail_append D "$_x"; done
#
#   # RIGHT: keep it in the current shell
#   while read -r _x; do xp_gate_detail_append D "$_x"; done <<< "$list"
#
# Audited 2026-11-24: every call site in githooks/ is in the current shell, and
# `gate-status-call-site.test.bats` fails if a new one appears inside a pipeline.
# Sourced, not executed. Callers keep their own GATE_N_* variables; this file
# only provides the comparison so the rule lives in one place.
#
# ASCII only: this file is sourced by hooks that run under many locales.

# Numeric rank for a gate status. Unknown/empty ranks as the weakest value so a
# typo can never silently outrank a real verdict.
xp_gate_status_rank() {
  case "${1:-}" in
    BLOCK) printf '4' ;;
    WARN)  printf '3' ;;
    SKIP)  printf '2' ;;
    PASS)  printf '1' ;;
    *)     printf '0' ;;
  esac
}

# Escalate a gate status variable to at least `candidate`.
#
# Usage:
#   xp_gate_status_escalate GATE_5_STATUS "WARN"
#
# Sets the named variable through indirect assignment, so callers do not have to
# restructure their existing code. An empty current value is treated as unset.
xp_gate_status_escalate() {
  local _var="${1:?variable name required}"
  local _candidate="${2:?candidate status required}"
  local _current="${!_var:-}"
  local _cur_rank _new_rank
  _cur_rank=$(xp_gate_status_rank "$_current")
  _new_rank=$(xp_gate_status_rank "$_candidate")
  # An unrecognised candidate would rank 0 and could never win; refuse it
  # loudly rather than producing a gate whose status silently never moves.
  if [ "$_new_rank" = "0" ]; then
    printf 'xp_gate_status_escalate: unknown status %q (expected PASS|SKIP|WARN|BLOCK)\n' \
      "$_candidate" >&2
    return 2
  fi
  if [ "$_new_rank" -gt "$_cur_rank" ]; then
    printf -v "$_var" '%s' "$_candidate"
  fi
  return 0
}

# Append a detail fragment without clobbering an earlier one.
#
# Detail is a DESCRIPTION, not a verdict: several languages may each have
# something to say, and replacing the earlier text is what made a skip reason
# unexplainable.
#
# SEPARATOR INJECTION (round-1 review, expert B): the first version joined with
# `; ` and de-duplicated by splitting on that same string. A fragment that
# CONTAINS `; ` was therefore split into pieces, never matched any single
# segment, and got appended every time -- and a later reader could not tell the
# pieces from separate reasons. Measured: appending "x; y" produced a value that
# re-appended itself as two segments.
#
# The fix is to keep the pieces unmistakable: a fragment's internal separators
# are neutralised on the way in, so the recorded text never contains the join
# separator. `; ` stays the human-readable join because every existing consumer
# parses the field that way.
#
# Usage:
#   xp_gate_detail_append GATE_6_DETAIL "powershell: PSSA module not installed"
xp_gate_detail_append() {
  local _var="${1:?variable name required}"
  local _fragment="${2:-}"
  # Whitespace-only is "no reason given", not a reason of spaces.
  case "$_fragment" in
    *[![:space:]]*) ;;
    *) return 0 ;;
  esac
  # Flatten internal separators so one fragment is always one segment.
  _fragment="${_fragment//; /, }"

  local _current="${!_var:-}"
  if [ -z "$_current" ]; then
    printf -v "$_var" '%s' "$_fragment"
    return 0
  fi
  # Compare whole segments. They cannot contain "; " after the flattening above,
  # so the split is unambiguous.
  local _segment _found=0
  local _rest="$_current"
  while [ -n "$_rest" ]; do
    case "$_rest" in
      *"; "*) _segment="${_rest%%; *}"; _rest="${_rest#*; }" ;;
      *)      _segment="$_rest"; _rest="" ;;
    esac
    if [ "$_segment" = "$_fragment" ]; then
      _found=1
      break
    fi
  done
  if [ "$_found" -eq 1 ]; then
    return 0
  fi
  printf -v "$_var" '%s; %s' "$_current" "$_fragment"
  return 0
}

# A NOTE ON WHY THIS FILE EXISTS (kept with the code, not in a plan document)
# Three gates in this repo had never produced a PASS: gate-1, gate-5 and gate-6
# all reported the verdict of their LAST language instead of their strongest.
# Measured 2026-11-24 across 343 audit records. The rule is one line of policy
# (BLOCK > WARN > SKIP > PASS, with PASS never outranking anything) and it must
# not be re-derived per gate.
