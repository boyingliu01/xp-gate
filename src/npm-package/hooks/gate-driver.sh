#!/usr/bin/env bash
# ============================================================================
# Ordered gate driver (#798)
#
# WHY THIS FILE EXISTS
#   The gate order used to BE the physical order of 16 inline blocks inside
#   pre-commit. Reordering meant moving thousands of lines between blocks, and
#   the first attempt at doing that moved the hook's epilogue along with the
#   last gate: every gate after it silently stopped running while `bash -n`,
#   a line count check and five ordering assertions all passed. Gate 5a stopped
#   blocking commits and only a behavioural fingerprint caught it.
#
#   Order is now data. Each gate body lives in githooks/gate-entries/ and is
#   called by name from XP_GATE_ORDER below. Moving a gate is a one-line edit
#   that cannot detach its body from its position.
#
# CONTRACT FOR ENTRY FILES
#   gate_NN_run() returns 0 to let the commit continue and non-zero to stop it.
#   It never calls `exit`: the driver owns that decision, so the EXIT trap that
#   writes the quality report keeps firing on the gate's status (see
#   scripts/wrap-gate-entries.cjs for why return/exit are equivalent here).
# ============================================================================

# Gate execution order. THIS LIST IS THE ORDER OF THE PRE-COMMIT CHAIN.
#
# Ordered by cost, cheapest-rejecting first (#798). A gate that rejects a
# commit should do so before the expensive ones spend their time:
#
#   1. Compile      Gate 13 (compiler), Gate 9 (build integrity)
#                   The compiler is the cheapest and strictest analysis any
#                   compiled language has, and nothing downstream is meaningful
#                   if it fails.
#   2. StaticCheck  Gate 1  (linters / third-party static analysis)
#   3. SimianCheck  Gate 2  (duplicate code)
#   4. CCNCheck     Gate 3  (cyclomatic complexity)
#   5. Security     Gate 8 (secrets), Gate 10 (SAST), Gate 7 (IaC)
#   6. RegressiveTest Gate 5 (test run + coverage) - the most expensive gate,
#                   so it runs LAST among the checks.
#   tail            Gate 6 (architecture), Gate 4 (principles)
#
# The prelude (0, 11, 12/12b/12c) runs first because it is cheap and decides
# whether the commit is even a candidate (version consistency, sprint state,
# file hygiene/conflict markers).
XP_GATE_ORDER="0 11 12 12b 12c 13 9 1 2 3 8 10 7 5 6 4"

# Gates that expect to run inside $PROJECT_SUBDIR. The `cd` back to the original
# directory is emitted after the LAST of these in the order above; deriving it
# (instead of leaving the restore inside gate 8's block) is what makes the
# restore survive a reorder.
#
# Gate 5 is the last gate that actually READS the subdirectory state: it is the
# only body that consults PROJECT_SUBDIR / IN_PROJECT_SUBDIR (15 references;
# gates 4/6/7/10 have none), because Gate 5a strips that prefix from the staged
# paths before probing for a paired test file. The list used to stop at 8, so the
# `cd` back to the repo root fired after Gate 8 -- and gates 10, 7 and 5 ran
# OUTSIDE the subdirectory while still stripping the prefix from their paths.
# Gate 5 then probed `src/...test.ts` from the repo root, where the file is
# `web/src/...test.ts`, and blocked a correctly paired commit. It only ever bit
# single-language subdirectory projects, which is the narrower of the two shapes
# this hook supports, so the multi-language cases stayed green.
XP_GATE_SUBDIR_GATES="${XP_GATE_SUBDIR_GATES:-0 11 12 12b 12c 13 9 1 2 3 8 10 7 5}"

# Source every gate body once, before the chain runs. Sourcing defines the
# gate_NN_run functions; it does not execute them.
_xp_gate_load_entries() {
  local entry_dir="$1" key fname
  for key in $XP_GATE_ORDER; do
    fname="$entry_dir/gate-${key}-entry.sh"
    if [ ! -f "$fname" ]; then
      echo "❌ FATAL: gate entry missing: $fname" >&2
      echo "   The order lists gate '$key' but its body file is absent." >&2
      echo "   Fix: reinstall the hooks (xp-gate doctor --sync-hooks)." >&2
      return 1
    fi
    # shellcheck source=/dev/null
    . "$fname" || {
      echo "❌ FATAL: gate entry failed to load: $fname" >&2
      return 1
    }
  done
  return 0
}

# Run the ordered chain.
#
# A gate that returns non-zero stops the commit. The driver exits with that
# status rather than returning it: only a real `exit` fires pre-commit's EXIT
# trap, and that trap is what writes the quality report for a blocked commit.
_xp_gate_run_chain() {
  local key fn rc
  local last_subdir=""

  # Derive which gate is the LAST one expecting $PROJECT_SUBDIR, so the restore
  # is emitted at the right point regardless of how the order is edited.
  for key in $XP_GATE_ORDER; do
    case " $XP_GATE_SUBDIR_GATES " in
      *" $key "*) last_subdir="$key" ;;
    esac
  done

  for key in $XP_GATE_ORDER; do
    fn="gate_${key}_run"

    if ! declare -F "$fn" >/dev/null 2>&1; then
      echo "❌ FATAL: gate '$key' was loaded but defines no $fn()" >&2
      echo "   The entry file exists but its function signature does not match" >&2
      echo "   its order key. This gate did NOT run." >&2
      exit 1
    fi

    "$fn"
    rc=$?
    if [ "$rc" -ne 0 ]; then
      exit "$rc"
    fi

    if [ "$key" = "$last_subdir" ]; then
      # Resolve beside THIS file, not via $GATE_DIR: pre-commit's preamble points
      # GATE_DIR at ADAPTER_DIR for adapter lookup, so it does not name the
      # directory the gate bodies live in.
      local _chain_dir
      _chain_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      if [ -f "$_chain_dir/gate-entries/subdir-restore.sh" ]; then
        # shellcheck source=/dev/null
        . "$_chain_dir/gate-entries/subdir-restore.sh"
        xp_gate_subdir_restore
      fi
    fi
  done
  return 0
}
