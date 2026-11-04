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

# --- every declared implementation must really be sourced by pre-commit ----

@test "every non-inline gate script is sourced by pre-commit" {
  local impl missing=""
  while IFS= read -r impl; do
    [ -n "$impl" ] || continue
    grep -q "$impl" "$REPO_ROOT/githooks/pre-commit" || missing="$missing $impl"
  done < <(gate_all_impls)
  [ -z "$missing" ] || {
    echo "gate script(s) declared in the registry but never sourced by pre-commit:$missing"
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

@test "registry says code-quality cannot block (matches pre-commit behaviour)" {
  # Gate 1's adapter branch prints SKIPPED/PASSED and never exits. Pinned in
  # issue-717-blocking-matrix.test.bats; asserted here so the registry cannot
  # silently claim a blocking power the gate does not have.
  run gate_can_block code-quality
  [ "$output" = "NO" ]
}

@test "registry says gate-9 build-integrity cannot block" {
  run gate_can_block build-integrity
  [ "$output" = "NO" ]
}

# --- a gate that reports BLOCK must actually block ------------------------

@test "gate-12b exits non-zero on a mirror violation, not just prints" {
  # #717: the failure branch set GATE_FAILED=1, an identifier assigned once in
  # pre-commit and read nowhere. The gate printed BLOCKED on every doc edit and
  # the commit landed. Same defect class as a filter that accepts a language no
  # adapter claims: the mechanism looks like enforcement but enforces nothing.
  run grep -A14 'BLOCKED - Gate 12b: \$MIRROR_FAIL mirror parity' "$REPO_ROOT/githooks/pre-commit"
  printf '%s' "$output" | grep -q 'exit 1' || {
    echo "Gate 12b's failure branch does not exit -- a printed BLOCK would not block"
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
  run grep -A4 'AGENTS.md) continue' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
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
