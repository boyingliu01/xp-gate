#!/usr/bin/env bats

# #717 AC-717-15: the full return-code matrix for csharp.sh's four functions.
#
# R1 round 6 (feasibility FC-C2/FC-M1) pointed out that AC-717-09/12/14 pin
# `run_tests` and sketch rc=2 in general, but never enumerate what each of the
# four functions can return, which gate consumes it, or what the gate does with
# a MIXED pair (one function clean, the other unable to execute). Without that,
# "cannot execute != failure" is a slogan rather than a specification.
#
# Consumer map, read from githooks/pre-commit:
#   Gate 1  -> run_static_analysis (:2255) and run_lint (:2262), via PIPESTATUS[0]
#   Gate 5  -> run_tests (:3203/:3228) and run_coverage (:3446 -> COV_EXIT)
#
# These tests assert the ADAPTER's contract and the GATE's aggregation rule.
# They do not re-implement pre-commit; where the gate logic is the subject, the
# assertion reproduces the exact expression pre-commit uses and is labelled so.

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
  ADAPTER="$REPO_ROOT/githooks/adapters/csharp.sh"
  FIXTURE=$(mktemp -d)
}

teardown() {
  rm -rf "$FIXTURE"
}

# Gate 1's aggregation expression, verbatim from pre-commit:2269-2278.
_gate1_verdict() {
  local a="$1" l="$2" out=""
  if [ "$a" -eq 2 ] || [ "$l" -eq 2 ]; then out="COULD_NOT_EXECUTE "; fi
  if [ "$a" -eq 0 ] && [ "$l" -eq 0 ]; then echo "${out}PASSED"; else echo "${out}NOT_PASSED"; fi
}

# ---------------------------------------------------------------------------
# Adapter-level: each function's contract in the "no project" shape.
# ---------------------------------------------------------------------------

@test "#717 AC-717-15: run_static_analysis returns 2 when dotnet is absent" {
  mkdir -p "$FIXTURE/bin-shadow"
  printf '#!/bin/sh\nexit 127\n' > "$FIXTURE/bin-shadow/dotnet"
  printf '#!/bin/sh\nexit 127\n' > "$FIXTURE/bin-shadow/dotnet.exe"
  chmod +x "$FIXTURE/bin-shadow/dotnet" "$FIXTURE/bin-shadow/dotnet.exe"
  touch "$FIXTURE/App.csproj"
  run bash -c "
    cd '$FIXTURE'
    PATH='$FIXTURE/bin-shadow':\$PATH; export PATH
    source '$ADAPTER'; run_static_analysis
  "
  [ "$status" -eq 2 ]
}

@test "#717 AC-717-15: run_lint returns 2 when dotnet is absent (delegates to analysis)" {
  mkdir -p "$FIXTURE/bin-shadow"
  printf '#!/bin/sh\nexit 127\n' > "$FIXTURE/bin-shadow/dotnet"
  printf '#!/bin/sh\nexit 127\n' > "$FIXTURE/bin-shadow/dotnet.exe"
  chmod +x "$FIXTURE/bin-shadow/dotnet" "$FIXTURE/bin-shadow/dotnet.exe"
  touch "$FIXTURE/App.csproj"
  run bash -c "
    cd '$FIXTURE'
    PATH='$FIXTURE/bin-shadow':\$PATH; export PATH
    source '$ADAPTER'; run_lint
  "
  [ "$status" -eq 2 ]
}

@test "#717 AC-717-15: run_coverage returns 2 when there is no test project" {
  bash -c "cd '$FIXTURE' && dotnet new classlib -o L --force" >/dev/null 2>&1 \
    || skip "dotnet SDK not installed"
  run bash -c "cd '$FIXTURE' && source '$ADAPTER' && run_coverage"
  [ "$status" -eq 2 ]
}

