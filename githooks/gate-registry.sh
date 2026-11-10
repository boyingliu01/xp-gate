#!/usr/bin/env bash
# ============================================================================
# GATE REGISTRY — the single source of truth for "which gate is which"
# ============================================================================
#
# WHY THIS FILE EXISTS
#
# Gate numbers alone are not self-describing, and the numbers are not stable
# facts about the repository — they are labels. Three sources disagreed about
# what "Gate 9" is:
#
#   root AGENTS.md      -> Semgrep SAST          (WRONG)
#   githooks/AGENTS.md  -> Build Integrity       (right)
#   pre-commit actual   -> Build Integrity       (right)
#
# In issue #717 a C# SAST fix was written into githooks/gate-9.sh, because the
# root document said Gate 9 was SAST. SAST is gate 10. gate-9.sh is not sourced
# by any hook and never executes, so the fix changed nothing while appearing to
# land. The defect was not "the number was hard to remember" — it was that
# nothing connected a gate's NAME to the FILE that runs it.
#
# This registry makes that connection explicit and testable. The drift test
# (githooks/__tests__/gate-registry.test.bats) asserts every `impl` below
# against the code, so a document that disagrees with reality, or a fix that
# lands in a file nobody sources, fails immediately.
#
# COLUMNS
#   name    stable semantic id — use this in prose, commits, and tests
#   number  display label only. Mirrors the report key (gateN_*) for backward
#           compatibility; do NOT treat it as the identity of the gate.
#   impl    where the gate actually runs. One of:
#             <script>.sh   a file sourced/executed by pre-commit
#             inline        implemented inside pre-commit itself
#   blocks  YES  the gate can reject a commit
#           NO   the gate reports but cannot reject
#
# USAGE
#   source githooks/gate-registry.sh
#   gate_name_for_file gate-10.sh      # -> sast
#   gate_impl sast                     # -> gate-10.sh
#   gate_number sast                   # -> 10
#   gate_can_block sast                # -> YES
#   gate_registry_dump                 # -> one line per gate
#
# ⚠️ Adding a gate: add a row here AND update the drift test's expectations.
#    A gate that exists only in pre-commit and not here is a gate nobody can
#    look up by name — which is how #717's wrong-file patch happened.
# ============================================================================

# name|number|impl|blocks|hook
#
# The `hook` field is LAST so a 4-field reader (any consumer installed from an
# older package) keeps working: appending a field does not move the ones it
# already reads.
#
# Numbers are POSITIONAL LABELS, never identities, and nothing here orders them
# numerically — pre-push numbers are strings (M, M2, ML, UI, MW, S). Do not add
# `-gt`/`-lt`/`$((` logic against this field;
# scripts/__tests__/gate-identity-cross-surface.test.cjs greps for it.
#
# `impl` names the file that DECIDES the gate. Where a gate is an inline block
# plus a helper that renders the verdict, name the helper: `impl` answers "which
# file do I edit to change this gate", and `inline` answered that wrongly for
# gate 6 (#715) — the layer verdict comes from gate-6-layers.sh.
GATE_REGISTRY_ROWS=(
  "version-consistency|0|inline|YES|pre-commit"
  "code-quality|1|inline|YES|pre-commit"
  "duplicate-code|2|inline|NO|pre-commit"
  "complexity|3|gate-3.sh|YES|pre-commit"
  "principles|4|gate-4.sh|YES|pre-commit"
  "tests-coverage|5|inline|YES|pre-commit"
  "architecture|6|gate-6-layers.sh|YES|pre-commit"
  "iac-security|7|gate-7.sh|YES|pre-commit"
  "secret-scanning|8|gate-8.sh|YES|pre-commit"
  "build-integrity|9|inline|YES|pre-commit"
  "sast|10|gate-10.sh|YES|pre-commit"
  "sprint-flow|11|sprint-gate.sh|YES|pre-commit"
  "file-hygiene|12|gate-12-file-hygiene.sh|NO|pre-commit"
  "compiler-strictness|13|gate-13-compiler-strictness.sh|YES|pre-commit"
  # pre-push. Registering these is identity bookkeeping only — pre-push keeps
  # deciding its own execution order and skip semantics. Before this the
  # registry knew nothing about half the gates this project runs (#769).
  "mutation|M|inline|YES|pre-push"
  "mock-density|M2|inline|NO|pre-push"
  "mock-layering|ML|inline|YES|pre-push"
  "ui-sprint|UI|inline|YES|pre-push"
  "code-walkthrough|MW|inline|YES|pre-push"
  "prepush-sprint|S|sprint-gate.sh|YES|pre-push"
)

