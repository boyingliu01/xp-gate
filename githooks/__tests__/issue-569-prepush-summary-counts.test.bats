#!/usr/bin/env bats
# @test REQ-599
# @intent The pre-push report carried three summary numbers that were not
#         measurements (#569):
#
#             gates_total:  8      <- a literal, while the list carried 12 gates
#             gates_passed: 0 or 1 <- the verdict squashed to an integer
#             score:        10.0 or 0.0
#
#         A reader asking "how many of the gates passed?" could not answer from
#         the report, and the total disagreed with the number of gate entries in
#         the same document. These cases pin that both counts are derived from the
#         gate list itself, so they cannot drift from it again, and that the
#         report can distinguish passed / failed / warned / skipped.
# @covers AC-599-11
bats_require_minimum_version 1.5.0

setup() {
  SCORE="$BATS_TEST_DIRNAME/../lib/prepush-score.py"
  PRE_PUSH="$BATS_TEST_DIRNAME/../pre-push"
  TEST_DIR="$BATS_TEST_TMPDIR/work"
  mkdir -p "$TEST_DIR"
  cd "$TEST_DIR" || return 1
  for c in python python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'pass' >/dev/null 2>&1; then
      PY="$c"
      break
    fi
  done
  [ -n "${PY:-}" ] || skip "no working python interpreter"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Write a report whose gate list is the twelve pre-push gates, with the given
# statuses applied positionally. Missing entries default to SKIP.
make_report() {
  local statuses="$1" rest="$1" i=1 st
  local ids="MP 10 M M-Python M-Go M-Java M-Kotlin M2 ML UI MW S"
  {
    printf '{\n  "overall": {},\n  "gates": [\n'
    for id in $ids; do
      st="SKIP"
      if [ -n "$rest" ]; then
        st="${rest%%|*}"
        if [ "$rest" = "$st" ]; then rest=""; else rest="${rest#*|}"; fi
      fi
      printf '    {"id": "%s", "status": "%s"}%s\n' "$id" "$st" \
        "$([ "$i" -lt 12 ] && echo , || echo )"
      i=$((i + 1))
    done
    printf '  ]\n}\n'
  } > "$TEST_DIR/report.json"
}

field_of() {
  "$PY" -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))['overall']
print(json.dumps(d[sys.argv[2]]))
" "$TEST_DIR/report.json" "$1"
}

@test "AC-599-11: the scorer fills gates_total and gates_passed (anti-vacuity)" {
  [ -f "$SCORE" ]
  make_report "PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS"
  "$PY" "$SCORE" --report "$TEST_DIR/report.json"

  [ "$(field_of gates_total)" = "12" ] || { echo "got: $(field_of gates_total)"; return 1; }
  [ "$(field_of gates_passed)" = "12" ] || { echo "got: $(field_of gates_passed)"; return 1; }
}

