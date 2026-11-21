#!/usr/bin/env bash
# ============================================================================
# Shared source-file classification (#732)
#
# The extension list this file exports used to be written out four times, in
# four slightly different literals:
#
#   gate-3.sh:366   (ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt)
#   gate-4.sh:79    (ts|tsx|js|jsx|py|go|java|kt|dart|swift|cpp|c|hpp|h|m|mm)
#   gate-9.sh:45,47 (ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift)
#   gate-10.sh:69   (ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift|ps1|psm1)
#
# Four literals means four chances to forget, and all four had already forgotten
# the same four extensions: mjs, cjs, mts, cts. Those are not exotic — .mjs/.cjs
# are what Node tooling ships by default now, and mts/cts are their TypeScript
# counterparts. Measured on a real repository with 14 in-scope .mjs/.cjs files:
# Gate 3 saw none of the 24 production functions above CCN 5 in them, and
# Gate 9/10 never handed the files to semgrep, which then flagged 6 ERROR-level
# findings when run on the same files directly.
#
# The gates did report SKIP, correctly, for the file list they were given. That
# is the whole problem: the file was never a candidate. "Not checked" and
# "checked and clean" must not be the same output.
#
# One list, one edit. Gates that need the population source this file.
#
# ASCII only.
# ============================================================================

# Every extension a JS/TS-family gate must consider.
#
# ORDER IS IRRELEVANT to the match, but the four ESM/CJS/ESM-TS/CTS entries are
# written first on purpose: they are the ones this list exists to keep, and a
# future reader adding to it should see them before anything else.
XP_GATE_JS_TS_EXTS='mjs|cjs|mts|cts|js|jsx|ts|tsx'

# Journals, source and script languages that Gate 4 (principles) can grade.
# Gate 4 runs a language-detecting walker rather than a per-language tool, so it
# legitimately covers more than Gate 3 (which needs a CCN-capable parser).
XP_GATE_PRINCIPLES_EXTS="${XP_GATE_JS_TS_EXTS}|py|go|java|kt|dart|swift|cpp|c|hpp|h|m|mm|cs|php"

# Languages Gate 3 can measure complexity for. A parser is required, so this is
# narrower than the principle set; keep it that way rather than implying a tool
# exists where it does not.
XP_GATE_CCN_EXTS="${XP_GATE_JS_TS_EXTS}|py|go|java|swift|cpp|c|hpp|h|m|mm|kt|cs|dart|php|phtml"

# What semgrep can parse (Gates 9 and 10). Powershell is here because semgrep
# has a p/... ruleset entry for it, unlike the CCN set above.
XP_GATE_SEMGREP_EXTS="${XP_GATE_JS_TS_EXTS}|py|go|java|c|cpp|cs|rb|php|scala|swift|ps1|psm1"

# Build the ERE a gate hands to `grep -E`: `\.(a|b|c)$`.
#
# Quoted deliberately. An unquoted expansion here would depend on the caller's
# IFS and on whether the set ever gains whitespace; capturing it in a variable
# and quoting lets a caller write `grep -E "$pat"` without surprises.
xp_gate_ext_regex() {
  printf '\\.(%s)$' "$1"
}

# Print the source extensions for one gate's family.
#
#   xp_gate_source_exts ccn|principles|semgrep
#
# An unknown family is an error rather than a silent empty list: a gate asking
# for a set that does not exist must not receive "no files", which is exactly the
# fail-open this file exists to remove.
xp_gate_source_exts() {
  case "$1" in
    ccn)        printf '%s' "$XP_GATE_CCN_EXTS" ;;
    principles) printf '%s' "$XP_GATE_PRINCIPLES_EXTS" ;;
    semgrep)    printf '%s' "$XP_GATE_SEMGREP_EXTS" ;;
    *)
      echo "xp_gate_source_exts: unknown family '$1' (expected ccn|principles|semgrep)" >&2
      return 2
      ;;
  esac
}
