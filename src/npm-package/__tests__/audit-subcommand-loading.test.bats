#!/usr/bin/env bats
#
# @test REQ-AUDIT-SUBCOMMAND-LOADING
# @intent `xp-gate audit` has four entry points, and three of them still tried to
#         `require()` a TypeScript file, which Node cannot do.
#
#         The fix for this was already written and documented in
#         bin/xp-gate.js: `evalGateAuditModule()` evaluates the module under tsx,
#         and the comment above it states plainly that `--tail`, `--stats`,
#         `--check` and `record` were ALL unusable and that it went unnoticed
#         because CI's Gate 5c runs `xp-gate audit --check || npx tsx ...`, so the
#         fallback was what actually ran.
#
#         Only `--check` was converted. Measured:
#
#           $ xp-gate audit --stats
#           Error computing stats: require is not defined in ES module scope
#
#           $ xp-gate audit --tail 5
#           Error reading audit entries: require is not defined in ES module scope
#
#           $ xp-gate audit --check
#           (works)
#
#         So the comment describes four broken entry points and the code fixes
#         one. A partial fix that its own comment presents as complete is worse
#         than none: the next reader trusts the comment.
#
#         `audit` is an ADVISORY command (src/npm-package/AGENTS.md: diagnostics
#         exit 0), so the failure mode is not a blocked build -- it is a diagnostic
#         that silently does not diagnose. `--stats` is exactly the command used to
#         produce this session's timing tables, which is how the breakage was
#         found: the numbers had to be computed by reading audit.jsonl by hand.
#
# @covers AC-AUDIT-SUBCOMMAND-LOADING-01
# @covers AC-AUDIT-SUBCOMMAND-LOADING-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  CLI="$REPO/src/npm-package/bin/xp-gate.js"
}

@test "AC-AUDIT-SUBCOMMAND-LOADING-01: no audit subcommand require()s the .ts module directly" {
  # A structural guard: require() of a .ts path is the defect, in any handler.
  # Excluding comments matters -- the file documents the old failure in prose, and
  # a naive grep matches the explanation instead of the code.
  local offenders
  offenders=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$CLI" \
    | grep -nE 'require[(]auditPath[)]|require[(][^)]*gate-audit' || true)

  if [ -n "$offenders" ]; then
    echo "these lines require() a TypeScript module, which Node cannot load:"
    printf '%s\n' "$offenders"
    echo ""
    echo "evalGateAuditModule() already exists in this file for exactly this;"
    echo "measured outcome of the unconverted paths:"
    echo "  xp-gate audit --stats -> Error computing stats: require is not defined"
    echo "  xp-gate audit --tail  -> Error reading audit entries: require is not defined"
    return 1
  fi
}

@test "AC-AUDIT-SUBCOMMAND-LOADING-02: audit --stats and --tail actually produce output" {
  # Behavioural: the structural guard can be satisfied by deleting the feature.
  # Both commands must run without the module-loading error.
  local stats tail
  stats=$(cd "$REPO/src/npm-package" && node "$CLI" audit --stats 2>&1 || true)
  tail=$(cd "$REPO/src/npm-package" && node "$CLI" audit --tail 3 2>&1 || true)

  if printf '%s' "$stats" | grep -q 'require is not defined'; then
    echo "audit --stats still fails to load the module:"
    printf '%s\n' "$stats" | head -2
    return 1
  fi
  if printf '%s' "$tail" | grep -q 'require is not defined'; then
    echo "audit --tail still fails to load the module:"
    printf '%s\n' "$tail" | head -2
    return 1
  fi

  # Not merely "no error": the command must actually report something. "No audit
  # entries found" is a legitimate answer only if the file is empty, which it is
  # not in this repository.
  printf '%s' "$stats" | grep -qiE '[0-9]' || {
    echo "audit --stats produced no numeric output:"
    printf '%s\n' "$stats" | head -3
    return 1
  }
}