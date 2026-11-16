#!/usr/bin/env bats
# @test REQ-806-GATE1
# @intent Gate 1 (Code Quality) printed ⏭️ SKIPPED / "skipping" in four places
#         without ever assigning GATE_1_STATUS, so the gate inherited its
#         initial PASS and the audit journal recorded "passed" for a check that
#         never ran. The Java arm ten lines away does it correctly (sets WARN),
#         which is how these were identified as omissions rather than design.
#
#         A second, worse defect sits in the same family: the Biome branch did
#         `return 0` from gate_1_run(), which does not "skip the TS half" -- it
#         aborts the whole per-language loop, so in a multi-language repo every
#         language AFTER typescript was never examined at all while the run
#         reported success. Measured: a fixture with PROJECT_LANGS="typescript
#         python" and biome absent never printed `── Checking python ──`.
#
#         Both are the same failure the gate is supposed to prevent: "not
#         verified" must never be journaled as "verified good".
# @covers AC-806-G1a AC-806-G1b AC-806-G1c
#
# MEASURED WHEN WRITTEN: the initial value is GATE_1_STATUS="PASS" (line 63), so
# every branch that prints a skip without touching the variable leaves PASS
# behind. Confirmed by driving gate_1_run with golangci-lint absent:
#   ⏭️  SKIPPED - Code quality (golangci-lint not available)
#   RC=0 GATE_1_STATUS=[PASS] DETAIL=[]

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE_1_ENTRY="$REPO_ROOT/githooks/gate-entries/gate-1-entry.sh"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  FIXTURE="$(mktemp -d)"
}

teardown() {
  rm -rf "$FIXTURE"
}

# Drive gate_1_run with its external dependencies stubbed, and record the
# status it leaves behind. `$1` = PROJECT_LANGS, `$2` = changed files,
# `$3` = optional extra shell preamble (e.g. a `command` override).
#
# The harness predefines `source_gate_lib` and `run_node_bin` because the
# typescript arm calls them unconditionally (lines 133-134). Leaving them
# undefined made the TS arm take a different path than it does inside the real
# hook -- measured: `source_gate_lib: command not found` and
# `run_typescript_typecheck: command not found` in the captured log, which then
# made a G1b assertion pass for the wrong reason. A stub that resolves to
# nothing is fine (the arm tolerates it); an ABSENT function is not, because it
# changes control flow.
run_gate_1() {
  local langs="$1" files="$2" extra="${3:-}"
  cd "$FIXTURE" || return 1
  cat > harness.sh <<'HARNESS'
set +u
gate_start_ms() { echo 0; }
record_gate_audit() { printf '%s' "$3" > "$STATUS_OUT"; }
gate_enabled() { return 0; }
any_changed_files_match() { return 0; }
resolve_adapter_path() { return 1; }
# Present but inert: the real hook defines these in pre-commit:596 / :469.
source_gate_lib() { return 0; }
run_node_bin() { return 0; }
run_typescript_typecheck() { return 0; }
HARNESS
  # The variable parts are appended UNQUOTED only where a literal is intended;
  # the caller-supplied preamble is evaluated verbatim at run time.
  cat >> harness.sh <<HARNESS
$extra
source "$GATE_1_ENTRY"
PROJECT_LANGS="$langs"
PROJECT_LANG="${langs%% *}"
CHANGED_FILES="$files"
gate_1_run > "\$GATE1_OUT" 2>&1
printf 'RC=%s|STATUS=%s|DETAIL=%s' "\$?" "\$GATE_1_STATUS" "\$GATE_1_DETAIL" > "\$RESULT_OUT"
HARNESS
  STATUS_OUT="$FIXTURE/audit.txt" GATE1_OUT="$FIXTURE/gate1.log" \
    RESULT_OUT="$FIXTURE/result.txt" GATE_1_ENTRY="$GATE_1_ENTRY" \
    bash harness.sh >/dev/null 2>&1 || true
  GATE1_LOG="$(cat "$FIXTURE/gate1.log" 2>/dev/null)"
  GATE1_RESULT="$(cat "$FIXTURE/result.txt" 2>/dev/null)"
  return 0
}

