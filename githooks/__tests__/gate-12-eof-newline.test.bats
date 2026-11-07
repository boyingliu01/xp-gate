#!/usr/bin/env bats
# @test REQ-772
# @intent Gate 12 的「缺 EOF 换行」检查用 $(...) 取文件内容，而命令替换会剥掉
#         末尾所有换行，随后 `printf '%s' "$FILE_CONTENT" | tail -c 1` 拿到的必然是
#         最后一个可见字符，非空 → 任何文件都被判成「缺 EOF 换行」。于是这道检查
#         对每个暂存文件都报假阳性：说文件有问题永远比说没问题安静，正常使用中
#         没人会注意到它，只能靠直接断言它对具体输入的答案来发现。
# @covers AC-772-01, AC-772-02
#
# Why this needs its own test: a gate that always fires looks like a strict gate.
# The signal it destroys is the distinction between "this file really is missing
# its final newline" and "this file is fine". Asserting the ANSWER per input kind
# is the only thing that separates the two.

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

# The check is inline in the gate body, so extract the predicate it relies on.
# The fix must answer "is the final byte a newline" from the raw bytes rather
# than from a command substitution that has already eaten them.
load_predicate() {
  awk '/^file_missing_eof_newline\(\) \{/,/^\}/' "$GATE" > "$WORK/pred.sh" 2>/dev/null
  if [ -s "$WORK/pred.sh" ]; then
    # shellcheck disable=SC1091
    . "$WORK/pred.sh"
    return 0
  fi
  # Fall back to the exact expression the gate body uses, so this test still
  # fails for the right reason if the helper is never extracted.
  file_missing_eof_newline() {
    local FILE_CONTENT
    FILE_CONTENT=$(git show ":$1" 2>/dev/null)
    [ -n "$FILE_CONTENT" ] || return 1
    local LAST_CHAR
    LAST_CHAR=$(printf '%s' "$FILE_CONTENT" | tail -c 1)
    [ "$LAST_CHAR" != "" ]
  }
}

@test "AC-772-01: a file that DOES end with a newline is not reported" {
  printf 'first line\nsecond line\n' > fine.txt
  git add fine.txt

  load_predicate
  run file_missing_eof_newline fine.txt
  [ "$status" -eq 1 ]
}

@test "AC-772-02: a file with no final newline IS reported" {
  printf 'first line\nsecond line' > truncated.txt
  git add truncated.txt

  load_predicate
  run file_missing_eof_newline truncated.txt
  [ "$status" -eq 0 ]
}

@test "AC-772-01: an empty file is not reported (nothing to terminate)" {
  : > empty.txt
  git add empty.txt

  load_predicate
  run file_missing_eof_newline empty.txt
  [ "$status" -eq 1 ]
}
