#!/usr/bin/env bats
# @test REQ-606
# @intent Gate 2 had no default answer to "what must not be scanned".
#
#         `resolve_jscpd_config` returns nothing when the project ships no
#         jscpd.conf.json, and pre-commit then runs jscpd with its own defaults —
#         which treat .yaml, .txt and .log as scannable source. On a data-heavy
#         project that means an exemptions manifest, golden snapshots and build
#         logs are measured for "duplicate code" (#591).
#
#         Measured here before the fix: two copies of a 13-entry exemptions.yaml
#         plus two copies of build-run.log -> "Found 1 exact clones with 38
#         (48.72%) duplicated lines in 2 (1 formats) files". Not one of those
#         lines is refactorable — duplicate rows are the DATA SHAPE of an
#         exemptions list, and a log is an artifact that exists to be kept.
#
#         The number is not merely noisy. It is unfalsifiable as a work item: the
#         reader cannot tell "yaml data that must repeat" from "two Java methods
#         that really were copy-pasted", so the honest response is to stop reading
#         the gate — taking the real duplicates down with it. The reporter's own
#         account: 176 clones reported, 6 genuinely refactorable.
#
#         So the invariant: a project that expresses no preference still gets a
#         defensible baseline, and the gate says which baseline it used
#         (the issue's points 1 and 3). Grouping the report by file class
#         (point 2) is a new feature and deliberately out of scope.
#
#         Point 4 -- the bare `jscpd $SOURCE_FILES | head -15` in the generic
#         branch, inconsistent with #477's temp-file treatment -- is covered here
#         only as far as the library owns it; the hook-side pipe is asserted
#         separately.
# @covers AC-606-01, AC-606-02, AC-606-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  JSCPD_LIB="$REPO_ROOT/githooks/lib/jscpd-run.sh"

  WORK="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q -b feature/gate2 .
  git config core.hooksPath /dev/null
  PROJECT_ROOT="$WORK"
}

# Run a library function with PROJECT_ROOT pointing at the fixture.
in_lib() {
  (
    cd "$WORK" || exit 70
    PROJECT_ROOT="$WORK"
    # shellcheck source=/dev/null
    source "$JSCPD_LIB"
    "$@"
  )
}

# ---------------------------------------------------------------------------
# AC-606-01: a project with no config still gets a default ignore set
# ---------------------------------------------------------------------------

@test "AC-606-01: data and evidence files are excluded by default" {
  # Every one of these is the exact shape #591 reported: an exemptions manifest,
  # two build logs, a golden snapshot, a baseline json.
  mkdir -p docs/evidence src
  printf -- '- id: WHALE001\n  reason: accepted\n' > docs/exemptions.yaml
  printf 'build output line\n' > build.log
  printf 'demo replay line\n' > demo-replay.log
  printf 'expected behavior line\n' > rule-behavior-golden.txt
  printf '{"baseline": 1}\n' > .warnings-baseline.json

  for f in docs/exemptions.yaml build.log demo-replay.log rule-behavior-golden.txt .warnings-baseline.json; do
    run in_lib jscpd_is_default_ignored "$f"
    [ "$status" -eq 0 ] || {
      echo "$f must be excluded by the default ignore set, got status $status"
      return 1
    }
  done
}

@test "AC-606-01: real source files are still scanned" {
  # The control that stops the ignore set from swallowing the gate. If a
  # widened ignore list also dropped .ts/.java/.py, Gate 2 would report a
  # permanent clean and look healthier than before the fix.
  mkdir -p src
  printf 'export const a = 1;\n' > src/a.ts
  printf 'public class A {}\n' > src/A.java
  printf 'def f():\n    pass\n' > src/a.py
  printf 'package main\n' > src/main.go

  for f in src/a.ts src/A.java src/a.py src/main.go; do
    run in_lib jscpd_is_default_ignored "$f"
    [ "$status" -ne 0 ] || {
      echo "$f is real source and must NOT be ignored"
      return 1
    }
  done
}

@test "AC-606-01: build output directories are excluded by default" {
  for f in node_modules/pkg/index.js dist/bundle.js build/main.js target/classes/A.class target/classes/A.java coverage/lcov.info; do
    run in_lib jscpd_is_default_ignored "$f"
    [ "$status" -eq 0 ] || {
      echo "$f lives in a build-output directory and must be ignored"
      return 1
    }
  done
}

# ---------------------------------------------------------------------------
# AC-606-02: a project's own config wins, and a project can opt back in
# ---------------------------------------------------------------------------

@test "AC-606-02: the defaults do not override an existing jscpd.conf.json" {
  printf '{"minLines": 5}\n' > jscpd.conf.json
  run in_lib resolve_jscpd_config
  [ "$status" -eq 0 ]
  [ -n "$output" ] || {
    echo "the project's own config must still be found and used"
    return 1
  }
  [[ "$output" == *"jscpd.conf.json"* ]]
}

@test "AC-606-02: XP_GATE_JSCPD_DEFAULT_IGNORE=0 disables the default ignore set" {
  # An escape hatch for a project that genuinely wants .yaml compared — otherwise
  # the default silently makes some real duplicates unreachable.
  printf -- '- id: A\n' > docs-exemptions.yaml
  mkdir -p docs
  printf -- '- id: A\n' > docs/exemptions.yaml

  run env XP_GATE_JSCPD_DEFAULT_IGNORE=0 bash -c "
    cd '$WORK'
    PROJECT_ROOT='$WORK'
    source '$JSCPD_LIB'
    jscpd_is_default_ignored docs/exemptions.yaml
  "
  [ "$status" -ne 0 ] || {
    echo "with the escape hatch set, nothing may be default-ignored"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-606-03: the gate says which baseline it used
# ---------------------------------------------------------------------------

@test "AC-606-03: the default ignore set is printable so 'what did it scan' is auditable" {
  run in_lib jscpd_default_ignore_patterns
  [ "$status" -eq 0 ]
  [ -n "$output" ] || {
    echo "the default ignore set must be printable, or the user cannot audit it"
    return 1
  }
  # The line the gate prints must name the reason, not just dump a regex.
  [[ "$output" == *"log"* ]]
  [[ "$output" == *"yaml"* ]] || [[ "$output" == *"yml"* ]]
  [[ "$output" == *"golden"* ]]
}
