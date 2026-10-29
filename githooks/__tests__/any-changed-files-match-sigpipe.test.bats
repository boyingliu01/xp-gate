#!/usr/bin/env bats
# @intent 钉住 any_changed_files_match 在 set -o pipefail 下不得把"匹配"读成"不匹配"。
#         `printf | grep -q` 会在 grep 命中后让 printf 吃 SIGPIPE，管道返回 141，
#         于是 `if` 走进"无匹配"分支 —— 这直接让 Gate 1 打印
#         "No code files changed, skipping lint"，而 Gate 2 读同一个变量却能扫到文件。
#         这个 bug 一直是尺寸相关的：列表短时正常，长时才翻车，所以 CI 的 first-commit
#         fixture（暂存 19 个 .sh）会撞上，真实项目反而不一定。

setup() {
  HOOK="$BATS_TEST_DIRNAME/../pre-commit"
}

extract_fn() {
  # Pull the function body out of the hook so the test exercises the shipped
  # implementation, not a paraphrase of it.
  sed -n '/^any_changed_files_match() {/,/^}/p' "$HOOK"
}

@test "AC-649-08: a long changed-file list still reports a match under pipefail" {
  eval "$(extract_fn)"
  CHANGED_FILES=$(seq 1 20000 | sed 's|^|githooks/adapters/f|;s|$|.sh|')

  # The regression: this returned 1 (no match) with the old `printf | grep -q`.
  run bash -c "set -o pipefail; $(extract_fn); CHANGED_FILES=\$(seq 1 20000 | sed 's|^|githooks/adapters/f|;s|\$|.sh|'); any_changed_files_match '\.(ts|sh)\$'"
  [ "$status" -eq 0 ]
}

@test "AC-649-09: no match is still reported as no match (anti-vacuity)" {
  # A predicate that always returns 0 would pass AC-649-08 and silently turn
  # every gate on. The "no" answer has to stay honest.
  eval "$(extract_fn)"
  CHANGED_FILES="docs/readme.md
LICENSE"

  run bash -c "set -o pipefail; $(extract_fn); CHANGED_FILES='docs/readme.md
LICENSE'; any_changed_files_match '\.(ts|tsx|js)\$'"
  [ "$status" -ne 0 ]
}

@test "AC-649-10: the hook no longer pipes printf into grep -q for this predicate" {
  # Pins the construct, not just the behaviour: `printf ... | grep -q` is the
  # shape that breaks, so it must not creep back.
  ! grep -qE "printf '%s\\n' \"\\$CHANGED_FILES\" \| grep -q" "$HOOK"
  grep -q 'grep -qE -- "$pattern" <<< "$CHANGED_FILES"' "$HOOK"
}
