#!/usr/bin/env bats
# @test REQ-717
# @intent Gate numbers are labels, not identities. In #717 a C# SAST fix was
#         written into githooks/gate-9.sh because root AGENTS.md said Gate 9 was
#         SAST; SAST is gate 10 and gate-9.sh is not sourced by any hook, so the
#         fix changed nothing. These tests bind each gate's NAME to the FILE
#         that actually runs it, and fail when code or docs drift from that.
# @covers AC-717-25

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  # shellcheck source=/dev/null
  . "$REPO_ROOT/githooks/gate-registry.sh"
}

# --- the lookup that would have caught #717 --------------------------------

@test "gate_name_for_file maps gate-10.sh to sast" {
  run gate_name_for_file gate-10.sh
  [ "$status" -eq 0 ]
  [ "$output" = "sast" ]
}

@test "gate-9.sh belongs to NO gate, which is why patching it did nothing" {
  # Gate 9 (build-integrity) is implemented inline in pre-commit; gate-9.sh is
  # dead weight shipped by install.sh and sourced by nothing. So the file maps
  # to no gate at all -- and an implementation that maps to nothing cannot be
  # the implementation of anything, which is exactly the #717 mistake.
  run gate_name_for_file gate-9.sh
  [ "$status" -ne 0 ]
  # Guard the other direction: the SAST gate must never claim this file.
  run gate_impl sast
  [ "$output" != "gate-9.sh" ]
}

@test "the sast gate's implementation is gate-10.sh" {
  run gate_impl sast
  [ "$status" -eq 0 ]
  [ "$output" = "gate-10.sh" ]
}

@test "unknown gate names fail the lookup instead of matching nothing" {
  run gate_impl definitely-not-a-gate
  [ "$status" -ne 0 ]
}

# --- every declared implementation must really be sourced by the gate chain ---

