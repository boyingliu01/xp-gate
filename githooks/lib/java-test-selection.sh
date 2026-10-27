#!/bin/bash
# Java smart test selection (#640) — the Java counterpart of the TypeScript
# selector (#286) and the Python selector (#399).
#
# Why: the Java arm of Gate 5 ran the FULL Maven/Gradle suite on every commit.
# Measured on a 206-file / 1079-test project: `mvn test jacoco:report` takes
# 77.8s no matter whether one file or a hundred changed. TypeScript and Python
# have had three-tier selection for a long time; Java had no equivalent — the
# `PARTIAL_TEST_RUN` capability existed but nothing on the Java path ever set
# it, so the downgrade channel was dead code for that language.
#
# Kept in its own file so the strategy truth table and the related-test lookup
# are unit-testable without executing the hook
# (githooks/__tests__/issue-640-java-test-selection.test.bats).
#
# Three tiers, matching the TS/Python implementations:
#   1. changed-tests — only test files changed: run exactly those.
#   2. related      — source files changed, no test files: run the tests the
#                     path convention maps to them.
#   3. full         — >20 test files changed, a build manifest changed, or no
#                     related tests found: run everything with the real
#                     coverage threshold.
# Tier 1/2 run WITHOUT the global coverage threshold (subset coverage is
# meaningless globally); the caller sets PARTIAL_TEST_RUN so Gate 5 warns
# instead of blocking.

# Max changed test files before falling back to the full suite. Same value as
# the TypeScript (#286) and Python (#399) selectors so all three languages
# behave alike.
JAVA_MAX_CHANGED_TESTS=20

# Build manifests: a change here can break ANY test (dependency bump, surefire
# config, compiler level), so the selector always escalates to the full suite.
JAVA_DEPENDENCY_PATTERNS='(^|/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|gradle/wrapper/[^/]+|mvnw|mvnw\.cmd|\.mvn/[^/]+)$'

# Java test CLASS-name conventions (applied to the basename only).
#
# Maven surefire's own defaults are `*Test.java`, `Test*.java`, `*Tests.java`,
# `*TestCase.java`; Gradle users commonly add `*Spec.java` and `*IT.java`.
#
# The `Test[A-Z]\w*` form is deliberately narrowed to `Test[A-Z]` followed by
# something that looks like a test subject rather than a helper: bare
# `Test[^/]*` would swallow `TestHelper.java`, `TestUtils.java`,
# `TestFixtures.java` — production/support classes that happen to start with
# "Test". Misclassifying a SOURCE as a TEST is the dangerous direction: those
# helpers are real code whose changing should run `related`, and calling them
# tests would make the selector run them as if they were suites (Surefire
# would then find no tests in them) and skip the source-driven lookup.
#
# A path under a test source root is caught independently by
# java_is_test_file, so helpers living in src/test/java are still tests.
JAVA_TEST_FILE_RE='(^|/)(Test[A-Z]\w*(Test|Tests|Case|Spec|IT)|[A-Z]\w*Test|[A-Z]\w*Tests|[A-Z]\w*TestCase|[A-Z]\w*Spec|[A-Z]\w*IT)\.java$'

# Decide the strategy from three counts. Pure function — no filesystem access,
# so the truth table is exhaustive and cheap to test.
#
#   $1 test_count    changed test files
#   $2 src_count     changed non-test Java source files
#   $3 deps_changed  1 when a build manifest changed, else 0
#
# Echoes exactly one of: full | changed-tests | related | skip
select_java_test_strategy() {
  # `${1-0}`, not `${1:-0}`: the `:-` form rewrites an EMPTY argument to "0",
  # which would make the empty check below unreachable — a caller passing ""
  # (e.g. an unset count that reached us as an empty string) would silently
  # mean "0 changed files" and skip the suite. Only a genuinely UNSET argument
  # defaults to 0.
  local test_count="${1-0}"
  local src_count="${2-0}"
  local deps_changed="${3-0}"

  # Non-numeric OR empty input must not silently become "0" and skip the
  # suite: a caller bug there would run nothing and report PASS. Escalate.
  case "$test_count" in
    ''|*[!0-9]*) printf '%s' "full"; return 0 ;;
  esac
  case "$src_count" in
    ''|*[!0-9]*) printf '%s' "full"; return 0 ;;
  esac

  # Dependency/build changes can break anything -> always the full suite.
  if [ "$deps_changed" = "1" ]; then
    printf '%s' "full"
    return 0
  fi

  # Large batch: per-file selection loses its point, and the other two
  # language arms use the same cutoff.
  if [ "$test_count" -gt "$JAVA_MAX_CHANGED_TESTS" ]; then
    printf '%s' "full"
    return 0
  fi

  if [ "$test_count" -gt 0 ]; then
    printf '%s' "changed-tests"
    return 0
  fi

  if [ "$src_count" -gt 0 ]; then
    printf '%s' "related"
    return 0
  fi

  printf '%s' "skip"
}

