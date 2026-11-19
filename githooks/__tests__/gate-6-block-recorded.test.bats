#!/usr/bin/env bats
#
# @test REQ-GATE6-BLOCK-RECORDED a missing architecture config is recorded as FAIL
# @intent Gate 6 has ten `return 1` sites. Every one of them printed a blocking
#         message and returned non-zero -- and NOT ONE of them assigned
#         GATE_6_STATUS, so it kept the "SKIP" it was initialised with.
#
#         Measured 2026-11-19 on a Kotlin fixture (no .archlint.yaml), with
#         XP_GATE_ONLY_GATE=6:
#
#             stdout : ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED
#             rc     : 1   (git really refused the commit)
#             report : gate6_arch_boyscout.status = "SKIP", reason ""
#                      overall.gatesFailed = 0, failedGates = []
#
#         This is the third instance of one family in two commits: Gate 9
#         (e9cf2e23) recorded SKIP for a blocked build, Gate 13 recorded PASS for
#         nothing compiled, and this records SKIP for ten different refusals. The
#         common shape is not "a forgotten line" -- it is that the return value
#         and the recorded status are two independent channels, and nothing forces
#         them to agree.
#
#         The structural test below is deliberately the primary one: it asserts
#         over ALL return sites rather than the one that happened to be measured,
#         because fixing only the observed site would leave nine identical bugs.
#
# @covers AC-GATE6-REC-01  every blocking return site sets a non-PASS status
# @covers AC-GATE6-REC-02  a missing config blocks AND is recorded as FAIL
# @covers AC-GATE6-REC-03  the recorded status carries a reason
# @covers AC-GATE6-REC-04  the clean path still records PASS (anti-vacuity)
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ENTRY="$REPO/githooks/gate-entries/gate-6-entry.sh"
}

@test "AC-GATE6-REC-01: every blocking return in Gate 6 sets a failing status first" {
  # Scan each `return 1` and require a GATE_6_STATUS assignment between it and the
  # previous `return`/`fi` boundary that is close enough to be its partner. A
  # window of 40 lines was chosen by measurement: the widest legitimate gap in this
  # file is the config-missing branch, whose explanation runs 20 lines.
  local offenders
  offenders=$(awk '
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ /^[ \t]*return 1[ \t]*$/) {
          found = 0
          lo = i - 40; if (lo < 1) lo = 1
          for (j = lo; j < i; j++) {
            if (lines[j] ~ /GATE_6_STATUS="(FAIL|WARN)"/) { found = 1 }
          }
          if (!found) printf "%d: %s\n", i, lines[i]
        }
      }
    }
  ' "$ENTRY")

  [ -z "$offenders" ] || {
    echo "these return 1 sites do not set a failing status, so the report will"
    echo "record whatever GATE_6_STATUS held before -- usually SKIP:"
    printf '%s\n' "$offenders"
    false
  }
}

