#!/usr/bin/env bats
# @test REQ-554 gate status integrity
# @intent Gate 5 has two ways to end without running a test: the commit is
#         docs-only (already reported SKIP since #554) and the commit changes no
#         source file at all while still NOT being docs-only -- a version bump
#         touching VERSION + package.json + CHANGELOG + AGENTS.md is the common
#         shape. The second path sets TESTS_SKIPPED=true and the status
#         assignment that ends the else-branch then writes GATE_5_STATUS="PASS".
#
#         The result is a gate that measured nothing, recorded as a pass. It is
#         the same defect #554 fixed on the sibling branch, surviving because
#         #554's case only drove the docs-only path and its structural assertion
#         only banned an assignment OUTSIDE the branch (column 0). This one is
#         inside the branch, so it looked legitimate.
#
#         Measured on the v0.31.2.0 release commit itself: 44 files, no source
#         extension after the mirror filter, and the journal recorded
#         {"gate5_tests": {"status": "PASS"}} while the summary printed
#         "Gate 5: Tests + Coverage PASS (coverage: N/A%)".
# @covers AC-554-01 AC-554-02

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
HOOK="$REPO_ROOT/githooks/pre-commit"

setup() {
  WORK="$BATS_TEST_TMPDIR/nocode"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  git config core.hooksPath "$WORK/.git/hooks"
  # The hook blocks at Gate 6 without an architecture config, so the run would
  # never reach the report writer and the journal assertion would have nothing
  # to read. Pin the minimum that lets the pipeline finish.
  printf 'ignore:\n- "%s"\n' 'nothing/**' > .archlint.yaml
  echo seed > seed.ts
  git add seed.ts .archlint.yaml
  git commit --no-verify -q -m seed
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
}

# Run the real hook and keep its full output for assertions.
run_hook() {
  run bash -c "cd '$WORK' && bash '$HOOK' 2>&1"
}

@test "anti-vacuity: the no-source-file early-skip path still exists in the hook" {
  # If this path is ever removed the cases below would pass for the wrong reason.
  grep -q 'TESTS_SKIPPED=true' "$HOOK"
  grep -q 'No code files changed' "$HOOK"
}

@test "a commit that changes no source file does NOT record Gate 5 as PASS" {
  # The release-commit shape: a version bump plus docs. No .ts/.js/.sh changes,
  # so no test can run and no coverage can be measured -- but this is NOT a
  # docs-only commit, so the docs-only SKIP branch does not cover it.
  printf '0.0.2.0\n' > VERSION
  printf '{\n  "name": "x",\n  "version": "0.0.2.0"\n}\n' > package.json
  printf '# changelog\n' > CHANGELOG.md
  printf 'notes\n' > AGENTS.md
  git add VERSION package.json CHANGELOG.md AGENTS.md

  run_hook

  # The skip path must have been the one taken, otherwise this case is not
  # exercising the defect it names.
  grep -q 'No code files changed' <<<"$output" || {
    echo "the no-source-file branch did not run; hook output was:"; echo "$output"; return 1;
  }

  # The summary line must not claim PASS for a gate that ran no test.
  if grep -qE 'Gate 5: Tests \+ Coverage +PASS' <<<"$output"; then
    echo "summary claims PASS for an unmeasured gate:"; grep -E 'Gate 5: Tests' <<<"$output"; return 1
  fi

  # And the machine-readable verdict must not be PASS either. Assert on the
  # journal the hook actually wrote, not on a re-implementation.
  local report
  report=$(ls "$WORK"/.xp-gate/quality-status/*.json 2>/dev/null | head -1)
  [ -n "$report" ] || { echo "hook wrote no quality-status report; output tail:"; echo "$output" | tail -20; return 1; }
  run node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const g = r.gates.gate5_tests;
    if (!g) { console.error("no gates.gate5_tests in report"); process.exit(1); }
    if (g.status === "PASS") { console.error("unmeasured Gate 5 recorded as PASS: " + JSON.stringify(g)); process.exit(1); }
    console.log(g.status);
  ' "$report"
  [ "$status" -eq 0 ] || { echo "$output"; return 1; }
}

@test "the no-source-file path names its own skip reason in the journal" {
  printf '0.0.2.0\n' > VERSION
  printf '{\n  "name": "x",\n  "version": "0.0.2.0"\n}\n' > package.json
  git add VERSION package.json

  run_hook

  # "skipped" in the console is not enough: the coverage stage says "Test run
  # was skipped" on every no-code path, so that word cannot distinguish a gate
  # that deliberately stood down from one that silently returned. The detail has
  # to reach the machine-readable record, where #571 taught us not to trust a
  # rendering default.
  grep -q 'No code files changed' <<<"$output" || {
    echo "the no-source-file branch did not run; hook output was:"; echo "$output"; return 1;
  }

  local report
  report=$(ls "$WORK"/.xp-gate/quality-status/*.json 2>/dev/null | head -1)
  [ -n "$report" ] || { echo "hook wrote no quality-status report"; return 1; }
  run node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const g = r.gates.gate5_tests;
    if (!g) { console.error("no gates.gate5_tests in report"); process.exit(1); }
    const detail = g.reason || "";
    if (!/no_code|no_source/i.test(detail)) {
      console.error("Gate 5 skipped without recording why: " + JSON.stringify(g));
      process.exit(1);
    }
    console.log(detail);
  ' "$report"
  [ "$status" -eq 0 ] || { echo "$output" | tail -20; return 1; }
}
