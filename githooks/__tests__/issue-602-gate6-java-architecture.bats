#!/usr/bin/env bats
# @test REQ-621
# @intent Gate 6's Java arm was a guaranteed PASS for two independent reasons.
#         (1) The test-dir probe hardcoded `src/test/java/architecture` at the
#             repo root, so a multi-module Maven repo (core/ + demo/), whose
#             arch tests live under <module>/src/test/java/..., took the SKIP
#             path and reported architecture as "not configured" for a repo
#             that actually has those tests.
#         (2) `mvn ... | head -20` yields head's exit status (0) as the
#             pipeline result, so the `||` fallback never fired and the
#             `echo "✅ ... completed"` printed unconditionally: a failing
#             architecture test was reported as success.
#         Both are "a dimension nobody measured, scored as if measured".
# @covers AC-621-01, AC-621-02, AC-621-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Extract the "java") arm of Gate 6's architecture case statement, so the
# assertions run against the real code rather than a copy that can drift.
_java_arm() {
  sed -n '/^      "java")$/,/^        ;;$/p' "$PRE_COMMIT"
}

@test "#602 AC-621-01: the java arm does not hardcode the repo-root test dir" {
  run _java_arm
  [ "$status" -eq 0 ]
  # Strip comment lines first: the arm's own explanatory comment quotes the old
  # probe to say what changed, and that mention must not be read as the defect.
  _code="$(printf '%s\n' "$output" | grep -vE '^[[:space:]]*#')"
  # The old probe. Its presence in CODE is the defect: it makes a multi-module
  # repo look like it has no architecture tests.
  if printf '%s\n' "$_code" | grep -q 'src/test/java/architecture'; then
    echo "java arm still hardcodes src/test/java/architecture in code"
    return 1
  fi
  # It must discover roots instead.
  printf '%s\n' "$_code" | grep -q "src/test/java" || {
    echo "java arm no longer looks for src/test/java at all"; return 1; }
  printf '%s\n' "$_code" | grep -qE 'find .*-type d .*src/test/java' || {
    echo "java arm does not discover module roots via find"; return 1; }
}

@test "#602 AC-621-02: the java arm judges by PIPESTATUS, not by head" {
  run _java_arm
  [ "$status" -eq 0 ]
  _code="$(printf '%s\n' "$output" | grep -vE '^[[:space:]]*#')"
  # Every build invocation that pipes through head/tail must read the build's
  # own exit status afterwards. `| head -20 || echo ✅` is exactly the shape
  # that reported failures as success.
  printf '%s\n' "$_code" | grep -q 'PIPESTATUS\[0\]' || {
    echo "java arm never reads PIPESTATUS[0]; a piped build failure is invisible"
    return 1; }
  # The old unconditional-success fallback must be gone from code.
  if printf '%s\n' "$_code" | grep -q '|| echo "⚠️  Java architecture tests completed"'; then
    echo "java arm still has the unconditional-success fallback in code"
    return 1
  fi
  # A non-zero build exit must block, not print ✅.
  printf '%s\n' "$_code" | grep -q 'BLOCKED - Java architecture test' || {
    echo "java arm has no blocking path for a failing build"; return 1; }
}

@test "#602 AC-621-03: --no-verify is not the answer; the gate itself blocks" {
  # Regression guard for the tempting wrong fix: silencing Gate 6. The arm must
  # exit non-zero on failure so the commit is refused.
  run _java_arm
  [ "$status" -eq 0 ]
  _code="$(printf '%s\n' "$output" | grep -vE '^[[:space:]]*#')"
  printf '%s\n' "$_code" | grep -q 'exit 1' || {
    echo "java arm never exits non-zero on a failing architecture test"; return 1; }
}

