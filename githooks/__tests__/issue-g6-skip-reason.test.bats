#!/usr/bin/env bats
#
# @test REQ-G6-SKIP-REASON gate-6 SKIP records WHY, instead of only printing it
# @intent Checked .xp-gate/audit.jsonl on 2026-11-23: gate-6 had 150 SKIP records
#         and NOT ONE carried a detail field. The key was absent, not empty --
#         the record could not distinguish:
#
#           - the boy-scout script is not present in this project
#           - the script is present but node/tsx is not installed
#           - the gate never ran at all
#
#         The gate DID compute the distinction; it printed it:
#
#             "SKIPPED - Boy Scout Rule (not available in project)"
#             "SKIPPED - Boy Scout Rule (Node.js/tsx not available)"
#
#         and then set GATE_6_STATUS="SKIP" without setting GATE_6_DETAIL. Prose
#         reaches whoever is watching the commit; only the record reaches whoever
#         asks afterwards. This is the "reason computed, channel existed, nothing
#         connected them" family that keeps recurring in this hook layer.
#
#         Why it matters more for gate-6 than for most: a 5.5 s SKIP is not free.
#         A row that says only SKIP cannot tell an operator whether paying that
#         5.5 s buys nothing because the project has no boy-scout script (leave it
#         alone) or because a toolchain is missing (install it and the gate works).
#
# @covers AC-G6-SKIP-REASON-01 the script-absent branch records its reason
# @covers AC-G6-SKIP-REASON-02 the toolchain-absent branch records its reason
# @covers AC-G6-SKIP-REASON-03 the two reasons are DISTINCT
# @covers AC-G6-SKIP-REASON-04 the reason reaches record_gate_audit
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE6="$REPO/githooks/gate-entries/gate-6-entry.sh"
}

# AC-G6-SKIP-REASON-01
@test "AC-G6-SKIP-REASON-01: the not-in-project branch sets a detail" {
  grep -q 'GATE_6_DETAIL="boy_scout_skipped: script not present in this project"' "$GATE6" || {
    echo "the 'script not present' SKIP branch still records nothing"
    return 1
  }
}

# AC-G6-SKIP-REASON-02
@test "AC-G6-SKIP-REASON-02: the no-toolchain branch sets a detail" {
  grep -q 'GATE_6_DETAIL="boy_scout_skipped: node/tsx toolchain not available"' "$GATE6" || {
    echo "the 'node/tsx not available' SKIP branch still records nothing"
    return 1
  }
}

# AC-G6-SKIP-REASON-03: the whole point is telling the two apart. One shared
# reason string would satisfy the two cases above and defeat the purpose.
@test "AC-G6-SKIP-REASON-03: the two skip reasons are different strings" {
  local a b
  a=$(grep -o 'script not present in this project' "$GATE6" | head -1)
  b=$(grep -o 'node/tsx toolchain not available' "$GATE6" | head -1)
  [ -n "$a" ] && [ -n "$b" ] || {
    echo "one of the skip reasons is missing"
    return 1
  }
  [ "$a" != "$b" ] || {
    echo "both branches record the same reason -- they cannot be told apart"
    return 1
  }
}

# AC-G6-SKIP-REASON-04: computed-but-not-passed is this project's most repeated
# defect. The audit call must forward the variable.
@test "AC-G6-SKIP-REASON-04: GATE_6_DETAIL reaches record_gate_audit" {
  grep -q 'record_gate_audit "gate-6" "architecture-boy-scout" "\$GATE_6_STATUS" "\${BS_BLOCKED:-0}" "\$GATE_6_START" "\${GATE_6_DETAIL:-\${GATE_6_REASON:-}}"' "$GATE6" || {
    echo "the audit call does not forward GATE_6_DETAIL"
    return 1
  }
}

# ---------------------------------------------------------------------------
# Second round, same file, different arms.
#
# The two cases above fixed the BOY SCOUT arms. Re-measuring afterwards showed
# gate-6 still writing blank-detail SKIPs -- three consecutive commits to this
# repo, 5.5 s each, no detail. Cause: those commits touch .md/.sh/.cjs and never
# a .ts SOURCE file, so they take the "no source files changed" arm at line ~267,
# which is reached EARLIER than the boy-scout arms. Fixing the boy-scout arms
# could never have helped this repository's own commits.
#
# That is the lesson worth pinning: "I fixed the SKIP reason in gate-X" is not a
# property of the gate, it is a property of the ARM. Each arm needs its own.
# ---------------------------------------------------------------------------

# AC-G6-SKIP-REASON-05
@test "AC-G6-SKIP-REASON-05: the no-source-files arm records its reason" {
  grep -q 'GATE_6_DETAIL="architecture_skipped: no source files changed"' "$GATE6" || {
    echo "the 'no source files changed' arm still records nothing"
    echo "-> this is the arm a docs/config commit actually takes"
    return 1
  }
}

# AC-G6-SKIP-REASON-06
@test "AC-G6-SKIP-REASON-06: the no-powershell-tooling arm records its reason" {
  grep -q 'GATE_6_DETAIL="architecture_skipped: no PowerShell architecture tooling"' "$GATE6" || {
    echo "the 'no PowerShell tooling' arm still records nothing"
    return 1
  }
}

# AC-G6-SKIP-REASON-07: the general rule for the whole file. Every SKIP arm that
# can actually reach the journal must set GATE_6_DETAIL within the few lines that
# follow its echo. Arms inside the run_archlint subshell are excluded because a
# variable set in a subshell cannot travel back out.
@test "AC-G6-SKIP-REASON-07: no SKIP arm outside the subshell is left reasonless" {
  local start end
  start=$(grep -n 'run_archlint() (' "$GATE6" | head -1 | cut -d: -f1)
  end=$(awk -v s="$start" 'NR>s && /^[[:space:]]*\)[[:space:]]*$/ {print NR; exit}' "$GATE6")
  [ -n "$start" ] && [ -n "$end" ] || {
    echo "could not locate the run_archlint subshell bounds"; return 1; }

  local total bad=""
  total=$(wc -l < "$GATE6")
  local n
  for n in $(grep -n 'SKIPPED - Architecture' "$GATE6" | cut -d: -f1); do
    if [ "$n" -ge "$start" ] && [ "$n" -le "$end" ]; then continue; fi
    # Look at the arm's own body: the next 4 lines must set a detail.
    local last=$((n + 4)); [ "$last" -gt "$total" ] && last=$total
    if ! sed -n "${n},${last}p" "$GATE6" | grep -q 'GATE_6_DETAIL='; then
      bad="$bad $n"
    fi
  done

  [ -z "$bad" ] || {
    echo "SKIP arms with no GATE_6_DETAIL nearby:$bad"
    echo "(prose alone never reaches the journal)"
    return 1
  }
}
