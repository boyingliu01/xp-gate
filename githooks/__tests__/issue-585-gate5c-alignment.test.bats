#!/usr/bin/env bats
# @test REQ-605
# @intent Gate 5c answered "not checked" by printing nothing at all.
#
#         The whole check sat inside
#             if [ -f "$REQ_IDS_FILE" ] && command -v jq >/dev/null 2>&1; then
#         so when req-ids.json was absent — which is the NORMAL state, because it is
#         produced by `xp-gate check-alignment` into .sprint-state/, a directory that
#         is gitignored and therefore never exists in a fresh clone — the gate emitted
#         zero bytes. It was neither PASS, nor FAIL, nor SKIP. generate_quality_report()
#         had no slot for it either. A PowerShell project's semantic alignment had
#         never been checked once, and every report was green.
#
#         That is the same class as #449, #499, #570, #575 and #594: silence read as
#         success. The distinction the operator needs is
#             "the annotations are consistent with the spec"   (PASS)
#         versus
#             "nobody ever ran the check"                      (SKIP, visibly)
#         and one `echo` is the whole difference.
#
#         The second defect is that a gate which DOES run can still only see JS/TS
#         tests. File discovery was
#             grep -E '\.(test|spec)\.(ts|tsx|js|jsx|cjs|mjs)$'
#         so Pester's `*.Tests.ps1`, pytest's `test_*.py`, Go's `*_test.go`, Java's
#         `*Test.java` and Kotlin's `*Tests.kt` matched nothing. On those repos the
#         gate reported "0 annotated, 0 uncovered" — a vacuous green.
# @covers AC-605-01, AC-605-02, AC-605-03, AC-605-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE5C_LIB="$REPO_ROOT/githooks/lib/gate-5c-alignment.sh"

  WORK="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q -b feature/gate5c .
  git config user.email t@t.t
  git config user.name t
  git config core.hooksPath /dev/null
}

# Drive the extracted Gate 5c contract directly. CHANGED_FILES is the same variable
# pre-commit uses at that point in its flow.
run_gate5c() {
  local changed="$1"
  (
    cd "$WORK" || exit 70
    CHANGED_FILES="$changed"
    # shellcheck source=/dev/null
    source "$GATE5C_LIB"
    gate_5c_alignment
  )
}

# A req-ids.json listing the given ids, at the path the gate reads.
# Must be a real JSON array: `xp-gate check-alignment` writes one, and a plain
# newline list would only exercise the jq-less fallback by accident.
write_req_ids() {
  mkdir -p .sprint-state/phase-outputs
  {
    printf '['
    local first=1 id
    for id in "$@"; do
      [ "$first" -eq 1 ] || printf ','
      printf '"%s"' "$id"
      first=0
    done
    printf ']\n'
  } > .sprint-state/phase-outputs/req-ids.json
}

# ---------------------------------------------------------------------------
# AC-605-01: absence of the artifact is VISIBLE
# ---------------------------------------------------------------------------

@test "AC-605-01: a missing req-ids.json is reported, not silently skipped" {
  # No .sprint-state at all: the fresh-clone state, and the state of this very
  # repository. Before the fix this produced no output whatsoever.
  echo "export const a = 1;" > a.ts
  echo "test('a', () => {});" > a.test.ts

  run run_gate5c "a.test.ts"
  [ "$status" -eq 0 ]

  [ -n "$output" ] || {
    echo "the gate printed nothing at all — 'not checked' is invisible"
    return 1
  }
  [[ "$output" == *"NOT CHECKED"* ]] || {
    echo "the gate must say the alignment was not checked, got:"
    printf '%s\n' "$output"
    return 1
  }
  # And it must say what to run about it, or the message is only a complaint.
  [[ "$output" == *"check-alignment"* ]] || {
    echo "the message must name the command that would enable the gate:"
    printf '%s\n' "$output"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-605-02: each language's test-file convention is discovered
# ---------------------------------------------------------------------------

@test "AC-605-02: Pester *.Tests.ps1 files are discovered" {
  write_req_ids REQ-001
  cat > Thing.Tests.ps1 <<'EOF'
# @test REQ-001
Describe 'thing' { It 'works' { 1 | Should -Be 1 } }
EOF

  run run_gate5c "Thing.Tests.ps1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Checking @test"* ]] || {
    echo "a Pester test file must reach the annotation check, got:"
    printf '%s\n' "$output"
    return 1
  }
}

