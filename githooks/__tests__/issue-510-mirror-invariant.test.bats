#!/usr/bin/env bats
# @test REQ-510
# @intent 钉住 #509 引入的安全不变量：pre-commit 的早退判定必须基于
#         RAW_CHANGED_FILES（未过滤暂存清单），而镜像前缀 ^src/npm-package/
#         只允许有一处定义。若未来重构把早退改成使用过滤后的 CHANGED_FILES，
#         纯镜像提交将命中 "No files changed. Skipping gates." 直接 exit 0，
#         Gate 8（fail-closed 密钥扫描）被整体跳过——安全旁路静默回归。
# @covers AC-510-01 AC-510-02 AC-510-03 AC-510-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT_COPY="$REPO_ROOT/githooks/pre-commit"
  # /tmp (POSIX-style): a Windows drive-letter mktemp path trips the sandboxed
  # rm shim in teardown (same workaround as gate-8.test.bats).
  export TMPDIR=/tmp
  FIXTURE_REPO="$(mktemp -d)"
  (
    cd "$FIXTURE_REPO" || exit 1
    git init -q
    git config user.email test@test.com
    git config user.name Test
    git config core.hooksPath .git/hooks
    echo seed > README.md
    git add README.md
    git commit -q -m seed
    # The ONLY staged change is under the mirror prefix.
    mkdir -p src/npm-package/lib
    echo "export const mirror = 1;" > src/npm-package/lib/mirror.js
    git add src/npm-package/lib/mirror.js
  )
}

teardown() {
  # `|| true`: sandboxed environments shim rm into rejecting drive-letter
  # paths; a failed cleanup must not fail an otherwise-passing test.
  rm -rf "$FIXTURE_REPO" 2>/dev/null || true
}

# The real list-computation block, taken out of the live hook at run time.
# A restructure that moves or renames it makes the extraction empty, which
# fails here rather than quietly testing nothing.
changed_lists_block() {
  awk '/^MIRROR_PATH_FILTER=/,/^fi$/ {print}' "$PRE_COMMIT_COPY"
}

#   $1 = optional sed transform to simulate a bad refactor
run_changed_lists() {
  (
    set -u
    cd "$FIXTURE_REPO" || exit 90
    block=$(changed_lists_block)
    [ -n "$block" ] || { echo "EXTRACTION-EMPTY"; exit 91; }
    eval "$(printf '%s\n' "$block" | sed "$1")"
    echo "EARLY-EXIT-DID-NOT-FIRE raw=[$RAW_CHANGED_FILES] changed=[$CHANGED_FILES]"
  )
}

@test "AC-510-01: the mirror prefix is defined exactly once in pre-commit" {
  count=$(grep -c '^MIRROR_PATH_FILTER=' "$PRE_COMMIT_COPY")
  [ "$count" -eq 1 ]
}

@test "AC-510-01: no consumer keeps its own inline mirror-prefix literal" {
  # The old duplicated definition sites: a grep -v with the literal regex.
  if grep -n "grep -v '\^src/npm-package/'" "$PRE_COMMIT_COPY"; then
    echo "inline mirror-prefix literal still present (must use \$MIRROR_PATH_FILTER)" >&2
    return 1
  fi
  # ...and both consumers must reference the hoisted variable.
  grep -q 'grep -v "$MIRROR_PATH_FILTER"' "$PRE_COMMIT_COPY"
  grep -q 'MIRROR_EXCLUDE="$MIRROR_PATH_FILTER"' "$PRE_COMMIT_COPY"
}

@test "AC-510-02: mirror-only commit keeps RAW list non-empty (gates still run)" {
  run run_changed_lists ""
  [ "$status" -eq 0 ]
  [[ "$output" == *"EARLY-EXIT-DID-NOT-FIRE"* ]]
  [[ "$output" == *"raw=[src/npm-package/lib/mirror.js]"* ]]
  [[ "$output" == *"changed=[]"* ]]
}

@test "AC-510-03: the early exit keys on RAW, not the filtered list (mutation check)" {
  # Simulate exactly the regression #510 warns about: re-keying the early
  # exit on the filtered corpus. With a mirror-only index this MUST hit
  # "No files changed. Skipping gates." -- proving the fixture is genuinely
  # mirror-only and that our passing test above would flip red on the bug.
  run run_changed_lists 's/if \[ -z "\$RAW_CHANGED_FILES" \]/if [ -z "$CHANGED_FILES" ]/'
  [ "$status" -eq 0 ]
  [[ "$output" == *"No files changed. Skipping gates."* ]]
  [[ "$output" != *"EARLY-EXIT-DID-NOT-FIRE"* ]]
}

@test "AC-510-03 anti-vacuity: the extraction is the real list block" {
  block=$(changed_lists_block)
  [ "$(printf '%s\n' "$block" | wc -l)" -ge 8 ]
  printf '%s\n' "$block" | grep -q '^MIRROR_PATH_FILTER='
  printf '%s\n' "$block" | grep -q '^RAW_CHANGED_FILES='
  printf '%s\n' "$block" | grep -q '^CHANGED_FILES='
  printf '%s\n' "$block" | grep -q 'exit 0'
}

@test "AC-510-04: gate-8 scans unconditionally -- no gate-8 copy reads the filtered list" {
  cd "$REPO_ROOT" || return 1
  for f in $(git ls-files 'gate-8*.sh' '*/gate-8*.sh'); do
    if grep -q 'CHANGED_FILES' "$f"; then
      echo "gate-8 copy references CHANGED_FILES (path-gated secret scan): $f" >&2
      return 1
    fi
  done
}
