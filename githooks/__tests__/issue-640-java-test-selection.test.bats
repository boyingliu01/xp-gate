#!/usr/bin/env bats
# @intent #640: the Java arm of Gate 5 ran the FULL Maven/Gradle suite on every
#         commit (measured: 77.8s for 1079 tests regardless of what changed).
#         TypeScript (#286) and Python (#399) have had three-tier selection for
#         a long time; Java had no equivalent, and the PARTIAL_TEST_RUN
#         downgrade channel was dead code on that path. This suite pins the
#         Java selector's truth table and its path-convention lookup.
# @covers lib/java-test-selection.sh: select_java_test_strategy, java_is_test_file,
#         java_related_tests, java_maven_test_selector, java_gradle_test_filters,
#         java_dependency_changed

setup() {
  bats_require_minimum_version 1.5.0
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SEL="$REPO_ROOT/githooks/lib/java-test-selection.sh"
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR" || return 1
}

teardown() {
  # Leave the temp dir before deleting it: Windows cannot remove a cwd.
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# ── select_java_test_strategy truth table ───────────────────────────────────

# strategy_case <tests> <src> <deps> <expected>
strategy_case() {
  local tests="$1" src="$2" deps="$3" expected="$4" actual
  actual=$(select_java_test_strategy "$tests" "$src" "$deps")
  if [ "$actual" != "$expected" ]; then
    echo "strategy(tests=$tests src=$src deps=$deps): expected=[$expected] got=[$actual]" >&2
    return 1
  fi
}

@test "strategy: >20 changed test files -> full" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 21 0 0 full
  strategy_case 100 3 0 full
}

@test "strategy: exactly 20 changed test files still runs them (boundary)" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 20 0 0 changed-tests
}

@test "strategy: only test files changed (<=20) -> changed-tests" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 1 0 0 changed-tests
  strategy_case 5 0 0 changed-tests
}

@test "strategy: source files changed, no test files -> related" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 0 3 0 related
  strategy_case 0 1 0 related
}

@test "strategy: build manifest changed forces full even with few test changes" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 1 0 1 full
  strategy_case 0 1 1 full
  strategy_case 0 0 1 full
}

@test "strategy: nothing changed -> skip" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 0 0 0 skip
}

@test "strategy: non-numeric counts escalate to full, never silently skip" {
  # A caller bug that passes garbage must not run zero tests and report PASS.
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case "abc" 0 0 full
  strategy_case 0 "abc" 0 full
  strategy_case "" 0 0 full
}

@test "strategy: changed test files win over changed sources" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 2 9 0 changed-tests
}

# ── java_is_test_file ───────────────────────────────────────────────────────

@test "test-file detection: suffix conventions" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_is_test_file "src/test/java/com/acme/FooTest.java"
  [ "$status" -eq 0 ]
  run java_is_test_file "src/test/java/com/acme/FooTests.java"
  [ "$status" -eq 0 ]
  run java_is_test_file "src/test/java/com/acme/TestFoo.java"
  [ "$status" -eq 0 ]
  run java_is_test_file "src/test/java/com/acme/FooTestCase.java"
  [ "$status" -eq 0 ]
  run java_is_test_file "src/test/java/com/acme/FooSpec.java"
  [ "$status" -eq 0 ]
  run java_is_test_file "src/test/java/com/acme/FooIT.java"
  [ "$status" -eq 0 ]
}

@test "test-file detection: production sources are not tests" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_is_test_file "src/main/java/com/acme/Foo.java"
  [ "$status" -ne 0 ]
  run java_is_test_file "src/main/java/com/acme/TestHelper.java"
  [ "$status" -ne 0 ]
}

@test "test-file detection: any path under a test root counts as a test" {
  # Surefire includes are configurable; an oddly-named class inside
  # src/test/java must not be classified as production source.
  # shellcheck disable=SC1091
  source "$SEL"
  run java_is_test_file "src/test/java/com/acme/Helper.java"
  [ "$status" -eq 0 ]
  run java_is_test_file "module-a/src/test/java/com/acme/Helper.java"
  [ "$status" -eq 0 ]
}

