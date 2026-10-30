#!/bin/bash
# Test-suite hygiene detectors for Gate 5, shared by every branch that needs them.
# Sourced by githooks/pre-commit and by the #602/#601 test batteries; kept in its
# own file so the contract is unit-testable without executing the hook.
#
# Why this exists at all: 指南 §9.5/§12 says a failing build must never be "fixed"
# by deleting assertions, widening mocks, or skipping tests. XP-Gate had no
# detector for the two quietest ways to do exactly that -- a committed `.only`
# (CI then runs one case and reports green) and a deleted test file with no
# replacement (the safety net vanishes with no signal). Gate 5a guarded the
# ADD side ("a new source file must have a test"); these functions guard the
# FOCUS/SKIP/DELETE side so the constraint is symmetric.
#
# The patterns live here, once, because Gate 5d (#601, assertion quality) needs
# the same vocabulary. Two copies of "what counts as a skip" drift apart, and the
# drift is invisible: each copy looks locally correct.

# JS/TS focus markers. In vitest and jest, the presence of `.only` in a file makes
# the whole file run ONLY that case; every other case is silently not executed and
# the run still reports success. `fit`/`fdescribe` are the jasmine aliases that
# vitest still accepts.
#
# Only the dotted/camel spellings are matched, not a bare `fit(`: `fit(` is also a
# common local helper name (curve fitting, layout fitting) and a false BLOCK on
# ordinary source would make the gate unusable. The anchored `\b(fit|fdescribe)\(`
# alternative below covers the alias form at a statement boundary only.
#
# Prints `line:text` for each hit. Empty output means "no focus markers".
classify_test_focus() {
  grep -nE '(\.only[[:space:]]*\()|(\b(fit|fdescribe)[[:space:]]*\()' || true
}

# Skip/todo markers across the five languages this repo gates. These are WARNINGS,
# not blocks: a skipped test is sometimes legitimate and always visible in the test
# runner, unlike `.only`. The warning is what makes the XP-Gate report say it
# counted fewer cases than the file contains.
#
# `@skip-justified: <reason >= 10 chars>` exempts one occurrence; see
# is_skip_justified() -- a bare annotation with no reason is not an exemption, so
# the escape hatch cannot become the default path.
classify_test_skip() {
  grep -nE '(\.(skip|todo)[[:space:]]*\()|(\b(xit|xdescribe|xtest)[[:space:]]*\()|(@pytest\.mark\.skip)|(\bt\.Skip[f]?\()|(@Disabled\b)|(@Ignore\b)' || true
}

# A skip marker is exempt when the surrounding file carries
# `@skip-justified: <reason>` with a reason of at least 10 non-space characters.
# Splitting marker-detection from justification keeps each rule single-purpose and
# makes "the annotation exists but has no reason" a testable state rather than a
# silent pass.
#
# $1 = the source text to inspect (usually the staged file content).
is_skip_justified() {
  printf '%s\n' "$1" \
    | grep -oE '@skip-justified:[[:space:]]*[^[:space:]*].*' \
    | sed 's/^@skip-justified:[[:space:]]*//' \
    | tr -d '\r' \
    | awk 'length($0) >= 10 { found = 1; exit } END { exit(found ? 0 : 1) }'
}

# Files whose basename marks them as a test. Shared with classify_deleted_tests so
# "is this a test file" has one definition. Covers the naming conventions of the
# gated languages: *.test.ts / *.spec.js / *_test.py / test_*.py / *_test.go /
# *Test.java / *Tests.kt / *.Tests.ps1.
is_test_file_path() {
  printf '%s' "$1" \
    | grep -qE '(^|/)(__tests__/)?(test_[^/]+\.py|[^/]+_test\.(py|go)|[^/]+\.(test|spec)\.[a-z]+|[^/]*(Test|Tests|TestSuite)\.(java|kt|cs|scala)|[^/]+\.Tests\.ps1)$'
}

