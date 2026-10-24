#!/usr/bin/env bats
# @test REQ-599
# @intent `overall.score` is the most quotable number in a pre-push report, so it
#         must generalise over the gates it claims to summarise. #580 made it a
#         measurement over the gates that actually ran and returned None when
#         NONE ran — but stopped at the zero-denominator edge. One gate passing
#         out of twelve still printed `10.0/10`:
#
#             12 gates: 11 SKIP, 1 PASS  ->  score: "10.0/10", verdict: PASS
#
#         That is the same false claim as the `0.0/10` the original comment warns
#         about, pointing the other way: 0.0 lied "everything broke", 10.0 lies
#         "everything is green". A reader quoting it into a PR reports a quality
#         level that was never measured (#577).
#
#         The rule these cases pin: a score is emitted only when the gates that
#         ran are a MAJORITY of the gates that exist. Below that the honest answer
#         is None ("not measured") — the same word the zero case already used.
#         `score_scope` always says how many gates the number covers, so a score
#         can never be read as global quality.
#
#         The rule lives in githooks/lib/prepush-score.py as a real executable
#         with a real interface, rather than as text embedded in the hook's
#         printf chain. The hook calls it; so do these cases. Each case below
#         runs the shipped script, so the assertions measure what runs in
#         production.
# @covers AC-599-08
bats_require_minimum_version 1.5.0

setup() {
  SCORE="$BATS_TEST_DIRNAME/../lib/prepush-score.py"
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

# Ask the shipped script for the score of an ordered gate list.
# Prints the JSON object it returns on stdout.
score_of() {
  local args=() st rest="$1"
  while [ -n "$rest" ]; do
    st="${rest%%|*}"
    if [ "$rest" = "$st" ]; then rest=""; else rest="${rest#*|}"; fi
    args+=(--status "$st")
  done
  "$PY" "$SCORE" "${args[@]}"
}

# Read one field out of the JSON printed by score_of.
field_of() {
  printf '%s' "$1" | "$PY" -c "
import json, sys
print(json.load(sys.stdin)[sys.argv[1]])
" "$2"
}

@test "AC-599-08: the scorer exists and answers for a full gate list (anti-vacuity)" {
  [ -f "$SCORE" ]
  out=$(score_of "PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS")

  [ "$(field_of "$out" score)" = "10.0/10" ] || { echo "got: $out"; return 1; }
  [ "$(field_of "$out" gates_total)" = "12" ] || { echo "got: $out"; return 1; }
}

@test "AC-599-08: 11 of 12 gates skipped must not produce a score" {
  # The exact shape from the issue: only Sprint Flow ran.
  out=$(score_of "SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|PASS")

  [ "$(field_of "$out" gates_run)" = "1" ] || { echo "got: $out"; return 1; }
  [ "$(field_of "$out" score)" = "None" ] || {
    echo "a run where 11 of 12 gates never executed was scored: $out"
    return 1
  }
}

@test "AC-599-08: a single passing gate is never worth 10.0/10" {
  out=$(score_of "SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|PASS")

  [[ "$out" != *"10.0/10"* ]] || {
    echo "one passing gate was summarised as full marks: $out"
    return 1
  }
}

@test "AC-599-08: no gate at all is still not measured" {
  out=$(score_of "SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP")

  [ "$(field_of "$out" gates_run)" = "0" ] || { echo "got: $out"; return 1; }
  [ "$(field_of "$out" score)" = "None" ] || { echo "got: $out"; return 1; }
  [[ "$(field_of "$out" score_scope)" == *"not measured"* ]] || { echo "got: $out"; return 1; }
}

@test "AC-599-08: a majority of gates running does produce a score" {
  # 7 of 12 ran and all passed -> the number generalises, so it is reported.
  out=$(score_of "PASS|PASS|PASS|PASS|PASS|PASS|PASS|SKIP|SKIP|SKIP|SKIP|SKIP")

  [ "$(field_of "$out" gates_run)" = "7" ] || { echo "got: $out"; return 1; }
  [ "$(field_of "$out" score)" = "10.0/10" ] || {
    echo "expected full marks once most gates ran: $out"
    return 1
  }
}

@test "AC-599-08: exactly half the gates running does not produce a score" {
  # Six of twelve is not a majority. The threshold is stated so it cannot be
  # moved silently to make a report look better.
  out=$(score_of "PASS|PASS|PASS|PASS|PASS|PASS|SKIP|SKIP|SKIP|SKIP|SKIP|SKIP")

  [ "$(field_of "$out" gates_run)" = "6" ] || { echo "got: $out"; return 1; }
  [ "$(field_of "$out" score)" = "None" ] || {
    echo "half the gates scored: $out"
    return 1
  }
}

@test "AC-599-08: a real failure among a majority still scores below full marks" {
  out=$(score_of "PASS|PASS|PASS|PASS|PASS|PASS|FAIL|SKIP|SKIP|SKIP|SKIP|SKIP")

  [ "$(field_of "$out" score)" = "8.6/10" ] || {
    echo "expected 6/7 = 8.6/10: $out"
    return 1
  }
}

@test "AC-599-08: the emitted scope names the gates the score covers" {
  out=$(score_of "PASS|PASS|PASS|PASS|PASS|PASS|PASS|SKIP|SKIP|SKIP|SKIP|SKIP")
  scope=$(field_of "$out" score_scope)

  [[ "$scope" == *"7"* ]] || { echo "scope does not name the 7 gates covered: $out"; return 1; }
  [[ "$scope" == *"12"* ]] || { echo "scope does not name the 12 total gates: $out"; return 1; }
}

@test "AC-599-08: --report patches the score fields into an existing report" {
  # The hook's own call shape: it already has the report dict on disk.
  cat > "$TEST_DIR/report.json" <<'JSON'
{
  "trigger": "pre-push",
  "overall": {"score": null, "gates_passed": 1, "verdict": "PASS"},
  "gates": [
    {"id": "MP", "status": "SKIP"}, {"id": "10", "status": "SKIP"},
    {"id": "M", "status": "SKIP"}, {"id": "M-Python", "status": "SKIP"},
    {"id": "M-Go", "status": "SKIP"}, {"id": "M-Java", "status": "SKIP"},
    {"id": "M-Kotlin", "status": "SKIP"}, {"id": "M2", "status": "SKIP"},
    {"id": "ML", "status": "SKIP"}, {"id": "UI", "status": "SKIP"},
    {"id": "MW", "status": "SKIP"}, {"id": "S", "status": "PASS"}
  ]
}
JSON

  "$PY" "$SCORE" --report "$TEST_DIR/report.json"

  score=$(field_of_at "$TEST_DIR/report.json" score)
  [ "$score" = "None" ] || { echo "the 11-of-12 report was scored $score"; return 1; }
  # Untouched fields survive.
  [ "$(field_of_at "$TEST_DIR/report.json" verdict)" = "PASS" ]
}

@test "AC-599-08: the hook calls the scorer instead of re-deriving the rule" {
  # A second copy of the rule in the hook would drift from the tested one.
  run grep -c "prepush-score" "$BATS_TEST_DIRNAME/../pre-push"

  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
  # And the old inline rule must be gone.
  run grep -c "10.0 \* sum(1 for g in _ran" "$BATS_TEST_DIRNAME/../pre-push"
  [ "$output" -eq 0 ]
}

# Read one field out of a report file's `overall` section.
field_of_at() {
  "$PY" -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))['overall']
print(d[sys.argv[2]])
" "$1" "$2"
}
