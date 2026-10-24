#!/usr/bin/env bats
# @test REQ-580
# @intent A pre-push run must never write a journal that LOOKS complete but
#         answers none of the questions it exists for.
#
#         #569 moved the score rule into githooks/lib/prepush-score.py. When that
#         file was missing, the hook only WARNED and carried on, so the journal
#         came out as
#             {"score": null, "gates_run": null, "gates_skipped": null, ...}
#         — a written document, no error, and no measurement inside it. Measured
#         on the issue-580 fixture, which installs the hook but not the scorer:
#             null|undefined|undefined|PASS
#         A reader (a dashboard, `xp-gate retro`, a human) cannot tell that from a
#         run that genuinely had nothing to summarise.
#
#         "No scorer" means the summary was never computed, not that the run had
#         nothing to summarise. It must fail closed and say how to repair.
# @covers AC-580-04
bats_require_minimum_version 1.5.0

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-push"
  WORK="$(mktemp -d)"
  cd "$WORK" || return 1
  git init -q -b feature/no-scorer .
  git config user.email test@example.com
  git config user.name Test
  mkdir -p .git/hooks
  cp "$HOOK" .git/hooks/pre-push
  chmod +x .git/hooks/pre-push
  cp "$REPO_ROOT/githooks/adapter-common.sh" .git/hooks/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/hook-module-resolution.sh" .git/hooks/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/lib/validate-code-walkthrough.cjs" .git/hooks/lib/ 2>/dev/null || true
  # Deliberately NOT installing lib/prepush-score.py: that is the condition.

  mkdir -p bin
  for t in jscpd gitleaks lizard semgrep checkov hadolint; do
    printf '#!/bin/bash\nexit 0\n' > "bin/$t"
    chmod +x "bin/$t"
  done
  export PATH="$WORK/bin:$PATH"

  echo init > README.md
  git add . >/dev/null 2>&1
  git -c core.hooksPath=.git/hooks commit -q --no-verify -m init
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# Run the hook and capture its stderr separately from the journal.
run_hook_no_scorer() {
  local sha stdin_file
  sha="$(git rev-parse HEAD)"
  stdin_file="$WORK/stdin.txt"
  printf 'refs/heads/feature/no-scorer %s refs/heads/feature/no-scorer %s\n' \
    "$sha" "0000000000000000000000000000000000000000" > "$stdin_file"
  GATE_MP_STATUS=PASS GATE_M_STATUS=PASS GATE_10_STATUS=PASS \
    .git/hooks/pre-push origin https://example.com < "$stdin_file" 2>&1 || true
}

@test "AC-580-04: a missing scorer is reported as an error, not a warning" {
  run run_hook_no_scorer
  [[ "$output" == *"prepush-score.py not found"* ]] || {
    echo "the hook did not mention the missing scorer: $output"
    return 1
  }
  # And it must be the fail-closed message, not the old advisory one.
  [[ "$output" == *"cannot compute the score"* ]] || {
    echo "the missing scorer is still reported as advisory: $output"
    return 1
  }
  [[ "$output" == *"doctor --sync-hooks"* ]] || {
    echo "the message must say how to repair it: $output"
    return 1
  }
}

@test "AC-580-04: no journal is published claiming a measurement that never happened" {
  # The defect's actual damage was not the warning text: it was the journal. With
  # no scorer the hook wrote
  #     {"score": null, "gates_run": null, "gates_skipped": null, "verdict": "PASS"}
  # and a reader cannot tell that apart from a run with nothing to summarise.
  # Measured on the issue-580 fixture before the fix: `null|undefined|undefined|PASS`.
  run run_hook_no_scorer

  local f
  f="$(ls -1t .xp-gate/reports/pre-push/*.json 2>/dev/null | head -n1)"
  [ -n "$f" ] || {
    # The fix refuses early, so no journal at all. That is the honest outcome and
    # is what case 1 forbids regressing; nothing to inspect here.
    echo "no journal written at all (fail-closed before writing) — nothing to mislead"
    return 0
  }

  # If a journal IS written it must not pretend to carry a measurement.
  node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const o = j.overall || {};
    if (o.score !== null && o.score !== undefined) {
      console.error("a journal was written with score=" + o.score + " although no scorer ran");
      process.exit(1);
    }
    if (o.gates_run !== null && o.gates_run !== undefined) {
      console.error("a journal claims gates_run=" + o.gates_run + " although no scorer ran");
      process.exit(1);
    }
    console.error(
      "a journal exists and carries no measurement (score/gates_run null) — " +
      "that is the shape this case exists to forbid; the hook must fail closed instead"
    );
    process.exit(1);
  ' "$f"
}

@test "AC-580-04: with the scorer present the same run does compute a score (control)" {
  # The control case: the error above must come from the MISSING FILE, not from
  # this fixture being unable to score at all. Without it, the case above would
  # pass for the wrong reason.
  mkdir -p .git/hooks/lib
  cp "$REPO_ROOT/githooks/lib/prepush-score.py" .git/hooks/lib/ 2>/dev/null || skip "scorer not present"

  run run_hook_no_scorer
  [[ "$output" != *"cannot compute the score"* ]] || {
    echo "the hook still refuses to score with the scorer installed: $output"
    return 1
  }

  local f
  f="$(ls -1t .xp-gate/reports/pre-push/*.json 2>/dev/null | head -n1)"
  [ -n "$f" ] || { echo "no journal was written"; return 1; }

  local ran
  ran=$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String((j.overall || {}).gates_run));
  ' "$f")
  [ "$ran" != "null" ] && [ "$ran" != "undefined" ] && [ "$ran" -ge 1 ] 2>/dev/null || {
    echo "the journal carries gates_run=[$ran] despite the scorer being installed"
    return 1
  }
}