@test "test-file detection: empty path is not a test" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_is_test_file ""
  [ "$status" -ne 0 ]
}

# ── java_dependency_changed ─────────────────────────────────────────────────

@test "dependency detection: build manifests escalate" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_dependency_changed "pom.xml"
  [ "$status" -eq 0 ]
  run java_dependency_changed "module-a/pom.xml"
  [ "$status" -eq 0 ]
  run java_dependency_changed "build.gradle"
  [ "$status" -eq 0 ]
  run java_dependency_changed "build.gradle.kts"
  [ "$status" -eq 0 ]
  run java_dependency_changed "settings.gradle"
  [ "$status" -eq 0 ]
  run java_dependency_changed "gradle.properties"
  [ "$status" -eq 0 ]
  run java_dependency_changed "gradle/wrapper/gradle-wrapper.properties"
  [ "$status" -eq 0 ]
  run java_dependency_changed "mvnw"
  [ "$status" -eq 0 ]
}

@test "dependency detection: ordinary sources do not escalate" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_dependency_changed "src/main/java/com/acme/Foo.java"
  [ "$status" -ne 0 ]
  run java_dependency_changed "README.md"
  [ "$status" -ne 0 ]
}

@test "dependency detection: any manifest in the list escalates" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_dependency_changed "src/main/java/com/acme/Foo.java" "pom.xml"
  [ "$status" -eq 0 ]
}

# ── java_related_tests ──────────────────────────────────────────────────────

# make_test_tree <path>... creates empty files at the given paths.
make_test_tree() {
  local p
  for p in "$@"; do
    mkdir -p "$(dirname "$p")"
    : >"$p"
  done
}

@test "related: src/main/java -> src/test/java same package" {
  # shellcheck disable=SC1091
  source "$SEL"
  make_test_tree "src/main/java/com/acme/service/Foo.java" \
                 "src/test/java/com/acme/service/FooTest.java"
  run java_related_tests "src/main/java/com/acme/service/Foo.java"
  [ "$status" -eq 0 ]
  [ "$output" = "src/test/java/com/acme/service/FooTest.java" ]
}

@test "related: prefers nothing when the conventional test does not exist" {
  # shellcheck disable=SC1091
  source "$SEL"
  make_test_tree "src/main/java/com/acme/Widget.java"
  run java_related_tests "src/main/java/com/acme/Widget.java"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "related: multi-module path keeps the module prefix" {
  # shellcheck disable=SC1091
  source "$SEL"
  make_test_tree "module-a/src/main/java/com/acme/Foo.java" \
                 "module-a/src/test/java/com/acme/FooTest.java"
  run java_related_tests "module-a/src/main/java/com/acme/Foo.java"
  [ "$status" -eq 0 ]
  [ "$output" = "module-a/src/test/java/com/acme/FooTest.java" ]
}

@test "related: several conventions resolve together, deduplicated" {
  # shellcheck disable=SC1091
  source "$SEL"
  make_test_tree "src/main/java/com/acme/Foo.java" \
                 "src/test/java/com/acme/FooTest.java" \
                 "src/test/java/com/acme/FooSpec.java"
  run java_related_tests "src/main/java/com/acme/Foo.java"
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c 'FooTest.java')" -eq 1 ]
  [ "$(printf '%s\n' "$output" | grep -c 'FooSpec.java')" -eq 1 ]
}

@test "related: empty input yields nothing" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_related_tests ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── selector builders ───────────────────────────────────────────────────────

@test "maven selector: paths become simple class names" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_maven_test_selector "src/test/java/com/acme/FooTest.java" \
                               "src/test/java/com/acme/BarTest.java"
  [ "$status" -eq 0 ]
  [ "$output" = "FooTest,BarTest" ]
}

@test "maven selector: duplicates removed (Surefire would run them twice)" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_maven_test_selector "a/foo/FooTest.java" "b/foo/FooTest.java"
  [ "$status" -eq 0 ]
  [ "$output" = "FooTest" ]
}

