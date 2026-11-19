#!/usr/bin/env bats
# @test REQ-G1-REASON-COVERAGE
#
# @intent Gate 1's adapter contract is:
#
#     0 = pass, 1|2 = block, 3 = warn (not verified)
#
# and a reason crosses the subshell boundary ONLY as an `XP_G1_REASON: ` stdout line,
# because the adapter runs inside `$( ... )` and an `export` there cannot reach the
# caller. Gate 1 lifts that line into GATE_1_DETAIL.
#
# Measured 2026-11-20 on a PHP fixture with no composer.json:
#
#     ❌ BLOCKED - php toolchain could not execute — NOT a pass (fail-closed): unknown
#
# The gate refused -- correct, fail-closed -- and told the operator "unknown". The
# adapter had printed a perfectly good sentence ("phpstan is not installed --
# static analysis not measurable") to the console and recorded nothing machine-
# readable. Deleting the reason from the journal is how a fail-closed verdict becomes
# impossible to act on.
#
# Four of the six adapters that return 2 carried no reason at all:
#   cpp 4, csharp 9, iac 1, php 18   (java and powershell were already compliant)

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTERS="$REPO_ROOT/githooks/adapters"
}

# @covers an adapter that can refuse to evaluate must say why
@test "every adapter that returns 2 can emit a machine-readable reason" {
  local offenders=""
  local f base returns reasons
  for f in "$ADAPTERS"/*.sh; do
    base=$(basename "$f")
    returns=$(grep -cE '\breturn 2\b' "$f" 2>/dev/null || true)
    [ -z "$returns" ] && returns=0
    [ "$returns" -eq 0 ] && continue
    reasons=$(grep -c 'XP_G1_REASON' "$f" 2>/dev/null || true)
    [ -z "$reasons" ] && reasons=0
    # Not a hard 1:1 -- one guard may cover several returns -- but an adapter with
    # NO reason mechanism at all can only ever report "unknown".
    if [ "$reasons" -eq 0 ]; then
      offenders="$offenders ${base}(${returns} returns, 0 reasons)"
    fi
  done

  if [ -n "$offenders" ]; then
    echo "Adapters that refuse to evaluate without recording why:$offenders"
    return 1
  fi
}

# @covers the specific contract Gate 1 reads
@test "the reason line format is exactly what Gate 1 parses" {
  # Gate 1 extracts with:  sed -n 's/^XP_G1_REASON: //p'
  # So the prefix must be at column 0 with exactly one space after the colon, and
  # the reason must not be empty. Anything else is invisible to the gate.
  local f bad=""
  for f in "$ADAPTERS"/*.sh; do
    # Report a reason echo whose text is empty or malformed.
    if grep -nE 'echo +"XP_G1_REASON:"' "$f" >/dev/null 2>&1; then
      bad="$bad $(basename "$f"):empty-reason"
    fi
    if grep -nE 'echo +"XP_G1_REASON:[^ ]' "$f" >/dev/null 2>&1; then
      bad="$bad $(basename "$f"):no-space"
    fi
    if grep -nE "echo +'XP_G1_REASON: " "$f" >/dev/null 2>&1; then
      bad="$bad $(basename "$f"):single-quoted"
    fi
  done
  if [ -n "$bad" ]; then
    echo "Malformed reason lines:$bad"
    return 1
  fi
}

# @covers the php adapter, the one that produced "unknown"
@test "the php adapter emits a reason on its not-a-project path" {
  local php="$ADAPTERS/php.sh"
  # This is the path the fixture took: no composer.json, no phpunit.xml.
  # It returns 0 (not a PHP project, nothing to check) rather than 2, so it needs
  # no reason -- but the paths that DO refuse must carry one.
  run grep -c 'XP_G1_REASON: phpstan_missing' "$php"
  [ "$output" -ge 1 ]
  run grep -c 'XP_G1_REASON: phpcs_missing' "$php"
  [ "$output" -ge 1 ]
  run grep -c 'XP_G1_REASON: phpunit_missing' "$php"
  [ "$output" -ge 1 ]
}
