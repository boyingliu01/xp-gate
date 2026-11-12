#!/usr/bin/env bash
# ============================================================================
# Shared fixture helper: read the SOURCE of the whole pre-commit gate chain
# (#798).
#
# WHY THIS EXISTS
#   pre-commit used to be one 6341-line file, so a test could assert "the hook
#   does X" by grepping that one path. Since #798 the source is split:
#
#     pre-commit             preamble + driver call + epilogue
#     gate-driver.sh         XP_GATE_ORDER and the runner
#     gate-entries/*.sh      one gate body per file
#
#   An assertion that still greps pre-commit alone finds nothing, and "finds
#   nothing" is usually written as a FAILURE (grep exits 1) -- so the test
#   reports a behaviour regression when only the file layout changed. Worse, the
#   mirror case: an assertion written as `! grep -q ...` PASSES for the wrong
#   reason once the code moves, because "not found" is now trivially true.
#
#   Both directions are fixed by asserting against the whole chain, which is
#   what this helper returns.
#
# USAGE
#   . "$BATS_TEST_DIRNAME/helpers/gate-chain-source.bash"
#
#   @test "..." {
#     run gate_chain_grep 'some pattern'
#     [ "$status" -eq 0 ]
#   }
#
#   @test "..." {
#     gate_chain_source > "$BATS_TEST_TMPDIR/chain.sh"   # for sed/awk extraction
#   }
# ============================================================================

# gate_chain_source <githooks-dir>
#
# Writes the concatenated source of the chain to stdout. Defaults to the
# repository's githooks/ (two levels up from __tests__/). Files are concatenated
# with a header comment so a match can be traced back to its file.
gate_chain_source() {
  local src="${1:-$BATS_TEST_DIRNAME/..}"
  local f

  [ -f "$src/pre-commit" ] || {
    echo "gate_chain_source: $src/pre-commit not found" >&2
    return 1
  }

  printf '# ==== %s ====\n' "pre-commit"
  cat "$src/pre-commit"

  for f in gate-driver.sh gate-registry.sh; do
    [ -f "$src/$f" ] || continue
    printf '\n# ==== %s ====\n' "$f"
    cat "$src/$f"
  done

  # Sorted so the output is stable across filesystems.
  for f in $(ls "$src"/gate-entries/*.sh 2>/dev/null | LC_ALL=C sort); do
    printf '\n# ==== %s ====\n' "${f##*/}"
    cat "$f"
  done

  return 0
}

# gate_chain_grep <grep-args...>
#
# grep the concatenated chain. Mirrors `grep`'s exit status, so a test can write
#     run gate_chain_grep -q 'pattern'
#     [ "$status" -eq 0 ]
gate_chain_grep() {
  gate_chain_source | grep "$@"
}

# gate_chain_matches <extended-regex>
#
# True when the chain contains the pattern. Thin wrapper for the common case.
gate_chain_matches() {
  gate_chain_source | grep -qE -- "$1"
}