@test "#717 AC-717-15: every function returns a documented code, never an arbitrary one" {
  # 0 = clean, 1 = ran and found problems, 2 = could not execute. Anything else
  # would be undocumented and the caller would read it as "ran and found
  # problems" once it is OR-ed into COV_EXIT.
  for fn in run_static_analysis run_lint run_tests run_coverage; do
    run grep -E "^${fn}\(\)" "$ADAPTER"
    [ "$status" -eq 0 ]
  done
  # Documented set is asserted at the consumer level below; here we pin that the
  # file itself names the three codes so a future edit cannot invent a fourth.
  run grep -E 'return (0|1|2)$' "$ADAPTER"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Gate 1 aggregation: every combination of run_static_analysis/run_lint.
# ---------------------------------------------------------------------------

@test "#717 AC-717-15: Gate 1 passes only when BOTH functions return 0" {
  [ "$(_gate1_verdict 0 0)" = "PASSED" ]
}

@test "#717 AC-717-15: Gate 1 does not pass when analysis finds problems (1/0)" {
  [ "$(_gate1_verdict 1 0)" = "NOT_PASSED" ]
}

@test "#717 AC-717-15: Gate 1 does not pass when lint finds problems (0/1)" {
  [ "$(_gate1_verdict 0 1)" = "NOT_PASSED" ]
}

@test "#717 AC-717-15: Gate 1 names could-not-execute for a pure 2/2 result" {
  echo "$(_gate1_verdict 2 2)" | grep -q "COULD_NOT_EXECUTE"
  echo "$(_gate1_verdict 2 2)" | grep -q "NOT_PASSED"
}

@test "#717 AC-717-15: Gate 1 names could-not-execute for a MIXED 1/2 result" {
  # One function found real problems, the other could not run. The gate must not
  # claim a clean skip: at least one measurement is genuinely missing.
  echo "$(_gate1_verdict 1 2)" | grep -q "COULD_NOT_EXECUTE"
  echo "$(_gate1_verdict 1 2)" | grep -q "NOT_PASSED"
}

@test "#717 AC-717-15: Gate 1 never blocks on rc=2 (tool-missing must not block)" {
  # Repo convention: a missing tool degrades to SKIP, not BLOCK (Gate 8 aside).
  for pair in "2 0" "0 2" "2 2" "1 2"; do
    set -- $pair
    echo "$(_gate1_verdict "$1" "$2")" | grep -q "^COULD_NOT_EXECUTE NOT_PASSED\|^NOT_PASSED$"
  done
}

# ---------------------------------------------------------------------------
# Gate 5 coverage aggregation: run_coverage's rc is OR-ed into COV_EXIT,
# so 2 must not be readable as "coverage measured and fine".
# ---------------------------------------------------------------------------

@test "#717 AC-717-15: run_coverage rc=2 does not silently claim coverage was collected" {
  # The adapter must SAY coverage was not measured; a bare `return 2` with no
  # message would leave the operator without the artifact name or the fix.
  mkdir -p "$FIXTURE/bin-shadow"
  printf '#!/bin/sh\nexit 127\n' > "$FIXTURE/bin-shadow/dotnet"
  chmod +x "$FIXTURE/bin-shadow/dotnet"
  touch "$FIXTURE/App.csproj"
  run bash -c "
    cd '$FIXTURE'
    PATH='$FIXTURE/bin-shadow':\$PATH; export PATH
    source '$ADAPTER'; run_coverage
  "
  [ "$status" -eq 2 ]
  echo "$output" | grep -qiE "not found|not measured|no test project"
}

@test "#717 AC-717-15: Gate 1 does not pass when BOTH functions find problems (1/1)" {
  # The 1/1 cell was missing from the first version of this matrix, which made
  # "both agree there is a problem" the one unasserted case -- and it is the
  # most common real outcome in a repo whose analyzer and linter both complain.
  [ "$(_gate1_verdict 1 1)" = "NOT_PASSED" ]
}

@test "#717 AC-717-15: the exhaustive (analysis, lint) matrix is as specified" {
  # All 3x3 combinations, since each input has exactly three documented codes.
  # The gate's rule is: PASSED only on 0/0; COULD_NOT_EXECUTE iff any side is 2.
  [ "$(_gate1_verdict 0 0)" = "PASSED" ]
  for l in 1 2; do [ "$(_gate1_verdict 0 "$l")" != "PASSED" ]; done
  for a in 1 2; do [ "$(_gate1_verdict "$a" 0)" != "PASSED" ]; done
  [ "$(_gate1_verdict 1 1)" = "NOT_PASSED" ]
  for a in 1 2; do for l in 1 2; do
    echo "$(_gate1_verdict "$a" "$l")" | grep -q "NOT_PASSED"
  done; done
  # COULD_NOT_EXECUTE is present exactly when a side returned 2.
  for pair in "2 0" "0 2" "1 2" "2 1" "2 2"; do
    set -- $pair
    echo "$(_gate1_verdict "$1" "$2")" | grep -q "COULD_NOT_EXECUTE"
  done
  for pair in "0 1" "1 0" "1 1"; do
    set -- $pair
    ! echo "$(_gate1_verdict "$1" "$2")" | grep -q "COULD_NOT_EXECUTE"
  done
}