@test "maven selector: empty input yields empty output, not a stray comma" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_maven_test_selector
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "gradle filters: one class name per line" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_gradle_test_filters "src/test/java/com/acme/FooTest.java" \
                               "src/test/java/com/acme/BarTest.java"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "FooTest" ]
  [ "${lines[1]}" = "BarTest" ]
  [ "${#lines[@]}" -eq 2 ]
}

@test "gradle filters: duplicates removed" {
  # shellcheck disable=SC1091
  source "$SEL"
  run java_gradle_test_filters "a/FooTest.java" "b/FooTest.java"
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  [ "${lines[0]}" = "FooTest" ]
}

# ── adapter wiring (regression guards) ──────────────────────────────────────

# The adapter lives in the npm package source tree; the installed copy under
# githooks/adapters/ is generated. Assert against the SOURCE so the guard fails
# in CI before a release ships the wrong flags.
#
# Located by explicit candidate probing rather than by deriving from
# BATS_TEST_DIRNAME: bats materialises each test file through a temp symlink,
# so `$BATS_TEST_DIRNAME/../..` can resolve to the filesystem root (observed:
# DIRNAME=/tmp, REPO_ROOT=/), which silently turns these guards into no-ops.
# $SEL is resolved in setup() from the same BATS_TEST_DIRNAME and DOES work
# there (bats keeps it pointing at the real suite dir during setup), so the
# anchor is the githooks/lib path we already resolved successfully.
_adapter_path() {
  local libdir
  libdir="$(dirname "$SEL")"           # .../githooks/lib
  local root
  root="$(cd "$libdir/../.." && pwd)"  # repo root, via the known-good anchor
  local candidate
  for candidate in \
    "$root/src/npm-package/adapters/java.sh" \
    "$root/githooks/adapters/java.sh"; do
    [ -f "$candidate" ] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

_precommit_path() {
  local libdir
  libdir="$(dirname "$SEL")"
  local candidate
  candidate="$(cd "$libdir/.." && pwd)/pre-commit"
  [ -f "$candidate" ] && { printf '%s' "$candidate"; return 0; }
  return 1
}

@test "adapter: maven selective run disables fail-if-no-specified-tests" {
  # Multi-module repos break WITHOUT this: the changed class lives in one
  # module, every other module has zero matches, and surefire fails the build.
  # Measured on a 2-module project: selective run = BUILD FAILURE, full suite =
  # clean. A selective mode that fails where the full suite passes is strictly
  # worse than not having it, so the flag is a correctness requirement.
  # shellcheck disable=SC1091
  source "$SEL"
  adapter=$(_adapter_path) || skip "adapter source not found"
  run grep -q 'surefire.failIfNoSpecifiedTests=false' "$adapter"
  [ "$status" -eq 0 ]
}

@test "adapter: selection honours the XP_GATE_JAVA_TEST_SELECTION=off escape valve" {
  # shellcheck disable=SC1091
  source "$SEL"
  adapter=$(_adapter_path) || skip "adapter source not found"
  run grep -q 'XP_GATE_JAVA_TEST_SELECTION' "$adapter"
  [ "$status" -eq 0 ]
}

@test "adapter: selection marks partial runs so Stage 2 warns instead of blocking" {
  # shellcheck disable=SC1091
  source "$SEL"
  adapter=$(_adapter_path) || skip "adapter source not found"
  run grep -q 'PARTIAL_TEST_RUN=true' "$adapter"
  [ "$status" -eq 0 ]
}

@test "adapter: sources the selection lib" {
  # shellcheck disable=SC1091
  source "$SEL"
  adapter=$(_adapter_path) || skip "adapter source not found"
  run grep -q 'java-test-selection.sh' "$adapter"
  [ "$status" -eq 0 ]
}

@test "pre-commit: exports GATE_CHANGED_FILES to the adapter" {
  # shellcheck disable=SC1091
  source "$SEL"
  precommit=$(_precommit_path) || skip "pre-commit not found"
  run grep -q 'GATE_CHANGED_FILES' "$precommit"
  [ "$status" -eq 0 ]
}
