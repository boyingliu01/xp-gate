#!/usr/bin/env bats
# @test REQ-580
# @intent Every pre-push run writes a JSON journal to
#         `.xp-gate/reports/pre-push/<timestamp>.json` for `xp-gate audit` and
#         `xp-gate retro`. Each entry carries a per-gate `status` and a summary
#         `score`.
#
#         The score was:
#
#             'score': '10.0/10' if '$verdict' == 'PASS' else '0.0/10',
#
#         a restatement of the verdict, not a measurement. When every gate SKIPs
#         (docs-only push, no supported language, missing tools) the run reports
#         `0.0/10` — which reads as "every gate failed", a claim about the code
#         that was never tested. The honest reading is "nothing was measured".
#
#         Two distinct states were collapsed into one number:
#           - gates ran, some failed   -> a low score is TRUE and useful
#           - gates all skipped        -> there is no score; the journal must say so
#
#         A reader (dashboards, retros, a human skimming) cannot recover the
#         difference from `0.0/10`, which is why the fix is `None` rather than 0:
#         the field is absent/null and the reader is forced to consult `verdict`
#         and `gates_skipped`.
#
#         Pin: the score must be computed from gates that actually ran, and be
#         null when none did.
# @covers AC-580-01, AC-580-02, AC-580-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-push"
  WORK="$(mktemp -d)"
}

teardown() {
  rm -rf "$WORK"
}

# Extract the score-computation statement from the hook and run it over the given
# gate-status list, printing what would be journaled.
#
# The hook assigns the score in two stages (a `None` placeholder inside the report
# literal, then the real value once the gate list exists), so the thing to extract
# is the computation, not the placeholder. It is recognised as the statement that
# assigns to `report['overall']['score']`.
run_score() {
  local statuses="$1"
  local expr
  # The computation spans several statements (`_ran = ...`, the score
  # assignment, and the gates_run / gates_skipped counters), so the whole block
  # from `_ran` through `gates_skipped` is taken, not just the score line.
  # Newlines are preserved: the block contains a multi-line conditional
  # expression, which is a syntax error if flattened onto one line.
  expr=$(awk "/^_ran = /,/gates_skipped'\] =/" "$HOOK")
  case "$expr" in
    *"report['overall']['score']"*) : ;;
    *)
      echo "NO_SCORE_EXPRESSION"
      return 1
      ;;
  esac
  # `python3` on Windows is often the Microsoft Store *stub* (`WindowsApps/
  # python3`), which exits non-zero without running anything. Use whichever
  # interpreter actually works; the logic under test is plain Python 3.
  local py
  py=$(command -v python3 2>/dev/null)
  if [ -z "$py" ] || ! "$py" -c 'import sys' >/dev/null 2>&1; then
    py=$(command -v python 2>/dev/null)
  fi
  [ -n "$py" ] || {
    echo "NO_PYTHON"
    return 1
  }
  "$py" - "$expr" "$statuses" << 'PY'
import sys

stmt = sys.argv[1]
statuses = [s for s in sys.argv[2].split(',') if s]


def score_for(status_list):
    # Build the same structures the hook has at that point in the script, then
    # execute the extracted statement against them. Nothing about the score
    # rules is restated here -- the hook's own code decides.
    report = {'overall': {'score': None},
              'gates': [{'status': s} for s in status_list]}
    scope = {'report': report, 'len': len, 'sum': sum}
    exec(stmt, scope)                                       # noqa: S102
    return report['overall']['score']


for verdict in ('PASS', 'BLOCKED'):
    try:
        value = score_for(statuses)
    except Exception as exc:                                    # noqa: BLE001
        print('%s -> EXPR_ERROR: %s' % (verdict, exc))
        continue
    print('%s -> %r' % (verdict, value))
PY
}

@test "AC-580-01: an all-SKIP run has no score, not 0.0/10" {
  # A docs-only push: every gate skips. There is nothing to score.
  run run_score "SKIP,SKIP,SKIP,SKIP"
  echo "$output"
  # Guard against the extraction itself failing: that would satisfy a bare
  # "is not 0.0/10" check for entirely the wrong reason.
  [[ "$output" != *"NO_SCORE_EXPRESSION"* ]] || {
    echo "could not locate the score expression in githooks/pre-push"
    return 1
  }
  [[ "$output" != *"EXPR_ERROR"* ]] || {
    echo "the score expression could not be evaluated"
    return 1
  }
  [[ "$output" != *"NO_PYTHON"* ]] || {
    echo "no working Python 3 interpreter found; this test cannot judge the score"
    return 1
  }
  [[ "$output" != *"'0.0/10'"* ]] || {
    echo "an all-SKIP run reported 0.0/10, which reads as 'every gate failed'"
    return 1
  }
  [[ "$output" == *"None"* ]] || {
    echo "an all-SKIP run should journal a null score; got: $output"
    return 1
  }
}

@test "AC-580-02: the score reflects gates that actually ran" {
  # Two PASS, two SKIP -> 10.0/10 (of what ran), not 5.0/10 and not 0.0.
  run run_score "PASS,PASS,SKIP,SKIP"
  echo "$output"
  [[ "$output" == *"10.0/10"* ]] || {
    echo "a run where every executed gate passed did not score 10.0/10"
    return 1
  }
}

@test "AC-580-03: a real failure still scores low" {
  # The fix must not make failures invisible: 1 PASS, 3 FAIL -> 2.5/10.
  run run_score "PASS,FAIL,FAIL,FAIL"
  echo "$output"
  [[ "$output" == *"2.5/10"* ]] || {
    echo "a run with real failures did not produce a low numeric score"
    return 1
  }
}
