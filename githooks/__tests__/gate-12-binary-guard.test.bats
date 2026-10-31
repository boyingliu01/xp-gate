#!/usr/bin/env bats
# @test REQ-682
# @intent 验证 Gate 12 的二进制守卫不会把每个暂存文件都判成二进制——旧写法
#         `grep -q $'\x00'` 的模式实际是空串，对任何非空输入都匹配，于是三道
#         检查（尾随空格 / 缺 EOF 换行 / 冲突标记）全部静默失效
# @covers AC-682-01, AC-682-02, AC-682-03
#
# Why this needs its own test: the broken guard made the gate report PASS more
# often, never less. A detector that never fires is indistinguishable from "no
# drift", so nothing in normal use would ever surface it (#676). These cases
# assert the guard's ANSWER for each input kind, not that the gate "ran".

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-12-file-hygiene.sh"
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

# Load only the helper under test: sourcing the gate would run every check.
load_helper() {
  awk '/^is_binary_staged_file\(\) \{/,/^\}/' "$GATE" > "$WORK/helper.sh"
  [ -s "$WORK/helper.sh" ] || { echo "is_binary_staged_file not found in gate-12" >&2; return 1; }
  # shellcheck disable=SC1091
  . "$WORK/helper.sh"
}

@test "AC-682-01: a text file is NOT judged binary (checks must run)" {
  printf 'plain line\nsecond line\n' > notes.txt
  git add notes.txt
  load_helper
  run is_binary_staged_file notes.txt
  [ "$status" -eq 1 ]
}

@test "AC-682-02: a file with NUL bytes IS judged binary (skipped)" {
  # The old guard could not distinguish these two cases at all -- it answered
  # "binary" for both, which is the bug this pins.
  printf 'BIN\000\001\002DATA' > blob.bin
  git add blob.bin
  load_helper
  run is_binary_staged_file blob.bin
  [ "$status" -eq 0 ]
}

@test "AC-682-03: a text file carrying a conflict marker still reaches the marker check" {
  # The whole point: conflict markers are a BLOCK-level finding, and the broken
  # guard skipped them along with every other file.
  printf 'id,name\n<<<<<<< HEAD\n1,a\n=======\n2,b\n>>>>>>> feature\n' > conflicted.csv
  git add conflicted.csv
  load_helper
  run is_binary_staged_file conflicted.csv
  [ "$status" -eq 1 ]
  run bash -c 'git show ":conflicted.csv" | grep -qE "^(<<<<<<<|=======|>>>>>>>)"'
  [ "$status" -eq 0 ]
}
