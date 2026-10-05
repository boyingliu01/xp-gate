#!/usr/bin/env bats

# ============================================================================
# Issue #470 (follow-up): Gate 9 (Build Integrity) reports
# "Not a TypeScript project" while Gate 1 has just run tsc successfully —
# the entry condition probed package.json/tsconfig.json at the repo root only.
#
# In a web/ (TS) + backend/ (Python) monorepo the hook sits at the repo root
# where neither file exists, so the whole Gate 9 silently SKIPped. Gate 1's
# discovery (PR #471) already resolves a TS project directory; Gate 9 now
# does the same (root -> PROJECT_SUBDIR -> shallow search) and hands the
# discovered dir to the build-integrity checker as --project-root so the
# checker's own <projectRoot>/tsconfig.json probe sees web/tsconfig.json.
#
# Also covers the Issue #462 hardening: an empty clock read must clamp the
# displayed duration to 0s instead of rendering -1.78e12 "seconds".
# ============================================================================

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"
PRE_COMMIT="$SOURCE_GITHOOKS/pre-commit"

setup() {
  TEST_DIR=$(mktemp -d)
  PROJ="$TEST_DIR/proj"
  mkdir -p "$PROJ/web" "$PROJ/bin"

  # Multi-language monorepo layout: TS project lives in web/.
  printf '%s\n' '{"name":"root-no-ts"}' > "$PROJ/package.json"
  printf '%s\n' '{"name":"web","scripts":{}}' > "$PROJ/web/package.json"
  printf '%s\n' '{"include":["src"]}' > "$PROJ/web/tsconfig.json"

  # Stub build-integrity checker so resolution finds it inside the fixture.
  mkdir -p "$PROJ/.xp-gate/modules/build-integrity"
  printf '%s\n' '// stub' > "$PROJ/.xp-gate/modules/build-integrity/gate-10.ts"

  # Extract the whole Gate 9 block (timing + discovery + dispatch).
  sed -n '/^GATE_9_START=\$(gate_start_ms)/,/^record_gate_audit "gate-9"/p' \
    "$PRE_COMMIT" > "$TEST_DIR/gate9-block.sh"
  [ -s "$TEST_DIR/gate9-block.sh" ]

  cat > "$TEST_DIR/run-gate9.sh" <<PRELUDE
#!/usr/bin/env bash
PROJECT_ROOT="$PROJ"
PROJECT_SUBDIR="\${PROJECT_SUBDIR_OVERRIDE:-web}"
CHANGED_FILES="web/src/a.ts"
gate_start_ms() { echo 1753001234000; }
record_gate_audit() { :; }
run_tsx() {
  { echo "CWD=\$(pwd)"; echo "ARGS=\$*"; } > "$TEST_DIR/run-tsx.log"
  echo "stub build integrity ok"
  return 0
}
PRELUDE
  cat "$TEST_DIR/gate9-block.sh" >> "$TEST_DIR/run-gate9.sh"
  chmod +x "$TEST_DIR/run-gate9.sh"

  cd "$PROJ"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# ---------------------------------------------------------------------------
# The regression: a TS project in web/ must be detected, not "not a TS project"
# ---------------------------------------------------------------------------

@test "Gate 9 detects the TS project in the language subdir and runs the checker" {
  run bash "$TEST_DIR/run-gate9.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" != *"Not a TypeScript project"* ]]
  [[ "$output" == *"Build integrity check passed"* ]]

  # The checker must receive the subdir as --project-root (web/ abs path).
  run cat "$TEST_DIR/run-tsx.log"
  [[ "$output" == *"ARGS="* ]]
  [[ "$output" == *"--project-root $PROJ/web"* ]]
  [[ "$output" == *"--project-root"* ]]
}

@test "Gate 9 root TS project keeps the repo root as --project-root (no regression)" {
  # Remove the subdir project markers, put them at the root instead.
  rm -rf "$PROJ/web"
  printf '%s\n' '{"name":"root","scripts":{}}' > "$PROJ/package.json"
  printf '%s\n' '{"include":["src"]}' > "$PROJ/tsconfig.json"

  PROJECT_SUBDIR_OVERRIDE="" run bash "$TEST_DIR/run-gate9.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" != *"Not a TypeScript project"* ]]
  [[ "$output" == *"Build integrity check passed"* ]]

  run cat "$TEST_DIR/run-tsx.log"
  [[ "$output" == *"--project-root $PROJ"* ]]
  [[ "$output" != *"--project-root $PROJ/web"* ]]
}

@test "Gate 9 still SKIPs truthfully when no TS project exists anywhere" {
  rm -rf "$PROJ/web"
  PROJECT_SUBDIR_OVERRIDE="" run bash "$TEST_DIR/run-gate9.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Not a TypeScript project"* ]]
  [[ "$output" == *"SKIPPED - Build integrity (not a TypeScript project)"* ]]
}

# ---------------------------------------------------------------------------
# Issue #462 hardening: absurd negative durations must be clamped
# ---------------------------------------------------------------------------

@test "Issue #462 hardening: Gate 9 duration is clamped when the clock read fails" {
  # The clamp guard must exist in the shipped hook (static).
  run grep -F '[ "$GATE_9_END" -ge "$GATE_9_START" ]' "$PRE_COMMIT"
  [ "$status" -eq 0 ]

  # And the arithmetic it guards: empty END must render 0s, not -1.78e12s.
  run bash -c '
    GATE_9_START=1753001234000
    GATE_9_END=""
    GATE_9_DURATION_MS=0
    if [ -n "$GATE_9_START" ] && [ -n "$GATE_9_END" ] && [ "$GATE_9_END" -ge "$GATE_9_START" ] 2>/dev/null; then
      GATE_9_DURATION_MS=$((GATE_9_END - GATE_9_START))
    fi
    GATE_9_DURATION=$((GATE_9_DURATION_MS / 1000))
    echo "$GATE_9_DURATION"
  '
  [ "$output" = "0" ]
}

@test "Issue #462 hardening: a healthy clock read still reports real seconds" {
  run bash -c '
    GATE_9_START=1753001234000
    GATE_9_END=1753001235500
    GATE_9_DURATION_MS=0
    if [ -n "$GATE_9_START" ] && [ -n "$GATE_9_END" ] && [ "$GATE_9_END" -ge "$GATE_9_START" ] 2>/dev/null; then
      GATE_9_DURATION_MS=$((GATE_9_END - GATE_9_START))
    fi
    GATE_9_DURATION=$((GATE_9_DURATION_MS / 1000))
    echo "$GATE_9_DURATION"
  '
  [ "$output" = "1" ]
}