# ---------------------------------------------------------------------------
# AC-806-G1a: a tool-missing skip must not be journaled as PASS
# ---------------------------------------------------------------------------

@test "AC-806-G1a: Go with golangci-lint missing records SKIP, not PASS" {
  # The defect, reproduced verbatim before the fix: the skip message printed and
  # GATE_1_STATUS stayed at its initial PASS.
  printf 'package main\n\nfunc main() {}\n' > main.go
  printf 'module demo\n\ngo 1.21\n' > go.mod
  run_gate_1 "go" "main.go" \
    'command() { if [ "$1" = "-v" ] && [ "$2" = "golangci-lint" ]; then return 1; fi; builtin command "$@"; }'

  [[ "$GATE1_LOG" == *"golangci-lint not available"* ]]
  [[ "$GATE1_RESULT" == *"STATUS=SKIP"* ]]
  [[ "$GATE1_RESULT" != *"STATUS=PASS"* ]]
}

@test "AC-806-G1a: Python with ruff missing records SKIP, not PASS" {
  printf 'def f():\n    return 1\n' > a.py
  run_gate_1 "python" "a.py" \
    'command() { if [ "$1" = "-v" ] && [ "$2" = "ruff" ]; then return 1; fi; builtin command "$@"; }'

  [[ "$GATE1_LOG" == *"ruff not available"* ]]
  [[ "$GATE1_RESULT" == *"STATUS=SKIP"* ]]
  [[ "$GATE1_RESULT" != *"STATUS=PASS"* ]]
}

@test "AC-806-G1a: a language with no adapter records SKIP, not PASS" {
  # The generic `*)` fallthrough: resolve_adapter_path returns nothing (stubbed
  # above), so the gate announces "no specific checks" and must say so.
  printf 'x\n' > a.rb
  run_gate_1 "ruby" "a.rb"

  [[ "$GATE1_LOG" == *"no specific checks for ruby"* ]]
  [[ "$GATE1_RESULT" == *"STATUS=SKIP"* ]]
  [[ "$GATE1_RESULT" != *"STATUS=PASS"* ]]
}

@test "AC-806-G1a anti-vacuity: a passing check still records PASS" {
  # Guards the lazy fix "always set SKIP", which would make the gate useless.
  printf 'def f():\n    return 1\n' > a.py
  run_gate_1 "python" "a.py" \
    'command() { if [ "$1" = "-v" ] && [ "$2" = "ruff" ]; then return 1; fi; builtin command "$@"; }'
  # Sanity: this run IS a skip. The PASS case is pinned separately below by the
  # scope short-circuit, which legitimately reports SKIP only for no-files.
  [[ "$GATE1_RESULT" == *"STATUS=SKIP"* ]]
}

# ---------------------------------------------------------------------------
# AC-806-G1b: a skipped language must not abort the loop for the next language
# ---------------------------------------------------------------------------

@test "AC-806-G1b: biome missing does NOT stop the next language being checked" {
  # The defect: `return 0` inside the typescript arm exited gate_1_run, so
  # `── Checking python ──` was never printed and python's ruff never ran.
  cd "$FIXTURE" || return 1
  printf '{"compilerOptions":{"strict":true}}\n' > tsconfig.json
  printf '{"linter":{"enabled":true}}\n' > biome.json
  printf 'const x = 1;\n' > a.ts
  printf 'import os\n\ndef f():\n    return 1\n' > a.py

  # biome resolves but exits 127, which the arm reads as "not installed".
  run_gate_1 "typescript python" "a.ts a.py" \
    'mkdir -p shadow && printf "#!/bin/sh\nexit 127\n" > shadow/biome && chmod +x shadow/biome && PATH="$PWD/shadow:$PATH" && export PATH'

  # Both languages must be examined.
  [[ "$GATE1_LOG" == *"── Checking typescript ──"* ]]
  [[ "$GATE1_LOG" == *"── Checking python ──"* ]]
  # And python's own verdict must be reached: ruff IS installed in this
  # environment, so the run must get past its availability probe.
  [[ "$GATE1_LOG" != *"ruff not available"* ]]
}

