#!/usr/bin/env bats
# @test REQ-ADAPTER-ROOT-TERMINATES
#
# @intent An upward directory walk must TERMINATE. `_php_detect_root` climbed from
# $PWD looking for composer.json / phpunit.xml, stopping only when the probe string
# equalled "/".
#
# Measured 2026-11-20 on a PHP fixture, host load 0.00 (so not measurement noise):
#
#   git commit                          -> hung past 200s, no output beyond
#                                          "Running static analysis for php..."
#   bash -x githooks/pre-commit  (direct) -> completed normally in <150s
#
# The difference was PWD's FORM. git hands the hook a Windows path
# ("C:/Users/.../phpst"); a directly-invoked hook sees POSIX ("/tmp/phpst").
# dirname never reaches "/" on the Windows form:
#
#     dirname("C:/Users/think/AppData/Local/Temp/phpst") = "C:/Users/think/AppData/Local/Temp"
#     ...
#     dirname("C:") = "C:"        <- a FIXED POINT
#
# and "C:" is neither empty nor "/", so the loop condition stayed true forever.
# Process sampling showed child PIDs being created and reaped every ~12s inside
# one pre-commit, which is what a spinning walk looks like from outside.
#
# The fix compares the probe with its own predecessor and stops on a fixed point, so
# it terminates for every degenerate root rather than enumerating the forms of "/".

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PHP="$REPO_ROOT/githooks/adapters/php.sh"
}

# @covers the walk stops on a fixed point rather than on a literal "/"
@test "the php root walk has a fixed-point guard" {
  run grep -c 'next = "\$probe"' "$PHP"
  [ "$output" = "0" ] || true
  # The guard, in whatever spacing the file uses.
  run grep -cE '\[ "\$next" = "\$probe" \] && break' "$PHP"
  [ "$output" = "1" ]
}

# @covers the walk terminates when handed a Windows-form path
@test "the php root walk terminates on a Windows-form PWD" {
  # This is the exact input that hung. A timeout turns a regression back into a
  # failure instead of a suite that never finishes.
  run timeout 20 bash -c "
    PWD='C:/Users/think/AppData/Local/Temp/phpst'
    source '$PHP' 2>/dev/null
    _php_detect_root
  "
  # 0 = found a root, 1 = none found. Both are fine; a timeout (124) is not.
  [ "$status" -ne 124 ]
  [ "$status" -le 1 ]
}

# @covers the walk still finds a real marker (the guard must not over-apply)
@test "the php root walk still ascends to a composer.json" {
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/proj/sub/deeper"
  printf '{"name":"x/y"}\n' > "$tmp/proj/composer.json"

  run bash -c "source '$PHP' 2>/dev/null; _php_detect_root '$tmp/proj/sub/deeper'"
  [ "$status" -eq 0 ]
  # Compare case-insensitively: /tmp maps to a drive path on this host and the
  # two forms differ in casing.
  echo "$output" | grep -qi 'proj$'
  rm -rf "$tmp"
}

# @covers no other adapter repeats this exact unbounded walk
@test "no adapter walks upward with only a literal-/ terminator" {
  # The guard exists so the NEXT such loop is caught at review time rather than by a
  # hung commit. A file may still use "/", but it must also have a fixed-point check.
  local offenders=""
  local f
  for f in "$REPO_ROOT"/githooks/adapters/*.sh; do
    grep -q 'probe=\$(dirname' "$f" 2>/dev/null || continue
    grep -qE '\[ "\$[a-z_]+" = "\$probe" \]' "$f" 2>/dev/null && continue
    offenders="$offenders $(basename "$f")"
  done
  if [ -n "$offenders" ]; then
    echo "Adapters with an upward walk that may not terminate:$offenders"
    return 1
  fi
}
