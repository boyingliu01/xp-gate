#!/usr/bin/env bash
# ============================================================================
# gate-12c entry — extracted from pre-commit by scripts/extract-gates.cjs
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
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_12c_run() {
# Gate 12c: probe discipline
#
# A command that could not RUN is not a command that found problems. The hooks
# used to answer "is this tool installed?" with `npx <tool> --version`, whose
# contract is "install it if missing, then run it" -- so the probe changed the
# environment it was asked about. `--no-install` prevents the install and
# nothing else: it still queries the registry on every call (measured 697 ms
# cold, 105 ms revalidating) inside a commit, and once an earlier misuse fills
# the npx cache the same probe starts answering "installed" for a tool the
# project never depended on.
#
# Scoped to commits that touch hook sources: the rule can only be broken by
# editing one, and scanning 51 files on every docs-only commit is exactly the
# fixed cost the input short-circuit convention exists to avoid.
if printf '%s\n' "$STAGED_FILES" 2>/dev/null | grep -qE '^githooks/(adapters/|lib/|adapter-common\.sh|pre-commit|pre-push|post-commit|post-merge)'; then
  _probe_root="${PROJECT_ROOT:-}"
  if [ -n "$_probe_root" ] && [ -f "$_probe_root/scripts/check-no-npx-probe.sh" ]; then
    echo ""
    echo "→ Gate 12c: probe discipline..."
    if (cd "$_probe_root" && bash scripts/check-no-npx-probe.sh); then
      echo "✅ PASSED - Gate 12c: no gate probes tool availability through npx"
    else
      echo ""
      echo "❌ BLOCKED - Gate 12c: a gate answers \"is this tool installed?\" by"
      echo "   asking the registry. A probe that installs the tool it was asked"
      echo "   about does not measure the environment, it changes it."
      return 1
    fi
  fi
fi
# ============================================================================

# The compiler is the first and cheapest static analyser for a compiled language
# and XP-Gate never used it as one: cpp.sh only runs clang-tidy/cppcheck over the
# first 20 files, and Gate 9's build-integrity half is TypeScript-and-Maven only.
# A measured `g++ -Wall -Wextra` pass reports -Wnon-virtual-dtor, -Wreorder,
# -Wparentheses and -Wclass-memaccess on an innocuous-looking file; bare `javac`
# reports NOTHING for a raw type where `-Xlint:all` reports [rawtypes].
#
# Verdicts: 0 PASS, 1 FAIL (new findings -> blocked), 2 BLOCK (ran but output
# untrustworthy), 3 WARN (tool absent / cross-compiling / timeout / warn-only).
# A missing compiler is a SKIP-class WARN per the project convention, NOT a block.
#
# Escape hatches: XP_GATE_DISABLE_13=1 (kill switch),
# XP_GATE_COMPILER_STRICTNESS=strict|balanced|warn-only,
# XP_GATE_COMPILER_ANALYZER=1 (gcc -fanalyzer, C only, opt-in).
# Design: docs/plans/2026-10-26-gate-13-compiler-strictness-design.md
#
# NOTE: this block is a TAIL APPEND after Gate 12 and intentionally touches no
# line of the gates above it.
  return 0
}


# Called by pre-commit's ordered driver.

