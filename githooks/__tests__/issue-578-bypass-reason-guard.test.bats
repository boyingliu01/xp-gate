#!/usr/bin/env bats
# @test REQ-599
# @intent The UI-gate bypass in pre-push promises "min 10 non-whitespace chars" and
#         writes an audit entry. Both live inside the same `if` condition, and that
#         condition used `${#XP_GATE_BYPASS_REASON// /}` — an illegal bash
#         expansion (`${#var//pat/rep}` stacks length and substitution). bash
#         raises `bad substitution` for the whole line, so NEITHER branch runs:
#         the guard never blocks, and the audit entry is never written. Net effect:
#         `XP_GATE_SKIP_UI_GATES=1` with an empty or one-character reason skipped
#         Gate UI silently and left no trace (#578).
#
#         These cases pin the CONTRACT, not the spelling: an empty reason and a
#         too-short reason must both BLOCK, a real reason must pass AND be
#         audited, and the block must never surface a bash "bad substitution".
# @covers AC-599-01, AC-599-02
bats_require_minimum_version 1.5.0

setup() {
  PRE_PUSH="$BATS_TEST_DIRNAME/../pre-push"
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  # The bypass block appends to .audit-log.jsonl and calls `git rev-parse HEAD`,
  # so the fixture needs to be a real repository with a commit.
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  git config core.hooksPath .git/hooks
  echo seed > README.md
  git add README.md
  git commit --no-verify -q -m seed
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# The shipped bypass block, extracted from the real hook at run time.
#
# The extraction must yield a COMPLETE, parseable shell construct. An earlier
# draft of this test cut the block at `else` and dropped that line, which left an
# unterminated `if` — `eval` reported "unexpected end of file from `if' command"
# to stderr and ran NOTHING, while the harness happily printed VERDICT=PASS. Five
# cases looked like they were measuring the guard and were measuring nothing. The
# `bash -n` check below makes that failure mode impossible: the block is proven
# parseable before any case relies on it.
ui_bypass_block() {
  awk '/^if \[\[ "\$XP_GATE_SKIP_UI_GATES" == "1" \]\]; then$/,/^else$/ {print}' "$PRE_PUSH" \
    | sed '$d'
  # Re-close the branch we just cut open.
  printf '%s\n' 'fi'
}

# Run just the bypass branch with a given reason.
#   $1  XP_GATE_BYPASS_REASON value
# Prints the branch's stdout, and the script exit code via $status.
run_bypass() {
  local block
  block=$(ui_bypass_block)
  [ -n "$block" ] || { echo "EXTRACTION-EMPTY"; return 91; }
  # Anti-vacuity: an unbalanced extraction must fail here, not silently no-op.
  printf '%s\n' "$block" > "$WORK/block.sh"
  bash -n "$WORK/block.sh" 2> "$WORK/blk.err" \
    || { echo "EXTRACTION-UNPARSEABLE: $(cat "$WORK/blk.err")"; return 92; }
  # And it must actually contain the branch it claims to test.
  grep -q 'XP_GATE_BYPASS_REASON required' "$WORK/block.sh" \
    || { echo "EXTRACTION-MISSING-GUARD"; return 93; }
  (
    set -u
    cd "$WORK" || exit 90
    XP_GATE_SKIP_UI_GATES=1
    XP_GATE_BYPASS_REASON="$1"
    CURRENT_BRANCH="main"
    # `set -e` in the harness would let a silently-skipped block look like a pass;
    # instead the block runs and its own `exit 1` propagates.
    eval "$block"
    echo "VERDICT=PASS"
  )
}

@test "AC-599-01: an EMPTY bypass reason must block and never reach the else branch" {
  # MEASURED NUANCE: `[[ -z "$VAR" || <bad expansion> ]]` short-circuits, so the
  # empty case was in fact still blocked by the broken guard — the `-z` half is
  # true and bash never evaluates the illegal part. This case therefore passes on
  # both the broken and the fixed code; it is a contract lock, not the
  # anti-vacuity case. The cases that actually pin the defect are the two below,
  # where the reason is non-empty and only the illegal expansion decides.
  run run_bypass ""

  [ "$status" -ne 0 ]
  [[ "$output" == *"XP_GATE_BYPASS_REASON required"* ]]
  [[ "$output" != *"VERDICT=PASS"* ]]
  # A bash parse/expansion error would mean the guard never evaluated.
  [[ "$output" != *"bad substitution"* ]]
}

@test "AC-599-01: a ONE-CHARACTER bypass reason must block (min 10 non-whitespace)" {
  run run_bypass "x"

  [ "$status" -ne 0 ]
  [[ "$output" == *"XP_GATE_BYPASS_REASON required"* ]]
  [[ "$output" != *"VERDICT=PASS"* ]]
  [[ "$output" != *"bad substitution"* ]]
}

@test "AC-599-01: whitespace does not count toward the 10-character minimum" {
  # "   a   b  " is 10 characters but only 2 non-whitespace ones.
  run run_bypass "   a   b  "

  [ "$status" -ne 0 ]
  [[ "$output" == *"XP_GATE_BYPASS_REASON required"* ]]
  [[ "$output" != *"VERDICT=PASS"* ]]
}

@test "AC-599-02: a real reason passes the guard AND writes an audit entry" {
  # The audit entry is in the same branch as the guard, so a broken guard silently
  # loses the audit trail too. Asserting both together is what makes that visible.
  run run_bypass "emergency hotfix for the payment outage"

  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT=PASS"* ]]
  [[ "$output" == *"UI Gate BYPASSED"* ]]
  [ -f .audit-log.jsonl ]
  grep -q "emergency hotfix for the payment outage" .audit-log.jsonl
  grep -q '"bypass_type":"ui-gates"' .audit-log.jsonl
}

@test "AC-599-02: a blocked bypass leaves NO audit entry" {
  # The mirror of the case above: failing closed must not look like it succeeded.
  run run_bypass "too short"

  [ "$status" -ne 0 ]
  [ ! -f .audit-log.jsonl ]
}