# Deleted test files that have NO same-named replacement.
#
# A pure deletion and a rename look identical in `--name-only --diff-filter=D`;
# git reports the old path as deleted either way. Comparing against the added list
# is what separates "the safety net was removed" from "the file moved", and
# reporting a rename would train developers to ignore the warning.
#
# $1 = file with deleted paths (one per line), $2 = file with added paths.
# Prints the offending paths; empty output means every deletion was a rename.
classify_deleted_tests() {
  local deleted_list added_list
  deleted_list="$1"
  added_list="$2"
  [ -f "$deleted_list" ] || return 0
  local path
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    is_test_file_path "$path" || continue
    # The same basename anywhere in the added list counts as a replacement: a
    # rename is usually same-directory, but moving a test module into
    # `__tests__/` is the common case here and must not be flagged.
    local base
    base=$(printf '%s' "$path" | sed 's#.*/##')
    if [ -f "$added_list" ] && grep -qF "$base" "$added_list" 2>/dev/null; then
      continue
    fi
    printf '%s\n' "$path"
  done < "$deleted_list"
}

# ---------------------------------------------------------------------------
# Gate 5d (#601): assertion quality. 指南 §9.2 forbids six assertion
# anti-patterns; before this, nothing in XP-Gate looked at assertions at all --
# Gate M2/M3 examine how test doubles are built, never whether the test actually
# asserts anything. `expect(true).toBe(true)` and an empty `catch {}` pass every
# other gate while verifying nothing.
#
# Every function below maps to one anti-pattern in
# skills/test-driven-development/testing-anti-patterns.md, and says so, so a
# reviewer reading a block message knows which section to consult.
# ---------------------------------------------------------------------------

