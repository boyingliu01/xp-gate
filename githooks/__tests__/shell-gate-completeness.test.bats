#!/usr/bin/env bats
#
# @test REQ-SHELL-GATE-COMPLETE The shell gate chain inspects the code it claims to inspect
# @intent Two defects let the shell quality gates report success without looking:
#
#         1. `githooks/pre-push` holds a `# shellcheck source=` directive INSIDE
#            an `elif` branch. ShellCheck cannot attach a directive to a single
#            branch, so it abandons the whole `if` -- and with it every line that
#            follows. Measured: 3 parse errors, and the file's remaining ~990
#            lines were never analysed. Anything wrong below that point was
#            invisible to Gate 1, including a real SC2168 (`local` outside a
#            function) at line 1182.
#
#         2. `githooks/gate-entries/gate-1-entry.sh` filters the change set with
#            `grep '\.sh$'`, so the extensionless hooks -- `pre-commit`,
#            `pre-push`, `post-commit`, `post-merge` -- can never reach the
#            shellcheck arm. They are the two largest shell programs in this
#            repository. A file that cannot enter the gate cannot fail it.
#
#         Both defects are the same shape as the rest of this work: the gate's
#         reported state and the gate's actual coverage disagree.
#
#         These tests assert the OBSERVABLE consequence, not the implementation:
#         "shellcheck can analyse the whole hook" and "the gate's file selection
#         includes extensionless hooks". Either can be satisfied differently, but
#         neither can be satisfied by an incidental edit.
#
# @covers AC-SHELL-GATE-COMPLETE-01
# @covers AC-SHELL-GATE-COMPLETE-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

# ---------------------------------------------------------------------------
# AC-01: the hook is fully analysable -- no parse errors.
#
# A parse error is the difference between "shellcheck checked this file and
# found nothing" and "shellcheck gave up at line N". Only the first is a verdict.
# ---------------------------------------------------------------------------

@test "AC-SHELL-GATE-COMPLETE-01: pre-push has no shellcheck parse errors" {
  run shellcheck -s bash -f gcc -S error "$REPO_ROOT/githooks/pre-push"
  [ "$status" -eq 0 ]
  # Name the offending codes when it fails, so the message points at the cause
  # rather than at a bare exit status.
  [[ "$output" != *"SC1073"* ]]
  [[ "$output" != *"SC1123"* ]]
  [[ "$output" != *"SC1072"* ]]
}

@test "AC-SHELL-GATE-COMPLETE-01: analysis reaches the end of the file, not the directive" {
  # The defect is geometric: the parse error at the directive stopped the
  # analyser early, so everything below it was unread. The measurable
  # consequence is therefore "the highest line shellcheck reports on".
  #
  # Measured: before the fix the highest reported line sat ABOVE the mock-density
  # loop; after it, findings appear past line 1500 of ~1650. Asserting on the
  # maximum reported line is what distinguishes "read the file" from "gave up".
  #
  # This test does NOT assert a finding count: counts move for legitimate
  # reasons (a real fix removes one), while "analysis reached the tail" holds
  # for any correct state.
  local total max_line
  total="$(wc -l < "$REPO_ROOT/githooks/pre-push" | tr -d ' ')"
  max_line="$(shellcheck -s bash -f gcc -S style "$REPO_ROOT/githooks/pre-push" 2>/dev/null \
              | grep -oE ':[0-9]+:' | tr -d ':' | sort -n | tail -1)"
  [ -n "$max_line" ] || { echo "shellcheck reported nothing at all" >&2; false; }
  # 80% is deliberately loose: the point is "the tail was read", not an exact
  # figure that would break the moment a gate is moved or renamed.
  local threshold=$(( total * 80 / 100 ))
  [ "$max_line" -ge "$threshold" ] || {
    echo "analysis stopped at line $max_line of $total (needs >= $threshold)" >&2
    false
  }
}

