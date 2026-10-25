#!/bin/bash
# Gate 5c: spec/test alignment (#585).
#
# Extracted from pre-commit so the contract is unit-testable without executing the
# hook, the same way lib/coverage-total.sh and lib/sprint-gate-report.sh are.
#
# The defect this file exists for: the whole check sat inside
#     if [ -f "$REQ_IDS_FILE" ] && command -v jq >/dev/null 2>&1; then
# so in the normal state — req-ids.json is produced by `xp-gate check-alignment`
# into .sprint-state/, which is gitignored and therefore absent in every fresh
# clone — the gate printed NOTHING. Not PASS, not FAIL, not SKIP. The quality
# report had no slot for it either. A repository's semantic alignment had never
# been checked once and every report was green.
#
# A gate that answers "not checked" by staying silent is the same defect class as
# #449, #499, #570, #575 and #594: silence read as success.

# Test-file conventions, per language. A gate that only knows JS/TS reports
# "0 annotated, 0 uncovered" on a PowerShell, Python, Go, Java or Kotlin
# repository — a vacuous green (#585).
#
# Pester:  *.Tests.ps1, *.test.ps1 (Pester's documented naming)
# pytest:  test_*.py, *_test.py
# Go:      *_test.go
# Java:    *Test.java, *Tests.java
# Kotlin:  *Test.kt, *Tests.kt
# JS/TS:   *.test.*, *.spec.*
GATE5C_TEST_FILE_PATTERN='(\.(test|spec)\.(ts|tsx|js|jsx|cjs|mjs)$)|(\.([Tt]ests?)\.ps1$)|(^(test_|.*/test_)[^/]*\.py$)|(^([^/]*_test)\.py$)|(_test\.go$)|([Tt]ests?\.java$)|([Tt]ests?\.kt$)'

# Is this changed-file list carrying anything that looks like a test file?
#
# Uses the same CHANGED_FILES variable the hook holds at that point in its flow.
gate_5c_test_files() {
  printf '%s\n' "${CHANGED_FILES:-}" \
    | grep -E "$GATE5C_TEST_FILE_PATTERN" 2>/dev/null || true
}

# One-line-per-id extraction. Reads req-ids.json when jq is available and falls
# back to grep when it is not: `jq` missing used to disable the gate silently, and
# a JSON array of strings is simple enough to read without it.
gate_5c_req_ids() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -r '.[]' "$file" 2>/dev/null && return 0
  fi
  # Fallback: quoted strings inside the array. Good enough for a flat id list, and
  # it fails toward EMPTY rather than toward a bogus id.
  grep -oE '"[^"]+"' "$file" 2>/dev/null | tr -d '"' || true
}

# The @test REQ-XXX annotations inside one file.
gate_5c_annotations() {
  local file="$1"
  grep -oE '@test[[:space:]]+REQ-[A-Za-z0-9-]+' "$file" 2>/dev/null \
    | sed 's/@test[[:space:]]*//' | sort -u || true
}

# Gate 5c entry point. Echoes the verdict; returns 1 to BLOCK.
#
# Reads CHANGED_FILES (set by pre-commit). Writes GATE_5C_STATUS for the report:
# PASS, SKIP or BLOCK — never empty, because "empty" is what was broken.
gate_5c_alignment() {
  local req_ids_file=".sprint-state/phase-outputs/req-ids.json"
  GATE_5C_STATUS=""

  if [ ! -f "$req_ids_file" ]; then
    # The normal state of a fresh clone: .sprint-state/ is a process artifact and
    # gitignored. Say so, out loud, with the command that would fix it.
    echo "  ⏭️  Gate 5c: spec/test alignment NOT CHECKED — $req_ids_file missing"
    echo "     Run 'xp-gate check-alignment' to generate it and enable this gate."
    GATE_5C_STATUS="SKIP"
    return 0
  fi

  # Staleness: a req-ids.json older than the spec it claims to describe would let a
  # deleted REQ keep its annotations looking valid.
  if [ -f "specification.yaml" ] && [ "$req_ids_file" -ot "specification.yaml" ]; then
    echo "  ⏭️  Gate 5c: spec/test alignment NOT CHECKED — req-ids.json is stale"
    echo "     specification.yaml is newer. Run 'xp-gate check-alignment' to regenerate."
    GATE_5C_STATUS="SKIP"
    return 0
  fi

  local test_files
  test_files=$(gate_5c_test_files)
  if [ -z "$test_files" ]; then
    # Reported rather than silent: without this line the operator cannot tell
    # "nothing to check" from "the gate is broken" (#585).
    echo "  ℹ️  Gate 5c: no test files among the staged changes — nothing to align."
    GATE_5C_STATUS="SKIP"
    return 0
  fi

  echo "  → Checking @test REQ-XXX annotations..."
  local annotation_errors=0 tf req_id found
  while read -r tf; do
    [ -n "$tf" ] || continue
    [ -f "$tf" ] || continue
    while read -r req_id; do
      [ -n "$req_id" ] || continue
      found=$(gate_5c_req_ids "$req_ids_file" | grep -qxF "$req_id" && echo yes || true)
      if [ -z "$found" ]; then
        echo "❌ Gate 5c: $tf — @test $req_id: REQ ID not found in specification.yaml"
        annotation_errors=$((annotation_errors + 1))
      fi
    done < <(gate_5c_annotations "$tf")
  done < <(printf '%s\n' "$test_files")

  if [ "$annotation_errors" -gt 0 ]; then
    echo ""
    echo "❌ $annotation_errors test annotation(s) reference non-existent REQ IDs — commit BLOCKED"
    echo "   Fix: verify the REQ IDs against specification.yaml, or run 'xp-gate check-alignment'"
    GATE_5C_STATUS="BLOCK"
    return 1
  fi

  # Reverse check: REQs with no annotated test among the staged changes. Visible,
  # non-blocking — a single commit rarely touches every requirement's test.
  local all_reqs annotated_all="" untested=0 spec_req
  all_reqs=$(gate_5c_req_ids "$req_ids_file")
  while read -r tf; do
    [ -n "$tf" ] || continue
    [ -f "$tf" ] || continue
    annotated_all="$annotated_all $(gate_5c_annotations "$tf")"
  done < <(printf '%s\n' "$test_files")

  while read -r spec_req; do
    [ -n "$spec_req" ] || continue
    if ! printf '%s\n' "$annotated_all" | tr ' ' '\n' | grep -qxF "$spec_req"; then
      untested=$((untested + 1))
    fi
  done < <(printf '%s\n' "$all_reqs")

  if [ "$untested" -gt 0 ]; then
    echo "  ⚠️  [FAIL] Gate 5c: $untested REQ(s) in specification.yaml have no annotated tests"
    echo "     This is non-blocking. Run 'xp-gate check-alignment' for the full report."
  fi

  echo "  ✅ @test annotation check complete."
  GATE_5C_STATUS="PASS"
  return 0
}
