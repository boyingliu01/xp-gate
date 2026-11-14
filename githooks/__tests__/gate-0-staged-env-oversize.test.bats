#!/usr/bin/env bats
# @test REQ-809
# @intent gate-0 无条件 `export XP_STAGED_ACM=暂存清单`（#640 的 fork 缓存）。
#         Windows 单个环境变量上限 32767 字符；大 merge（494 文件 / 36752 字符）
#         超限后，pytest 继承该环境，syrupy 的 env_context 还原 os.environ 时
#         CPython 在 __setitem__ 抛 ValueError，Gate 5 误判 Tests FAILED。
#         修复按长度守卫导出：<=32767 才 export，否则 unset，让每个消费者已有的
#         `${XP_STAGED_ACM:-$(git diff --cached ...)}` 回退生效。
# @covers AC-809-01, AC-809-02, AC-809-03
#
# Why this needs its own test: the cache looks harmless -- it is "just" an env
# var. The signal it destroys is a Windows-native child's ability to manipulate
# its OWN environment. A normal small commit never surfaces the bug; only a list
# past 32767 chars does, and then it blocks a merge that should pass. Asserting
# the export ANSWER per length (and at the exact boundary) is what separates the
# cache from the poison. The guard lives in export_staged_acm_cache(), which
# gate_0_run calls, so these cases run the ACTUAL helper -- not a copied snippet:
# reverting the fix must fail here.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-entries/gate-0-entry.sh"
  # Sourcing only DEFINES gate_0_run + export_staged_acm_cache (the file has no
  # top-level call -- pre-commit's driver invokes gate_0_run), so it is
  # side-effect free. Start from a clean cache each case.
  source "$GATE"
  unset XP_STAGED_ACM
}

# Exactly N ASCII chars (chars == bytes == UTF-16 units, so the length the guard
# measures is the length Windows/CPython enforces). printf width avoids a huge
# seq arg list; tr turns the spaces into a non-whitespace payload.
n_chars() {
  printf '%*s' "$1" '' | tr ' ' 'a'
}

@test "AC-809-01: a normal small list IS exported as the #640 cache" {
  export_staged_acm_cache "src/App.java
src/B.java"
  [ "${XP_STAGED_ACM:-}" = "src/App.java
src/B.java" ]
  # exported => a child process actually inherits it (the cache is warm)
  run bash -c 'printf "%s" "${XP_STAGED_ACM:-}"'
  [ "$status" -eq 0 ]
  [ "$output" = "src/App.java
src/B.java" ]
}

@test "AC-809-02: an oversized list (>32767) is NOT exported -- consumers fall back" {
  export_staged_acm_cache "$(n_chars 32768)"
  # unset => the ${XP_STAGED_ACM:-$(git diff ...)} fallback in every consumer fires
  [ -z "${XP_STAGED_ACM:-}" ]
  run bash -c 'printf "%s" "${XP_STAGED_ACM:-UNSET}"'
  [ "$status" -eq 0 ]
  [ "$output" = "UNSET" ]
}

@test "AC-809-03: the boundary is EXACTLY 32767 -- 32767 exports, 32768 does not" {
  export_staged_acm_cache "$(n_chars 32767)"
  [ "${#XP_STAGED_ACM}" -eq 32767 ]
  run bash -c 'printf "%s" "${XP_STAGED_ACM:+SET}"'
  [ "$output" = "SET" ]

  export_staged_acm_cache "$(n_chars 32768)"
  [ -z "${XP_STAGED_ACM:-}" ]
  run bash -c 'printf "%s" "${XP_STAGED_ACM:-UNSET}"'
  [ "$output" = "UNSET" ]
}
