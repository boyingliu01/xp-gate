#!/usr/bin/env bats
# @test REQ-LINT-BASELINE
#
# @intent Gate 1 blocks when shellcheck findings in the STAGED files exceed a
# per-file baseline. Two things then have to be true or the gate is unappeasable:
# the baseline file must be producible, and the advice printed when it blocks must
# name something that exists.
#
# Measured 2026-11-20 on this repository:
#   - .xp-gate/lint-baseline.json was `{}` (0 recorded), so the baseline was 0
#   - pre-push alone carried 15 shellcheck findings
#   - every commit touching a shell file was blocked with
#       "❌ BLOCKED - 14 NEW shellcheck issue(s) (baseline: 0, current: 14)"
#     and the number moved between runs because only STAGED files are counted
#   - the gate's own advice was "Run 'xp-gate baseline reset'", and
#     `xp-gate baseline` is not a subcommand
#
# So the repository could not commit its own shell scripts, and the suggested repair
# did not exist. A gate that cannot be satisfied and cannot be explained is
# indistinguishable from a broken gate.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE1="$REPO_ROOT/githooks/gate-entries/gate-1-entry.sh"
  GEN="$REPO_ROOT/scripts/gen-lint-baseline.cjs"
}

# @covers the advice points at a command that exists
@test "gate 1 does not tell the operator to run a command that does not exist" {
  # The specific string that was wrong. If a future rename reintroduces advice,
  # this only catches this command; the general check is the next test.
  run grep -c "xp-gate baseline reset" "$GATE1"
  [ "$output" = "0" ]
}

# @covers every remediation command the gate names is resolvable
@test "every 'Run ...' remediation printed by gate 1 names something that exists" {
  local line cmd missing=""
  # Collect the commands from the advice lines, then resolve each one.
  while IFS= read -r line; do
    cmd=$(printf '%s\n' "$line" | grep -oE 'node scripts/[a-z0-9.-]+\.cjs' | head -1)
    [ -z "$cmd" ] && continue
    local script
    script=$(printf '%s' "$cmd" | sed 's|^node ||')
    [ -f "$REPO_ROOT/$script" ] || missing="$missing $script"
  done < <(grep -E "echo \"(Run|After)" "$GATE1")

  if [ -n "$missing" ]; then
    echo "Gate 1 advises scripts that do not exist:$missing"
    return 1
  fi
}

# @covers a baseline can actually be produced
@test "the lint baseline generator exists and is runnable" {
  [ -f "$GEN" ]
  # --check must not write. It exits 0 on match and 1 on drift, never 2 unless the
  # tool is missing; a missing tool is "not measured" and must not look like drift.
  run node "$GEN" --check
  [ "$status" -ne 2 ]
}

# @covers the baseline records the measured tree rather than a hand-typed number
@test "the baseline file, when present, has the schema gate 1 reads" {
  local baseline="$REPO_ROOT/.xp-gate/lint-baseline.json"
  # Absent is a legitimate state for a fresh clone: the gate then treats the
  # baseline as 0, which is conservative. Only a PRESENT file is constrained.
  [ -f "$baseline" ] || skip "no baseline recorded in this checkout"
  run node -e '
    const b = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (Array.isArray(b)) { console.log("baseline is an array"); process.exit(1); }
    for (const [k, v] of Object.entries(b)) {
      if (typeof v?.totalWarnings !== "number") {
        console.log("entry " + k + " has no numeric totalWarnings");
        process.exit(1);
      }
    }
    console.log("ok");
  ' "$baseline"
  [ "$output" = "ok" ]
}