@test "AC-605-02: pytest test_*.py and *_test.py files are discovered" {
  write_req_ids REQ-001
  printf '# @test REQ-001\ndef test_a():\n    assert True\n' > test_thing.py
  printf '# @test REQ-001\ndef test_b():\n    assert True\n' > thing_test.py

  run run_gate5c "test_thing.py"
  [[ "$output" == *"Checking @test"* ]] || {
    echo "test_*.py must reach the annotation check, got:"
    printf '%s\n' "$output"
    return 1
  }

  run run_gate5c "thing_test.py"
  [[ "$output" == *"Checking @test"* ]] || {
    echo "*_test.py must reach the annotation check, got:"
    printf '%s\n' "$output"
    return 1
  }
}

@test "AC-605-02: Go, Java and Kotlin test files are discovered" {
  write_req_ids REQ-001
  printf '// @test REQ-001\npackage foo\n' > thing_test.go
  printf '// @test REQ-001\nclass ThingTest {}\n' > ThingTest.java
  printf '// @test REQ-001\nclass ThingTests\n' > ThingTests.kt

  for f in thing_test.go ThingTest.java ThingTests.kt; do
    run run_gate5c "$f"
    [[ "$output" == *"Checking @test"* ]] || {
      echo "$f must reach the annotation check, got:"
      printf '%s\n' "$output"
      return 1
    }
  done
}

@test "AC-605-02: a non-test file is still not treated as a test file" {
  # The control: widening the discovery must not turn every source file into a
  # "test" — that would make the reverse check meaningless.
  write_req_ids REQ-001
  printf '// @test REQ-001\nexport const a = 1;\n' > a.ts

  run run_gate5c "a.ts"
  [[ "$output" != *"Checking @test"* ]] || {
    echo "a plain source file must not be treated as a test file:"
    printf '%s\n' "$output"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-605-03: a dangling annotation still blocks (the check really runs)
# ---------------------------------------------------------------------------

@test "AC-605-03: an annotation naming an unknown REQ still blocks the commit" {
  write_req_ids REQ-001
  cat > Thing.Tests.ps1 <<'EOF'
# @test REQ-999
Describe 'thing' { It 'works' { 1 | Should -Be 1 } }
EOF

  local rc=0
  run_gate5c "Thing.Tests.ps1" >/dev/null 2>&1 || rc=$?

  [ "$rc" -eq 1 ] || {
    echo "REQ-999 is not in req-ids.json and must BLOCK (exit 1), got exit $rc"
    return 1
  }
}

@test "AC-605-03: a well-formed annotation passes" {
  write_req_ids REQ-001
  cat > Thing.Tests.ps1 <<'EOF'
# @test REQ-001
Describe 'thing' { It 'works' { 1 | Should -Be 1 } }
EOF

  local rc=0
  run_gate5c "Thing.Tests.ps1" >/dev/null 2>&1 || rc=$?

  [ "$rc" -eq 0 ] || {
    echo "a valid annotation must not block, got exit $rc"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-605-04: no changed test files is a reported state, not silence
# ---------------------------------------------------------------------------

@test "AC-605-04: a commit with no test files says so instead of printing nothing" {
  write_req_ids REQ-001
  echo "export const a = 1;" > a.ts
  git add a.ts

  run run_gate5c "a.ts"
  [ "$status" -eq 0 ]
  [ -n "$output" ] || {
    echo "no visible state again; the operator cannot tell this from a broken gate"
    return 1
  }
}
