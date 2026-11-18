#!/usr/bin/env bats
#
# @test REQ-GATE-SHELLBATS-DELEGATION
# @intent The shell adapter's `run_tests()` turns out to be UNUSABLE from Gate 5
#         once bats can actually be found. `_shell_test_files` discovers every
#         *.bats under the repo (284 in this one, measured), and bats has no
#         selection of its own, so a single `run_tests` call is a multi-hour job.
#         A commit that hangs for hours is not a stricter gate; it is a gate that
#         gets killed or bypassed.
#
#         That was hiding behind a bug. The old `command -v bats` probe failed on
#         every real hook run, printed "bats not available", and returned 0 -- so
#         Gate 5 never reached the run. Fixing the probe alone converted a silent
#         skip into a silent multi-hour hang. Measured: with only shell.sh staged,
#         the hook produced no output for 100s+ and had to be killed; with an
#         empty index the same hook finished in well under 100s.
#
#         So resolution is fixed (see shell-adapter-bats-resolution.test.bats) and
#         EXECUTION FROM GATE 5 IS REMOVED. The .bats contracts are owned by CI's
#         `bats-contracts` job, which shards them across runners; quality-gates.yml
#         says so in as many words -- "do not re-add a silent copy here" -- because
#         running them serially measured 18m47s of a 22m24s job before the move.
#
#         The required behaviour is a REPORTED DELEGATION, not a pass: this is the
#         same rule the rest of the hook lives by ("not checked must never be
#         recordable as passed"), and the reason the skip must name where the
#         check actually happens.
#
# @covers AC-SHELLBATS-03 AC-SHELLBATS-04
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/shell.sh"
  ENTRY="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
}

@test "AC-SHELLBATS-03: the shell adapter declares that its tests belong to CI" {
  # A declaration, not a language-name check in the gate. #794's lesson (applied
  # twice already) is that a hardcoded name list only ever covers the languages
  # someone remembered, and the gate owns no knowledge of which runner a language
  # uses.
  run bash -c "
    # shellcheck source=/dev/null
    . '$ADAPTER'
    command -v tests_delegated_to_ci >/dev/null 2>&1 || { echo 'no declaration'; exit 1; }
    tests_delegated_to_ci || { echo 'declaration returned false'; exit 1; }
    echo 'declared'
  "
  [ "$status" -eq 0 ] || {
    echo "the shell adapter does not declare its test delegation: $output"
    return 1
  }
  [[ "$output" == *declared* ]]
}

@test "AC-SHELLBATS-03: Gate 5 must not call run_tests for a delegating adapter" {
  # The hang is the whole point: a gate that calls run_tests for shell walks 284
  # suites. This asserts the call site is not reached, by checking the gate's own
  # control flow rather than by timing a multi-hour run.
  run grep -n 'adapter_delegates_tests_to_ci' "$ENTRY"
  [ "$status" -eq 0 ] || {
    echo "Gate 5 has no delegation check; it will call run_tests for shell and hang"
    return 1
  }
  # The check alone is not enough: it has to gate the run_tests call. Asserting
  # the call-site ordering is what distinguishes "asked the adapter" from "asked
  # and then ran it anyway", which would leave the hang in place.
  #
  # The comparison must be against the call in the NON-Typescript branch: a
  # TypeScript project without package.json also runs run_tests, from an earlier
  # line, and that one is unreachable for shell. Comparing against the first
  # occurrence in the file would compare the wrong pair and pass or fail for a
  # reason unrelated to shell.
  local deleg_line shell_else_line run_line
  deleg_line="$(grep -n 'if adapter_delegates_tests_to_ci' "$ENTRY" | head -1 | cut -d: -f1)"
  shell_else_line="$(awk -v after="${deleg_line:-0}" 'NR<after && /^      else$/ {l=NR} END{print l}' "$ENTRY")"
  run_line="$(awk -v from="${deleg_line:-0}" 'NR>from && /run_without_git_context run_tests/ {print NR; exit}' "$ENTRY")"
  [ -n "$deleg_line" ] && [ -n "$run_line" ] || {
    echo "could not locate the delegation check or a following run_tests call"
    return 1
  }
  [ "$deleg_line" -lt "$run_line" ] || {
    echo "the delegation check ($deleg_line) does not precede the run_tests call ($run_line)"
    return 1
  }
  # And the gated call must be the one shell reaches, not the TypeScript fallback.
  [ -n "$shell_else_line" ] && [ "$shell_else_line" -lt "$deleg_line" ] || {
    echo "the delegation check is not inside the branch shell reaches (else at '${shell_else_line:-none}')"
    return 1
  }
}

@test "AC-SHELLBATS-04: a delegated skip is reported with a reason naming CI" {
  # Anti-vacuity: removing the run must not be silent. Anyone reading the output
  # has to be able to tell "not checked here" from "checked and clean", and where
  # it IS checked.
  run grep -n 'bats-contracts\|delegat' "$ENTRY"
  [ "$status" -eq 0 ] || {
    echo "the delegation is silent: no output names where the suites actually run"
    return 1
  }
  [[ "$output" == *bats-contracts* ]] || {
    echo "the reason does not name the CI job that owns the suites: $output"
    return 1
  }
}

@test "AC-SHELLBATS-04: run_tests itself still works when called directly" {
  # The delegation is a GATE-level decision, not an amputation of the adapter.
  # A developer or a different host may still call run_tests, and it must still
  # discover and execute a suite that is actually there.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__" "$work/node_modules/.bin"

  printf '#!/usr/bin/env bats\n@test "x" { [ 1 -eq 1 ]; }\n' \
    > "$work/githooks/__tests__/direct.test.bats"
  cat > "$work/node_modules/.bin/bats" <<'STUB'
#!/usr/bin/env bash
echo "DIRECT_CALL_RAN"
exit 0
STUB
  chmod +x "$work/node_modules/.bin/bats"

  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:/usr/bin:/bin'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_tests 2>&1
  "

  [ "$status" -eq 0 ]
  [[ "$output" == *DIRECT_CALL_RAN* ]] || {
    echo "run_tests stopped working for a direct caller: $output"
    return 1
  }
}
@test "AC-SHELLBATS-05: a declaration does not leak into the next adapter" {
  # Adapters are sourced into ONE shell, so a function stays callable after the
  # loop moves on. Measured before the fix: once shell.sh declared its delegation,
  # powershell was reported as delegating too, though powershell.sh declares
  # nothing. That removes test verification for a language that never asked --
  # exactly what the declaration's safe default exists to prevent.
  run bash -c '
    . "'"$ADAPTER"'" || exit 9
    command -v tests_delegated_to_ci >/dev/null 2>&1 || { echo "shell did not declare"; exit 8; }
    unset -f tests_delegated_to_ci tests_delegated_to_ci_target coverage_runs_tests 2>/dev/null || true
    command -v tests_delegated_to_ci >/dev/null 2>&1 && { echo "leaked"; exit 1; }
    echo "cleared"
  '
  [ "$status" -eq 0 ] || {
    echo "the declaration survives an adapter switch: $output"
    return 1
  }
  [[ "$output" == *cleared* ]]
}

@test "AC-SHELLBATS-05: Gate 5 clears adapter declarations between languages" {
  # The clearing has to live in the loop, not in the adapter: an adapter cannot
  # know it is being replaced.
  run grep -c 'unset -f tests_delegated_to_ci' "$ENTRY"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ] || {
    echo "Gate 5 does not clear declarations between adapters"
    return 1
  }
}
