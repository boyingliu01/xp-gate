#!/usr/bin/env bats
# @test REQ-GATE-DUAL-COPY-PARITY
#
# @intent Some gate scripts ship in TWO places that different installs load:
#
#     githooks/<name>.sh            <- canonical (sync-package-content.js says so)
#     githooks/adapters/<name>.sh   <- what resolveGateScript() finds when
#                                      adapterDir is ~/.config/xp-gate/adapters
#
# A project install resolves $GATE_DIR to githooks/ and reads the canonical copy.
# A global install reads the adapters copy. So a divergence is invisible locally:
# the run that validates the work is not the program the user gets.
#
# MEASURED 2026-11-20, before this check existed: FIVE copies had drifted.
#
#     gate-13-compiler-strictness.sh  1458 vs 1770 lines
#         adapters gained gate13_run_declared_checks(); canonical did not.
#         A project install printed
#             gate-13-entry.sh: line 796: gate13_run_declared_checks: command not found
#             Gate 13 (PASS) completed in 0s
#         and every adapter-declared compile-time check -- go vet, cargo check,
#         dart analyze -- had never run. The local run was the LOOSER one.
#     gate-7.sh, gate-8.sh, gate-10.sh, gate-12-file-hygiene.sh  also drifted.
#         gate-10 had been repaired earlier in the same session and that repair
#         reached only one of the two copies.
#
# scripts/check-hook-mirror.sh guarded githooks/<f> -> src/npm-package/<f> and said
# nothing about githooks/adapters/, which is why this survived. It now checks both
# content and mode for every name present in both places.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GUARD="$REPO_ROOT/scripts/check-hook-mirror.sh"
}

# @covers the guard exists and is the one pre-push runs
@test "the mirror guard carries the dual-copy rule" {
  run grep -c 'gate script has diverged between the two places it ships' "$GUARD"
  [ "$output" = "1" ]
}

# @covers the repository is clean under the rule right now
@test "every gate script present in both places is byte-identical" {
  local drifted="" f base
  for f in "$REPO_ROOT"/githooks/adapters/gate-*.sh "$REPO_ROOT"/githooks/adapters/sprint-gate.sh; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    [ -f "$REPO_ROOT/githooks/$base" ] || continue
    cmp -s "$f" "$REPO_ROOT/githooks/$base" || drifted="$drifted $base"
  done
  if [ -n "$drifted" ]; then
    echo "diverged:$drifted"
    return 1
  fi
}

# @covers the rule is enforced, not merely present
@test "the guard FAILS when a dual copy is made to differ" {
  # Mutate an adapters copy in place, run the real guard, restore. The point is
  # that the guard goes red -- a rule that exists but cannot fail is the exact
  # shape this whole effort is about.
  local target
  target=$(ls "$REPO_ROOT"/githooks/adapters/gate-*.sh 2>/dev/null | while read -r p; do
    b=$(basename "$p"); [ -f "$REPO_ROOT/githooks/$b" ] && { echo "$p"; break; }
  done)
  [ -n "$target" ] || skip "no dual-copy gate scripts to mutate"

  local backup
  backup=$(mktemp)
  cp "$target" "$backup"

  printf '\n# falsification probe -- makes this copy differ\n' >> "$target"
  run bash -c "cd '$REPO_ROOT' && bash scripts/check-hook-mirror.sh"
  local status=$status output=$output

  cp "$backup" "$target"
  rm -f "$backup"

  # The guard must have rejected, and must have named the file.
  [ "$status" -ne 0 ]
  echo "$output" | grep -q 'diverged between the two places it ships'
  echo "$output" | grep -q "$(basename "$target")"
}

# @covers a mode-only divergence is caught too
@test "the guard checks the mode of dual copies, not just their bytes" {
  run grep -c 'gate script mode differs between the two places it ships' "$GUARD"
  [ "$output" = "1" ]
}
