#!/usr/bin/env bats
# @test REQ-601
# @intent A coverage percentage that computes to NaN was reported as a PASS.
#
#         The TypeScript arm read the report with
#             console.log(Math.round(data.total.lines.pct))
#         and guarded the result with `!= "parse_error"` and `-n`. Both guards
#         pass when the value is the STRING "NaN", because Math.round() does not
#         fail on a non-numeric input — it returns NaN and prints it:
#             $ node -e 'console.log(Math.round("Unknown"))'
#             NaN
#         istanbul emits "Unknown" for a file with no executable lines, and a
#         subset run can leave `total` unusable, so this is reachable.
#
#         The second half is bash: `[ "NaN" -lt 80 ]` is not false, it is an
#         ERROR (exit 2) that prints "integer expression expected". An `if` only
#         distinguishes zero from non-zero, so the error took the else branch —
#         the PASS branch. Observed in the wild:
#             TypeScript coverage: NaN% ✅ (≥ 80%)
#             pre-commit: line 3041: [: NaN: integer expression expected
#         A ✅ and a bash error on adjacent lines, and the verdict was the ✅.
#
#         This is the same claim the project already enforces elsewhere (#449,
#         #499, #570): with no evidence you may not claim success. Gate 8 reports
#         SKIP when gitleaks produces no report for exactly this reason.
# @covers AC-601-01, AC-601-02, AC-601-03, AC-821-01, AC-821-02
#
#         AC-821-* live here because they need THIS fixture: the same hook copy,
#         the same TS project, the same stubbed runner. A second file would mean a
#         second copy of the ~90-line setup, and duplicate fixture bodies are what
#         the clone gates exist to prevent.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  # #798: this suite COPIES the hook into .git/hooks and EXECUTES it, so it needs
  # the whole hook, not a gate entry (an entry only defines gate_5_run()). The
  # content it greps lives in Gate 5's body, read separately via GATE_5.
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  GATE_5="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"

  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR" || return 1
  git init -q -b feature/coverage-nan .
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks

  mkdir -p .git/hooks/lib
  cp "$PRE_COMMIT" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  cp "$REPO_ROOT/githooks/adapter-common.sh" .git/hooks/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/hook-module-resolution.sh" .git/hooks/ 2>/dev/null || true
  for f in "$REPO_ROOT"/githooks/lib/*; do [ -f "$f" ] && cp "$f" .git/hooks/lib/; done
  # #798: pre-commit is a preamble + driver + epilogue; the gate bodies are
  # sourced from gate-entries/. A fixture without them runs the preamble and
  # then executes no gate at all, so every verdict assertion below would fail
  # for a reason unrelated to the NaN handling this suite is about.
  cp "$REPO_ROOT/githooks/gate-driver.sh" .git/hooks/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/gate-registry.sh" .git/hooks/ 2>/dev/null || true
  cp -r "$REPO_ROOT/githooks/gate-entries" .git/hooks/ 2>/dev/null || true
  cp -r "$REPO_ROOT/githooks/adapters" .git/hooks/ 2>/dev/null || true

  # Minimal TS project
  echo '{ "name": "nan-fixture", "private": true }' > package.json
  echo "0.0.1" > VERSION
  echo "# Changelog" > CHANGELOG.md
  echo init > README.md
  echo "ignore: []" > .archlint.yaml
  mkdir -p src
  cat > tsconfig.json <<'EOF'
{ "compilerOptions": { "strict": true } }
EOF
  # Gate 1 type-checks a TS project, and this fixture has no node_modules, so the
  # stub keeps Gate 1 from blocking before the coverage section runs. The stub is
  # the point of the case: like the jscpd/pytest stubs elsewhere in this directory,
  # the tool is stubbed rather than assumed (#497).
  mkdir -p bin
  cat > bin/npx <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *"vitest --version"*) exit 0 ;;
  *"tsc"*) exit 0 ;;
  *"vitest run --coverage"*)
    mkdir -p coverage
    # Leave the report the test wrote in place: the case supplies it.
    exit 0 ;;
  *"vitest run"*) exit 0 ;;
esac
exit 0
STUB
  chmod +x bin/npx
  export PATH="$TEST_DIR/bin:$PATH"
  echo "export const a = 1;" > src/a.ts
  git add -A
  git commit -q --no-verify -m init
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Write a coverage-summary.json whose total.lines.pct is not a usable number, and
# stage a source change so the coverage section runs.
#
# Deliberately does NOT stage a test file: the hook switches to a SUBSET run as
# soon as a changed test file exists, and every "cannot measure" path then takes
# its warn-only branch — which hides the NaN defect this issue is about. The
# source file carries @no-test-required so Gate 5a lets it through; this case is
# about the coverage verdict, not about pairing.
stage_bad_coverage() {
  local pct_json="$1"
  mkdir -p coverage
  printf '{"total":{"lines":{"pct":%s},"statements":{"pct":90},"functions":{"pct":90},"branches":{"pct":90}}}\n' \
    "$pct_json" > coverage/coverage-summary.json
  cat > src/b.ts <<'EOF'
// @no-test-required: fixture file, this case asserts the coverage verdict
export const b = 2;
EOF
  # `git add` FAILED silently here: the fixture inherits the repo's
  # `.gitignore` via `init.templateDir`/excludes, and `coverage/` is on it
  # (.gitignore:127), so the coverage report never reached the index. Gate 5 then
  # saw no evidence and skipped, and all three verdict cases failed for a reason
  # that had nothing to do with NaN handling. `-f` stages it deliberately: the
  # artefact IS the input under test. Verified: without -f, git reports
  # "The following paths are ignored ... coverage".
  git add src/b.ts
  git add -f coverage/coverage-summary.json
  # Anti-vacuity: the case is meaningless if the input never landed.
  git diff --cached --name-only | grep -qx 'coverage/coverage-summary.json' || {
    echo "fixture bug: the coverage report was not staged"
    return 1
  }
}

# Run the hook. The fixture stages no test file, so the hook takes its full-suite
# path and the coverage threshold is really evaluated.
run_full_suite_hook() {
  run .git/hooks/pre-commit
}

# #823: the state Gate 5 itself calls "nothing to measure" -- a shell file, which
# no adapter claims as a test or a source file. Gate 5 prints
# "No test or source files changed, skipping test run." and no coverage report is
# produced, because no runner ran.
stage_untestable_change() {
  # The real repo declares `typescript iac`. That is NOT incidental to this bug:
  # with only one language, an early arm handles the run and the TS coverage arm
  # below is never reached, so the case would pass without exercising the reported
  # failure at all. The two-language declaration is what reproduces it.
  cat > .xp-gate-config.json <<'EOF'
{ "version": 1, "languages": { "typescript": { "name": "TypeScript" }, "iac": { "name": "IaC" } } }
EOF
  mkdir -p githooks
  printf '#!/usr/bin/env bash\n# fixture: a comment-only edit\n:\n' > githooks/fixture-comment-only.sh
  git add githooks/fixture-comment-only.sh .xp-gate-config.json
  # Anti-vacuity: if the file were ignored, the fixture would stage nothing, Gate 5
  # would take its docs-only short-circuit at the OUTER guard, and the case would
  # pass without ever reaching the branch under test.
  git diff --cached --name-only | grep -qx 'githooks/fixture-comment-only.sh' || {
    echo "fixture bug: the comment-only shell file was not staged"
    return 1
  }
  [ ! -f coverage/coverage-summary.json ] || {
    echo "fixture bug: a coverage report exists, the absence is the whole premise"
    return 1
  }
}

# #823 control: a change that DOES have something to measure, but which produces no
# report. This is #570's protected case and must keep blocking.
stage_testable_change_without_report() {
  # The adapter probes node_modules/.bin for a runner before anything runs. Without
  # one it prints "No test runner installed locally" and Gate 5 takes the
  # TESTS_SKIPPED branch -- the case would then pass for the WRONG reason (no
  # runner) instead of the one under test (a runner ran, no report was written).
  # The stub is deliberately silent about coverage: it runs, writes nothing, and
  # that absence is the input.
  mkdir -p node_modules/.bin
  cat > node_modules/.bin/vitest <<'STUB'
#!/bin/sh
case "$*" in
  *--coverage*) exit 0 ;;
esac
exit 0
STUB
  chmod +x node_modules/.bin/vitest

  cat > src/d.ts <<'EOF'
// @no-test-required: fixture file, this case asserts the missing-report verdict
export const d = 4;
EOF
  git add src/d.ts
  git diff --cached --name-only | grep -qx 'src/d.ts' || {
    echo "fixture bug: the source file was not staged"
    return 1
  }
  rm -f coverage/coverage-summary.json coverage/coverage-final.json
}

@test "AC-601-01: a NaN coverage percentage is never reported as a pass" {
  # istanbul's real "Unknown" shape, not a hand-made NaN literal: this is the
  # input that produced the bug in the field.
  stage_bad_coverage || return 1

  run_full_suite_hook
  local out="$output"

  [[ "$out" != *"TypeScript coverage: NaN% ✅"* ]] || {
    echo "a NaN percentage was reported as a pass:"
    printf '%s\n' "$out" | grep -E 'NaN|coverage' | head -5
    return 1
  }
  [[ "$out" != *"integer expression expected"* ]] || {
    echo "bash rejected the comparison, so the threshold never ran:"
    printf '%s\n' "$out" | grep -E 'integer expression' | head -3
    return 1
  }
}

@test "AC-601-02: an unmeasurable percentage blocks instead of passing" {
  stage_bad_coverage || return 1

  run_full_suite_hook
  local out="$output"

  # The same verdict the #570 "cannot measure" path gives: no evidence, no pass.
  [[ "$out" == *"BLOCKED"* ]] || {
    echo "an unmeasurable coverage did not block:"
    printf '%s\n' "$out" | grep -E 'coverage|Coverage' | head -6
    return 1
  }
  [ "$status" -ne 0 ] || {
    echo "the hook exited 0 although coverage could not be measured"
    return 1
  }
}

@test "AC-601-03: a genuinely low percentage is still blocked, not mistaken for NaN" {
  # The control: a real number below the floor must reach the threshold branch and
  # BLOCK. Without this, "block on NaN" could be satisfied by blocking everything.
  stage_bad_coverage || return 1

  run_full_suite_hook
  local out="$output"

  [[ "$out" == *"42%"* ]] || {
    echo "the measured 42% never reached the report:"
    printf '%s\n' "$out" | grep -E 'coverage' | head -5
    return 1
  }
  [[ "$out" == *"BLOCKED"* ]] || {
    echo "42% did not block below the 80% floor"
    return 1
  }
}

@test "AC-601-03: a genuinely high percentage still passes" {
  # The other control: 95% must report a pass with the real threshold. If the fix
  # made the arm always block, this goes red.
  stage_bad_coverage || return 1

  run_full_suite_hook
  local out="$output"

  [[ "$out" == *"95%"* ]] || {
    echo "the measured 95% never reached the report:"
    printf '%s\n' "$out" | grep -E 'coverage' | head -5
    return 1
  }
  [[ "$out" != *"BLOCKED"* ]] || {
    echo "95% was blocked; the threshold branch is inverted"
    return 1
  }
}

# Leave a coverage report in the working tree WITHOUT staging it, and stage a
# change that starts no test run. This is the #821 shape: the report is a leftover
# from someone's earlier local run and describes a tree that has nothing to do
# with this commit.
leave_unstaged_coverage() {
  local pct_json="$1"
  mkdir -p coverage
  printf '{"total":{"lines":{"pct":%s},"statements":{"pct":90},"functions":{"pct":90},"branches":{"pct":90}}}\n' \
    "$pct_json" > coverage/coverage-summary.json
  # A .ts change, not markdown: a docs-only commit short-circuits Gate 5 at the
  # outer `DOCS_ONLY_COMMIT` guard, so the code under test here would never run
  # and the case would "pass" by never reaching it. `@no-test-required` keeps
  # Gate 5a's pairing rule quiet, and no test file is staged, so the suite run is
  # skipped — which is exactly the state the evidence flag decides.
  cat > src/c.ts <<'EOF'
// @no-test-required: fixture file, this case asserts the coverage evidence rule
export const c = 3;
EOF
  git add src/c.ts
  # Anti-vacuity in the OTHER direction: the report must really be present on
  # disk and really absent from the commit. Without the second half this case
  # would also pass if the fixture simply failed to write the file.
  [ -f coverage/coverage-summary.json ] || {
    echo "fixture bug: the leftover coverage report was not written"
    return 1
  }
  if git diff --cached --name-only | grep -qx 'coverage/coverage-summary.json'; then
    echo "fixture bug: the leftover coverage report was staged"
    return 1
  fi
}

@test "AC-821-01: a leftover uncommitted coverage report is not evidence about this commit" {
  # Measured 2026-11-16 in this repo: a commit staging ONE test file under the
  # bundled mirror was blocked with
  #     ❌ BLOCKED - TypeScript coverage 2% below 78% threshold
  # while the identical commit passed once the leftover coverage/ directory was
  # gone. The number came from a previous run over a DIFFERENT tree, and the
  # working tree also carried another workstream's uncommitted source. A gate
  # that answers "how well is this commit tested" may not answer with a
  # measurement of whatever happens to be lying around.
  leave_unstaged_coverage || return 1

  run_full_suite_hook
  local out="$output"

  [[ "$out" != *"BLOCKED"* ]] || {
    echo "a leftover, uncommitted coverage report blocked the commit:"
    printf '%s\n' "$out" | grep -E 'coverage|BLOCKED' | head -6
    return 1
  }
  # Not blocking is only half of it: the gate must take the SKIP branch and say
  # so, rather than silently evaluating a number it did not commit to.
  [[ "$out" == *"skipping coverage check"* ]] || {
    echo "the coverage check neither blocked nor announced a skip:"
    printf '%s\n' "$out" | grep -E 'coverage|Coverage' | head -6
    return 1
  }
}

@test "AC-821-02: a coverage report that IS part of the commit is still evidence" {
  # The control guarding #601: the artefact being staged is exactly the case that
  # issue set out to honour ("a staged 42% never reached the threshold"). Scoping
  # evidence to the commit must not weaken that.
  stage_bad_coverage || return 1

  run_full_suite_hook
  local out="$output"

  [[ "$out" == *"BLOCKED"* ]] || {
    echo "a staged 42% coverage report no longer blocks (#601 regressed):"
    printf '%s\n' "$out" | grep -E 'coverage|BLOCKED' | head -6
    return 1
  }
}

@test "AC-823-01: a commit with nothing testable in it is not blocked for missing coverage" {
  # Measured 2026-11-16 while committing a comment-only fix to a gate script:
  # Gate 5 printed BOTH of these in the same run --
  #     ✅ PASSED - No test or source files changed, skipping test run.
  #     ℹ️  No TypeScript tests were selected — no TS coverage to evaluate.
  # -- and then blocked with
  #     ❌ BLOCKED - coverage/coverage-summary.json not found.
  # The gate had already established there was nothing to measure, and then
  # demanded a measurement anyway. `PARTIAL_TEST_RUN` covers "some tests ran", not
  # "no tests were selected", so a commit touching only a shell comment could not
  # be landed without either a version bump (Gate 0) or a fabricated report.
  stage_untestable_change

  run_full_suite_hook
  local out="$output"

  [[ "$out" != *"coverage-summary.json not found"* ]] || {
    echo "a commit with no testable change was blocked for a missing report:"
    printf '%s\n' "$out" | grep -E 'No test|coverage|BLOCKED' | head -6
    return 1
  }
  [[ "$out" != *"BLOCKED"* ]] || {
    echo "a commit with no testable change was blocked:"
    printf '%s\n' "$out" | grep -E 'BLOCKED' | head -4
    return 1
  }
}

@test "AC-823-02: a testable change with no coverage report is STILL blocked" {
  # The control. The failure mode this guards against is "no tests were selected"
  # being read as a licence to skip coverage universally -- that would turn
  # "delete coverage/coverage-summary.json" back into an off switch, which is
  # exactly what #570 closed. A source change that DID run tests must still block
  # when no report was produced.
  stage_testable_change_without_report

  run_full_suite_hook
  local out="$output"

  [[ "$out" == *"coverage-summary.json not found"* ]] || {
    echo "a testable change with no coverage report no longer blocks (#570 regressed):"
    printf '%s\n' "$out" | grep -E 'No test|coverage|BLOCKED' | head -6
    return 1
  }
}
