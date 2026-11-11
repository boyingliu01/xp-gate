#!/usr/bin/env bash
# ============================================================================
# gate-12b entry — extracted from pre-commit by scripts/extract-gates.cjs
#
# WHY THIS FILE EXISTS (#798)
#   The gate order used to BE the physical order of blocks in a 6341-line
#   hook, so changing the order meant moving thousands of lines. An attempt at
#   that also moved the hook epilogue, after which every gate past Gate 13
#   silently stopped running while `bash -n`, a line count and five ordering
#   tests all passed. Gate 5a stopped blocking and only a behavioural test
#   noticed. With one file per gate, order is a list of names in
#   pre-commit's GATE_ORDER and cannot detach a body from its position.
#
# THE BODY BELOW IS A BYTE-EXACT SLICE of the original block. It is wrapped
# in a function so the gate keeps its own variable scope, and is called from
# pre-commit at the point the driver reaches it. Edit the gate here from now
# on - there is no copy left in the hook.
# ============================================================================

# ============================================================================
# GATE 12b: Mirror Parity (#654)
#
# `githooks/**` and `plugins/*/src/**` are canonical; `src/npm-package/**` holds
# byte-identical mirrors that get published. Editing only the mirror means the next
# prepack silently regenerates it over the change -- v0.27.3 shipped exactly that
# bug, and mirror/sync rework accounts for 58 failures in the session logs.
#
# The check used to run only at pre-push, which turns a two-second fix into a
# five-minute wait. It runs here now, but ONLY over files in this commit: a
# full-tree scan on every commit is the cost that pushed it to pre-push in the
# first place.
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_12b_run() {
MIRROR_STAGED=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
# `src/npm-package/` is in this filter because a mirror-only edit is the
# dangerous direction, not the harmless one. Keying off the canonical paths
# alone meant staging just the mirror skipped the whole block, so a fix written
# into the published copy could be committed while its source stayed wrong --
# v0.27.3 shipped exactly that (#542). The reverse mapping below resolves each
# staged mirror back to its canonical file and compares the pair either way.
if [ -n "$MIRROR_STAGED" ] && printf '%s
' "$MIRROR_STAGED" | grep -qE '^(githooks/|plugins/[^/]+/src/|src/npm-package/(adapters|hooks|principles|build-integrity)/)'; then
  # Reuse PROJECT_ROOT: `git rev-parse` costs ~90ms per fork on Windows and this
  # gate must not add two of them to every commit (#640).
  MIRROR_REPO_ROOT="${PROJECT_ROOT:-}"
  if [ -n "$MIRROR_REPO_ROOT" ] && [ -f "$MIRROR_REPO_ROOT/scripts/check-hook-mirror.sh" ]; then
    # Scope to the touched families only: a mirror pair is clean or dirty
    # independently, and checking untouched families is the slow path this gate
    # exists to avoid.
    MIRROR_FAIL=0
    while IFS= read -r _mf; do
      [ -n "$_mf" ] || continue
      # `__tests__/` has no mirror BY DESIGN: sync-package-content.js lists it in
      # SKIP_DIRS so test suites never ship to consumers. Demanding a mirror for
      # them makes every new BATS file un-committable -- the two rules contradicted
      # each other, and the only way past was to edit a generated file by hand.
      case "$_mf" in
        */__tests__/*) continue ;;
        # AGENTS.md is documentation, not a hook artifact: sync-package-content.js
        # copies the hook suite, and no AGENTS.md exists under hooks/. Demanding a
        # mirror for it reported a BLOCK on every doc edit (harmless only because
        # GATE_FAILED was never read -- see below).
        */AGENTS.md) continue ;;
        # `githooks/adapters/` mirrors to `src/npm-package/adapters/`, NOT under
        # `hooks/` -- that is what scripts/check-hook-mirror.sh declares (line 6)
        # and what sync-package-content.js writes. The blanket `githooks/*` rule
        # below sent it to `src/npm-package/hooks/adapters/<f>`, a path that has
        # never existed, so ANY edit to an adapter was un-committable with
        # "has no mirror at". It stayed hidden because nobody had edited an
        # adapter since this gate was narrowed to diff files.
        githooks/adapters/*) _mm="src/npm-package/adapters/${_mf#githooks/adapters/}" ;;
        githooks/*) _mm="src/npm-package/hooks/${_mf#githooks/}" ;;
        plugins/*/src/*) _mm=$(printf '%s' "$_mf" | sed 's|^plugins/\([^/]*\)/src/|src/npm-package/plugins/\1/src/|') ;;
        # Reverse direction: the staged file IS the mirror. Resolve it back to
        # the canonical file and let the same comparison below decide. Without
        # this arm the widened filter above matches nothing and the gate stays
        # blind to a mirror-only edit -- the v0.27.3 shape (#542).
        src/npm-package/adapters/*) _mf="githooks/adapters/${_mf#src/npm-package/adapters/}"; _mm="src/npm-package/adapters/${_mf#githooks/adapters/}" ;;
        src/npm-package/hooks/lib/*) _mf="githooks/lib/${_mf#src/npm-package/hooks/lib/}"; _mm="src/npm-package/hooks/lib/${_mf#githooks/lib/}" ;;
        src/npm-package/hooks/*) _mf="githooks/${_mf#src/npm-package/hooks/}"; _mm="src/npm-package/hooks/${_mf#githooks/}" ;;
        src/npm-package/principles/*) _mf="src/principles/${_mf#src/npm-package/principles/}"; _mm="src/npm-package/principles/${_mf#src/principles/}" ;;
        src/npm-package/build-integrity/*) _mf="src/build-integrity/${_mf#src/npm-package/build-integrity/}"; _mm="src/npm-package/build-integrity/${_mf#src/build-integrity/}" ;;
        *) continue ;;
      esac
      if [ ! -f "$MIRROR_REPO_ROOT/$_mm" ]; then
        echo "❌ BLOCKED - Gate 12b: $_mf has no mirror at $_mm"
        echo "     Run: node src/npm-package/scripts/sync-package-content.js --fix"
        MIRROR_FAIL=$((MIRROR_FAIL + 1))
      elif ! cmp -s "$MIRROR_REPO_ROOT/$_mf" "$MIRROR_REPO_ROOT/$_mm"; then
        echo "❌ BLOCKED - Gate 12b: $_mm differs from canonical $_mf"
        echo "     Run: node src/npm-package/scripts/sync-package-content.js --fix"
        MIRROR_FAIL=$((MIRROR_FAIL + 1))
      fi
    done <<< "$MIRROR_STAGED"
    if [ "$MIRROR_FAIL" -gt 0 ]; then
      echo ""
      echo "❌ BLOCKED - Gate 12b: $MIRROR_FAIL mirror parity violation(s)."
      echo "   The mirror is what gets published; a mirror-only fix is silently"
      echo "   reverted by the next prepack (v0.27.3 shipped that bug)."
      # BLOCKS, and must actually block. This used to set GATE_FAILED=1, a
      # variable that appears exactly once in this file -- the assignment --
      # and is read nowhere, so the gate printed BLOCKED on every doc edit and
      # let the commit through. A gate that reports a verdict nobody consumes is
      # the same failure as a filter that accepts a file no adapter claims:
      # it looks like enforcement. exit is the contract every other blocking
      # gate here uses (see Gate 13: `exit "$_g13_worst"`).
      #
      # No GATE_12_STATUS assignment here: `exit 1` runs immediately after, so
      # the journal/summary writes at the end of the hook never execute and the
      # assignment would be dead -- the same "verdict nobody consumes" defect
      # one line up. Dropped rather than kept as a misleading WARN label
      # (code-walkthrough R2, A2/F1).
      return 1
    else
      echo "✅ PASSED - Gate 12b: mirror parity (touched files)"
    fi
  fi

  # ---------------------------------------------------------------------------
  # Gate 12b (second half): deploy-manifest projection freshness (REQ-DEPLOY-001).
  #
  # `src/npm-package/lib/deploy-manifest.js` is the single source of truth and
  # `githooks/deploy-manifest.sh` is a GENERATED projection of it (bash cannot
  # require() JS, so the manifest is emitted as shell arrays rather than typed a
  # second time). A generated projection whose generator is never run rots back
  # into the hand-copied lists this whole change set removed -- the 11 lists
  # that had already drifted apart before #789.
  #
  # The check lives HERE, in the gate that already owns "two files that must
  # agree", rather than in a test: a test only runs when someone runs it, and
  # the drift appears at the moment the source is edited, which is a commit.
  #
  # Only run when the source or the projection is in the change set. Unrelated
  # commits must not pay for a node spawn.
  # ---------------------------------------------------------------------------
  if printf '%s\n' "$CHANGED_FILES" | grep -qE '^(src/npm-package/lib/deploy-manifest\.js|githooks/deploy-manifest\.sh|src/npm-package/hooks/deploy-manifest\.sh|scripts/generate-deploy-manifest\.cjs)$'; then
    if [ ! -f "$PROJECT_ROOT/scripts/generate-deploy-manifest.cjs" ]; then
      # The generator is gone. The manifest/projection pair is in this change
      # set, so the projection is demonstrably in play and cannot be verified.
      echo "❌ BLOCKED - Gate 12b: deploy-manifest projection cannot be verified"
      echo "   scripts/generate-deploy-manifest.cjs is missing but the manifest or"
      echo "   its projection changed in this commit."
      return 1
    elif ! command -v node >/dev/null 2>&1; then
      # node missing while the projection is being edited: degrading this to a
      # notice would hand the silent-pass outcome to exactly the contributor who
      # cannot run the generator -- and hand-editing the projection is the drift
      # this check exists to catch (code-walkthrough R2, F-1).
      echo "❌ BLOCKED - Gate 12b: node is required to verify the deploy-manifest projection"
      echo "   The manifest or its projection changed but node is not on PATH."
      echo "   Install node, or regenerate on a machine that has it:"
      echo "   node scripts/generate-deploy-manifest.cjs && git add githooks/deploy-manifest.sh"
      return 1
    else
      echo "Checking deploy-manifest projection freshness..."
      if _dm_out=$(cd "$PROJECT_ROOT" && node scripts/generate-deploy-manifest.cjs --check 2>&1); then
        echo "✅ PASSED - Gate 12b: deploy-manifest projection is current"
      else
        echo "❌ BLOCKED - Gate 12b: deploy-manifest.sh is STALE vs deploy-manifest.js"
        printf '%s\n' "$_dm_out" | sed 's/^/   /'
        # As above: no GATE_12_STATUS assignment -- `exit 1` means the summary
        # writes never run, so the assignment would be dead (A2/F1).
        echo "   Fix: node scripts/generate-deploy-manifest.cjs && git add githooks/deploy-manifest.sh"
        return 1
      fi
    fi
  fi
fi
  return 0
}



# Called by pre-commit's ordered driver.