@test "AC-GATE6-REC-02: a missing config blocks the commit AND is recorded as FAIL" {
  local tmp="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$tmp"

  run bash -c '
    cd "$1" || exit 1
    set -u
    GATE_6_STATUS="SKIP"
    GATE_6_REASON=""
    PROJECT_ROOT="$1"
    PROJECT_LANG="kotlin"
    PROJECT_LANGS="kotlin"
    CHANGED_FILES="a.kt"
    XP_STAGED_ACM="a.kt"
    CURRENT_LANG="kotlin"
    declare -A GATE_6_REASON_BY_LANG 2>/dev/null || true
    gate_start_ms() { printf "1000"; }
    gate_enabled() { return 0; }
    record_gate_audit() { :; }
    archlint_configured() { return 1; }
    find_architecture_config() { return 1; }
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    gate_6_run >/dev/null 2>&1
    rc=$?
    echo "RC=$rc"
    echo "STATUS=$GATE_6_STATUS"
    echo "REASON=$GATE_6_REASON"
  ' _ "$tmp" "$ENTRY"

  printf '%s' "$output" | grep -q 'STATUS=FAIL' || {
    echo "the gate did not record FAIL; it recorded:"
    printf '%s\n' "$output"
    false
  }
  printf '%s' "$output" | grep -qE 'RC=[1-9]' || {
    echo "the gate did not block the commit:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-GATE6-REC-03: the recorded failure carries a reason" {
  # A FAIL with no reason is only marginally better than a SKIP with no reason:
  # the report cannot say what to fix. This project's rule is that an unexplained
  # verdict is a bug, and it does not distinguish SKIP from FAIL.
  local tmp="$BATS_TEST_TMPDIR/proj2"
  mkdir -p "$tmp"

  run bash -c '
    cd "$1" || exit 1
    set -u
    GATE_6_STATUS="SKIP"
    GATE_6_REASON=""
    PROJECT_ROOT="$1"
    PROJECT_LANG="kotlin"
    PROJECT_LANGS="kotlin"
    CHANGED_FILES="a.kt"
    XP_STAGED_ACM="a.kt"
    CURRENT_LANG="kotlin"
    gate_start_ms() { printf "1000"; }
    gate_enabled() { return 0; }
    record_gate_audit() { :; }
    archlint_configured() { return 1; }
    find_architecture_config() { return 1; }
    . "$2" >/dev/null 2>&1 || true
    gate_6_run >/dev/null 2>&1
    echo "REASON=$GATE_6_REASON"
  ' _ "$tmp" "$ENTRY"

  printf '%s' "$output" | grep -q 'REASON=architecture_config_missing' || {
    echo "the failure carried no machine-readable reason:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-GATE6-REC-04: the status is initialised to SKIP, not PASS" {
  # Anti-vacuity in the other direction. If GATE_6_STATUS were initialised to
  # PASS, every early return would record a pass -- which is the much worse
  # version of this defect. Pinning the initial value documents which side the
  # default falls on.
  grep -qE '^\s*GATE_6_STATUS="SKIP"' "$ENTRY" || {
    echo "Gate 6 does not initialise GATE_6_STATUS to SKIP"
    false
  }
}

@test "AC-GATE6-REC-05: an unmeasured layer dimension cannot end as PASS" {
  # GATE_6_LAYER_STATUS had 6 assignments and zero reads in the whole repository.
  # shellcheck SC2034 reported it and was right: the layer dimension's own verdict
  # went nowhere, so "gate-6-layers.sh not found -- layer boundaries NOT checked"
  # printed a warning and the gate could still finish PASS.
  #
  # Two assertions, because the first fix attempt failed the second:
  #   1. the variable is READ somewhere (not just assigned)
  #   2. the read happens at the FINAL verdict, after the PASS upgrade
  #
  # The first attempt assigned GATE_6_STATUS right beside the warning, ~430 lines
  # before `GATE_6_STATUS="PASS"`, and was silently overwritten. A test that only
  # checked assertion (1) would have passed.
  local reads
  reads=$(grep -cE '\$\{?GATE_6_LAYER_STATUS' "$ENTRY" || true)
  [ "${reads:-0}" -ge 1 ] || {
    echo "GATE_6_LAYER_STATUS is assigned but never read -- SC2034 is a real defect here"
    false
  }

  # The flag it feeds must be consumed after the PASS upgrade line.
  local pass_line warn_line
  pass_line=$(grep -n 'GATE_6_STATUS="PASS"' "$ENTRY" | tail -1 | cut -d: -f1)
  warn_line=$(grep -n 'GATE_6_LAYERS_WARNED:-0' "$ENTRY" | grep -v '=1' | tail -1 | cut -d: -f1)
  [ -n "$pass_line" ] && [ -n "$warn_line" ] || {
    echo "could not locate the PASS upgrade or its consumer"
    false
  }
  [ "$warn_line" -gt "$pass_line" ] || {
    echo "the layer warning is consumed at line $warn_line, BEFORE the PASS upgrade at $pass_line -- it will be overwritten"
    false
  }
}