@test "AC-599-11: gates_total equals the number of gates the report lists" {
  # The literal said 8 while the document listed 12. They must agree by
  # construction, so count the list rather than trusting either number.
  make_report "PASS|PASS|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|PASS"
  local listed
  listed=$("$PY" -c "
import json, sys
print(len(json.load(open(sys.argv[1], encoding='utf-8'))['gates']))
" "$TEST_DIR/report.json")
  "$PY" "$SCORE" --report "$TEST_DIR/report.json"

  [ "$(field_of gates_total)" = "$listed" ] || {
    echo "report lists $listed gates but claims $(field_of gates_total)"
    return 1
  }
}

@test "AC-599-11: gates_passed counts passing gates, not the verdict" {
  # The old field was 1 if the verdict was PASS else 0. Four passing gates among
  # a majority must report 4.
  make_report "PASS|PASS|PASS|PASS|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP"
  "$PY" "$SCORE" --report "$TEST_DIR/report.json"

  [ "$(field_of gates_passed)" = "4" ] || {
    echo "expected 4 passing gates, got $(field_of gates_passed)"
    return 1
  }
}

@test "AC-599-11: a run with no passing gate reports zero, not one-for-PASS" {
  make_report "FAIL|FAIL|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP"
  "$PY" "$SCORE" --report "$TEST_DIR/report.json"

  [ "$(field_of gates_passed)" = "0" ] || { echo "got: $(field_of gates_passed)"; return 1; }
}

@test "AC-599-11: passed, failed, warned and skipped are each reported separately" {
  # A reader must be able to tell "2 warnings" from "2 skips" from the data.
  make_report "PASS|PASS|FAIL|WARN|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP"
  "$PY" "$SCORE" --report "$TEST_DIR/report.json"

  [ "$(field_of gates_passed)" = "2" ] || { echo "got: $(field_of gates_passed)"; return 1; }
  [ "$(field_of gates_failed)" = "1" ] || { echo "got: $(field_of gates_failed)"; return 1; }
  [ "$(field_of gates_warned)" = "1" ] || { echo "got: $(field_of gates_warned)"; return 1; }
  [ "$(field_of gates_skipped)" = "8" ] || { echo "got: $(field_of gates_skipped)"; return 1; }
}

@test "AC-599-11: the failed gate ids are named, not just counted" {
  make_report "PASS|PASS|FAIL|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP"
  "$PY" "$SCORE" --report "$TEST_DIR/report.json"

  [ "$(field_of failed_gates)" = '["M"]' ] || {
    echo "expected the failing gate id, got $(field_of failed_gates)"
    return 1
  }
}

@test "AC-599-11: the hook no longer hardcodes gates_total or squashes gates_passed" {
  run grep -c "gates_total': 8" "$PRE_PUSH"
  [ "$output" -eq 0 ] || { echo "the literal 8 is still there"; return 1; }

  run grep -c "gates_passed': passed" "$PRE_PUSH"
  [ "$output" -eq 0 ] || { echo "gates_passed is still the squashed verdict"; return 1; }

  # And the hook must actually invoke the scorer, or the placeholders stay None.
  run grep -c "prepush-score" "$PRE_PUSH"
  [ "$output" -ge 1 ]
}

@test "AC-599-11: the hook's own journal carries measured counts end to end" {
  # The cases above exercise prepush-score.py directly, which cannot catch a hook
  # that still writes a literal: the scorer would overwrite it and they would stay
  # green. This case runs the hook's REAL write_pre_push_report() and reads the
  # journal it leaves behind.
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  echo seed > README.md
  git add README.md
  git commit --no-verify -q -m seed

  cat > "$TEST_DIR/run.sh" <<'RUN'
#!/usr/bin/env bash
set -u
cd "$1" || exit 1
# The hook resolves prepush-score.py relative to BASH_SOURCE, so the extracted
# function must be sourced from a file that sits where the real hook sits —
# otherwise the lookup fails for a harness reason and the case measures the
# harness. Write it beside githooks/lib/.
HOOK_DIR=$(dirname "$2")
cp "$HOOK_DIR/../pre-push" /dev/null 2>/dev/null || true
sed -n '/^write_pre_push_report() {$/,/^}$/p' "$2" > "$HOOK_DIR/.report_fn_$$.sh"
export PATH="$3:$PATH"
# Globals the hook sets before it can write a report.
CURRENT_BRANCH=test-branch
REMOTE=origin
URL=test-url
export CURRENT_BRANCH REMOTE URL
# Three gates passed, one failed, the rest skipped: a majority, so the score is
# real and the counts must reflect the list rather than the verdict.
GATE_MP_STATUS=PASS GATE_10_STATUS=PASS GATE_M_STATUS=PASS GATE_M_PY_STATUS=FAIL
export GATE_MP_STATUS GATE_10_STATUS GATE_M_STATUS GATE_M_PY_STATUS
# shellcheck disable=SC1090
source "$HOOK_DIR/.report_fn_$$.sh"
write_pre_push_report 0
rc=$?
rm -f "$HOOK_DIR/.report_fn_$$.sh"
[ "$rc" -eq 0 ] || exit "$rc"
find .xp-gate/reports/pre-push -name '*.json' | head -1
RUN
  chmod +x "$TEST_DIR/run.sh"

  local journal
  journal=$(bash "$TEST_DIR/run.sh" "$TEST_DIR" "$PRE_PUSH" "$(dirname "$SCORE")")
  [ -n "$journal" ] || { echo "the hook wrote no journal"; return 1; }

  # gates_total must equal the twelve entries the journal itself lists, and
  # gates_passed must be 3 -- not 1-for-PASS.
  local listed passed total
  listed=$("$PY" -c "
import json, sys
print(len(json.load(open(sys.argv[1], encoding='utf-8'))['gates']))
" "$journal")
  passed=$("$PY" -c "
import json, sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['overall']['gates_passed'])
" "$journal")
  total=$("$PY" -c "
import json, sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['overall']['gates_total'])
" "$journal")

  [ "$total" = "$listed" ] || {
    echo "journal lists $listed gates but claims gates_total=$total"
    return 1
  }
  [ "$passed" = "3" ] || {
    echo "expected gates_passed=3, journal says $passed"
    return 1
  }
}
