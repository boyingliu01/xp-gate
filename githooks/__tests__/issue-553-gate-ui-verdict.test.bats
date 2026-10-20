#!/usr/bin/env bats
# @test REQ-553 Gate UI verdict integrity
# @intent Verify the UI gate cannot report "no UI changes" when it never got a
#         verdict. #553: jq -r on empty input prints nothing and exits 0, so the
#         `|| echo "false"` fallback was unreachable, IS_UI_SPRINT was the empty
#         string, and a push touching only src/ui/streamlit_app.py was told "No
#         UI changes detected — skipping UI Gate". A missing detector produced
#         an affirmative "nothing to review" verdict, which is the exact failure
#         the gate exists to prevent, inverted.
# @covers AC-553-01

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PREPUSH="$REPO_ROOT/githooks/pre-push"

@test "anti-vacuity: the UI gate block still exists" {
  grep -q 'IS_UI_SPRINT' "$PREPUSH"
  grep -q 'ui-detector.ts' "$PREPUSH"
}

@test "the empty verdict is not silently treated as 'not a UI sprint'" {
  # The fingerprint: a bare jq -r with a `|| echo "false"` fallback. jq exits 0
  # on empty input, so that fallback never runs and "" flows into the comparison.
  run bash -c "grep -nE \"jq -r '\\.isUiSprint' 2>/dev/null \\|\\| echo \\\"false\\\"\" '$PREPUSH'"
  [ "$status" -ne 0 ]
}

@test "the detector's exit status is captured" {
  grep -q 'UI_DETECT_EXIT' "$PREPUSH"
}

@test "an unknown verdict falls back to a UI path check, not to 'no UI changes'" {
  grep -q 'UI_PATH_HITS\|UI_UNKNOWN\|IS_UI_SPRINT="unknown"' "$PREPUSH"
}

@test "jq really does exit 0 on empty input (the premise of this issue)" {
  # Pinning the tool behaviour keeps a future 'fix' from re-introducing the
  # fallback pattern on the assumption that jq fails on empty input.
  run bash -c 'printf "" | jq -r ".isUiSprint" 2>/dev/null; echo "exit=$?"'
  [ "$output" = "exit=0" ]
}

@test "an unknown verdict with UI-looking paths blocks" {
  # Simulate the decision logic: unknown + a UI path must not take the skip path.
  run bash -c '
    IS_UI_SPRINT="unknown"
    PUSHED_FILES="src/ui/streamlit_app.py"
    if [ "$IS_UI_SPRINT" = "unknown" ]; then
      UI_PATH_HITS=$(echo "$PUSHED_FILES" | grep -Ei "(^|/)(src/ui|ui|components|pages|views)/|[.](tsx|jsx|vue|svelte|css|scss)$" || true)
      if [ -n "$UI_PATH_HITS" ]; then echo BLOCK; else echo SKIP; fi
    else
      echo other
    fi
  '
  [ "$output" = "BLOCK" ]
}
