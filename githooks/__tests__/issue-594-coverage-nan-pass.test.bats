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
# @covers AC-601-01, AC-601-02, AC-601-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"

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
  git add src/b.ts coverage/coverage-summary.json
}

# Run the hook. The fixture stages no test file, so the hook takes its full-suite
# path and the coverage threshold is really evaluated.
run_full_suite_hook() {
  run .git/hooks/pre-commit
}

@test "AC-601-01: a NaN coverage percentage is never reported as a pass" {
  # istanbul's real "Unknown" shape, not a hand-made NaN literal: this is the
  # input that produced the bug in the field.
  stage_bad_coverage '"Unknown"'

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
  stage_bad_coverage '"Unknown"'

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
  stage_bad_coverage '42'

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
  stage_bad_coverage '95'

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
