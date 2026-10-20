#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# @test REQ-507-DR intent: when wc_java_json_violation_count() rejects a report,
#         the operator needs to know WHICH invariant failed. #545 was filed on a
#         wrong root-cause hypothesis largely because the only message available
#         was "not a usable violations JSON" -- indistinguishable between a
#         broken tool, a stripped banner line, and a desynchronized key count.
#         Diagnostics go to stderr so the stdout contract (a bare number) and
#         every existing caller's $(...) capture stay unchanged.
# @covers AC-507-01

setup() {
  source "$BATS_TEST_DIRNAME/../adapters/java.sh"
}

# --- stdout contract must not change ---------------------------------------
# These pin the reason for using stderr: a diagnostic on stdout would be
# captured as the violation count by `count=$(wc_java_json_violation_count ...)`
# and turn a clean run into a "lying tool" BLOCK.

@test "clean object report still emits exactly 0 on stdout" {
  f="$(mktemp)"
  cat > "$f" <<'JSON'
{
  "version": "0.4.1",
  "summary": {
    "total_issues": 0,
    "by_tool": {},
    "by_severity": {},
    "by_tool_severity": {}
  },
  "issues": []
}
JSON
  run wc_java_json_violation_count "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  rm -f "$f"
}

@test "clean object report writes nothing to stderr" {
  f="$(mktemp)"
  printf '{ "summary": {}, "issues": [] }\n' > "$f"
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  [ -z "$stderr" ]
  rm -f "$f"
}

# --- diagnostics must identify the failing invariant -----------------------

@test "diagnostic names the entry-point character when the report does not start with a bracket" {
  f="$(mktemp)"
  # A banner line on stdout is the failure mode the diagnostic must make
  # obvious: the JSON itself is fine, but the first character is not a bracket.
  printf 'wc-java-lint: checking 4 files\n{"summary":{},"issues":[]}\n' > "$f"
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"entry"* ]]
  rm -f "$f"
}

@test "diagnostic names the truncated-tail case separately" {
  f="$(mktemp)"
  # Opens as an object but does not close: truncated response.
  printf '{"summary":{},"issues":[\n' > "$f"
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"unterminated"* || "$stderr" == *"tail"* ]]
  rm -f "$f"
}

@test "diagnostic reports the desynchronized key counts" {
  f="$(mktemp)"
  # Object shape whose issue record is missing "severity": the global key
  # counts disagree, and the message must show the three measured numbers.
  cat > "$f" <<'JSON'
{
  "summary": {},
  "issues": [
    { "file": "A.java", "rule": "R1", "message": "no severity key" }
  ]
}
JSON
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"file="* ]]
  [[ "$stderr" == *"rule="* ]]
  [[ "$stderr" == *"severity="* ]]
  rm -f "$f"
}

@test "diagnostic is absent on success, including a non-zero count" {
  f="$(mktemp)"
  printf '[{"file":"A.java","rule":"R1","severity":"warning"}]\n' > "$f"
  run --separate-stderr wc_java_json_violation_count "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
  [ -z "$stderr" ]
  rm -f "$f"
}
