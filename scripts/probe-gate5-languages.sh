#!/usr/bin/env bash
# Gate 5 (tests + coverage) x language effectiveness probe.
#
# For each supported language, build a fixture whose test suite contains a
# DELIBERATELY FAILING assertion, then ask Gate 5 to judge it. A gate that is
# effective must block. Everything else -- SKIP, PASS, "no runner installed" -- is
# the defect this probe exists to find.
#
# Why a failing test and not a missing one:
#   A gate that cannot RUN and a gate that found NOTHING look identical from the
#   outside, and the whole of githooks/AGENTS.md's "verdict contract" is about
#   keeping them apart. A failing assertion is the only input where the two must
#   diverge: the toolchain is present, the test is real, and the only correct
#   answer is a block. A probe built on an absent test would pass a gate that
#   skips everything.
#
# Exit: 0 when every probed language produced a real verdict.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/xp-gate5-probe"
rm -rf "$WORK"; mkdir -p "$WORK"

PASS_N=0; FAIL_N=0; SKIP_N=0
declare -a FAILURES=()
declare -a ROWS=()

# Languages whose toolchain is absent are reported as SKIP with the tool named.
# Per the project convention (tool missing => SKIP, not BLOCK).
#
# A tool that is installed only inside this repo still counts as present: `bats`
# lives in node_modules/, and treating that as "not installed" would have marked
# shell SKIP for a machine that can run the suite. The adapters reach the same
# conclusion through their own resolution chain, so agreeing with them is the
# point.
tool_present() {
  local tool="$1"
  command -v "$tool" >/dev/null 2>&1 && return 0
  [ -x "$REPO/node_modules/.bin/$tool" ] && return 0
  [ -x "$REPO/node_modules/$tool/bin/$tool" ] && return 0
  return 1
}

# --- fixture builders -------------------------------------------------------
#
# Each builder writes a project with ONE failing test. The failure must be in the
# test, not in the source, so the verdict is unambiguously "tests failed".

mk_typescript() {
  local d="$1"
  mkdir -p "$d/src" "$d/test"
  printf '{"name":"p","version":"1.0.0","scripts":{"test":"node --test test/"}}\n' > "$d/package.json"
  printf 'export const add = (a, b) => a + b;\n' > "$d/src/math.js"
  # Expects 3 from add(1,1). Fails.
  cat > "$d/test/math.test.js" <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert';
import { add } from '../src/math.js';
test('deliberately failing', () => { assert.strictEqual(add(1, 1), 3); });
EOF
}

mk_python() {
  local d="$1"
  mkdir -p "$d/src" "$d/tests"
  printf '[project]\nname = "p"\nversion = "1.0.0"\n' > "$d/pyproject.toml"
  printf 'def add(a, b):\n    return a + b\n' > "$d/src/math_mod.py"
  cat > "$d/tests/test_math.py" <<'EOF'
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from math_mod import add

def test_deliberately_failing():
    assert add(1, 1) == 3
EOF
}

mk_go() {
  local d="$1"
  mkdir -p "$d"
  printf 'module p\n\ngo 1.21\n' > "$d/go.mod"
  printf 'package main\n\nfunc Add(a, b int) int { return a + b }\n' > "$d/math.go"
  cat > "$d/math_test.go" <<'EOF'
package main

import "testing"

func TestDeliberatelyFailing(t *testing.T) {
	if Add(1, 1) != 3 {
		t.Fatalf("deliberately failing")
	}
}
EOF
}

mk_shell() {
  local d="$1"
  mkdir -p "$d/tests"
  printf '#!/bin/sh\necho hi\n' > "$d/run.sh"
  cat > "$d/tests/sample.test.bats" <<'EOF'
#!/usr/bin/env bats
@test "deliberately failing" {
  [ 1 -eq 2 ]
}
EOF
}

mk_powershell() {
  local d="$1"
  mkdir -p "$d/tests"
  printf '# p\n' > "$d/run.ps1"
  cat > "$d/tests/Sample.Tests.ps1" <<'EOF'
Describe 'Sample' {
  It 'deliberately fails' {
    (1 + 1) | Should -Be 3
  }
}
EOF
}

mk_java() {
  local d="$1"
  mkdir -p "$d/src/main/java/p" "$d/src/test/java/p"
  cat > "$d/pom.xml" <<'EOF'
<project><modelVersion>4.0.0</modelVersion><groupId>p</groupId>
<artifactId>p</artifactId><version>1.0.0</version></project>
EOF
  printf 'package p;\npublic class MathUtil {\n  public static int add(int a, int b) { return a + b; }\n}\n' \
    > "$d/src/main/java/p/MathUtil.java"
  cat > "$d/src/test/java/p/MathUtilTest.java" <<'EOF'
package p;
import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;
public class MathUtilTest {
  @Test void deliberatelyFails() { assertEquals(3, MathUtil.add(1, 1)); }
}
EOF
}

