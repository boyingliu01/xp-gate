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
PRE_COMMIT_COPY="$REPO_ROOT/githooks/gate-entries/gate-0-entry.sh"
# #798: the hint text lives in Gate 0's body, not in the pre-commit preamble.
# Both the canonical and the shipped copy are read at their entry path.
PRE_COMMIT_MIRROR="$REPO_ROOT/src/npm-package/hooks/gate-entries/gate-0-entry.sh"

@test "AC-450-01: the hint names the env var as the escape hatch" {
  local text
  text=$(cat "$PRE_COMMIT_COPY")
  echo "$text" | grep -qF 'SKIP_VERSION_CHECK=1 git commit'
  # The hint must describe the exemptions the gate ACTUALLY applies. It used to
  # be pinned to the literal "adapters/, scripts/, hooks/" -- which went stale
  # the moment #806 added gate-entries/ and the skill tooling, and then failed
  # for a hint that was MORE correct than the assertion. Pin the invariant
  # instead of one snapshot of the prose: every exempt directory named in the
  # gate's case-list must also be named in the hint.
  echo "$text" | grep -q "adapters/"
  echo "$text" | grep -q "gate-entries/"
  echo "$text" | grep -q "build-tooling-only"
}

@test "AC-450-01b: the hint names every build-tooling path the whitelist exempts" {
  # Anti-drift check, and the reason AC-450-01 no longer hardcodes one list: if
  # the case-list grows an exemption and the hint is not updated, the operator
  # reads a narrower rule than the gate enforces.
  #
  # The hint is isolated first, and that is not incidental: a naive
  # `grep "gate-entries/"` over the whole file always succeeds, because the
  # comments and the case-list itself contain those strings. That version of
  # this test was written, then falsified by deleting the term from the hint
  # alone -- it stayed GREEN, which is this repo's recurring failure mode: an
  # assertion that passes for a reason unrelated to what it claims to check.
  local text hint whitelist
  text=$(cat "$PRE_COMMIT_COPY")
  # The hint block starts at the build-tooling sentence and runs to the blank
  # line before the SKIP_VERSION_CHECK paragraph.
  hint=$(echo "$text" | grep -A2 "^Build-tooling-only changes")
  [ -n "$hint" ] || fail "the build-tooling hint block is missing entirely"
  whitelist=$(echo "$text" | grep -o 'src/npm-package/adapters/\*|[^)]*')

  for token in "adapters/" "gate-entries/" "scripts/" "hooks/"; do
    echo "$whitelist" | grep -q "$token" || fail "expected '$token' in the exemption whitelist"
    echo "$hint" | grep -qF "$token" || fail "whitelist exempts '$token' but the HINT never mentions it (hint: $hint)"
  done
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
