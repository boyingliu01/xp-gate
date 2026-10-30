#!/usr/bin/env bats
#
# @test REQ-668 断言债务必须区分"本次引入"与"存量"，并在阻断消息里标注
# @intent Gate 5d 只检查 diff 范围内的**文件**，不是 diff 范围内的**行**。
#         这个区别造成了一次错误的因果归因：有人改 `writeReport()` 的错误处理，
#         却被同文件里存在数月的 4 处 `expect(true).toBe(true)` 拦下，看起来像是
#         他自己引入的。
#
#         这个 bug 最贵的部分不是那次误阻断，而是它教给人的习惯：归因噪音让人倾向
#         加 `@assertion-justified` 而不是真修掉。**一个让人更愿意豁免的门禁，
#         比没有门禁更糟。**
#
#         所以修复要求两件事分开报：新引入的 BLOCK，存量的 WARN 且明说"不是你引入的"。
#         只做"少报"很容易（直接不报存量），但那会让债务永远不可见——所以还有
#         `xp-gate audit assertions` 作为批次清理入口。
#
# @covers AC-668-01, AC-668-02
#
# ASCII only: the classifier under test matches punctuation-heavy EREs, and a
# non-ASCII byte in this file has broken the fixture pipeline before.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

# --- helper unit tests -------------------------------------------------------

@test "AC-668-01: a line inside an added hunk counts as new" {
  run bash -c "
    source '$REPO_ROOT/githooks/lib/assertion-quality.sh'
    assertion_line_is_new f 5 '3-7' && echo NEW || echo OLD
  "
  [ "$status" -eq 0 ]
  [ "$output" = "NEW" ]
}

@test "AC-668-01: a line outside every added hunk counts as pre-existing" {
  run bash -c "
    source '$REPO_ROOT/githooks/lib/assertion-quality.sh'
    assertion_line_is_new f 9 '3-7' && echo NEW || echo OLD
  "
  [ "$status" -eq 0 ]
  [ "$output" = "OLD" ]
}

@test "AC-668-01: a file with no added lines makes every finding pre-existing" {
  # A rename-only or mode-only change adds no lines; nothing in it can be 'introduced'.
  run bash -c "
    source '$REPO_ROOT/githooks/lib/assertion-quality.sh'
    assertion_line_is_new f 1 '' && echo NEW || echo OLD
  "
  [ "$status" -eq 0 ]
  [ "$output" = "OLD" ]
}

@test "AC-668-01: multiple hunks are all honoured, not just the first" {
  run bash -c "
    source '$REPO_ROOT/githooks/lib/assertion-quality.sh'
    assertion_line_is_new f 20 '1-2 18-25' && echo NEW || echo OLD
  "
  [ "$status" -eq 0 ]
  [ "$output" = "NEW" ]
}

# --- the hook must label the two cases differently ---------------------------

@test "AC-668-02: the hook distinguishes introduced from pre-existing in its messages" {
  # The whole point of #668 is the LABEL. A fix that blocks silently, or that warns
  # without saying "not yours", leaves the false attribution intact.
  run grep -c 'PRE-EXISTING' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  [ "$output" -ge 2 ]

  run grep -c 'added by this change' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  [ "$output" -ge 2 ]
}

@test "AC-668-02: the pre-existing path points at the batch-cleanup command" {
  # Without a pointer to `audit assertions`, a WARN is just noise with a nicer word.
  run grep -c 'xp-gate audit assertions' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# --- the audit command makes debt visible ------------------------------------

@test "AC-668-01: audit assertions lists standing debt across the repo" {
  cd "$REPO_ROOT" || return 1
  run node src/npm-package/bin/xp-gate.js audit assertions --json
  [ "$status" -eq 0 ]
  # Must be valid JSON a batch fixer can consume, not a prose report.
  run node -e "
    const d = JSON.parse(process.argv[1]);
    if (typeof d.summary.total !== 'number') { console.error('missing total'); process.exit(1); }
    if (!Array.isArray(d.files)) { console.error('missing files'); process.exit(1); }
    console.log('ok');
  " "$output"
  [ "$output" = "ok" ]
}

@test "AC-668-02: audit assertions exits 0 even when debt exists" {
  # Advisory by design: a debt list that fails builds becomes a number people learn
  # to ignore, and then it stops being read at all.
  cd "$REPO_ROOT" || return 1
  run node src/npm-package/bin/xp-gate.js audit assertions
  [ "$status" -eq 0 ]
}