mk_cpp() {
  local d="$1"
  mkdir -p "$d/src" "$d/tests"
  printf 'cmake_minimum_required(VERSION 3.10)\nproject(p)\n' > "$d/CMakeLists.txt"
  printf 'int add(int a, int b) { return a + b; }\n' > "$d/src/math.cpp"
  cat > "$d/tests/test_math.cpp" <<'EOF'
#include <cassert>
int add(int a, int b);
int main() { assert(add(1, 1) == 3); return 0; }
EOF
}

mk_dart() {
  local d="$1"
  mkdir -p "$d/lib" "$d/test"
  printf 'name: p\nversion: 1.0.0\nenvironment:\n  sdk: ">=2.17.0 <4.0.0"\n' > "$d/pubspec.yaml"
  printf 'int add(int a, int b) => a + b;\n' > "$d/lib/p.dart"
  cat > "$d/test/p_test.dart" <<'EOF'
import 'package:p/p.dart';
import 'package:test/test.dart';
void main() {
  test('deliberately failing', () { expect(add(1, 1), 3); });
}
EOF
}

mk_php() {
  local d="$1"
  mkdir -p "$d/src" "$d/tests"
  printf '{"name":"p/p","require":{}}\n' > "$d/composer.json"
  cat > "$d/phpunit.xml" <<'EOF'
<?xml version="1.0"?>
<phpunit bootstrap="vendor/autoload.php">
  <testsuites><testsuite name="p"><directory>tests</directory></testsuite></testsuites>
</phpunit>
EOF
  # shellcheck disable=SC2016  # PHP's $a/$b must reach the file literally
  printf '<?php\nfunction add($a, $b) { return $a + $b; }\n' > "$d/src/math.php"
  cat > "$d/tests/MathTest.php" <<'EOF'
<?php
use PHPUnit\Framework\TestCase;
class MathTest extends TestCase {
  public function testDeliberatelyFailing(): void {
    $this->assertSame(3, add(1, 1));
  }
}
EOF
}

# --- driver -----------------------------------------------------------------