# True (0) when the path looks like a Java test source.
#
#   $1 path, e.g. src/test/java/com/acme/FooTest.java
java_is_test_file() {
  local path="$1"
  [ -n "$path" ] || return 1
  # A path under a test source root is a test even when the basename does not
  # end in Test/Tests/Spec — surefire includes are configurable, and a `*IT.java`
  # integration test living in src/test/java must not be mistaken for source.
  #
  # The leading "/" matters: git reports repo-relative paths with no leading
  # slash ("src/test/java/..."), so a bare "*/src/test/*" pattern would never
  # match the most common case of all. Prefixing normalises both forms.
  case "/$path" in
    */src/test/java/*|*/src/test/*|*/src/androidTest/*) return 0 ;;
  esac
  printf '%s' "$path" | grep -qE "$JAVA_TEST_FILE_RE"
}

# True (0) when any of the given paths is a Java build manifest.
java_dependency_changed() {
  local path
  for path in "$@"; do
    [ -n "$path" ] || continue
    if echo "$path" | grep -qE "$JAVA_DEPENDENCY_PATTERNS"; then
      return 0
    fi
  done
  return 1
}

# Map a Maven/Gradle source path to the test path(s) the convention implies.
# Echoes one existing path per line, deduplicated, in discovery order. Echoes
# nothing when no candidate exists — the caller then falls back to tier 3.
#
#   $1 source path, e.g. src/main/java/com/acme/service/Foo.java
#
# The mapping mirrors the standard layout: src/main/java/<pkg>/X.java ->
# src/test/java/<pkg>/XTest.java. Multi-module builds are handled because the
# module prefix is preserved verbatim (only `main`->`test` inside the path is
# rewritten).
java_related_tests() {
  local src_file="$1"
  [ -n "$src_file" ] || return 0

  local filename dir base
  base="${src_file%.java}"
  filename="${base##*/}"
  dir="$(dirname "$src_file")"

  local candidates=""
  # Primary convention: same package, main -> test.
  # "/$dir" for the same reason as java_is_test_file: git's repo-relative paths
  # have no leading slash, so a bare "*/src/main/java/*" would never match.
  case "/$dir" in
    */src/main/java/*)
      # Rewrite the source root segment. `#` as the sed delimiter keeps the
      # pattern readable: / would need escaping in both the pattern AND the
      # replacement. The leading "/" is prepended BEFORE the substitution and
      # stripped after: the pattern is anchored on "/src/main/java/", and a
      # repo-relative dir ("src/main/java/com/acme") does not contain that
      # leading slash, so a bare substitution would match nothing and every
      # "related" lookup would return empty — quietly downgrading every commit
      # to the full suite (correct, but pointless).
      local test_dir
      test_dir=$(printf '/%s' "$dir" | sed 's#/src/main/java/#/src/test/java/#')
      test_dir="${test_dir#/}"
      candidates="$candidates
${test_dir}/${filename}Test.java
${test_dir}/${filename}Tests.java
${test_dir}/${filename}Spec.java
${test_dir}/Test${filename}.java"
      ;;
  esac
  # Colocated forms (some projects keep tests beside sources).
  candidates="$candidates
${dir}/${filename}Test.java
${dir}/${filename}Tests.java
${dir}/${filename}Spec.java
${dir}/__tests__/${filename}Test.java"

  local seen=""
  local candidate
  # IFS-safe iteration over newline-separated candidates.
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    [ -f "$candidate" ] || continue
    # Dedupe: several patterns resolve to the same file whenever the source
    # already sits under a test-looking root.
    case "$seen" in
      *"|$candidate|"*) continue ;;
    esac
    seen="$seen|$candidate|"
    printf '%s\n' "$candidate"
  done <<EOF
$candidates
EOF
}

# Turn test file paths into the Maven `-Dtest=` selector list.
# Echoes one comma-separated argument, or nothing when the input is empty.
#
#   $1..$N test file paths
#
# Maven matches `-Dtest=` against simple class names (not paths), so the
# directory part is dropped and the `.java` suffix stripped. Duplicates are
# removed: `-Dtest=A,A` makes Surefire run A twice.
java_maven_test_selector() {
  local seen=" " out=""
  local path name
  for path in "$@"; do
    [ -n "$path" ] || continue
    name="${path##*/}"
    name="${name%.java}"
    [ -n "$name" ] || continue
    case "$seen" in
      *" $name "*) continue ;;
    esac
    seen="$seen$name "
    if [ -z "$out" ]; then out="$name"; else out="$out,$name"; fi
  done
  [ -n "$out" ] && printf '%s' "$out"
  return 0
}

# Turn test file paths into Gradle `--tests` filter arguments.
# Echoes one argument per line (Gradle wants a repeated flag, not a list).
#
#   $1..$N test file paths
java_gradle_test_filters() {
  local seen=""
  local path name
  for path in "$@"; do
    [ -n "$path" ] || continue
    name="${path##*/}"
    name="${name%.java}"
    [ -n "$name" ] || continue
    case "$seen" in
      *"|$name|"*) continue ;;
    esac
    seen="$seen|$name|"
    printf '%s\n' "$name"
  done
  return 0
}