# Anti-pattern 1: tautological assertion -- the assertion cannot fail. Two shapes,
# both BLOCK, because neither is a weak test: each is the absence of one wearing an
# assertion's syntax.
#
#   (a) literal vs identical literal: `expect(true).toBe(true)`, `expect(1).toBe(1)`
#   (b) a literal tested for the truthiness it already has:
#       `expect(true).toBeTruthy()`, `expect(false).toBeFalsy()`,
#       `expect("x").toBeTruthy()`, `expect(0).toBeFalsy()`, `expect(null).toBeFalsy()`
#
# (b) cannot be caught by (a)'s backreference, and the pairs are not equivalents to
# compare: `toBeTruthy`/`toBeFalsy` ask a different question than `toBe`. Matching
# the literal's CLASS against the matcher is what distinguishes them, so the two
# are separate alternatives rather than one clever expression.
#
# Deliberately NOT matched: `expect(x).toBe(x)` (same variable both sides). It is
# common in referential-identity checks (`expect(await load(a)).toBe(await load(a))`
# for memoisation) and a false block there is worse than the miss. Likewise
# `expect(someVar).toBeTruthy()` -- a variable's truthiness is a real question.
classify_tautological_assertions() {
  # Implemented in awk rather than grep because POSIX grep -E has no portable
  # backreference support: the Windows Git Bash grep used here matched nothing with
  # `\1`, so a literal-vs-identical-literal check cannot be expressed there.
  #
  # The literal is extracted with a plain ERE-substitution loop instead of gawk's
  # 3-argument match(), which mawk/BSD awk do not provide.
  #
  # Accepts stdin OR $1: the hook pipes the staged content in, while the test
  # battery passes a string. Supporting only one of the two silently makes the
  # other read nothing and report "no violations" -- the fail-open shape this
  # whole release is about.
  local _aq_src
  if [ -n "${1:-}" ]; then _aq_src="$1"; else _aq_src=$(cat); fi
  printf '%s\n' "$_aq_src" | awk '
    BEGIN { TOL = "[[:space:]]*" }
    function trim(s) { gsub(/^[[:space:]]+/, "", s); gsub(/[[:space:]]+$/, "", s); return s }
    # (a) identical literal on both sides of toBe/toEqual/toStrictEqual.
    /expect[^;]*\.to(Be|Equal|StrictEqual)[[:space:]]*\(/ {
      line = $0
      # Peel "expect(" ... ")" first, then the matcher argument.
      if (match(line, /expect[[:space:]]*\([^()]*\)/)) {
        left = substr(line, RSTART, RLENGTH)
        sub(/^expect[[:space:]]*\(/, "", left); sub(/\)$/, "", left)
        left = trim(left)
        rest = substr(line, RSTART + RLENGTH)
        if (match(rest, /\.to(Be|Equal|StrictEqual)[[:space:]]*\([^()]*\)/)) {
          right = substr(rest, RSTART, RLENGTH)
          sub(/^\.to(Be|Equal|StrictEqual)[[:space:]]*\(/, "", right); sub(/\)$/, "", right)
          right = trim(right)
          if (left != "" && left == right && left ~ /^(true|false|null|undefined|-?[0-9]+|".*"|\047.*\047)$/) {
            print NR ":" line; next
          }
        }
      }
    }
    # (b) a literal tested against the truthiness it already has.
    /expect[[:space:]]*\([[:space:]]*(true|1|-1|"[^"]+"|\047[^\047]+\047)[[:space:]]*\)[[:space:]]*\.[[:space:]]*toBeTruthy[[:space:]]*\(/ { print NR ":" $0; next }
    /expect[[:space:]]*\([[:space:]]*(false|0|null|undefined|""|\047\047)[[:space:]]*\)[[:space:]]*\.[[:space:]]*toBeFalsy[[:space:]]*\(/ { print NR ":" $0; next }
  '
}

# Anti-pattern 2: swallowed error -- a `catch` that neither asserts nor rethrows.
# The test cannot fail on the very path it was written to guard. BLOCK.
#
# Three spellings: `catch {}`, `catch (e) {}` (empty body), and `catch (e) { }`
# with only whitespace. A catch containing `expect`/`assert`/`throw`/`fail` is
# doing its job and is not matched.
classify_swallowed_errors() {
  grep -nE 'catch([[:space:]]*\([^)]*\))?[[:space:]]*\{[[:space:]]*\}' || true
}

# Anti-patterns 3-5 (WARNING tier): weak-only assertions, mock-echo assertions, and
# call-order over-verification. These can be legitimate, so each is reported but
# never blocks.
#
# Implemented as a per-`it`/`test` block judgement rather than a per-line grep:
# "only weak assertions" is a property of the whole test body, and a line-wise
# check cannot tell `expect(x).toBeDefined()` alone from the same line followed by
# `expect(x).toBe(42)`.
#
# $1 = source text. Prints `line:reason` for each offending test block.
classify_weak_assertions() {
  # Stdin or $1, for the same reason classify_tautological_assertions accepts both.
  local _aq_src
  if [ -n "${1:-}" ]; then _aq_src="$1"; else _aq_src=$(cat); fi
  printf '%s\n' "$_aq_src" | awk '
    # A block opens on it( / test( and closes on the matching "});" at column 0-2.
    function flush() {
      if (open && nassert > 0 && nstrong == 0) {
        printf "%d:weak_assertion_only\n", startline
      }
      open = 0; nassert = 0; nstrong = 0
    }
    /(^|[^.[:alnum:]_])(it|test)(\.(only|skip|todo))?[[:space:]]*\(/ {
      flush(); open = 1; startline = NR; next
    }
    open && /expect[[:space:]]*\(/ {
      nassert++
      # A "strong" assertion inspects a concrete value: not toBeDefined/toBeTruthy/
      # toBeFalsy/toBeNull/toBeUndefined, and not a bare toHaveBeenCalled().
      if ($0 !~ /\.(toBeDefined|toBeTruthy|toBeFalsy|toBeNull|toBeUndefined|toBeInstanceOf)[[:space:]]*\(/ \
          && $0 !~ /\.toHaveBeenCalled[[:space:]]*\([[:space:]]*\)/) {
        nstrong++
      }
    }
    open && /^\s*\}\);?\s*$/ { flush() }
    END { flush() }
  '
}

# Anti-pattern 6 exemption: `@assertion-justified: <reason>`, mirroring
# `@mock-justified`. The reason must be at least 10 non-space characters -- an
# annotation without a reason is not an exemption, which is what stops the escape
# hatch from becoming the default.
#
# $1 = the source text to inspect.
is_assertion_justified() {
  printf '%s\n' "$1" \
    | grep -oE '@assertion-justified:[[:space:]]*[^[:space:]*].*' \
    | sed 's/^@assertion-justified:[[:space:]]*//' \
    | tr -d '\r' \
    | awk 'length($0) >= 10 { found = 1; exit } END { exit(found ? 0 : 1) }'
}