# judge <lang> <expected-verdict> <dir> <tool>
#
# Runs Gate 5 through the REAL pre-commit hook, because Gate 5 is commit-only:
# `xp-gate check 5` always answers SKIP ("requires the git-staged set"), so a
# probe built on the CLI would record SKIP for every language and conclude the
# gate is uniformly broken -- measuring the CLI's admission, not the gate.
judge() {
  local lang="$1" expect="$2" dir="$3" tool="$4"
  local out verdict

  if [ -n "$tool" ] && ! tool_present "$tool"; then
    SKIP_N=$((SKIP_N+1))
    ROWS+=("$(printf '%-14s %-8s %s' "$lang" "SKIP" "toolchain '$tool' not installed")")
    return 0
  fi

  # The whole fixture lifecycle must run in one command substitution: `out` has to
  # reach THIS shell. An earlier version assigned it inside a `( ... )` subshell,
  # which discarded it -- every language then reported "NONE / no verdict line",
  # a probe failure that reads exactly like a gate failure. The fix is the
  # redirection at the end, not a looser verdict pattern.
  out=$(
    cd "$dir" || exit 1
    git init -q -b probe 2>/dev/null
    # Commit the fixture WITHOUT its failing test, then introduce the failing test
    # as the staged change.
    #
    # This is not decoration. The first version committed everything and staged a
    # .probe_touch marker; Gate 5 then correctly answered
    # "2431ms (skipped -- no code changes)", which the probe recorded as a defect.
    # The gate was right and the fixture was wrong: a commit whose only change is
    # a non-source file has no tests to judge, and Gate 5's input short-circuit
    # (AGENTS.md: ask "is there anything to check?" before "is the tool installed?")
    # is supposed to fire there. Staging a real source file alongside the failing
    # test is what makes the change set something Gate 5 must evaluate.
    find . -path ./.git -prune -o -name '*test*' -print 2>/dev/null | while read -r f; do
      mv "$f" "$f.probehidden" 2>/dev/null
    done
    git -c user.email=p@p -c user.name=p -c core.hooksPath= add -A 2>/dev/null
    git -c user.email=p@p -c user.name=p -c core.hooksPath= commit -q --no-verify -m init 2>/dev/null
    find . -path ./.git -prune -o -name '*.probehidden' -print 2>/dev/null | while read -r f; do
      mv "$f" "${f%.probehidden}" 2>/dev/null
    done
    # Stage a real source change plus the now-failing test: a change set Gate 5
    # cannot short-circuit on.
    src=$(find . -path ./.git -prune -o -type f \( -name '*.ts' -o -name '*.js' -o -name '*.py' \
      -o -name '*.go' -o -name '*.sh' -o -name '*.ps1' -o -name '*.java' -o -name '*.cpp' \
      -o -name '*.dart' -o -name '*.php' \) -print 2>/dev/null | grep -v test | head -1)
    if [ -n "$src" ]; then printf '\n' >> "$src"; fi
    git add -A 2>/dev/null
    git config core.hooksPath "$REPO/githooks"
    # XP_GATE_ONLY_GATE isolates the gate under test.
    #
    # Without it the probe measured the ORDER of the chain, not Gate 5: on the
    # python fixture, Ruff rejected a missing blank line and on the java fixture
    # the lint arm found one violation, so Gate 1 blocked and Gate 5 was never
    # reached -- recorded as "gate-5 FAIL" for a gate that had not run. Both
    # fixtures were fine; the probe was attesting to a verdict it never observed.
    #
    # Note the trade-off this accepts: the probe now certifies Gate 5's behaviour
    # in isolation. End-to-end ordering is covered separately (the two full-chain
    # runs recorded in docs/gate-quality-matrix), because re-proving the order in
    # every language cell would make each cell two tests.
    timeout 900 env XP_GATE_ONLY_GATE=5 git -c user.email=p@p -c user.name=p commit -m probe 2>&1
  ) || true

  # Scope the verdict to Gate 5's OWN section of the hook log.
  #
  # The first version grepped the whole log, so Gate 11's
  # "SKIPPED - Sprint Flow (not a sprint project)" matched the SKIP pattern and
  # every language came back SKIP. That is the very conflation the verdict
  # contract forbids -- one gate's "not checked" standing in for another's verdict
  # -- reproduced inside the probe that hunts it. The hook prints a "--> Gate N:"
  # banner before each gate, so the section is delimited by those banners.
  local section
  section=$(printf '%s\n' "$out" | awk '
    /^→ Gate 5[: ]/ { inm=1; print; next }
    /^→ Gate [0-9]/ { inm=0 }
    inm' )

  verdict="NONE"
  if [ -z "$section" ]; then
    verdict="NONE"
  elif printf '%s' "$section" | grep -qE 'Tests FAILED|Tests failed|❌ BLOCKED'; then
    verdict="BLOCK"
  elif printf '%s' "$section" | grep -qE '⏭️  SKIP|SKIPPED|SKIP -'; then
    verdict="SKIP"
  elif printf '%s' "$section" | grep -qE '✅ PASSED|✅ Tests|test run|Tests passed'; then
    verdict="PASS"
  fi

  if [ "$verdict" = "$expect" ]; then
    PASS_N=$((PASS_N+1))
    ROWS+=("$(printf '%-14s %-8s %s' "$lang" "$verdict" "ok")")
  else
    FAIL_N=$((FAIL_N+1))
    local reason
    reason=$(printf '%s' "$out" | grep -oE '(Tests FAILED|No test runner[^.]*|not found[^.]*|SKIPPED - [^.]*)' | head -1)
    FAILURES+=("$lang: got $verdict, expected $expect (${reason:-no verdict line})")
    ROWS+=("$(printf '%-14s %-8s %s' "$lang" "$verdict" "EXPECTED $expect")")
  fi
  return 0
}

run_lang() {
  local lang="$1" tool="$2"
  local dir="$WORK/$lang"
  mkdir -p "$dir"
  "mk_$lang" "$dir" || { SKIP_N=$((SKIP_N+1)); ROWS+=("$(printf '%-14s %-8s %s' "$lang" "SKIP" "fixture build failed")"); return 0; }
  judge "$lang" BLOCK "$dir" "$tool"
}

echo "=============================================="
echo " GATE 5 x LANGUAGE EFFECTIVENESS PROBE"
echo "=============================================="
echo " Each language ships a DELIBERATELY FAILING test."
echo " Correct verdict for every one of them: BLOCK."
echo ""

run_lang typescript node
run_lang python     pytest
run_lang go         go
run_lang shell      bats
run_lang powershell pwsh
run_lang java       mvn
run_lang cpp        cmake
run_lang dart       dart
run_lang php        php

echo ""
echo "----------------------------------------------"
printf ' %-14s %-8s %s\n' "LANGUAGE" "VERDICT" "NOTE"
echo "----------------------------------------------"
for r in "${ROWS[@]}"; do echo " $r"; done
echo "----------------------------------------------"
printf ' PASS: %d   FAIL: %d   SKIP: %d\n' "$PASS_N" "$FAIL_N" "$SKIP_N"
if [ "$FAIL_N" -gt 0 ]; then
  echo " FAILURES:"
  printf '   - %s\n' "${FAILURES[@]}"
fi
echo "=============================================="
[ "$FAIL_N" -eq 0 ]
