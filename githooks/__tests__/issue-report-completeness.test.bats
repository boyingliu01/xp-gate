#!/usr/bin/env bats
#
# @test REQ-REPORT-COMPLETE a gate that can BLOCK must appear in the report
# @intent Gate 0 (version-consistency) runs first in XP_GATE_ORDER, writes audit
#         records, and has BLOCKED 58 commits. It was absent from every quality
#         report.
#
#         Measured 2026-11-23 against .xp-gate/audit.jsonl and the newest
#         .xp-gate/reports/pre-commit/*.json:
#
#             gate-0    audit records: 1705   (223 PASS, 58 BLOCK, 8 SKIP)
#             report    "gates" object: gate1_ .. gate13_  -- no gate0 at all
#             report    overall.gatesTotal: 13
#
#         gate-12b and gate-12c were missing on the same terms: both had audit
#         records (231 each), both are in GATE_REGISTRY_ROWS and in
#         XP_GATE_ORDER, and gate_key_status() even had `12b)` / `12c)` cases --
#         the cases existed and nothing in the report template ever called them.
#
#         That combination is the dangerous one: a gate that can stop a commit
#         while being invisible in the record of what ran. Someone reading the
#         report concludes the chain has 13 gates and that every one that matters
#         is represented, when three -- one of which blocks regularly -- are not.
#         It is the "not checked vs checked and clean" defect pointing the other
#         way: here the work WAS done and the record drops it.
#
#         The rule pinned here: the report's 'gates' object must carry a row for
#         every commit-phase gate in the registry. A gate may be SKIP or
#         NOT_REACHED; it may not be silently absent.
#
# @covers AC-REPORT-COMPLETE-01 gate 0 has a report row
# @covers AC-REPORT-COMPLETE-02 gates 12b and 12c have report rows
# @covers AC-REPORT-COMPLETE-03 every commit-phase registry gate has a report row
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  REPORT_WRITER="$REPO/githooks/gate-entries/gate-13-entry.sh"
  REGISTRY="$REPO/githooks/gate-registry.sh"
  ORDER_FILE="$REPO/githooks/gate-driver.sh"
}

# AC-REPORT-COMPLETE-01: gate 0 is present in the report template and resolvable.
@test "AC-REPORT-COMPLETE-01: gate 0 has a row in the report's gates object" {
  [ -f "$REPORT_WRITER" ]
  run grep -q '"gate0_version_consistency"' "$REPORT_WRITER"
  [ "$status" -eq 0 ] || { echo "gate 0 is still absent from the report template"; return 1; }

  # It must be wired to a real status source, not a hardcoded string -- a row that
  # always says one thing is the same failure wearing a row's clothes.
  run grep -q 'gate_key_status 0' "$REPORT_WRITER"
  [ "$status" -eq 0 ] || { echo "gate 0 has a row but its status is not resolved"; return 1; }

  # And the resolver must actually know key 0.
  run grep -qE '^\s+0\)$' "$REPORT_WRITER"
  [ "$status" -eq 0 ] || { echo "gate_key_status has no case for 0"; return 1; }
}

# AC-REPORT-COMPLETE-02: 12b and 12c are present AND their names are not swapped.
@test "AC-REPORT-COMPLETE-02: gates 12b and 12c have rows, with the registry's names" {
  run grep -q '"gate12b_mirror_parity"' "$REPORT_WRITER"
  [ "$status" -eq 0 ] || { echo "gate 12b missing from the report"; return 1; }
  run grep -q '"gate12c_probe_discipline"' "$REPORT_WRITER"
  [ "$status" -eq 0 ] || { echo "gate 12c missing from the report"; return 1; }

  # The registry is the authority for name-to-number. mirror-parity is 12b and
  # probe-discipline is 12c; writing them the other way round produces a report
  # that is present and wrong, which is worse than absent.
  run grep -q '"mirror-parity|12b|' "$REGISTRY"
  [ "$status" -eq 0 ] || { echo "registry no longer binds mirror-parity to 12b"; return 1; }
  run grep -q '"probe-discipline|12c|' "$REGISTRY"
  [ "$status" -eq 0 ] || { echo "registry no longer binds probe-discipline to 12c"; return 1; }
}

# A row may be written as a JSON literal ("gate1_static_analysis": {...}) or
# patched in afterwards by the node step (j.gates.gate13_compiler_strictness = ...).
# Both are legitimate; the rule is that the row EXISTS, not how it is spelled.
has_row() {
  grep -q "\"${1}_" "$REPORT_WRITER" || grep -q "gates\.${1}_" "$REPORT_WRITER"
}

# AC-REPORT-COMPLETE-03: the general rule, so the next gate added cannot repeat this.
@test "AC-REPORT-COMPLETE-03: every commit-phase registry gate has a report row" {
  # Commit-phase gate keys come from XP_GATE_ORDER, not from the registry's push
  # rows (M/MW/S are push-only by design and legitimately have no commit report row).
  local order_line
  order_line=$(grep -E '^XP_GATE_ORDER=' "$ORDER_FILE" | head -1)
  [ -n "$order_line" ] || { echo "XP_GATE_ORDER not found"; return 1; }

  local missing=""
  local key
  for key in $(printf '%s' "$order_line" | sed 's/.*="//; s/"$//'); do
    case "$key" in
      12b) has_row gate12b || missing="$missing 12b" ;;
      12c) has_row gate12c || missing="$missing 12c" ;;
      0)   has_row gate0 || missing="$missing 0" ;;
      *)
        has_row "gate${key}" || missing="$missing $key"
        ;;
    esac
  done

  [ -z "$missing" ] || {
    echo "commit-phase gates with no report row:$missing"
    echo "(a gate that can block a commit must not be invisible in the report)"
    return 1
  }
}