# Report-key overrides for rows whose historical artifact key is not derivable
# as gate{number}_{name}. ONE entry today. Kept beside the rows so a second
# mapping cannot appear next to the comparison logic where it would be invisible.
# Compare on NAME, never on these keys: an override must not excuse a mismatch.
#
# Not read by any shell code here -- it exists for the Node reader in
# src/npm-package/lib/gate-identity.js, which parses this block directly. Some
# shells do not inherit unexported array variables across a `source`, so it is
# exported rather than left dangling (which also keeps shellcheck honest).
export GATE_REPORT_KEY_OVERRIDES=(
  "code-quality|gate1_static_analysis"
)

# Human-readable title for each name. Kept separate from the row above so the
# title can change without touching the lookup keys.
_gate_title() {
  case "$1" in
    version-consistency) echo "Version Consistency" ;;
    code-quality)        echo "Code Quality (Static + Lint)" ;;
    duplicate-code)      echo "Duplicate Code" ;;
    complexity)          echo "Cyclomatic Complexity" ;;
    principles)          echo "Clean Code + SOLID" ;;
    tests-coverage)      echo "Tests + Coverage" ;;
    architecture)        echo "Architecture + Boy Scout Rule" ;;
    iac-security)        echo "IaC Security Scanning" ;;
    secret-scanning)     echo "Secret Scanning" ;;
    build-integrity)     echo "Build Integrity" ;;
    sast)                echo "SAST Security Scan" ;;
    sprint-flow)         echo "Sprint Flow Enforcement" ;;
    file-hygiene)        echo "File Hygiene Check" ;;
    compiler-strictness) echo "Compiler Strictness" ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Lookups. Each returns non-zero when the name is unknown, so a typo fails
# loudly instead of silently matching nothing.
# ---------------------------------------------------------------------------

# gate_row <name> -> echoes the raw row, or returns 1.
gate_row() {
  local want="$1" row
  for row in "${GATE_REGISTRY_ROWS[@]}"; do
    case "$row" in
      "$want"\|*) printf '%s\n' "$row"; return 0 ;;
    esac
  done
  return 1
}

# _gate_field <name> <1-based field index>
_gate_field() {
  local row
  row=$(gate_row "$1") || return 1
  printf '%s\n' "$row" | cut -d'|' -f"$2"
}

gate_number()  { _gate_field "$1" 2; }
gate_impl()    { _gate_field "$1" 3; }
gate_blocks()  { _gate_field "$1" 4; }
gate_can_block() { [ "$(gate_blocks "$1")" = "YES" ] && echo YES || echo NO; }
gate_title()   { _gate_title "$1"; }

# gate_name_for_number <N> -> echoes the semantic name.
gate_name_for_number() {
  local want="$1" row
  for row in "${GATE_REGISTRY_ROWS[@]}"; do
    case "$row" in
      *\|"$want"\|*) printf '%s\n' "${row%%|*}"; return 0 ;;
    esac
  done
  return 1
}

# gate_name_for_file <file> -> semantic name of the gate implemented by <file>.
# Returns 1 for `inline` gates and unknown files. This is the lookup that would
# have caught #717: gate-9.sh resolves to build-integrity, not sast.
gate_name_for_file() {
  local want="$1" row impl name
  for row in "${GATE_REGISTRY_ROWS[@]}"; do
    name="${row%%|*}"
    impl=$(printf '%s\n' "$row" | cut -d'|' -f3)
    [ "$impl" = "$want" ] && { printf '%s\n' "$name"; return 0; }
  done
  return 1
}

# List every script the registry claims the hook runs.
gate_all_impls() {
  local row impl
  for row in "${GATE_REGISTRY_ROWS[@]}"; do
    impl=$(printf '%s\n' "$row" | cut -d'|' -f3)
    [ "$impl" != "inline" ] && printf '%s\n' "$impl"
  done
}

gate_registry_dump() {
  local row name num impl blocks
  for row in "${GATE_REGISTRY_ROWS[@]}"; do
    name="${row%%|*}"
    num=$(printf '%s\n' "$row" | cut -d'|' -f2)
    impl=$(printf '%s\n' "$row" | cut -d'|' -f3)
    blocks=$(printf '%s\n' "$row" | cut -d'|' -f4)
    printf '%-3s %-22s %-34s %-6s %s\n' "$num" "$name" "$(_gate_title "$name")" "$blocks" "$impl"
  done
}