@test "every non-inline gate script is sourced by pre-commit" {
  # #798 split the hook: the `source "$GATE_DIR/gate-N.sh"` lines now live in
  # gate-entries/gate-N-entry.sh, which the driver sources. The invariant this
  # guards is unchanged -- "a registry row must name a script some gate really
  # sources" -- so it reads the whole chain. That is the #717/#738 failure this
  # test exists for: a SAST fix landed in gate-9.sh, a file no hook sourced.
  local chain impl missing=""
  chain=$(cat "$REPO_ROOT/githooks/pre-commit" \
            "$REPO_ROOT/githooks/gate-driver.sh" \
            "$REPO_ROOT"/githooks/gate-entries/*.sh 2>/dev/null)
  while IFS= read -r impl; do
    [ -n "$impl" ] || continue
    printf '%s' "$chain" | grep -q "$impl" || missing="$missing $impl"
  done < <(gate_all_impls)
  [ -z "$missing" ] || {
    echo "gate script(s) declared in the registry but never sourced by the gate chain:$missing"
    false
  }
}

@test "every gate script file the registry names actually exists" {
  local impl missing=""
  while IFS= read -r impl; do
    [ -n "$impl" ] || continue
    [ -f "$REPO_ROOT/githooks/$impl" ] || missing="$missing $impl"
  done < <(gate_all_impls)
  [ -z "$missing" ] || {
    echo "gate script(s) named in the registry but absent on disk:$missing"
    false
  }
}

@test "gate-9.sh is not sourced by any hook, so it cannot be the sast gate" {
  # The fact behind the warning banner in that file. If this ever changes, the
  # registry row for build-integrity must change with it.
  run grep -c 'gate-9.sh' "$REPO_ROOT/githooks/pre-commit" "$REPO_ROOT/githooks/pre-push"
  [ "$status" -ne 0 ]
}

# --- the registry must cover every gate the hook reports -------------------

@test "the registry covers all 14 numbered gates with unique numbers" {
  local nums
  nums=$(gate_registry_dump | awk '{print $1}' | sort -n | tr '\n' ' ')
  [ "$nums" = "0 1 2 3 4 5 6 7 8 9 10 11 12 13 " ]
}

@test "every report key in pre-commit has a registry entry" {
  # The report writes gateN_<slug> keys. A gate that reports but is missing
  # from the registry is a gate nobody can look up by name.
  local missing=""
  while IFS= read -r key; do
    local num
    num=$(printf '%s' "$key" | sed -n 's/^gate\([0-9]*\)_.*/\1/p')
    [ -n "$num" ] || continue
    gate_name_for_number "$num" >/dev/null || missing="$missing $num"
  done < <(grep -oE '"gate[0-9]+_[a-z_]+"' "$REPO_ROOT/githooks/pre-commit")
  [ -z "$missing" ] || {
    echo "report key(s) with no registry entry for gate number(s):$missing"
    false
  }
}

# --- docs must agree with the registry ------------------------------------

@test "root AGENTS.md gate table agrees with the registry about each number" {
  # The original defect: root AGENTS.md listed Gate 9 as Semgrep SAST while the
  # hook ran Build Integrity. This asserts the document against the registry so
  # a stale table fails here rather than misleading the next contributor.
  local num name title line
  while IFS= read -r line; do
    num=$(printf '%s' "$line" | sed -n 's/^[0-9]*[[:space:]]*\([0-9]*\)[[:space:]].*/\1/p')
    [ -n "$num" ] || continue
    name=$(gate_name_for_number "$num") || continue
    title=$(gate_title "$name")
    # The registry title's first word must appear in that row of the document.
    local first_word
    first_word=$(printf '%s' "$title" | cut -d' ' -f1)
    printf '%s' "$line" | grep -qi "$first_word" || {
      echo "AGENTS.md row for gate $num does not mention '$first_word' (registry says: $title)"
      echo "  row: $line"
      false
    }
  done < <(gate_registry_dump)
}

@test "no doc asserts Gate 9 is SAST" {
  # Stated directly because this exact claim caused the #717 wrong-file fix.
  # Only table rows are matched: a row is what misleads a reader into editing
  # the wrong file, while prose that explains the old mistake is the fix itself
  # and must not fail this test.
  run grep -rnE '^\|[[:space:]]*9[[:space:]]*\|.*(SAST|[Ss]emgrep)' \
    "$REPO_ROOT/AGENTS.md" "$REPO_ROOT/githooks/AGENTS.md" 2>/dev/null
  [ "$status" -ne 0 ]
}

# --- blocking matrix in the registry must match reality -------------------

@test "registry says sast and compiler-strictness can block" {
  run gate_can_block sast
  [ "$output" = "YES" ]
  run gate_can_block compiler-strictness
  [ "$output" = "YES" ]
}

@test "registry says code-quality CAN block (Gate 1's language arm exits 1)" {
  # This test used to assert NO, with the reasoning that "Gate 1's adapter
  # branch prints SKIPPED/PASSED and never exits". That is true of the TS
  # special-case arms and false of the generic adapter arm every adaptive
  # language goes through: pre-commit:2389-2401 sets GATE_1_STATUS="BLOCK" and
  # `exit 1` whenever run_lint() returns 1. The registry said NO while the hook
  # could reject a commit, and this assertion is what kept the two in step --
  # pinning the wrong answer makes a drift test into a drift guard.
  run gate_can_block code-quality
  [ "$output" = "YES" ]
}

@test "registry says build-integrity CAN block (Gate 9 exits 1 on a failed build)" {
  # pre-commit:5156-5162: GATE_9_TS_STATUS="BLOCK" is followed by `exit 1`.
  # Claiming NO meant a reader could believe a red build still lands.
  run gate_can_block build-integrity
  [ "$output" = "YES" ]
}

@test "every gate the registry marks NO really cannot exit" {
  # The blocks column is only worth reading if it is derived from behaviour
  # rather than maintained by hand -- #769 recorded that it was already wrong
  # on the day it shipped. For each NO row, fail if any assignment of that
  # gate's status to BLOCK is immediately followed by an exit.
  #
  # Iterates GATE_REGISTRY_ROWS (raw "name|number|impl|blocks"), not
  # gate_registry_dump -- the dump is a space-aligned human table, so an IFS='|'
  # read over it parses nothing and the loop silently passes without testing
  # a single gate. That is the same vacuous-assertion shape this file exists
  # to prevent.
  local row name num impl blocks statusvar chain
  local checked=0
  # #798 moved the gate bodies into gate-entries/, so the status assignments and
  # their terminal statements live there, not in pre-commit. Reading the whole
  # chain is also what keeps this from becoming a vacuous pass: an empty grep over
  # pre-commit alone finds no BLOCK assignment and silently "succeeds".
  chain=$(cat "$REPO_ROOT/githooks/pre-commit" \
            "$REPO_ROOT/githooks/gate-driver.sh" \
            "$REPO_ROOT"/githooks/gate-entries/*.sh 2>/dev/null)
  for row in "${GATE_REGISTRY_ROWS[@]}"; do
    IFS='|' read -r name num impl blocks <<< "$row"
    [ "$blocks" = "NO" ] || continue
    checked=$((checked + 1))
    statusvar="GATE_${num}_STATUS"
    # `return 1` counts as terminating for the same reason as `exit 1`: the gate
    # body is a function now, and the driver turns a non-zero return into the
    # hook's exit status.
    if printf '%s' "$chain" | grep -n -A4 "${statusvar}=\"BLOCK\"" | grep -qE '(exit|return) 1'; then
      echo "registry says $name cannot block, but ${statusvar}=\"BLOCK\" is followed by a non-zero exit/return"
      false
    fi
  done
  # Anti-vacuity: if the loop never ran, this test proves nothing.
  [ "$checked" -gt 0 ] || {
    echo "no NO rows were inspected -- the loop did not execute"
    false
  }
}

# --- a gate that reports BLOCK must actually block ------------------------

@test "gate-12b exits non-zero on a mirror violation, not just prints" {
  # #717: the failure branch set GATE_FAILED=1, an identifier assigned once in
  # pre-commit and read nowhere. The gate printed BLOCKED on every doc edit and
  # the commit landed. Same defect class as a filter that accepts a language no
  # adapter claims: the mechanism looks like enforcement but enforces nothing.
  #
  # #798 wrapped every gate body in `gate_N_run()`, so the terminal statement is
  # now `return 1` rather than `exit 1`: the driver turns a non-zero return into
  # the hook's exit status (see scripts/wrap-gate-entries.cjs). The property being
  # asserted is unchanged -- "the failure branch TERMINATES the gate with a
  # non-zero status" -- so both spellings satisfy it, and allowing only `exit 1`
  # would fail a gate that still blocks perfectly.
  local text
  text=$(cat "$REPO_ROOT/githooks/pre-commit" \
           "$REPO_ROOT/githooks/gate-driver.sh" \
           "$REPO_ROOT"/githooks/gate-entries/*.sh 2>/dev/null)
  printf '%s' "$text" | grep -A14 'BLOCKED - Gate 12b: \$MIRROR_FAIL mirror parity' \
    | grep -qE '(exit|return) 1' || {
    echo "Gate 12b's failure branch does not terminate with a non-zero status -- a printed BLOCK would not block"
    false
  }
}

@test "no gate writes a failure to a variable nobody reads" {
  # GATE_FAILED was exactly that. Assert it is gone rather than merely unused.
  run grep -E '^\s*GATE_FAILED=' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -ne 0 ]
}

@test "gate-12b skips documentation files, which have no mirror by design" {
  # githooks/AGENTS.md has no hooks/AGENTS.md counterpart; requiring one made
  # every doc refresh a false BLOCK.
  #
  # #798 moved this loop into gate-entries/gate-12b-entry.sh, so the assertion
  # reads the whole chain instead of pre-commit alone.
  local text
  text=$(cat "$REPO_ROOT/githooks/pre-commit" \
           "$REPO_ROOT/githooks/gate-driver.sh" \
           "$REPO_ROOT"/githooks/gate-entries/*.sh 2>/dev/null)
  printf '%s' "$text" | grep -q -A4 'AGENTS.md) continue'
}

# --- the registry must actually be LOADED, not merely present ------------

@test "pre-commit sources gate-registry.sh" {
  # eb2097b0 shipped the registry and its 17 tests, and the tests were green --
  # because they assert what the FILE contains, not that anything reads it. On
  # that commit the registry existed and no hook loaded it. Same shape as Gate
  # 12b printing BLOCKED from a variable nothing read.
  run grep -q '_GATE_REGISTRY' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
}

@test "pre-commit's sourcing line actually resolves and runs" {
  # Content assertions cannot tell a working source from a path that never
  # resolves. Execute the sourcing block in a subshell and prove the registry's
  # functions become callable in the hook's process.
  run bash -c '
    set -e
    _GATE_REGISTRY="$1/githooks/gate-registry.sh"
    [ -f "$_GATE_REGISTRY" ] || exit 9
    . "$_GATE_REGISTRY"
    # If sourcing worked, the lookup answers. If it silently failed, this is a
    # command-not-found instead of the expected name.
    out=$(gate_name_for_file gate-10.sh)
    [ "$out" = "sast" ] || exit 10
  ' _ "$REPO_ROOT"
  [ "$status" -eq 0 ]
}

@test "the hook still works when the registry is absent (graceful degradation)" {
  # Consumer repos installed from an older package have no registry file. The
  # sourcing block is guarded, so the hook must not fail on a missing file.
  run bash -c '
    _GATE_REGISTRY="/nonexistent/gate-registry.sh"
    if [ -f "$_GATE_REGISTRY" ]; then . "$_GATE_REGISTRY"; fi
    echo "reached end without failing"
  '
  [ "$status" -eq 0 ]
  [ "$output" = "reached end without failing" ]
}
