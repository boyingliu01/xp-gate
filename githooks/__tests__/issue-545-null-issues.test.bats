#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# @test REQ-507-DR intent: wc-java-lint serializes an empty issue list as JSON
#         null, not [], whenever the scan hid at least one info-level finding.
#         The Go producer's nil slice marshals to null; a scan with NO findings
#         at all uses a different path and does emit []. So the bug only appears
#         for files whose only problems are info-level (spotbugs hides those by
#         default), which is why testing with a clean file never hits it (#545).
#
#         `null` is a legitimate, well-formed "zero visible violations" report --
#         exactly as clean as []. Treating it as a broken response fail-closed
#         every commit touching such a file, whatever the operator did.
# @covers AC-507-01

setup() {
  source "$BATS_TEST_DIRNAME/../adapters/java.sh"
}

# Verbatim from a real run (wc-java-lint 0.4.1, whale-sql-audit
# GovernanceController.java): 9 spotbugs info findings, all hidden.
ISSUES_NULL='{
  "version": "0.4.1",
  "summary": {
    "total_issues": 0,
    "by_tool": {},
    "by_severity": {},
    "by_tool_severity": {},
    "info_hidden": 9
  },
  "issues": null
}'

@test "issues: null with info_hidden counts zero instead of BLOCKing" {
  f="$(mktemp)"
  printf '%s\n' "$ISSUES_NULL" > "$f"
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  rm -f "$f"
}

@test "issues: null without info_hidden also counts zero" {
  f="$(mktemp)"
  # Defensive: a producer that emits null for an empty list without the
  # info_hidden hint is still reporting zero violations, not a broken response.
  cat > "$f" <<'JSON'
{
  "version": "0.4.1",
  "summary": { "total_issues": 0, "by_tool": {}, "by_severity": {}, "by_tool_severity": {} },
  "issues": null
}
JSON
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  rm -f "$f"
}

@test "issues: null with a nonzero total_issues still BLOCKs" {
  f="$(mktemp)"
  # If the tool claims visible violations but omits them, the count cannot be
  # trusted. This is the lying-tool shape and must not be waved through by the
  # null tolerance.
  cat > "$f" <<'JSON'
{
  "version": "0.4.1",
  "summary": { "total_issues": 3, "by_tool": { "pmd": 3 }, "by_severity": { "warning": 3 } },
  "issues": null
}
JSON
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"null"* ]]
  rm -f "$f"
}

@test "an empty issues array still counts zero (unchanged)" {
  f="$(mktemp)"
  printf '{ "version": "0.4.1", "summary": { "total_issues": 0 }, "issues": [] }\n' > "$f"
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  rm -f "$f"
}

@test "a missing issues member is still a broken response" {
  f="$(mktemp)"
  # "null" is tolerated; absent is not. A truncated or wrong-shape response
  # must keep failing closed.
  printf '{ "version": "0.4.1", "summary": { "total_issues": 0 } }\n' > "$f"
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -ne 0 ]
  rm -f "$f"
}
