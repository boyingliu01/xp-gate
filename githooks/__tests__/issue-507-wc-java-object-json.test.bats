#!/usr/bin/env bats
# @test REQ-507-DR intent: wc-java-lint 0.4.x emits an OBJECT-shaped report
#         ({summary, issues:[...]}) instead of the pinned bare array. The
#         counter must parse both shapes; rejecting the object form made every
#         real Java commit fail-closed with "JSON was unusable" even though the
#         JSON was perfectly well-formed (e2e sweep 2026-10-17).
# @covers AC-507-01-02

setup() {
  source "$BATS_TEST_DIRNAME/../adapters/java.sh"
}

@test "counter parses the object-wrapped issues shape (wc-java-lint 0.4.x)" {
  f="$(mktemp)"
  cat > "$f" <<'JSON'
{
  "version": "0.4.1",
  "summary": { "total_issues": 2 },
  "issues": [
    { "tool": "checkstyle", "rule": "WhitespaceAroundCheck", "severity": "error", "file": "src/main/java/A.java", "line": 1 },
    { "tool": "pmd", "rule": "UnusedImports", "severity": "warning", "file": "src/main/java/B.java", "line": 3 }
  ]
}
JSON
  run wc_java_json_violation_count "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
  rm -f "$f"
}

@test "object shape with empty issues counts zero" {
  f="$(mktemp)"
  printf '{ "summary": {}, "issues": [] }\n' > "$f"
  run wc_java_json_violation_count "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  rm -f "$f"
}

@test "object shape missing required per-issue fields -> BLOCK (fail closed)" {
  f="$(mktemp)"
  cat > "$f" <<'JSON'
{ "issues": [ { "tool": "x", "severity": "error", "file": "A.java" } ] }
JSON
  run wc_java_json_violation_count "$f"
  [ "$status" -ne 0 ]
  rm -f "$f"
}

@test "legacy bare-array contract still holds" {
  f="$(mktemp)"
  cat > "$f" <<'JSON'
[
  { "file": "A.java", "rule": "R1", "severity": "error" },
  { "file": "B.java", "rule": "R2", "severity": "warning" }
]
JSON
  run wc_java_json_violation_count "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
  rm -f "$f"
}

@test "files list extracts from both shapes" {
  f="$(mktemp)"
  cat > "$f" <<'JSON'
{ "issues": [ { "file": "A.java", "rule": "R", "severity": "error" },
              { "file": "B.java", "rule": "R", "severity": "error" } ] }
JSON
  run wc_java_json_files "$f"
  [ "$status" -eq 0 ]
  [[ "$output" == *"A.java"* ]]
  [[ "$output" == *"B.java"* ]]
  rm -f "$f"
}
