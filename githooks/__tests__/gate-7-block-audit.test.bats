#!/usr/bin/env bats
#
# @test REQ-GATE7-BLOCK-AUDIT
# @intent A BLOCKED gate 7 wrote no audit row at all.
#
#         gate-7.sh ended like this:
#
#             ...
#             GATE_7_STATUS="FAIL"
#             exit 1                 <-- line 68
#             fi
#           ...
#           record_gate_audit ...    <-- line 76, UNREACHABLE when blocked
#
#         The journal line sat at the bottom of the file, past the only `exit` in
#         it. Measured by calling the arm directly with a stubbed recorder: on the
#         FAIL path the recorder was never invoked.
#
#         So the one outcome an operator most needs to find in the journal -- "gate
#         7 stopped this commit" -- was the single outcome that never got written,
#         while every PASS and SKIP recorded normally. `xp-gate rework` and the
#         gate-coverage report both read that journal.
#
#         The `exit` also violates the gate-body contract: bodies `return`, so the
#         driver keeps a single exit point and the EXIT trap fires with the same
#         status. Fixing the reachability and the contract are the same change.
#
#         Second defect in the same line: `issues_found` was the literal "0" on
#         EVERY path, including the blocked one, so even once reachable the row
#         would have claimed zero issues for a gate that had just refused the
#         commit.
#
# @covers AC-GATE7-BLOCK-AUDIT-01 AC-GATE7-BLOCK-AUDIT-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$REPO/githooks/gate-7.sh"
}

@test "AC-GATE7-BLOCK-AUDIT-01: no exit before the journal line" {
  # Locate the journal call and the blocked arm, and require that no `exit` in the
  # body precedes the call. A `return` is what the contract wants; an `exit`
  # skips everything after it, which is what happened here.
  local record_line exit_line
  record_line=$(grep -n 'record_gate_audit "gate-7"' "$SCRIPT" | head -1 | cut -d: -f1)
  [ -n "$record_line" ] || {
    echo "no record_gate_audit call for gate-7 in gate-7.sh"
    return 1
  }

  exit_line=$(grep -nE '^[[:space:]]*exit [0-9]+' "$SCRIPT" | head -1 | cut -d: -f1)
  if [ -n "$exit_line" ] && [ "$exit_line" -lt "$record_line" ]; then
    echo "a top-level exit at line $exit_line precedes the journal line $record_line:"
    echo "the blocked path never records, and the gate-body contract is violated"
    return 1
  fi

  # And the blocked arm must actually return non-zero, so the block survives.
  grep -qE '^[[:space:]]*return 1' "$SCRIPT" || {
    echo "the blocked arm no longer returns non-zero; gate 7 stopped blocking"
    return 1
  }
}

@test "AC-GATE7-BLOCK-AUDIT-02: the recorded issue count is not a hardcoded zero" {
  # The journal call must pass a variable, not the literal "0". A literal there
  # makes a blocked gate report zero findings.
  local call
  call=$(grep 'record_gate_audit "gate-7"' "$SCRIPT" | head -1)
  [[ "$call" != *'"0" "$GATE_7_START"'* ]] || {
    echo "gate-7 journals issues_found as the literal 0 on every path:"
    printf '  %s\n' "$call"
    return 1
  }
}

@test "AC-GATE7-BLOCK-AUDIT-02b: the blocked path records, end to end" {
  # Behavioural: drive the real decision with a stubbed adapter and recorder. The
  # adapter is what decides the exit status, so this exercises the actual arm
  # rather than grepping for it.
  local work="$BATS_TEST_TMPDIR/g7"
  mkdir -p "$work"
  # gate-7.sh derives IAC_FILES itself from `git diff --cached`, so the fixture
  # has to BE a repo with a staged .tf file -- assigning IAC_FILES beforehand
  # would be overwritten on line 12 of the body.
  git -C "$work" init -q -b gate7fixture
  printf 'resource "aws_s3_bucket" "b" { acl = "public-read" }\n' > "$work/main.tf"
  git -C "$work" -c user.email=t@t -c user.name=t -c commit.gpgsign=false \
    -c core.hooksPath= add main.tf
  cat > "$work/iac.sh" <<'ADAPTER'
run_static_analysis() {
  echo "  ERROR: public-read bucket detected"
  echo "  HIGH: open security group"
  return 1
}
ADAPTER

  cat > "$work/drive.sh" <<'DRIVER'
set -u
GATE_7_START=1
GATE_DIR="__WORK__"
SCRIPT_DIR="__WORK__"
HOME="__WORK__/nohome"
cd "__WORK__" || exit 9
record_gate_audit() { printf 'AUDIT %s %s %s %s\n' "$1" "$3" "$4" "$5"; }
gate_start_ms() { echo 1; }
run_gate() { . "$GATE_DIR/gate-7.sh"; }
run_gate
DRIVER
  sed -i "s|__WORK__|$work|g" "$work/drive.sh"
  mkdir -p "$work/nohome" "$work/adapters"
  cp "$work/iac.sh" "$work/adapters/iac.sh"
  # The body under test has to be present at GATE_DIR, which is also where the
  # adapter is resolved from (tier 3: ${SCRIPT_DIR}/adapters).
  cp "$SCRIPT" "$work/gate-7.sh"

  run bash "$work/drive.sh"
  # Non-zero: the block must survive.
  [ "$status" -ne 0 ] || {
    echo "the blocked path returned 0; gate 7 no longer blocks"
    printf '%s\n' "$output"
    return 1
  }
  [[ "$output" == *"AUDIT gate-7 FAIL"* ]] || {
    echo "the blocked path recorded no audit row; the journal line was unreachable"
    printf '%s\n' "$output"
    return 1
  }
  # And the count reflects the findings, not a hardcoded zero.
  [[ "$output" == *"AUDIT gate-7 FAIL 2"* ]] || {
    echo "expected issue count 2 from the two ERROR/HIGH lines, got:"
    printf '%s\n' "$output" | grep AUDIT
    return 1
  }
}