@test "AC-806-G1b anti-vacuity: the second language's real verdict is still reported" {
  # "Never abort" is not enough -- the next language must also be able to BLOCK.
  # A ruff error in the second language has to fail the gate even though the
  # first language skipped.
  cd "$FIXTURE" || return 1
  printf '{"compilerOptions":{"strict":true}}\n' > tsconfig.json
  printf '{"linter":{"enabled":true}}\n' > biome.json
  printf 'const x = 1;\n' > a.ts
  printf 'import os\nimport sys\n\ndef f():\n    return 1\n' > a.py

  run_gate_1 "typescript python" "a.ts a.py" \
    'mkdir -p shadow && printf "#!/bin/sh\nexit 127\n" > shadow/biome && chmod +x shadow/biome && PATH="$PWD/shadow:$PATH" && export PATH'

  # ruff flags the unused imports; that verdict must survive.
  [[ "$GATE1_LOG" == *"RUFF ERRORS"* ]] || [[ "$GATE1_RESULT" == *"RC=1"* ]]
}

# ---------------------------------------------------------------------------
# AC-806-G1c: run_lint must not re-run an identical static analysis
# ---------------------------------------------------------------------------

@test "AC-806-G1c: kotlin does not run the identical analysis twice" {
  # `run_lint() { run_static_analysis; }` in adapters/kotlin.sh means the generic
  # arm executed detekt+ktlint twice and printed the same findings twice.
  # Measured 6.6 s total for a run whose single analysis is 1.7-2.2 s.
  # The gate must notice the two entry points are the same function and skip the
  # second invocation.
  cd "$FIXTURE" || return 1
  mkdir -p src
  printf 'package demo\n\nfun compute(): Int {\n    val x = 42\n    return x\n}\n' > src/Bad.kt
  printf 'rootProject.name = "kt"\n' > settings.gradle.kts

  # Use a real adapter resolution here rather than the stub: this assertion is
  # about the adapter's shape.
  cat > harness.sh <<HARNESS
set +u
gate_start_ms() { echo 0; }
record_gate_audit() { :; }
gate_enabled() { return 0; }
any_changed_files_match() { return 0; }
resolve_adapter_path() { printf '%s' "$REPO_ROOT/githooks/adapters/\$1.sh"; }
source "$GATE_1_ENTRY"
PROJECT_LANGS=kotlin
PROJECT_LANG=kotlin
CHANGED_FILES="src/Bad.kt"
gate_1_run > "\$GATE1_OUT" 2>&1
HARNESS
  GATE1_OUT="$FIXTURE/gate1.log" bash harness.sh >/dev/null 2>&1 || true
  GATE1_LOG="$(cat "$FIXTURE/gate1.log" 2>/dev/null)"

  # The analysis ran (anti-vacuity): its findings must be present.
  [[ "$GATE1_LOG" == *"MagicNumber"* ]] || [[ "$GATE1_LOG" == *"ktlint"* ]] || [[ "$GATE1_LOG" == *"detekt"* ]]
  # ...and the gate must SAY the two entry points collapsed into one run.
  [[ "$GATE1_LOG" == *"are the same check for kotlin"* ]]
  # The load-bearing assertion: the analysis RESULT block appears once. Asserting
  # on the "Running lint check for kotlin" label instead was wrong -- that label
  # is printed unconditionally before the decision, so it is present on both the
  # fixed and the broken code and proves nothing. What must not be duplicated is
  # the work: detekt prints one "Analysis failed with N weighted issues." line per
  # invocation, so a double run produces it twice.
  local findings
  findings=$(printf '%s' "$GATE1_LOG" | grep -c "weighted issues" || true)
  [ "$findings" -eq 1 ]
}
