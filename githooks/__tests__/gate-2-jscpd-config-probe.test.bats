#!/usr/bin/env bats

# ============================================================================
# Issue #477: Gate 2 called `jscpd --config jscpd.conf.json` unconditionally.
# When the file does not exist jscpd prints
#   "Using config from jscpd.conf.json"
#   "config file jscpd.conf.json: 系统找不到指定的文件 (os error 2)"
# then falls back to its defaults — a scary fake error — and the non-zero exit
# was misreported as "jscpd found duplicated code".
#
# Fix: probe CWD / TS project dir / repo root for jscpd.conf.json; pass
# --config only when it exists (real path); otherwise run with jscpd defaults
# (identical effective thresholds to the old fallback) and say so honestly.
# Also run from the repo root so repo-root-relative CHANGED_FILES resolve in
# subdir mode. Duplicate detection stays a warning (non-blocking) either way —
# no threshold or severity change.
# ============================================================================

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"
PRE_COMMIT="$SOURCE_GITHOOKS/pre-commit"

setup() {
  TEST_DIR=$(mktemp -d)
  PROJ="$TEST_DIR/proj"
  mkdir -p "$PROJ/web/src" "$PROJ/bin"
  printf '%s\n' 'export const a = 1' > "$PROJ/web/src/a.ts"

  # Extract the jscpd typescript dispatch (first "Running jscpd" block only:
  # the *) fallback branch reuses the same marker line).
  awk '/echo "Running jscpd for duplicate code detection..."/{f=1} f{print} f && /echo "✅ PASSED - jscpd duplicate code check completed."/{exit}' \
    "$PRE_COMMIT" > "$TEST_DIR/gate2-jscpd.sh"
  [ -s "$TEST_DIR/gate2-jscpd.sh" ]
  # The extract must be balanced bash (no case/else fragments).
  bash -n "$TEST_DIR/gate2-jscpd.sh"

  cat > "$TEST_DIR/run-gate2.sh" <<PRELUDE
#!/usr/bin/env bash
# Mirror the hook's pipeline semantics (pre-commit sets pipefail globally) so
# jscpd's exit code survives the `| head` truncation in the extracted block.
set -o pipefail
PROJECT_ROOT="$PROJ"
TS_PROJECT_DIR="\${TS_PROJECT_DIR_OVERRIDE:-web}"
CHANGED_FILES="web/src/a.ts"
require_tool() { return 0; }
export JSCPD_STUB_STATUS="\${JSCPD_STUB_STATUS:-0}"
PRELUDE
  cat "$TEST_DIR/gate2-jscpd.sh" >> "$TEST_DIR/run-gate2.sh"
  chmod +x "$TEST_DIR/run-gate2.sh"

  cat > "$PROJ/bin/jscpd" <<'STUB'
#!/usr/bin/env bash
{ echo "PWD=$(pwd)"; echo "ARGS=$*"; } >> "$JSCPD_STUB_LOG"
exit "$JSCPD_STUB_STATUS"
STUB
  chmod +x "$PROJ/bin/jscpd"

  export JSCPD_STUB_LOG="$TEST_DIR/jscpd.log"
  cd "$PROJ/web"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

@test "Gate 2 without jscpd.conf.json: honest message, no --config, defaults unchanged (#477)" {
  PATH="$PROJ/bin:$PATH" run bash "$TEST_DIR/run-gate2.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No jscpd.conf.json found - using jscpd defaults"* ]]
  [[ "$output" != *"Using config from jscpd.conf.json"* ]]
  [[ "$output" == *"PASSED - jscpd duplicate code check completed."* ]]

  run cat "$JSCPD_STUB_LOG"
  [[ "$output" != *"--config"* ]]
}

@test "Gate 2 with jscpd.conf.json at the repo root: --config uses the real path (#477)" {
  printf '%s\n' '{}' > "$PROJ/jscpd.conf.json"
  PATH="$PROJ/bin:$PATH" run bash "$TEST_DIR/run-gate2.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" != *"No jscpd.conf.json found"* ]]

  run cat "$JSCPD_STUB_LOG"
  [[ "$output" == *"--config $PROJ/jscpd.conf.json"* ]]
}

@test "Gate 2 runs jscpd from the repo root so subdir-mode paths resolve (#477)" {
  PATH="$PROJ/bin:$PATH" run bash "$TEST_DIR/run-gate2.sh"

  run cat "$JSCPD_STUB_LOG"
  [[ "$output" == *"PWD=$PROJ"* ]]
  [[ "$output" == *"web/src/a.ts"* ]]
}

@test "Gate 2 duplicate warning on non-zero jscpd stays non-blocking (#477)" {
  run env JSCPD_STUB_STATUS=2 PATH="$PROJ/bin:$PATH" bash "$TEST_DIR/run-gate2.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"jscpd found duplicated code (warning, not blocking by default)"* ]]
  [[ "$output" == *"PASSED - jscpd duplicate code check completed."* ]]
}
