#!/usr/bin/env bats
# @test REQ-450
# @intent Gate 0 的提示必须与执行口径一致，两个随包副本不得漂移。
#
#         #624 之后口径变了：pre-commit 运行时 git 还没生成提交消息，
#         `.git/COMMIT_EDITMSG` 不存在（-m / -F / 编辑器三条路径实测），
#         所以"消息前缀 bypass"在结构上不可能成立，已移除。真正可用的逃生口是
#         环境变量 SKIP_VERSION_CHECK=1（CHANGELOG 早已记载）。本测试固定：
#           * 提示指向环境变量，而不是那个永远无效的前缀；
#           * 只改构建工具链的提交无需任何标记即可通过；
#           * 两份随包副本保持同步。
# @covers AC-450-01, AC-450-02, AC-450-03

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PRE_COMMIT_COPY="$REPO_ROOT/githooks/pre-commit"
PRE_COMMIT_MIRROR="$REPO_ROOT/src/npm-package/hooks/pre-commit"

@test "AC-450-01: the hint names the env var as the escape hatch" {
  local text
  text=$(cat "$PRE_COMMIT_COPY")
  echo "$text" | grep -qF 'SKIP_VERSION_CHECK=1 git commit'
  echo "$text" | grep -q "adapters/, scripts/, hooks/"
  echo "$text" | grep -q "build-tooling-only"
}

@test "AC-450-02: the dead message-prefix recipe is gone from both copies (mirrors in sync)" {
  for copy in "$PRE_COMMIT_COPY" "$PRE_COMMIT_MIRROR"; do
    if grep -qF "[skip-version-check] chore: <description>" "$copy"; then
      fail "dead message-prefix recipe still advertised in $copy (#624)"
    fi
    grep -qF 'SKIP_VERSION_CHECK=1 git commit' "$copy" || fail "env-var hint missing in $copy"
  done
}

@test "AC-450-02b: pre-commit and its npm mirror are byte-identical" {
  diff -q "$PRE_COMMIT_COPY" "$PRE_COMMIT_MIRROR"
}

@test "AC-450-03: anti-vacuity: the matcher rejects a copy without the env-var hint" {
  local tmp_fixture
  tmp_fixture="$(mktemp)"
  printf '#!/bin/sh\nOr use --no-verify (discouraged) or include [skip-version-check] in commit message.\n' > "$tmp_fixture"
  if grep -qF 'SKIP_VERSION_CHECK=1 git commit' "$tmp_fixture"; then
    rm -f "$tmp_fixture"
    fail "matcher accepted a copy lacking the env-var hint"
  fi
  rm -f "$tmp_fixture"
}
