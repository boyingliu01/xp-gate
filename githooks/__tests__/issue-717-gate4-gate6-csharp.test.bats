#!/usr/bin/env bats
# @test REQ-717-019
# @intent Gate 4 and Gate 6 both silently accepted C# and then checked nothing:
#         gate-4.sh's extension filter let `.cs` through, but analyzer.ts had no
#         `.cs` entry so the file was dropped; and Gate 6's per-language loop had
#         no `csharp` arm, so it fell to the `*)` default. Both printed something
#         that looked like coverage. These assertions pin that each gate now has a
#         real C# path and that the fail-open shapes are gone.
# @covers AC-717-23

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  # #798: the Gate 4/6 per-language arms moved into gate-entries/. Gate 6 owns
  # the csharp arm, so these assertions read that entry file.
  GATE_6="$REPO_ROOT/githooks/gate-entries/gate-6-entry.sh"
}

# --- Gate 4: the analyzer must resolve .cs to a real adapter -----------------

@test "analyzer registers .cs and .csx to the CSharpAdapter" {
  run grep -q "'.cs': CSharpAdapter" "$REPO_ROOT/src/principles/analyzer.ts"
  [ "$status" -eq 0 ]
  run grep -q "'.csx': CSharpAdapter" "$REPO_ROOT/src/principles/analyzer.ts"
  [ "$status" -eq 0 ]
}

@test "the C# principles adapter file exists and implements the adapter contract" {
  [ -f "$REPO_ROOT/src/principles/adapters/csharp.ts" ]
  run grep -q "class CSharpAdapter extends BaseAdapter" "$REPO_ROOT/src/principles/adapters/csharp.ts"
  [ "$status" -eq 0 ]
  for fn in parseAST extractFunctions extractClasses; do
    run grep -q "$fn()" "$REPO_ROOT/src/principles/adapters/csharp.ts"
    [ "$status" -eq 0 ]
  done
}

@test "C# adapter keeps braces inside strings and comments out of the body scan" {
  # The cpp.ts lesson: counting a `}` inside a literal truncates the body and
  # under-measures every rule that reads length/nesting.
  run grep -q "lexSkip" "$REPO_ROOT/src/principles/adapters/csharp.ts"
  [ "$status" -eq 0 ]
  run grep -q "inVerbatimString" "$REPO_ROOT/src/principles/adapters/csharp.ts"
  [ "$status" -eq 0 ]
  run grep -q "inRawString" "$REPO_ROOT/src/principles/adapters/csharp.ts"
  [ "$status" -eq 0 ]
}

# --- Gate 6: a real csharp arm, not the *) default --------------------------

@test "Gate 6 has a dedicated csharp case arm" {
  run grep -n '"csharp")' "$GATE_6"
  [ "$status" -eq 0 ]
}

@test "the Gate 6 csharp arm is inside the per-language loop, not the fallback" {
  LOOP_LINE=$(grep -n 'for CURRENT_LANG in $PROJECT_LANGS; do' "$GATE_6" | tail -1 | cut -d: -f1)
  CS_LINE=$(grep -n '"csharp")' "$GATE_6" | tail -1 | cut -d: -f1)
  [ -n "$LOOP_LINE" ]
  [ -n "$CS_LINE" ]
  [ "$CS_LINE" -gt "$LOOP_LINE" ]
}

@test "the Gate 6 csharp arm reads PIPESTATUS so it cannot fail open" {
  # #630/#602 removed the shape where `cmd | tail` yields tail's status and the
  # arm printed "completed" unconditionally. The C# arm must not reintroduce it.
  LOOP_LINE=$(grep -n 'for CURRENT_LANG in $PROJECT_LANGS; do' "$GATE_6" | tail -1 | cut -d: -f1)
  START=$LOOP_LINE
  END_LINE=$(grep -n 'cs_arch_rc=' "$GATE_6" | tail -1 | cut -d: -f1)
  [ -n "$END_LINE" ]
  sed -n "${START},$((END_LINE+3))p" "$GATE_6" | grep -q 'PIPESTATUS\[0\]'
}

@test "the Gate 6 csharp arm blocks on failure rather than only printing" {
  LOOP_LINE=$(grep -n 'for CURRENT_LANG in $PROJECT_LANGS; do' "$GATE_6" | tail -1 | cut -d: -f1)
  END_LINE=$(grep -n 'C# architecture validation completed' "$GATE_6" | tail -1 | cut -d: -f1)
  [ -n "$END_LINE" ]
  # #798: a gate body RETURNS its verdict (the driver maps a non-zero return
  # to the hook exit status), so blocking is spelled `return 1` here.
  sed -n "${LOOP_LINE},$((END_LINE+1))p" "$GATE_6" | grep -qE '(^|[[:space:]])return 1'
}

@test "the Gate 6 csharp arm leaves a skip reason when it cannot measure" {
  # #537: a language that was NOT measured must carry a reason, otherwise the
  # gate cannot tell "validated and passed" from "never ran".
  LOOP_LINE=$(grep -n 'for CURRENT_LANG in $PROJECT_LANGS; do' "$GATE_6" | tail -1 | cut -d: -f1)
  END_LINE=$(grep -n 'C# architecture validation completed' "$GATE_6" | tail -1 | cut -d: -f1)
  sed -n "${LOOP_LINE},$((END_LINE+1))p" "$GATE_6" \
    | grep -q 'GATE_6_REASON_BY_LANG\["\$CURRENT_LANG"\]="architecture_not_configured"'
}

@test "pre-commit still parses after the csharp arm was added" {
  run bash -n "$GATE_6"
  [ "$status" -eq 0 ]
}