@test "AC-SHELL-GATE-COMPLETE-01: the region past the old stop point carries no error-level finding" {
  # SC2168 (`local` outside a function) sat in the mock-density loop, deep in the
  # region the parse error hid. Asserting "no error-level finding anywhere" is
  # the direct statement of the goal; the SC2168 name is kept in the message so a
  # regression is identified rather than merely counted.
  run shellcheck -s bash -f gcc -S error "$REPO_ROOT/githooks/pre-push"
  [ "$status" -eq 0 ] || {
    echo "error-level findings, expected none (SC2168 was the one this region hid):" >&2
    echo "$output" >&2
    false
  }
}

@test "AC-SHELL-GATE-COMPLETE-01: pre-push is syntactically valid bash" {
  run bash -n "$REPO_ROOT/githooks/pre-push"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# AC-02: the gate's file selection reaches the extensionless hooks.
#
# The assertion is on the SELECTION LOGIC, exercised directly: a change set
# naming `pre-push` must classify it as a shell file. Before the fix the filter
# was `grep '\.sh$'` and every hook name fell straight through.
# ---------------------------------------------------------------------------

@test "AC-SHELL-GATE-COMPLETE-02: the shell arm actually lints an extensionless hook in the change set" {
  # The assertion that matters is not "a helper exists" but "the gate would hand
  # pre-push to shellcheck". That is observable end to end: run the call site in a
  # sandbox whose CHANGED_FILES names the hook plus one non-shell file, and read
  # the list the gate builds.
  #
  # This deliberately goes through the SOURCE LINE the gate uses, so restoring an
  # extension filter fails here even if the helper is still defined -- an earlier
  # version called the helper directly and therefore stayed green under exactly
  # that revert.
  local entry="$REPO_ROOT/githooks/gate-entries/gate-1-entry.sh"
  local sandbox
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/githooks" "$sandbox/src"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$sandbox/githooks/pre-push"
  printf '#!/usr/bin/env bash\nset -e\n' > "$sandbox/githooks/gate-3.sh"
  printf 'const x = 1;\n' > "$sandbox/src/app.ts"

  # Extract the helper and the assignment that consumes it, verbatim.
  {
    printf '#!/usr/bin/env bash\n'
    sed -n '/^_shell_changed_files() {/,/^}/p' "$entry"
    grep -E '^  SHELL_FILES=' "$entry"
    printf 'printf "%%s\\n" "$SHELL_FILES"\n'
  } > "$sandbox/probe.sh"

  [ -s "$sandbox/probe.sh" ] || { echo "probe extraction produced nothing" >&2; rm -rf "$sandbox"; false; }
  grep -q '_shell_changed_files' "$sandbox/probe.sh" || { echo "helper missing from probe" >&2; rm -rf "$sandbox"; false; }

  run bash -c "cd '$sandbox' && CHANGED_FILES='githooks/pre-push
githooks/gate-3.sh
src/app.ts' bash probe.sh"
  rm -rf "$sandbox"

  [ "$status" -eq 0 ]
  [[ "$output" == *"githooks/pre-push"* ]] || {
    echo "pre-push was not handed to shellcheck; got: $output" >&2
    false
  }
  [[ "$output" == *"githooks/gate-3.sh"* ]]
  # A selector that accepts everything would pass the checks above while checking
  # nothing, so the non-shell file must stay out.
  [[ "$output" != *"src/app.ts"* ]] || {
    echo "src/app.ts must not be selected as a shell file" >&2
    false
  }
}

@test "AC-SHELL-GATE-COMPLETE-02: gate-1 does not rely on a .sh extension filter" {
  local entry="$REPO_ROOT/githooks/gate-entries/gate-1-entry.sh"
  # The exact construct that hid the hooks. Stated as a property so the fix
  # cannot come back under a different variable name.
  run grep -nE "CHANGED_FILES.*grep.*\\\\\.sh\\\$" "$entry"
  [ "$status" -ne 0 ]
}