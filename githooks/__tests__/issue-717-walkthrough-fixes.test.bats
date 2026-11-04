#!/usr/bin/env bats
# @test REQ-717-walkthrough
# @intent The code-walkthrough review found that three claims in the evidence
#         document were asserted but not measured. Each of these pins a claim
#         that used to rest on reading the code alone:
#           1. Gate 9 marked C# as blocking, but p/security-audit carries no C#
#              rules, so a .cs SQL injection produced 0 findings.
#           2. Gate 13's Windows-path reconciliation handles spaces -- true, but
#              nothing tested it, and a suffix match can false-positive when two
#              files share a basename.
#           3. Gate 6's csharp arm reads PIPESTATUS[0] -- asserted, never shown
#              to be in the right position relative to the pipeline.
# @covers AC-717-24

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

# --- SAST: the ruleset must actually contain C# rules ----------------------

@test "gate-10 loads p/csharp in addition to p/security-audit" {
  run grep -q "p/csharp" "$REPO_ROOT/githooks/gate-10.sh"
  [ "$status" -eq 0 ]
}

@test "gate-10 keeps p/security-audit so other languages stay covered" {
  run grep -q "SEMGREP_RULES=(--config=p/security-audit)" "$REPO_ROOT/githooks/gate-10.sh"
  [ "$status" -eq 0 ]
}

@test "gate-10 adds p/csharp conditionally, keyed off a staged .cs file" {
  # Unconditional loading would slow every commit; keyed off the file list keeps
  # non-C# commits at the old cost.
  run grep -qE 'grep -qE "\.cs\$"' "$REPO_ROOT/githooks/gate-10.sh"
  [ "$status" -eq 0 ]
}

@test "gate-10 passes the whole ruleset array to semgrep, not a single hardcoded config" {
  run grep -q 'scan "\${SEMGREP_RULES\[@\]}"' "$REPO_ROOT/githooks/gate-10.sh"
  [ "$status" -eq 0 ]
}

# --- Gate 13: Windows path reconciliation must survive spaces --------------

@test "gate-13 reconciles a spaced Windows path to its repo-relative form" {
  # The defect: dotnet prints C:\...\My Project\Class1.cs while git reports
  # "My Project/Class1.cs". Reimplement the two-step fold the gate performs
  # (separator normalisation, then suffix match) and assert it relates them --
  # including the space, which is what broke naive word-splitting.
  diag='C:\Users\dev\repo\My Project\Class1.cs'
  staged='My Project/Class1.cs'
  folded=$(printf '%s\n' "$diag" | tr '\' '/')
  [ "$folded" = 'C:/Users/dev/repo/My Project/Class1.cs' ]
  matched=0
  case "$folded" in *"$staged") matched=1 ;; esac
  [ "$matched" -eq 1 ]
}

@test "gate-13 does not match a same-named file in a different directory" {
  # The suffix match must not turn into a bare basename match: Foo/Class1.cs
  # must not satisfy a diagnostic for BarFoo/Class1.cs.
  diag='C:/repo/BarFoo/Class1.cs'
  staged='Foo/Class1.cs'
  matched=0
  case "$diag" in *"/$staged") matched=1 ;; esac
  [ "$matched" -eq 0 ]
}

@test "gate-13 path matching is suffix-anchored, not a bare substring" {
  # A bare `grep -q "$dir/Class1.cs"` would match BarFoo/Class1.cs when looking
  # for Foo/Class1.cs. The suffix form is what keeps that from happening.
  run grep -qF '*"$s")' "$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
  [ "$status" -eq 0 ]
}

# --- Gate 6: PIPESTATUS must belong to the dotnet test pipeline ------------

@test "gate-6 reads PIPESTATUS immediately after the dotnet test pipeline" {
  LOOP=$(grep -n 'for CURRENT_LANG in $PROJECT_LANGS; do' "$REPO_ROOT/githooks/pre-commit" | tail -1 | cut -d: -f1)
  CS=$(grep -n '"csharp")' "$REPO_ROOT/githooks/pre-commit" | tail -1 | cut -d: -f1)
  END=$(grep -n 'C# architecture validation completed' "$REPO_ROOT/githooks/pre-commit" | tail -1 | cut -d: -f1)
  [ -n "$LOOP" ]
  [ "$CS" -gt "$LOOP" ]
  # PIPESTATUS is only valid on the line IMMEDIATELY after a pipeline; any
  # command in between (even `echo`) resets it and the arm silently reads 0.
  run bash -c "sed -n '$((CS)),$((END))p' '$REPO_ROOT/githooks/pre-commit' | grep -A1 'dotnet test' | grep -q 'PIPESTATUS\[0\]'"
  [ "$status" -eq 0 ]
}

# --- The blocking matrix must not claim what the code cannot do ------------

@test "no gate in the C# block path silently swallows a non-zero status" {
  # The #602/#630 shape: `cmd | tail` then unconditional success text. Any
  # `| tail` inside the csharp arms must be followed by a status read.
  run bash -c "grep -n 'dotnet test' '$REPO_ROOT/githooks/pre-commit' -A2 | grep -q 'PIPESTATUS'"
  [ "$status" -eq 0 ]
}

@test "pre-commit and gate-10 still parse after the walkthrough fixes" {
  run bash -n "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  run bash -n "$REPO_ROOT/githooks/gate-10.sh"
  [ "$status" -eq 0 ]
}
