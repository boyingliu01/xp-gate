#!/usr/bin/env bats
# @test REQ-AUDIT-CLOCK-005
# @intent 两个审计条目报告重叠的时间，会让任何"这次提交的分钟花在哪了"的分析重复计数。
#
#         门禁链的计时报告（scripts/gate-timing-report.cjs）把每个 gate 的 duration_ms
#         当作互不重叠的成本。Gate 5 内部记录了三条审计：tests-coverage、test-focus、
#         focus-override —— 而 test-focus 曾经把 GATE_5_START 当作自己的起点。
#         于是它那条记录的时长是"Gate 5 从开始到此刻的全部工作"，不是这次检查的成本。
#
#         实测 2026-11-23：test-focus 16 个样本，中位 44.4s —— 而同一段代码的注释写着
#         这项检查"应当在毫秒内失败"。44 秒不是它慢，是它把别人的时间算成了自己的。
#
#         本测试钉住的是：test-focus / focus-override 必须有自己的时钟。
#         证伪方式：把 GATE_5_FOCUS_START 改回 GATE_5_START，本测试的第一个用例失败。
# @covers AC-AUDIT-CLOCK-005

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE5="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
}

# AC-AUDIT-CLOCK-005a: the focus check takes its own start reading.
@test "AC-AUDIT-CLOCK-005a: test-focus has its own start clock, not Gate 5's" {
  [ -f "$GATE5" ]
  run grep -q 'GATE_5_FOCUS_START=$(gate_start_ms)' "$GATE5"
  [ "$status" -eq 0 ] || { echo "test-focus does not take its own start reading"; return 1; }

  # The reading must be taken BEFORE the check starts, not after it finishes.
  local focus_line start_line
  focus_line=$(grep -n 'GATE_5_FOCUS_START=$(gate_start_ms)' "$GATE5" | head -1 | cut -d: -f1)
  start_line=$(grep -n 'GATE_5_FOCUS_BLOCKED=0' "$GATE5" | head -1 | cut -d: -f1)
  [ -n "$focus_line" ] && [ -n "$start_line" ] || { echo "anchors missing"; return 1; }
  [ "$focus_line" -le "$start_line" ] || {
    echo "start reading is taken after the check begins ($focus_line > $start_line)"
    return 1
  }
}

# AC-AUDIT-CLOCK-005b: every gate-5-internal audit row uses its own clock.
@test "AC-AUDIT-CLOCK-005b: no gate-5 sub-audit reports Gate 5's whole elapsed time" {
  # tests-coverage is the ONLY row entitled to GATE_5_START -- it is the gate.
  local offenders
  offenders=$(grep -n 'record_gate_audit "gate-5' "$GATE5" \
    | grep 'GATE_5_START' \
    | grep -v 'record_gate_audit "gate-5" ' || true)
  [ -z "$offenders" ] || {
    echo "sub-audit rows still billed with Gate 5's start (overlapping durations):"
    echo "$offenders"
    return 1
  }
}

# AC-AUDIT-CLOCK-005c: the gate's own row still uses GATE_5_START.
@test "AC-AUDIT-CLOCK-005c: the tests-coverage row still measures the whole gate" {
  # The fix must not overshoot: the gate's own duration is legitimately the full
  # span, so replacing THAT with a sub-clock would understate the gate.
  run grep -q 'record_gate_audit "gate-5" "tests-coverage" "$GATE_5_STATUS" "0" "$GATE_5_START"' "$GATE5"
  [ "$status" -eq 0 ] || { echo "tests-coverage no longer measures the whole gate"; return 1; }
}