@test "#602 a multi-module repo discovers the module that holds the tests" {
  # Build a fixture shaped like the real repo: root pom + two modules, arch test
  # in one of them, nothing under the repo-root src/test/java.
  mkdir -p "$TEST_DIR/repo/alpha/src/test/java" "$TEST_DIR/repo/beta/src/main/java"
  cd "$TEST_DIR/repo" || return 1
  : > pom.xml
  printf 'class ArchitectureTest {}\n' > alpha/src/test/java/ArchitectureTest.java

  # Re-create exactly the discovery snippet the arm uses.
  _java_arch_roots=""
  while IFS= read -r _root; do
    [ -n "$_root" ] && _java_arch_roots="${_java_arch_roots} ${_root}"
  done <<JAVAARCHROOTS
$(find . -path ./target -prune -o -type d -path '*/src/test/java' -print 2>/dev/null \
  | sed 's|^\./||; s|/src/test/java$||; s|^src/test/java$|.|')
JAVAARCHROOTS

  _java_arch_hit=""
  for _r in $_java_arch_roots; do
    _probe_dir="$_r/src/test/java"
    [ "$_r" = "." ] && _probe_dir="src/test/java"
    if find "$_probe_dir" -name '*Architecture*' -type f 2>/dev/null | head -1 | grep -q .; then
      _java_arch_hit="${_java_arch_hit} ${_r}"
    fi
  done

  echo "roots:$_java_arch_roots"
  echo "hit:$_java_arch_hit"
  case " $_java_arch_hit " in
    *" alpha "*) ;;
    *) echo "expected alpha in hit list, got:$_java_arch_hit"; return 1 ;;
  esac
  case " $_java_arch_hit " in
    *" beta "*) echo "beta has no arch test and must not be in the hit list"; return 1 ;;
  esac
}

@test "#602 a repo with no arch tests still reports a skip reason" {
  mkdir -p "$TEST_DIR/empty/src/test/java"
  cd "$TEST_DIR/empty" || return 1
  : > pom.xml
  printf 'class PlainTest {}\n' > src/test/java/PlainTest.java

  run _java_arm
  [ "$status" -eq 0 ]
  # The SKIP path must still exist and still record why, so "no arch tests"
  # stays distinguishable from "arch tests passed".
  printf '%s\n' "$output" | grep -q 'architecture_not_configured' || {
    echo "no-tests path lost its skip reason"; return 1; }
}

@test "#602 a fully measured Gate 6 is PASS, not SKIP" {
  # A language that was really measured and passed leaves no skip reason. The
  # verdict was never upgraded to match, so Gate 6 reported SKIP even when every
  # language had been validated and passed -- the mirror image of #537's "SKIP
  # dressed as PASS", and the report could not tell the two apart.
  _region="$(sed -n '/# #602 (status):/,/^  else$/p' "$PRE_COMMIT")"
  [ -n "$_region" ] || { echo "#602 status upgrade block is missing"; return 1; }
  printf '%s\n' "$_region" | grep -q 'GATE_6_STATUS="PASS"' || {
    echo "a fully measured gate never becomes PASS"; return 1; }
  # It must be conditional on there being no per-language skip reason: "some
  # languages measured" must not be scored as a full success.
  printf '%s\n' "$_region" | grep -q 'z "$GATE_6_LANG_REASONS"' || {
    echo "PASS is not gated on an empty skip-reason set"; return 1; }
  printf '%s\n' "$_region" | grep -q 'n "$PROJECT_LANGS"' || {
    echo "PASS is not gated on at least one language being present"; return 1; }
}

@test "#602 a partially measured Gate 6 stays non-PASS" {
  # Fixture: two languages, one measured, one with a skip reason. The upgrade
  # must not fire.
  GATE_6_LANG_REASONS="python=no_archlint_detector"
  PROJECT_LANGS="python java"
  GATE_6_STATUS=""
  if [ -z "$GATE_6_LANG_REASONS" ] && [ -n "$PROJECT_LANGS" ]; then
    GATE_6_STATUS="PASS"
  fi
  [ -z "$GATE_6_STATUS" ] || { echo "partial coverage was scored as PASS"; return 1; }

  # And the fully-measured case does fire.
  GATE_6_LANG_REASONS=""
  PROJECT_LANGS="java"
  if [ -z "$GATE_6_LANG_REASONS" ] && [ -n "$PROJECT_LANGS" ]; then
    GATE_6_STATUS="PASS"
  fi
  [ "$GATE_6_STATUS" = "PASS" ] || { echo "fully measured gate did not become PASS"; return 1; }
}
