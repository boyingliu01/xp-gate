#!/usr/bin/env bats
# @test REQ-494
# @intent Gate 5 的 smart selection 不能把 vitest 根项目收集不到的镜像路径当目标：
#         vitest.config.ts 把 src/npm-package/<子树>/ 整批排除（与 src/ 下同名文件字节
#         一致的镜像，#418），门禁却照样传给 vitest —— 目标全部不可收集时 vitest 报
#         "No test files found" 退出 1，Gate 5 把它读成"测试失败"，于是只改镜像的提交
#         被误 BLOCK（#494）。本套件从随包 pre-commit 里抽出该过滤函数并**执行**，
#         再与 vitest.config.ts 的 exclude 列表对账，防止两份列表各自漂移。
# @covers AC-494-01, AC-494-02, AC-494-03, AC-494-04, AC-494-05

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export REPO_ROOT
}

# Pull the function definition out of a shipped pre-commit and define it here,
# so the test runs production text rather than a transcription of it.
load_selector() {
  local src="${1:-$REPO_ROOT/githooks/pre-commit}"
  local body
  body=$(awk '/^select_root_suite_targets\(\)[[:space:]]*\{/{flag=1} flag{print} flag&&/^\}$/{exit}' "$src")
  if [ -z "$body" ]; then
    echo "EXTRACTION-EMPTY: no select_root_suite_targets() in $src" >&2
    return 91
  fi
  eval "$body"
}

@test "AC-494-01: a mirrored test path is mapped to the canonical file the root suite can collect" {
  load_selector || return 1

  run select_root_suite_targets "src/npm-package/mutation/__tests__/gate-m.test.ts"
  [ "$status" -eq 0 ]
  [ "$output" = "src/mutation/__tests__/gate-m.test.ts" ]

  run select_root_suite_targets $'src/npm-package/principles/__tests__/a.test.ts\nsrc/mutation/__tests__/b.test.ts'
  [ "$status" -eq 0 ]
  [[ "$output" == *"src/principles/__tests__/a.test.ts"* ]]
  [[ "$output" == *"src/mutation/__tests__/b.test.ts"* ]]
}

@test "AC-494-02: paths the root suite does collect are left untouched" {
  load_selector || return 1

  # src/npm-package/lib holds tests that exist nowhere else -- mapping or
  # dropping them would delete real coverage.
  run select_root_suite_targets "src/npm-package/lib/__tests__/doctor.test.js"
  [ "$status" -eq 0 ]
  [ "$output" = "src/npm-package/lib/__tests__/doctor.test.js" ]

  run select_root_suite_targets ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# A dropped target must not leave a blank line behind: the caller counts lines to
# pick the strategy, and an empty element turns "no target" into "one target".
@test "AC-494-03: uncollectable targets without a canonical twin are dropped cleanly" {
  load_selector || return 1

  run select_root_suite_targets $'src/npm-package/plugins/qoder/skills/x.test.ts\nsrc/npm-package/skills/y.test.ts'
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  # Both sides of a mirror pair collapse to one target, not two identical runs.
  run select_root_suite_targets $'src/mutation/__tests__/gate-m.test.ts\nsrc/npm-package/mutation/__tests__/gate-m.test.ts'
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  [ "${lines[0]}" = "src/mutation/__tests__/gate-m.test.ts" ]
}

@test "AC-494-04: every source-tree the root project excludes is handled" {
  load_selector || return 1
  cfg="$REPO_ROOT/vitest.config.ts"
  [ -f "$cfg" ]

  # Only the test-level exclude block (it comes first; coverage.exclude is a
  # different list about reporting, not about what can be collected).
  block=$(awk '/^    exclude: \[/{f=1;next} f&&/^    \]/{exit} f' "$cfg")
  [ -n "$block" ] || { echo "no test exclude block found in vitest.config.ts" >&2; return 1; }

  # Probe the committable source trees only: .worktrees/, dist/, node_modules/ and
  # friends are VCS or build artefacts that never arrive through git diff.
  prefixes=$(printf '%s\n' "$block" \
    | grep -oE "'(src|plugins|skills)(/[A-Za-z0-9._-]+)*/\*\*'" \
    | tr -d "'" | sed 's|/\*\*$|/|' | sort -u)
  [ -n "$prefixes" ] || { echo "vitest.config.ts excludes no committable source tree" >&2; return 1; }
  probed=0
  for prefix in $prefixes; do
    probe="${prefix}__tests__/sample.test.ts"
    run select_root_suite_targets "$probe"
    [ "$status" -eq 0 ]
    # Whatever survives must be collectable by the root project: nothing from an
    # excluded tree may stay selectable as a target.
    if [[ "$output" == "$prefix"* ]]; then
      echo "excluded tree still selectable: $probe -> $output" >&2
      return 1
    fi
    probed=$((probed + 1))
  done
  # Anti-vacuity: the guard must have walked a real set of exclusions.
  [ "$probed" -ge 8 ]
}

@test "AC-494-05: anti-vacuity -- every shipped copy defines the selector and Gate 5 calls it" {
  cd "$REPO_ROOT" || return 1
  copies=0
  for f in $(git ls-files 'githooks/pre-commit' 'src/npm-package/hooks/pre-commit'); do
    grep -q '^select_root_suite_targets()' "$f" || { echo "no selector in $f" >&2; return 1; }
    # Defining it is not enough: both selection sites must route through it.
    [ "$(grep -c 'select_root_suite_targets "$CHANGED_TEST_FILES"\|select_root_suite_targets "$CHANGED_SRC_FILES"' "$f")" -ge 2 ] \
      || { echo "selector defined but never applied in $f" >&2; return 1; }
    copies=$((copies + 1))
  done
  [ "$copies" -ge 2 ]
}
