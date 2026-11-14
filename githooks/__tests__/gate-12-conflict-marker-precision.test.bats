#!/usr/bin/env bats
# @test REQ-808
# @intent Gate 12 的冲突标记正则 `^(<<<<<<<|=======|>>>>>>>)` 没有右边界，
#         任何 7 个及以上的 `=`/`<`/`>` 连续串都会命中。git 真正的冲突标记
#         恰好是 7 个字符，而 Maven 构建日志的分隔线是 64 个 `=`、RST/setext
#         下划线也常是长串 —— 它们被误判成冲突标记，让一次干净的合并被 BLOCK。
#         修复把正则锚定到「恰好 7 个 + 空格/行尾边界」：长串不再误报，真标记仍拦截。
# @covers AC-808-01, AC-808-02, AC-808-03, AC-808-04
#
# Why this needs its own test: a detector that fires on EVERY long `=` run looks
# like a strict gate. The signal it destroys is the distinction between "this
# file really carries a git conflict marker" and "this is a build-log separator".
# Normal use never surfaces the false positive as a bug -- it just blocks merges
# that should pass. Asserting the gate's ANSWER per input kind (and per mode) is
# the only thing that separates the two. The check is INLINE in the gate body, so
# these cases run the ACTUAL gate (with its two audit helpers stubbed), not a
# copied regex: reverting the fix must fail here.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-12-file-hygiene.sh"
  export GATE
  WORK="$(mktemp -d)"
  cd "$WORK"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Gate 12 Test"
  git config core.hooksPath /dev/null
}

teardown() {
  cd /
  rm -rf "$WORK"
}

# Drive the real gate body. The conflict-marker regex lives inline (no helper to
# awk-extract), so source the whole gate with only its two external audit hooks
# stubbed. BLOCK does `exit 1`; PASS/WARN fall through to exit 0. $1 selects the
# docs-only diff-scoped path (true) vs the full-blob path (false).
run_gate() {
  export DOCS_ONLY_COMMIT="${1:-false}"
  run bash -c 'gate_start_ms() { printf "0"; }
record_gate_audit() { :; }
source "$GATE"'
}

# A run of N '=' characters as a single terminated line (no trailing whitespace).
equals_run() {
  printf '%0.s=' $(seq 1 "$1")
  printf '\n'
}

@test "AC-808-01: a Maven 64-= log separator is NOT a conflict marker (full-blob)" {
  {
    printf '[INFO] Scanning for projects...\n'
    equals_run 64
    printf '[INFO] BUILD SUCCESS\n'
  } > mvn-verify.log
  git add mvn-verify.log

  run_gate false
  [ "$status" -eq 0 ]
}

@test "AC-808-02: real 7-char conflict markers ARE blocked (full-blob)" {
  printf 'id,name\n<<<<<<< HEAD\n1,a\n=======\n2,b\n>>>>>>> feature\n' > conflicted.csv
  git add conflicted.csv

  run_gate false
  [ "$status" -eq 1 ]
}

@test "AC-808-03: a Maven 64-= log separator is NOT a conflict marker (docs-only diff)" {
  {
    printf '[INFO] Scanning for projects...\n'
    equals_run 64
    printf '[INFO] BUILD SUCCESS\n'
  } > mvn-verify.log
  git add mvn-verify.log

  run_gate true
  [ "$status" -eq 0 ]
}

@test "AC-808-04: real 7-char conflict markers ARE blocked (docs-only diff)" {
  printf 'id,name\n<<<<<<< HEAD\n1,a\n=======\n2,b\n>>>>>>> feature\n' > conflicted.csv
  git add conflicted.csv

  run_gate true
  [ "$status" -eq 1 ]
}

@test "AC-808-01: the boundary is EXACTLY 7 -- 6/8/23/64 pass, bare 7 is a marker" {
  # git's separator is exactly `=======` (7, EOL). Shorter and longer runs are
  # not markers. This pins the right-hand boundary the old regex lacked.
  for n in 6 8 23 64; do
    equals_run "$n" > sep.log
    git add sep.log
    run_gate false
    [ "$status" -eq 0 ]
  done

  equals_run 7 > sep.log
  git add sep.log
  run_gate false
  [ "$status" -eq 1 ]
}
