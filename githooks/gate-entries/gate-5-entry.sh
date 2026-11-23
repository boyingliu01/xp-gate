#!/usr/bin/env bash

# --- shellcheck suppressions for this file, see the note below ---
# shellcheck disable=SC2001,SC2034,SC2086,SC2126,SC2140

# ============================================================================
# gate-5 entry — extracted from pre-commit by scripts/extract-gates.cjs
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

# SC2034 -- four variables shellcheck reports as written-but-never-read INSIDE
# THIS FILE. All four are consumed from elsewhere, and the check that establishes
# it has to search wider than this file:
#
#   COVERAGE_THRESHOLD_SOURCE  read by githooks/pre-commit (2 references).
#   PY_TEST_SKIPPED            read by githooks/lib/coverage-total.sh:54, where
#                              enforce_python_coverage refuses to consume a stale
#                              .coverage left by a subset run. NOT dead -- an
#                              earlier version of this comment claimed it was,
#                              based on grepping only pre-commit and gate-driver.
#   GATE_5_COVERAGE_APPLIES_TO read by githooks/gate-entries/gate-13-entry.sh at
#                              two sites (the persisted "applies_to" field and the
#                              subset exemption). Also NOT dead, same wrong grep.
#   TESTS_DEFERRED             REMOVED. It was written here and no reader existed
#                              anywhere -- not in pre-commit, gate-driver, lib/ or
#                              the other gate bodies. The note that stood here said
#                              deleting it was safe and belonged in its own commit;
#                              this is that commit.
#
#                              Deleting it outright would have dropped the FACT it
#                              recorded (this language's tests run inside the
#                              coverage pass, not separately). So the fact moved to
#                              GATE_5_DETAIL, which is the field that already
#                              carries the other "why the tests did not run" answer
#                              and which reaches the journal through
#                              record_gate_audit. A flag nobody reads is
#                              indistinguishable from a decision never made.
#
# The lesson is the one this repository keeps relearning: "I grepped and found no
# reader" is evidence about the directories you grepped, not about the codebase.
#

# Three note-level codes, suppressed for the same reason: each is a deliberate
# shell idiom the linter cannot tell from an accident.
#
#   SC2086 ($SMART_TARGETS, $RELATED_TESTS, $PY_CHANGED_ALL). These hold
#   space-separated file lists and are expanded UNQUOTED on purpose -- quoting
#   collapses the list into one bogus path. The alternative shellcheck suggests
#   is an array, which means rewriting the surrounding branches; the code is
#   correct as written.
#   SC2001 (sed instead of parameter substitution). The existing sed forms sit in
#   multi-step pipelines where they are the readable choice.
#   SC2126 (grep piped to wc -l). Kept for symmetry with the surrounding counts.

# ============================================================================
# Is the coverage report on disk evidence for THIS commit?
#
# TOP-LEVEL on purpose, like generate_quality_report(): it is a predicate about a
# file, not part of the gate's control flow, and keeping it out of gate_5_run is
# what lets a test exercise it without triggering a full test run.
#
# The gate previously asked this question three different ways and answered it
# inconsistently. #821 fixed the EVIDENCE check to ask the git index:
#
#     git cat-file -e ":coverage/coverage-summary.json"
#
# but the three sites that READ the report still asked the working directory with
# `[ -f ... ]`. Those are different questions:
#
#   - coverage/ is gitignored, so a report produced by a local `--coverage` run
#     is never in the index. Replacing `-f` with the index test outright would
#     discard real local measurements -- which is why the `-f` sites survived.
#   - a leftover report from an earlier run is also absent from the index, and
#     `-f` accepts it just as readily.
#
# Reproduced 2026-11-18: a commit staging only hook shell sources was blocked by
#     BLOCKED - TypeScript coverage 1% below 78% threshold
# reading a five-hour-old partial report (574/45329 lines). The comment at the
# evidence check records the same artifact family blocking a commit on
# 2026-11-16, so this is a recurrence, not a one-off.
#
# Neither question is the right one. The right one is "was this report produced
# by THIS run?", which the gate can answer because it stamps GATE_5_START before
# running the tests. Staged evidence (#601) still wins outright: the commit
# carries it deliberately, so its mtime is not an objection.
#
# Returns 0 when the report may be read, non-zero when it must be ignored.
# Does this project contain ANY test source for the given language?
#
# Returns 0 (ASSUME TESTS EXIST) in every case it cannot prove otherwise. That
# asymmetry is deliberate: guessing "no tests" wrongly would SKIP the coverage
# floor for a repository that does have tests, which is a silent pass --
# the exact failure this gate exists to prevent. Guessing "tests exist" wrongly
# only costs the fail-closed BLOCK that already happened before this helper.
#
# Only a language with a KNOWN test-file convention may answer "no". For a
# language this table does not cover, the answer is "assume yes", so an unknown
# toolchain keeps the old fail-closed behaviour rather than gaining a new skip.
_gate5_language_has_tests() {
  local lang="$1"
  local pattern
  case "$lang" in
    csharp)               pattern='*.Tests.csproj' ;;
    java)                 pattern='*Test.java' ;;
    kotlin)               pattern='*Test.kt' ;;
    go)                   pattern='*_test.go' ;;
    python)               pattern='test_*.py' ;;
    php)                  pattern='*Test.php' ;;
    cpp|c)                pattern='test_*.cpp' ;;
    dart|flutter)         pattern='*_test.dart' ;;
    ruby)                 pattern='*_spec.rb' ;;
    rust)                 pattern='*.rs' ;;
    *)                    return 0 ;;
  esac
  # A language with a known convention: report "no tests" only on positive proof
  # that the find completed AND matched nothing. `find` failing to run is not
  # evidence of absence.
  local found
  found=$(find . -name "$pattern" \
            -not -path './node_modules/*' -not -path './.git/*' \
            -print -quit 2>/dev/null) || return 0
  [ -n "$found" ]
}

_gate5_coverage_usable() {
  if [ "${GATE_5_COVERAGE_EVIDENCE:-false}" = "true" ]; then
    return 0
  fi
  local start="${GATE_5_START:-}"
  # No stamp means the gate is not mid-run; nothing can be attributed to it.
  case "$start" in
    ''|*[!0-9]*) return 1 ;;
  esac
  local f mtime
  for f in coverage/coverage-summary.json coverage/coverage-final.json; do
    [ -f "$f" ] || continue
    # GNU stat first, BSD stat second: the hooks run on both.
    mtime=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null) || continue
    case "$mtime" in
      ''|*[!0-9]*) continue ;;
    esac
    # stat reports whole seconds, the stamp is milliseconds.
    if [ $(( mtime * 1000 )) -ge "$start" ]; then
      return 0
    fi
  done
  return 1
}

# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_5_run() {
# Shared verdict rules: strongest verdict wins, details append.
# Loaded here because gate-5 walks PROJECT_LANGS and used to let the last
# language replace the reason of an earlier one (see githooks/lib/gate-status.sh).
_GATE_STATUS_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/gate-status.sh"
if [ -r "$_GATE_STATUS_LIB" ]; then
  # shellcheck source=/dev/null
  . "$_GATE_STATUS_LIB"
fi
unset _GATE_STATUS_LIB

# GATE 5: Tests & Coverage Combined (Combines Old Gates 3 - Tests and 4 - Coverage)
# Uses adapter system to run tests + coverage for language
# 
# v0.14.3+ (Issue #312): Skip test run when no code files changed.
# Code files = src/**/*.ts, plugins/**/*.ts, *.ts, *.tsx, etc. (language-aware).
# VERSION, CHANGELOG, docs, config-only changes → SKIP test run entirely.
  # Gate 5a (new file pairing), 5b (mock density), and 5c (semantic annotation)
  # are lightweight and still run even when no code files changed.
  # Gate 5a (new file pairing) and Gate 5b (mock density) still run — they're lightweight.
# ============================================================================
 2>&1 echo ""
 2>&1 echo "→ Gate 5: Tests & coverage..."
GATE_5_START=$(gate_start_ms)
# #554 follow-up: explicit "nothing decided yet" sentinel. A branch inside the
# else-block may record its own verdict (the no-code early skip records SKIP);
# the epilogue must not overwrite it with PASS. Using "" rather than leaving the
# variable unset keeps the epilogue's decision readable, and keeps every render
# site's own default (`${GATE_5_STATUS:-SKIP}`) honest for the paths that never
# assign at all.
GATE_5_STATUS=""

if ! gate_enabled 5; then
  echo "⏭️  SKIPPED - Gate 5: Tests & coverage (not selected by XP_GATE_ONLY_GATE)"
  GATE_5_STATUS="SKIP"
  xp_gate_detail_append GATE_5_DETAIL "not_selected"

elif [ "$PROJECT_LANG" = "documentation-only" ] || [ "$DOCS_ONLY_COMMIT" = true ]; then
  echo "⏭️  SKIPPED - Tests & coverage (documentation-only commit — no code changed to test)."
  GATE_5_STATUS="SKIP"
  xp_gate_detail_append GATE_5_DETAIL "docs_only_change"

else
  # ========================================================================
  # Gate 5-FOCUS / Gate 5-DELETE (#602): the two quietest ways to "fix" a red
  # build are to commit a `.only` (CI then runs one case and reports green) and
  # to delete a test file with no replacement (the safety net vanishes with no
  # signal). 指南 §9.5/§12 forbid both. Gate 5a guards the ADD side -- "a new
  # source file must have a test" -- so guarding only that side left the
  # constraint asymmetric: tests could be silently removed but never silently
  # added, which is backwards from what protects the codebase.
  #
  # Runs before the expensive Gate 5a machinery so a `.only` commit fails in
  # milliseconds instead of after a full test run.
  # ========================================================================
  # Its OWN clock. The audit row below used to pass GATE_5_START, so the
  # test-focus duration was "everything Gate 5 did since it started" rather than
  # the cost of this check -- measured 2026-11-23: 16 samples, median 44.4s, for
  # a scan that the comment above says should finish in milliseconds. Two rows
  # reporting overlapping time is not a display bug: any breakdown of where a
  # commit's minutes go double-counts the overlap, and the overlap is attributed
  # to whichever gate happens to be recorded second.
  GATE_5_FOCUS_START=$(gate_start_ms)

  # Segmented clock. Gate 5's SKIP rows were measured at a 20.7 s median while an
  # isolated call to gate_5_run takes 4.6 s, and no amount of guessing located the
  # gap (see docs/gate-timing-baseline.md sec 6). Guessing twice was worse than
  # spending one field: these marks go into the AUDIT DETAIL, so every future
  # commit records where its own gate-5 seconds went without anyone re-running a
  # probe. A stderr probe was tried first and produced nothing -- the hook's output
  # is captured in some paths, so a diagnostic that is not persisted disappears.
  _g5t_focus=0
  _g5t_a=0
  _g5t_b=0
  _g5t_c=0
  _g5t_mark() {
    local _now
    _now=$(gate_start_ms)
    case "$1" in
      focus) _g5t_focus=$(( _now - GATE_5_START )) ;;
      a)     _g5t_a=$(( _now - GATE_5_START )) ;;
      b)     _g5t_b=$(( _now - GATE_5_START )) ;;
      c)     _g5t_c=$(( _now - GATE_5_START )) ;;
    esac
  }
  _g5t_mark focus
  GATE_5_FOCUS_BLOCKED=0
  GATE_5_SKIP_COUNT=0
  GATE_5_DELETED_TESTS=""
  if declare -f classify_test_focus >/dev/null 2>&1; then
    STAGED_TEST_FILES=$(printf '%s\n' "${XP_STAGED_ACM:-$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)}" \
      | filter_project_paths | grep -E '\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|cs|scala|ps1)$|(^|/)(test_[^/]*\.py|[^/]*_test\.(py|go))$' || true)
    if [ -n "$STAGED_TEST_FILES" ]; then
      while IFS= read -r _tf; do
        [ -n "$_tf" ] || continue
        # `git show ":<path>"` reads the STAGED blob, which is what the commit
        # will contain. The path variable here was `$tf` -- never assigned in this
        # scope -- so the command was always `git show ":"`, which git rejects
        # with "ambiguous argument", and every file fell through to the working
        # tree copy. Measured: the fallback ran for 100% of files, so this gate
        # has only ever inspected the working tree.
        #
        # That is the wrong direction for a commit gate: the user controls the
        # working tree AND the index independently, so "clean in the index, marker
        # still in the working copy" bypassed the focus check, and the reverse
        # ("marker only in the index") was read as a false positive against a
        # file the commit did not contain.
        _tf_content=$(git show ":$_tf" 2>/dev/null) || _tf_content=$(cat "$_tf" 2>/dev/null || true)
        [ -n "$_tf_content" ] || continue

        # --- focus markers: BLOCK ---
        _focus_hits=$(printf '%s\n' "$_tf_content" | classify_test_focus || true)
        if [ -n "$_focus_hits" ]; then
          # XP_GATE_ALLOW_ONLY=1 is an explicit, audited override for the one
          # legitimate case (debugging an unrelated failure mid-bisect). It is
          # opt-in per run and printed, never silent.
          if [ "${XP_GATE_ALLOW_ONLY:-0}" = "1" ]; then
            echo "⚠️  WARN - focus marker in $_tf (allowed by XP_GATE_ALLOW_ONLY=1)"
            record_gate_audit "gate-5-focus-override" "focus-override" "WARN" 1 "$GATE_5_FOCUS_START" "file=$_tf"
          else
            echo "❌ BLOCKED - focus marker(s) in $_tf:"
            printf '%s\n' "$_focus_hits" | sed 's/^/     /'
            GATE_5_FOCUS_BLOCKED=$((GATE_5_FOCUS_BLOCKED + 1))
          fi
        fi

        # --- skip markers: WARN unless justified ---
        _skip_hits=$(printf '%s\n' "$_tf_content" | classify_test_skip || true)
        if [ -n "$_skip_hits" ]; then
          if is_skip_justified "$_tf_content"; then
            echo "ℹ️  Skipped case(s) in $_tf are justified via @skip-justified."
          else
            _skip_n=$(printf '%s\n' "$_skip_hits" | wc -l | tr -d ' ')
            GATE_5_SKIP_COUNT=$((GATE_5_SKIP_COUNT + _skip_n))
            echo "⚠️  WARN - $_skip_n skipped case(s) in $_tf without @skip-justified: <reason>"
          fi
        fi
        # --- Gate 5d (#601): assertion quality ---
        # 指南 §9.2 forbids six assertion anti-patterns, and until now nothing in
        # XP-Gate looked at assertions at all: Gate M2/M3 examine how test doubles
        # are built, never whether the test asserts anything. Tautologies and
        # empty catches are BLOCK (certainly vacuous); weak-only / mock-echo /
        # call-order shapes WARN, because each can be legitimate and blocking a
        # legal style trains people to add justification annotations until the
        # annotation stops meaning anything.
        if declare -f classify_tautological_assertions >/dev/null 2>&1; then
          if is_assertion_justified "$_tf_content"; then
            echo "ℹ️  Assertion style in $_tf is justified via @assertion-justified."
          else
            _tauto=$(printf '%s\n' "$_tf_content" | classify_tautological_assertions || true)
            _swallow=$(printf '%s\n' "$_tf_content" | classify_swallowed_errors || true)
            _weak=$(printf '%s\n' "$_tf_content" | classify_weak_assertions || true)
            # #668: split the findings into "added by this change" and
            # "pre-existing". Gate 5d examines whole files, so editing a file
            # anywhere re-examines all of its assertions; presenting standing debt
            # under an unrelated commit is a false attribution, and false
            # attribution is what drives people to @assertion-justified instead of
            # a real fix.
            _new_ranges=$(staged_added_line_ranges "$_tf" 2>/dev/null || true)
            if [ -n "$_tauto" ]; then
              _tauto_new=""
              _tauto_old=""
              while IFS= read -r _tline; do
                [ -n "$_tline" ] || continue
                _tnum="${_tline%%:*}"
                if assertion_line_is_new "$_tf" "$_tnum" "$_new_ranges"; then
                  _tauto_new="${_tauto_new}${_tline}"$'\n'
                else
                  _tauto_old="${_tauto_old}${_tline}"$'\n'
                fi
              done <<< "$_tauto"
              if [ -n "$_tauto_new" ]; then
                echo "❌ BLOCKED - tautological assertion(s) added by this change in $_tf (cannot fail):"
                printf '%s' "$_tauto_new" | sed 's/^/     /'
                echo "     See skills/test-driven-development/testing-anti-patterns.md"
                GATE_5_FOCUS_BLOCKED=$((GATE_5_FOCUS_BLOCKED + 1))
              fi
              if [ -n "$_tauto_old" ]; then
                echo "⚠️  WARN - PRE-EXISTING tautological assertion(s) in $_tf (NOT introduced by this change):"
                printf '%s' "$_tauto_old" | sed 's/^/     /'
                echo "     These predate this commit. Two options:"
                echo "       fix them now (see 'xp-gate audit assertions'), or"
                echo "       leave them - they are not blocking you."
              fi
            fi
            if [ -n "$_swallow" ]; then
              # Same #668 split as the tautology branch above.
              _sw_new=""
              _sw_old=""
              while IFS= read -r _sline; do
                [ -n "$_sline" ] || continue
                _snum="${_sline%%:*}"
                if assertion_line_is_new "$_tf" "$_snum" "$_new_ranges"; then
                  _sw_new="${_sw_new}${_sline}"$'\n'
                else
                  _sw_old="${_sw_old}${_sline}"$'\n'
                fi
              done <<< "$_swallow"
              if [ -n "$_sw_new" ]; then
                echo "❌ BLOCKED - empty catch added by this change in $_tf swallows the failure it guards:"
                printf '%s' "$_sw_new" | sed 's/^/     /'
                echo "     See skills/test-driven-development/testing-anti-patterns.md"
                GATE_5_FOCUS_BLOCKED=$((GATE_5_FOCUS_BLOCKED + 1))
              fi
              if [ -n "$_sw_old" ]; then
                echo "⚠️  WARN - PRE-EXISTING empty catch(es) in $_tf (NOT introduced by this change):"
                printf '%s' "$_sw_old" | sed 's/^/     /'
                echo "     These predate this commit; see 'xp-gate audit assertions'."
              fi
            fi
            if [ -n "$_weak" ]; then
              echo "⚠️  WARN - test block(s) in $_tf assert only weak properties:"
              printf '%s\n' "$_weak" | sed 's/^/     /'
              echo "     toBeDefined/toBeTruthy alone cannot detect a wrong value."
              GATE_5_SKIP_COUNT=$((GATE_5_SKIP_COUNT + $(printf '%s\n' "$_weak" | wc -l | tr -d ' ')))
            fi
          fi
        fi
      done <<< "$STAGED_TEST_FILES"

    fi
  fi

  # --- deleted test files: WARN ---
  #
  # OUTSIDE the STAGED_TEST_FILES guard, deliberately. That list is built with
  # `--diff-filter=ACM`, so it can never contain a deleted file, and a commit
  # that ONLY deletes tests -- the one case this warning exists for -- skipped
  # the scan entirely. Measured before this fix: staging nothing but the removal
  # of a committed test printed "Gate 5: 2124ms (skipped - no code changes)" and
  # SKIP(no_code_files_changed), with no mention of the deletion. That reason was
  # not false, which is what made it dangerous: the journal showed a gate
  # standing down for a benign cause while the safety net had disappeared.
  #
  # Guarded on the FUNCTION rather than on the change set: an empty deletion list
  # is the normal case, a missing classifier is not.
  if declare -f classify_deleted_tests >/dev/null 2>&1; then
  DELETED_LIST=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/xp-deleted-$$")
  ADDED_LIST=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/xp-added-$$")
  # Routed through the same filter as every other staged-file scan (#649):
  # a deleted/added file under node_modules/ or vendor/ is not project code,
  # and treating it as one reports deletions that mean nothing.
  git diff --cached --name-only --diff-filter=D 2>/dev/null | filter_project_paths > "$DELETED_LIST" || true
  git diff --cached --name-only --diff-filter=A 2>/dev/null | filter_project_paths > "$ADDED_LIST" || true
  GATE_5_DELETED_TESTS=$(classify_deleted_tests "$DELETED_LIST" "$ADDED_LIST" || true)
  rm -f "$DELETED_LIST" "$ADDED_LIST"
  if [ -n "$GATE_5_DELETED_TESTS" ]; then
    echo "⚠️  WARN - test file(s) deleted with no same-named replacement:"
    printf '%s\n' "$GATE_5_DELETED_TESTS" | sed 's/^/     /'
    echo "     Deleting a test removes the safety net (指南 §9.5). If the code is"
    echo "     genuinely gone, say so in the commit body; otherwise restore it."
  fi
  fi

  if [ "$GATE_5_FOCUS_BLOCKED" -gt 0 ]; then
    echo ""
    echo "❌ BLOCKED - Gate 5: $GATE_5_FOCUS_BLOCKED test-hygiene violation(s) (see above)."
    echo "   Focus markers (.only/fit/fdescribe) make CI run one case and report green;"
    echo "   tautological assertions and empty catches verify nothing at all."
    echo "   See skills/test-driven-development/testing-anti-patterns.md"
    echo "   Remove them, or add '@assertion-justified: <reason>' for a reviewed exception."
    record_gate_audit "gate-5-focus" "test-focus" "FAIL" "$GATE_5_FOCUS_BLOCKED" "$GATE_5_FOCUS_START" "blocked=1"
    return 1
  fi

  _g5t_mark a

  # ========================================================================
  # Gate 5a: Test-Source File Pairing Check
  # New .ts/.tsx files: BLOCK (no corresponding test → commit rejected)
  # Modified files (any lang): WARNING (backward compatible)
  # New non-TS files: WARNING (unchanged)
  # Escape valve: SKIP_GATE_5A_BLOCK=1 (non-main/master only, audit logged)
  # Grace period: .tdd-adoption.yaml gracePeriod: N (first N commits = WARNING only)
  # Checks coexistence, not temporal order. True "test-first" enforced by
  # Agent skills (Layer 1 + Layer 4).
  # ========================================================================

  # --- Pre-checks: grace period + escape valve ---
  TDD_GRACE=0
  if [ -f ".tdd-adoption.yaml" ]; then
    TDD_ENABLED=$(grep -E '^\s*enabled:' .tdd-adoption.yaml | awk '{print $2}' || echo "true")
    if [ "$TDD_ENABLED" != "false" ]; then
      TDD_GRACE=$(grep -E '^\s*gracePeriod:' .tdd-adoption.yaml | awk '{print $2}' || echo "0")
    fi
  fi

  TDD_BLOCK_DOWNGRADE=false
  if [ "$TDD_GRACE" -gt 0 ] 2>/dev/null; then
    TDD_BLOCK_DOWNGRADE=true
  fi

  SKIP_5A_BLOCK=false
  if [ "${SKIP_GATE_5A_BLOCK:-0}" = "1" ]; then
    CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null) || CURRENT_BRANCH=""
    CURRENT_BRANCH=$(printf '%s' "$CURRENT_BRANCH" | tr -d '\r\n'); [ -n "$CURRENT_BRANCH" ] || CURRENT_BRANCH="HEAD"
    if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
      REASON="${SKIP_GATE_5A_BLOCK_REASON:-not specified}"
      mkdir -p .xp-gate/reports
      # Escape special characters in REASON for valid JSON
      ESCAPED_REASON=$(printf '%s' "$REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
      ESCAPED_USER=$(printf '%s' "$(git config user.name)" | sed 's/\\/\\\\/g; s/"/\\"/g')
      echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"branch\":\"$CURRENT_BRANCH\",\"user\":\"$ESCAPED_USER\",\"reason\":\"$ESCAPED_REASON\",\"gate\":\"5a-block\"}" >> .xp-gate/reports/escape-valve-log.json
      echo "⚠️  ESCAPE VALVE: SKIP_GATE_5A_BLOCK=1 on branch $CURRENT_BRANCH (reason: $REASON)"
      echo "   ⚠️  Post-mortem issue required within 24h"
      SKIP_5A_BLOCK=true
    else
      echo "❌ ESCAPE VALVE BLOCKED: SKIP_GATE_5A_BLOCK not allowed on main/master branch"
      return 1
    fi
  fi

  # --- BLOCK path: New .ts/.tsx files without corresponding tests ---
  # Exclusions come from filter_project_paths (#649). The hand-maintained list
  # this replaced omitted vendor/target/coverage/out, so a staged vendor/x.ts
  # was reported as new source with no test.
  #
  # Byte-identical mirrors under src/npm-package/ are excluded the same way
  # lint (#494) and Boy Scout (#649) already exclude them. A mirror cannot
  # carry its own test: the next resync overwrites the directory, so the
  # requirement is structurally unsatisfiable and blocked every commit that
  # added a file to a mirrored module. The canonical source keeps its test.
  NEW_TS_FILES=$(git diff --cached --name-only --diff-filter=A | filter_project_paths | grep -Ev "$MIRROR_PATH_FILTER" | grep -E '\.(ts|tsx)$' | grep -v '\.d\.ts$' | grep -v '__tests__' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__snapshots__' | grep -Ev '(^|/)vitest\.config\.' | grep -Ev '(^|/)vite\.config\.' | grep -Ev '(^|/)jest\.config\.' | grep -Ev '(^|/)tsconfig\.' | grep -Ev '(^|/)eslint\.' | grep -Ev '(^|/)prettier\.' | grep -Ev '(^|/)tailwind\.' || true)

  # Strip PROJECT_SUBDIR prefix from new-TS-file paths ONLY when the hook
  # actually cd'd into the subdirectory (IN_PROJECT_SUBDIR=1; single-language
  # subdirectory projects). git diff returns repo-root relative paths; after
  # cd "$PROJECT_SUBDIR" the test-pairing [ -f ] checks below need
  # subdirectory-relative paths. When the hook stays at the repo root
  # (multi-language projects) the paths must KEEP their prefix or every
  # [ -f ] lookup misses and paired files are falsely BLOCKED.
  # (Mirrors the v0.14.31+ Gate 5b fix at lines 1603-1608; Gate 5a was missing it.)
  if [ "$IN_PROJECT_SUBDIR" = "1" ] && [ -n "$NEW_TS_FILES" ]; then
    NEW_TS_FILES=$(echo "$NEW_TS_FILES" | sed "s|^${PROJECT_SUBDIR}/||")
  fi

  if [ -n "$NEW_TS_FILES" ]; then
    BLOCKED_TS_FILES=0
    for src_file in $NEW_TS_FILES; do
      base="${src_file%.*}"
      ext="${src_file##*.}"
      filename="${base##*/}"
      dir="$(dirname "$src_file")"

      # Skip excluded files: index/barrel, types, interfaces, constants, declarations
      case "$filename" in
        index|types|interfaces|constants|__init__) continue ;;
      esac
      case "$ext" in
        d.ts|pyi) continue ;;
      esac
      # Skip files with @no-test-required (reason >= 10 chars) or legacy @no-test annotation
      # Order matters: @no-test-required must be checked first — @no-test is a substring match
      if grep -q '@no-test-required' "$src_file" 2>/dev/null; then
        if grep -qE '@no-test-required\s*:\s*.{10,}' "$src_file" 2>/dev/null; then
          continue
        fi
        # @no-test-required with short reason (< 10 chars) — fall through to BLOCK
      elif grep -q '@no-test' "$src_file" 2>/dev/null; then
        continue
      fi

      # Check common test file patterns for TypeScript
      TEST_FOUND=false
      patterns=(
        "${base}.test.${ext}"
        "${base}.spec.${ext}"
        "${dir}/__tests__/${filename}.test.${ext}"
        "${dir}/__tests__/${filename}.spec.${ext}"
        "tests/${filename}.test.${ext}"
        "tests/${filename}.spec.${ext}"
        # #787: `test/` (singular) is as conventional as `tests/` (plural), and
        # both live in the wild -- Jest silently accepts either, so a repo that
        # picked the singular spelling was hard-BLOCKED on a file whose test was
        # right there. The asymmetry made it read like a user error: identical
        # content under tests/ passed, and only the path spelling decided the
        # verdict, so "did you mean tests/" was not actionable advice.
        "test/${filename}.test.${ext}"
        "test/${filename}.spec.${ext}"
      )

      for pattern in "${patterns[@]}"; do
        if [[ "$pattern" == *'*'* ]]; then
          found=$(find . -path "*/${pattern}" -type f 2>/dev/null | head -1)
          if [ -n "$found" ]; then TEST_FOUND=true; break; fi
        elif [ -f "$pattern" ]; then
          TEST_FOUND=true
          break
        fi
      done

      if [ "$TEST_FOUND" = false ]; then
        if [ "$SKIP_5A_BLOCK" = true ] || [ "$TDD_BLOCK_DOWNGRADE" = true ]; then
          echo "⚠️  TEST PAIRING WARNING (downgraded): New TypeScript file without test: $src_file"
          echo "   Expected: ${patterns[0]}, ${patterns[1]:-...}"
          echo "   Or: Add '// @no-test-required: <reason>' if this file doesn't need tests"
        else
          echo "❌ BLOCKED: $src_file — New TypeScript source file without corresponding test"
          echo "   Expected: ${patterns[0]}, ${patterns[1]:-...}"
          echo "   Add '// @no-test-required: <reason>' if this file doesn't need tests"
          BLOCKED_TS_FILES=$((BLOCKED_TS_FILES + 1))
        fi
      fi
    done

    if [ "$BLOCKED_TS_FILES" -gt 0 ]; then
      echo ""
      echo "❌ $BLOCKED_TS_FILES new TypeScript file(s) without corresponding tests — commit BLOCKED"
      echo "   Add test files or '// @no-test-required: <reason>' annotation."
      echo "   Escape valve: SKIP_GATE_5A_BLOCK=1 (non-main/master only)"
      return 1
    fi
  fi

  # --- WARNING path: Modified files (any lang) + New non-TS files ---
  # filter_project_paths strips dependencies and build output (#649); without
  # it a staged vendor/ or target/ module is reported as source needing a test.
  WARNING_SOURCE_FILES=$(
    {
      git diff --cached --name-only --diff-filter=M | filter_project_paths | grep -E '\.(ts|tsx|py|go|java|kt|kts|cpp|cc|cxx|c|swift|dart|rb|rs)$' | grep -v '__tests__' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__snapshots__'
      git diff --cached --name-only --diff-filter=A | filter_project_paths | grep -E '\.(py|go|java|kt|kts|cpp|cc|cxx|c|swift|dart|rb|rs)$' | grep -v '__tests__' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__snapshots__'
    } | sort -u || true
  )

  if [ -n "$WARNING_SOURCE_FILES" ]; then
    PAIRING_WARNINGS=0
    for src_file in $WARNING_SOURCE_FILES; do
      base="${src_file%.*}"
      ext="${src_file##*.}"
      filename="${base##*/}"
      dir="$(dirname "$src_file")"

      # Skip excluded files: index/barrel, types, interfaces, constants, declarations
      case "$filename" in
        index|types|interfaces|constants|__init__) continue ;;
      esac
      case "$ext" in
        d.ts|pyi) continue ;;
      esac
      # Skip files with @no-test-required (reason >= 10 chars) or legacy @no-test annotation
      # Order matters: @no-test-required must be checked first — @no-test is a substring match
      if grep -q '@no-test-required' "$src_file" 2>/dev/null; then
        if grep -qE '@no-test-required\s*:\s*.{10,}' "$src_file" 2>/dev/null; then
          continue
        fi
        # @no-test-required with short reason (< 10 chars) — fall through to BLOCK
      elif grep -q '@no-test' "$src_file" 2>/dev/null; then
        continue
      fi

      # Check common test file patterns (language-specific)
      TEST_FOUND=false
      case "$ext" in
        ts|tsx|js|jsx)
          patterns=(
            "${base}.test.${ext}"
            "${base}.spec.${ext}"
            "${dir}/__tests__/${filename}.test.${ext}"
            "${dir}/__tests__/${filename}.spec.${ext}"
            "tests/${filename}.test.${ext}"
            "tests/${filename}.spec.${ext}"
          )
          ;;
        py)
          patterns=(
            "tests/${filename}_test.py"
            "tests/test_${filename}.py"
            "${dir}/tests/test_${filename}.py"
            "${base}_test.py"
          )
          ;;
        go)
          patterns=(
            "${base}_test.go"
            "${dir}/${filename}_test.go"
          )
          ;;
        java|kt|kts)
          patterns=(
            "${base}Test.${ext}"
            "src/test/java/**/${filename}Test.${ext}"
            "src/test/kotlin/**/${filename}Test.${ext}"
          )
          ;;
        cpp|cc|cxx|c)
          patterns=(
            "${base}_test.${ext}"
            "${base}Test.${ext}"
            "${dir}/test_${filename}.${ext}"
          )
          ;;
        swift)
          patterns=(
            "${base}Tests.swift"
            "${dir}/${filename}Tests.swift"
          )
          ;;
        dart)
          patterns=("${base}_test.${ext}")
          ;;
        rb)
          patterns=(
            "${dir}/test_${filename}.rb"
            "${base}_test.rb"
          )
          ;;
        rs)
          # Rust tests are typically inline with #[cfg(test)]
          continue
          ;;
        *) continue ;;
      esac

      for pattern in "${patterns[@]}"; do
        if [[ "$pattern" == *'*'* ]]; then
          found=$(find . -path "*/${pattern}" -type f 2>/dev/null | head -1)
          if [ -n "$found" ]; then TEST_FOUND=true; break; fi
        elif [ -f "$pattern" ]; then
          TEST_FOUND=true
          break
        fi
      done

      if [ "$TEST_FOUND" = false ]; then
        echo "⚠️  TEST PAIRING WARNING: Source file without corresponding test: $src_file"
        echo "   Expected patterns for .${ext}: ${patterns[0]}, ${patterns[1]:-...}"
        echo "   Or: Add '// @no-test-required: <reason>' annotation if this file doesn't need tests"
        PAIRING_WARNINGS=$((PAIRING_WARNINGS + 1))
      fi
    done

    if [ "$PAIRING_WARNINGS" -gt 0 ]; then
      echo ""
      echo "⚠️  $PAIRING_WARNINGS source file(s) without corresponding tests"
      echo "   This is a WARNING — commit proceeds. TDD order enforced by Agent skills."
      echo "   To suppress for specific files, add '// @no-test-required: <reason>' at the top."
    fi
  fi

  _g5t_mark b

  # ========================================================================
  # Gate 5b: Mock Density ADVISORY Scan (pure bash — no npx tsx overhead)
  # 30% = ADVISORY, 50% = suggests @mock-justified. Does NOT block commit.
  # ========================================================================
  CHANGED_TEST_FILES=$(printf '%s\n' "${XP_STAGED_ACM:-$(git diff --cached --name-only --diff-filter=ACM)}" | filter_project_paths | grep -E '\.(test|spec)\.(ts|tsx|js|jsx|cjs|mjs|py|go)$' || true)

  # Nested plugin sub-projects (plugins/<name>/) own their own vitest config and
  # are excluded from the root suite (`vitest.config.ts` excludes `plugins/**`,
  # because plugins/*/node_modules contains vendored tests). Feeding their test
  # paths to the root vitest yields "No test files found" → false BLOCK, so drop
  # them here and let the per-plugin suite cover them (CI runs `npm test` inside
  # each plugin directory).
  CHANGED_TEST_FILES=$(echo "$CHANGED_TEST_FILES" | grep -vE '^plugins/[^/]+/' || true)

  # Strip PROJECT_SUBDIR prefix from test file paths ONLY when the hook
  # actually cd'd into the subdirectory (IN_PROJECT_SUBDIR=1). git diff returns
  # repo-root relative paths; after cd "$PROJECT_SUBDIR" vitest and [ -f ]
  # checks need subdirectory-relative paths. At the repo root (multi-language
  # projects) stripping would silently skip the mock-density scan and feed
  # vitest paths that do not exist. (v0.14.31+ fix, gated on the cd in v0.19.x)
  if [ "$IN_PROJECT_SUBDIR" = "1" ] && [ -n "$CHANGED_TEST_FILES" ]; then
    CHANGED_TEST_FILES=$(echo "$CHANGED_TEST_FILES" | sed "s|^${PROJECT_SUBDIR}/||")
  fi

  if [ -n "$CHANGED_TEST_FILES" ]; then
    echo "Checking mock density in test files..."
    for test_file in $CHANGED_TEST_FILES; do
      if [ -f "$test_file" ]; then
        # Count mock keyword references (precise patterns only)
        MOCK_COUNT=0
        for kw in 'jest\.mock' 'vi\.mock' 'jest\.spyOn' 'vi\.spyOn' 'jest\.fn' 'vi\.fn' \
                  'mockResolvedValue' 'mockRejectedValue' 'mockReturnValue' 'mockImplementation' \
                  'createMock' 'mockReset' 'mockClear' 'mockRestore' 'MagicMock' 'unittest\.mock' \
                  '\.patch(' 'gomock' 'mockgen' '.EXPECT()'; do
          # Use grep -o piped to wc -l for reliable single-number output (grep -c can emit
          # multi-line output with filenames under some grep versions, causing bash arithmetic
          # syntax errors). grep -o extracts each match on its own line, wc -l counts them.
          c=$(grep -o "$kw" "$test_file" 2>/dev/null | wc -l || true)
          c=${c//[^0-9]/}
          c=${c:-0}
          MOCK_COUNT=$((MOCK_COUNT + c))
        done

        # Count total non-empty, non-comment lines for density denominator
        TOTAL_LINES=$(grep -v '^\s*$' "$test_file" | grep -v '^\s*//' | grep -v '^\s*\*' | grep -v '^\s*#' | wc -l | awk '{print $1}')

        if [ "$TOTAL_LINES" -gt 0 ] 2>/dev/null; then
          MOCK_DENSITY=$(awk "BEGIN {printf \"%.1f\", ($MOCK_COUNT / $TOTAL_LINES) * 100}")
        else
          MOCK_DENSITY="0"
        fi

        THRESHOLD_30=$(awk "BEGIN {print ($MOCK_DENSITY > 30) ? 1 : 0}")
        THRESHOLD_50=$(awk "BEGIN {print ($MOCK_DENSITY > 50) ? 1 : 0}")

        # Check for @mock-justified annotation with reason text (min 10 chars)
        HAS_JUSTIFIED=$(grep -qE '@mock-justified\s*:\s*.{10,}' "$test_file" 2>/dev/null && echo "true" || echo "false")

        if [ "$THRESHOLD_50" = "1" ]; then
          if [ "$HAS_JUSTIFIED" = "false" ]; then
            echo "⚠️  MOCK DENSITY: $test_file — ${MOCK_DENSITY}% (exceeds 50%)"
            echo "   Consider: integration test with real collaborators"
            echo "   Or: Add '// @mock-justified: <reason>' (min 10 char explanation)"
          else
            echo "📝 MOCK DENSITY: $test_file — ${MOCK_DENSITY}% (justified)"
          fi
        elif [ "$THRESHOLD_30" = "1" ]; then
          echo "ℹ️  MOCK DENSITY ADVISORY: $test_file — ${MOCK_DENSITY}% (consider reducing mocks)"
        fi
      fi
    done
  fi

  # ============================================================================
  # ============================================================================
  _g5t_mark c

  # Gate 5c: Semantic Annotation Check (#585)
  #
  # The check itself lives in lib/gate-5c-alignment.sh so its contract is
  # unit-testable without executing the hook. Two defects it fixes, both of which
  # made this gate a decoration:
  #   1. The whole body sat inside `if [ -f req-ids.json ] && command -v jq`.
  #      .sprint-state/ is gitignored, so on a fresh clone the gate printed
  #      NOTHING — not PASS, not FAIL, not SKIP — and the report had no slot for
  #      it. Silence read as success, the same defect as #449/#499/#570.
  #   2. Test discovery matched only JS/TS, so Pester's *.Tests.ps1, pytest's
  #      test_*.py, Go's *_test.go, Java's *Test.java and Kotlin's *Tests.kt found
  #      nothing and the gate reported a vacuous "0 annotated, 0 uncovered".
  #
  # GATE_5C_STATUS is now always PASS, SKIP or BLOCK — never empty.
  # ============================================================================
  GATE_5C_STATUS=""
  gate_5c_alignment || return 1

  # ============================================================================
  # v0.14.3+ (Issue #312): Early skip when no code files changed.
  # If the commit only touches VERSION, CHANGELOG, docs, config, .gitignore,
  # or similar non-code files, skip the test run entirely.
  # Gate 5a (new file pairing) and 5b (mock density) are cheap and still run.
  # ============================================================================
  # #763: `cs`/`csx` were missing from this list, so a commit touching ONLY C#
  # files produced an empty CHANGED_CODE_FILES and took the "no code files
  # changed" early skip below -- the full test suite never ran, and the absence
  # of a test result was reported as the absence of a need for one. The
  # Principles extensions list got `.cs` in ac214d38; this one was left behind,
  # which is why the C# arm looked like it worked while Gate 5 stood down.
  CODE_EXTENSIONS="\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|kts|cs|csx|cpp|cc|cxx|c|h|hpp|swift|m|mm|dart|php|phtml|sh|ps1)$"
  CHANGED_CODE_FILES=$(echo "$CHANGED_FILES" | grep -E "$CODE_EXTENSIONS" || true)
  if [ -z "$CHANGED_CODE_FILES" ]; then
    # #554: this branch DID stand down deliberately, but "PASS" is a claim that
    # a check ran and found nothing. Nothing ran here: no test executed, no
    # coverage number exists. Recording PASS inflated the pass rate and made an
    # unmeasured gate indistinguishable from a measured clean one -- the same
    # defect #554 fixed on the docs-only branch, on the branch that fix did not
    # cover (measured on the v0.31.2.0 release commit: journal said
    # gate5_tests.status=PASS while the summary printed "coverage: N/A%").
    echo "⏭️  SKIPPED - No code files changed (only docs/config/VERSION) — test run not needed."
    echo "   Changed files: $(echo "$CHANGED_FILES" | tr '\n' ' ')"
    TESTS_EXIT_CODE=0
    TESTS_SKIPPED=true
    GATE_5_STATUS="SKIP"
    xp_gate_detail_append GATE_5_DETAIL "no_code_files_changed"
    GATE_5_END=$(gate_start_ms)
    GATE_5_ELAPSED=$((GATE_5_END - GATE_5_START))
    echo "   ⏱️  Gate 5: ${GATE_5_ELAPSED}ms (skipped — no code changes)"
  else

  # ============================================================================
  # Smart test selection (Issue #286): only run tests affected by changed files.
  # Reuses CHANGED_TEST_FILES already computed in Gate 5b (line 1244).
  # Full run fallback: >20 changed test files, or vitest not found.
  # ============================================================================
  echo "Running tests..."
  
  # Route to appropriate test runner via adapter
  for CURRENT_LANG in $PROJECT_LANGS; do
    ADAPTER_FILE=$(resolve_adapter_path "$CURRENT_LANG")
    # Drop declarations left behind by the PREVIOUS adapter before sourcing this
    # one. Adapters are sourced into one shell, so a function one adapter defines
    # stays callable while the next language is being handled -- measured: after
    # shell.sh declared its delegation, powershell was reported as delegating too,
    # even though powershell.sh declares nothing. The consequence is not cosmetic:
    # a stale "yes" removes test verification for a language that never asked for
    # it, which is the exact failure mode the declaration's default is meant to
    # prevent. `unset -f` on an absent function is a no-op, so this is safe for
    # adapters that declare nothing.
    unset -f tests_delegated_to_ci tests_delegated_to_ci_target coverage_runs_tests 2>/dev/null || true
    if [ "${CURRENT_LANG}" != "unknown" ] && [ -n "$ADAPTER_FILE" ]; then
    if source "$ADAPTER_FILE" 2>/dev/null; then
      # TypeScript: vitest with smart test selection
      if [ "$CURRENT_LANG" = "typescript" ] && { [ -f "package.json" ] || [ -f "$PROJECT_ROOT/package.json" ]; }; then
        # `--probe`: answer "is vitest installed HERE?" without letting npx
        # download it. A probe that installs what it is checking for always
        # reports success, which is how repos with no vitest ended up blocking on
        # a downloaded one's missing @vitest/coverage-v8 (#21, dsh-aot-runner).
        if run_without_git_context run_node_bin --probe vitest vitest/vitest.mjs --version >/dev/null 2>&1; then
          # Count changed test files to decide strategy. `grep -c '.'` prints its
          # own zero AND exits 1 on an empty list, so `|| echo "0"` used to yield
          # $'0\n0' -- the same two-value bug that false-blocked Gate 8 (#493).
          # Bundled mirrors under src/npm-package/ are excluded from the root
          # vitest project (vitest.config.ts, #418), so selecting them makes
          # vitest exit 1 with "No test files found" and this gate reads that as
          # failing tests: a false BLOCK for any commit that only touches mirrors
          # (#494). Route both lists through the selector and announce it.
          SELECTED_TEST_FILES=$(select_root_suite_targets "$CHANGED_TEST_FILES")
          if [ "$SELECTED_TEST_FILES" != "$CHANGED_TEST_FILES" ]; then
            echo "   ↪ Selection adjusted for bundled mirrors (#494):"
            echo "     was: $(echo "$CHANGED_TEST_FILES" | tr '\n' ' ')"
            echo "     now: $(echo "$SELECTED_TEST_FILES" | tr '\n' ' ')"
          fi
          CHANGED_TEST_FILE_COUNT=$(echo "$SELECTED_TEST_FILES" | grep -c '.' || true)
          
          # Also get changed source files (non-test) for related-test lookup
          CHANGED_SRC_FILES=$(printf '%s\n' "${XP_STAGED_ACM:-$(git diff --cached --name-only --diff-filter=ACM)}" | filter_project_paths | grep -E '\.(ts|tsx|js|jsx)$' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__tests__' | grep -v '\.d\.ts$' | grep -v '__snapshots__' || true)
          # Nested plugin sub-projects are excluded from the root suite; their
          # sources must not drive root-vitest related-test lookup either (it
          # would resolve to plugin-local paths vitest cannot collect).
          CHANGED_SRC_FILES=$(echo "$CHANGED_SRC_FILES" | grep -vE '^plugins/[^/]+/' || true)
          # Mirror handling is identical for source files: their test-adjacent
          # paths must never reach vitest as root-project targets (#494).
          # Selection runs on repo-root relative paths (git diff output), before
          # any PROJECT_SUBDIR stripping, so the bundled-mirror prefixes match.
          SELECTED_SRC_FILES=$(select_root_suite_targets "$CHANGED_SRC_FILES")
          if [ "$SELECTED_SRC_FILES" != "$CHANGED_SRC_FILES" ]; then
            echo "   ↪ Source selection adjusted for bundled mirrors (#494):"
            echo "     was: $(echo "$CHANGED_SRC_FILES" | tr '\n' ' ')"
            echo "     now: $(echo "$SELECTED_SRC_FILES" | tr '\n' ' ')"
          fi
          # Strip PROJECT_SUBDIR prefix ONLY when the hook cd'd into the
          # subdirectory (IN_PROJECT_SUBDIR=1; same gate as the CHANGED_TEST_FILES
          # fix above — at the repo root the paths must stay root-relative or the
          # related-test lookup and vitest targets resolve against the wrong dir,
          # #470)
          if [ "$IN_PROJECT_SUBDIR" = "1" ] && [ -n "$SELECTED_SRC_FILES" ]; then
            SELECTED_SRC_FILES=$(echo "$SELECTED_SRC_FILES" | sed "s|^${PROJECT_SUBDIR}/||")
          fi
          CHANGED_SRC_COUNT=$(echo "$SELECTED_SRC_FILES" | grep -c '.' || true)
          
          # Decide strategy
          if [ "$CHANGED_TEST_FILE_COUNT" -gt 20 ] 2>/dev/null; then
            # Too many test files changed → full run
            echo "Too many test files changed ($CHANGED_TEST_FILE_COUNT), running full test suite..."
            TESTS_OUTPUT=$(run_without_git_context run_node_bin vitest vitest/vitest.mjs run --coverage 2>&1)
            TESTS_EXIT_CODE=$?
            echo "$TESTS_OUTPUT" | head -60
            if [ "$TESTS_EXIT_CODE" -ne 0 ]; then
              handle_test_failure "$TESTS_OUTPUT" "full test suite" || return 1
            else
              echo "✅ PASSED - Full test suite passed (with coverage)."
              TESTS_RAN_ANY=true
            fi
          elif [ "$CHANGED_TEST_FILE_COUNT" -gt 0 ] 2>/dev/null; then
            # Run only changed test files with coverage
            PARTIAL_TEST_RUN=true  # Mark as partial run for coverage check
            SMART_TARGETS=$(echo "$SELECTED_TEST_FILES" | tr '\n' ' ')
            echo "Running ${CHANGED_TEST_FILE_COUNT} changed test file(s) with coverage..."
            echo "   Target(s): $(echo "$SELECTED_TEST_FILES" | tr '\n' ' ')"
            TESTS_OUTPUT=$(run_without_git_context run_node_bin vitest vitest/vitest.mjs run --coverage $SMART_TARGETS 2>&1)
            TESTS_EXIT_CODE=$?
            echo "$TESTS_OUTPUT" | head -60
            if [ "$TESTS_EXIT_CODE" -ne 0 ]; then
              # Distinguish a real test failure from a runner infrastructure
              # error -- see #454. handle_test_failure routes both cases and
              # keeps the message consistent across every Gate 5 branch.
              handle_test_failure "$TESTS_OUTPUT" "changed test files" || return 1
            else
              echo "✅ PASSED - Changed test files passed (with coverage)."
              TESTS_RAN_ANY=true
            fi
          elif [ "$CHANGED_SRC_COUNT" -gt 0 ] 2>/dev/null; then
            # Source files changed but no test files → find related tests or run full
            echo "Source file(s) changed, finding related tests..."
            RELATED_TESTS=""
            for src_file in $SELECTED_SRC_FILES; do
              base="${src_file%.*}"
              filename="${base##*/}"
              dir="$(dirname "$src_file")"
              ext="${src_file##*.}"
              # Try common test file patterns
              for pattern in \
                "${base}.test.${ext}" \
                "${base}.spec.${ext}" \
                "${dir}/__tests__/${filename}.test.${ext}" \
                "${dir}/__tests__/${filename}.spec.${ext}" \
                "tests/${filename}.test.${ext}" \
                "tests/${filename}.spec.${ext}"; do
                if [ -f "$pattern" ]; then
                  RELATED_TESTS="${RELATED_TESTS}${pattern} "
                fi
              done
              # Glob fallback for __tests__ dir patterns
              if [ -d "${dir}/__tests__" ]; then
                found_glob=$(find "${dir}/__tests__" -maxdepth 1 -name "${filename}.test.*" -o -name "${filename}.spec.*" 2>/dev/null | tr '\n' ' ')
                if [ -n "$found_glob" ]; then
                  for f in $found_glob; do
                    case " $RELATED_TESTS " in *" $f "*) ;; *) RELATED_TESTS="${RELATED_TESTS}${f} " ;; esac
                  done
                fi
              fi
            done
            if [ -n "$RELATED_TESTS" ]; then
              echo "   Found related test(s): $(echo "$RELATED_TESTS" | tr '\n' ' ')"
              PARTIAL_TEST_RUN=true  # Mark as partial run for coverage check
              TESTS_OUTPUT=$(run_without_git_context run_node_bin vitest vitest/vitest.mjs run --coverage $RELATED_TESTS 2>&1)
              TESTS_EXIT_CODE=$?
              echo "$TESTS_OUTPUT" | head -60
              if [ "$TESTS_EXIT_CODE" -ne 0 ]; then
                handle_test_failure "$TESTS_OUTPUT" "related test files" || return 1
              else
                echo "✅ PASSED - Related test files passed (with coverage)."
                TESTS_RAN_ANY=true
              fi
            else
              # No related tests found → full run is safest
              echo "   No related test files found, running full test suite..."
              TESTS_OUTPUT=$(run_without_git_context run_node_bin vitest vitest/vitest.mjs run --coverage 2>&1)
              TESTS_EXIT_CODE=$?
              echo "$TESTS_OUTPUT" | head -60
              if [ "$TESTS_EXIT_CODE" -ne 0 ]; then
                handle_test_failure "$TESTS_OUTPUT" "full test suite" || return 1
              else
                echo "✅ PASSED - Full test suite passed (with coverage)."
                TESTS_RAN_ANY=true
              fi
            fi
          else
            # No test files AND no source files changed → skip
            echo "✅ PASSED - No test or source files changed, skipping test run."
            TESTS_EXIT_CODE=0
            TESTS_SKIPPED=true
          fi
        else
          # Fallback: run_tests without coverage
          TESTS_OUTPUT=$(run_without_git_context run_tests 2>&1)
          TESTS_EXIT_CODE=$?
          echo "$TESTS_OUTPUT" | head -50
          # No runner installed is a SKIP, not a pass. The adapter returns 0 in
          # that case (it measured nothing), so the exit code alone cannot tell
          # "all tests passed" from "no tests could run". Without this, the
          # coverage arm further down finds no report and blocks with
          # "coverage/coverage-summary.json not found" -- blaming a missing
          # artifact for a runner that was never installed (dsh-aot-runner #21).
          if _gate5_test_run_skipped "$TESTS_EXIT_CODE" "$TESTS_OUTPUT"; then
            TESTS_SKIPPED=true
          fi
          if [ "$TESTS_EXIT_CODE" -ne 0 ]; then
            # This branch is reached from the typescript adapter, so run_tests ran
            # vitest (adapters/typescript.sh) and its output is vitest-shaped: the
            # same three non-failure exits (#454 runner EPERM, #473 partial
            # threshold, #498 no test files) apply here as in the four branches
            # above. #454 left it unguarded because its own comment covers the
            # NON-typescript fallback below, whose runner is pytest/go/jest; this
            # one is not that branch.
            handle_test_failure "$TESTS_OUTPUT" "typescript adapter fallback" || return 1
          fi
        fi
      else
        # Adapter test flow for everything the TypeScript branch above did not
        # claim. The label this branch carried (#454) was "Non-TypeScript", which
        # is not what reaches it: a TypeScript project without a package.json also
        # lands here, and its adapter runs vitest — which is how a test-less TS
        # repo got false-blocked on "No test files found" (#498).
        #
        # #798 / #794: whether the coverage section below will already run (and
        # therefore validate) this suite is now an ADAPTER declaration, not a
        # language name. The old code was:
        #
        #     if [ "$CURRENT_LANG" = "python" ]; then ...defer...
        #
        # Python had been patched by hand once (#794's 2d23fe89) because its
        # coverage run subsumes the test run; csharp/go/java/kotlin/dart/swift
        # have exactly the same property and kept running the suite twice. The
        # language-name check could only ever cover the languages someone
        # remembered to add. `coverage_runs_tests` asks the adapter, which is the
        # component that actually knows its toolchain.
        #
        # Default is deliberately the SAFE side: an adapter that does not
        # declare it runs the tests here as well. Double-running costs time; not
        # running them would cost verification, and #794's precedent is that the
        # slower mistake is the acceptable one for an undeclared adapter.
        # An adapter may declare that its suite runs elsewhere. Checked FIRST,
        # because for such an adapter the question below ("does coverage also run
        # the tests?") is moot -- neither branch may call run_tests.
        #
        # Why this exists for shell specifically: `run_tests` has no selection and
        # discovers every *.bats in the repo (284, measured), so calling it here is
        # a multi-hour commit. That was masked by a failing `command -v bats`
        # probe that returned 0 before the run; once the probe was fixed, a
        # shell.sh-only commit hung with no output for 100s+ and had to be killed.
        #
        # The report line is required, not decorative: removing the run must not
        # make the check indistinguishable from one that passed, and the reader
        # has to be told where it IS verified (CI's sharded bats-contracts job,
        # per quality-gates.yml -- "do not re-add a silent copy here").
        if adapter_delegates_tests_to_ci; then
          local _delegated_to
          _delegated_to="$(adapter_test_delegation_target)"
          echo "ℹ️  ${CURRENT_LANG}: tests run in ${_delegated_to}, not at commit time."
          echo "   Not checked by this gate -- verified on push/PR instead."
          xp_gate_detail_append GATE_5_DETAIL "${CURRENT_LANG}: tests delegated to ${_delegated_to}"
          DELEGATED_LANGS="${DELEGATED_LANGS:+${DELEGATED_LANGS} }${CURRENT_LANG}"
        elif adapter_declares_coverage_runs_tests; then
          echo "ℹ️  ${CURRENT_LANG}: coverage run includes the tests — deferring test execution to a single pass."
          # The deferral is stated in the RECORD, not only on the console.
          #
          # This used to set `TESTS_DEFERRED=true` and nothing read it -- not this
          # file, not the report writer, not the audit journal. A flag written by a
          # gate and read by nobody is indistinguishable from a decision that was
          # never made: the console said "deferring", the report said nothing about
          # why the language's tests were not run, and a reader comparing two
          # languages could not tell a skip from a run.
          #
          # GATE_5_DETAIL already carries the delegate reason one branch above, so
          # the deferral goes there too: one field, both shapes, and both reach the
          # journal through record_gate_audit.
          #
          # Deliberately NOT appended to DELEGATED_LANGS: that variable is reported
          # further down as "tests delegated to CI", and a coverage-run deferral is
          # not a CI delegation. Reusing it would relabel this case as the other.
          xp_gate_detail_append GATE_5_DETAIL "${CURRENT_LANG}: tests deferred to the coverage run"
        else
          TESTS_OUTPUT=$(run_without_git_context run_tests 2>&1)
          TESTS_EXIT_CODE=$?
          echo "$TESTS_OUTPUT" | head -50
          if [ "$TESTS_EXIT_CODE" -ne 0 ]; then
            if [ "$CURRENT_LANG" = "typescript" ]; then
              # vitest output, so the same three non-failure exits are judged
              # here as in the branches above (#454, #473, #498).
              handle_test_failure "$TESTS_OUTPUT" "typescript adapter (no package.json)" || return 1
            else
              # Genuinely non-vitest runners (pytest/go/jest/...): their output
              # shape is not vitest's, so the guard could excuse a real failure.
              # They keep blocking on any non-zero exit (#454).
              echo ""
              echo "❌ BLOCKED - Tests FAILED"
              return 1
            fi
          else
            # Same distinction as the branch above: the adapter returns 0 both for
            # "tests passed" and for "no runner installed", so the output is the
            # only evidence of which one happened. Setting TESTS_RAN_ANY here
            # unconditionally would claim a measurement that never took place.
            if _gate5_test_run_skipped "$TESTS_EXIT_CODE" "$TESTS_OUTPUT"; then
              TESTS_SKIPPED=true
            else
              echo "✅ PASSED - Unit tests passed."
              # #760: a runner really executed for this language, so the coverage
              # guard below must not treat this pass as "nothing was measured".
              TESTS_RAN_ANY=true
            fi
          fi
        fi
      fi
    else
      echo "✅ PASSED - Could not source ${CURRENT_LANG} adapter for tests, assuming none to run."
    fi
  else
    echo "✅ PASSED - No ${CURRENT_LANG} adapter found for tests, assuming none to run."
  fi
  done  # end for CURRENT_LANG

  fi  # End: if [ -n "$CHANGED_CODE_FILES" ] (Issue #312 early skip)
   
  # Next, run coverage check (skip if tests were skipped — Issue #312)
  #
  # #760: TESTS_SKIPPED is one global flag written inside the per-language test
  # loop, but it is read HERE, outside that loop. A project that resolves to
  # several languages therefore had its coverage check cancelled by whichever
  # language stood down first -- and the loop order is the detection order, not
  # a statement about which language matters.
  #
  # Measured on a real repo (.xp-gate-config.json -> typescript, shell, csharp):
  # the typescript arm found no changed .ts file, set TESTS_SKIPPED=true, and the
  # csharp arm's dotnet test result (139 passing, full coverage data present) was
  # then discarded with "Test run was skipped — skipping coverage check". Gate 5
  # reported a PASS on a coverage floor it never evaluated.
  #
  # The flag now only speaks for language selection that produced nothing at all:
  # if any language actually RAN tests, coverage is evaluated for every language
  # that has an adapter. Languages that ran nothing fall through to their own
  # adapter's coverage branch, which already distinguishes "no evidence" (a
  # documented failure) from "not applicable" (iac).
  #
  # #601: "tests were not run" is not the same as "there is nothing to
  # evaluate". A repo can carry a coverage report from an earlier run (CI
  # artifacts, a developer's last npm test) while no runner is selected for this
  # change set. Skipping then DISCARDS a measurement that exists, and Gate 5
  # reports PASS on a floor it never applied -- #760's defect one direction over.
  # Measured on run 43368235868: with coverage/coverage-summary.json staged, the
  # hook still printed "Test run was skipped — skipping coverage check" and a
  # staged 42% never reached the threshold. The skip now also requires that no
  # coverage evidence is present.
  GATE_5_COVERAGE_EVIDENCE=false
  # #821: evidence must come FROM THE COMMIT, not from the working tree.
  #
  # This used to be a bare `-f` on the two report paths, so ANY leftover report
  # counted -- e.g. coverage/coverage-summary.json left behind by an earlier local
  # run over a different tree. Measured 2026-11-16 in this repo: a commit staging
  # one test file under the bundled mirror was blocked with
  #     ❌ BLOCKED - TypeScript coverage 2% below 78% threshold
  # and the identical commit passed once the leftover coverage/ directory was
  # removed. The percentage described neither this commit nor this tree, and the
  # working tree additionally carried a second workstream's uncommitted source.
  #
  # A report is evidence for this commit when the commit carries it. This keeps
  # #601 intact -- that issue is about a STAGED report being ignored, and its
  # fixtures stage the artefact with `git add -f` -- while refusing to answer
  # "how well is this change tested" with a stale measurement of something else.
  # `git cat-file -e :<path>` asks the INDEX (the commit being built) for the
  # blob; a plain `-f` asks the directory.
  if git cat-file -e ":coverage/coverage-summary.json" 2>/dev/null \
     || git cat-file -e ":coverage/coverage-final.json" 2>/dev/null; then
    GATE_5_COVERAGE_EVIDENCE=true
  fi
  if [ "${TESTS_SKIPPED:-false}" = "true" ] && [ "${TESTS_RAN_ANY:-false}" != "true" ] \
     && [ "$GATE_5_COVERAGE_EVIDENCE" != "true" ]; then
    echo "ℹ️  Test run was skipped — skipping coverage check."
  else
  echo "Running coverage check..."

  # Major-2 (Delphi): COV_EXIT aggregates coverage-run failures across ALL
  # languages in Stage 1. It starts at 0 and each language branch ORs its own
  # result in (`COV_EXIT=$((COV_EXIT || $?))`), so a later language's success
  # can never mask an earlier language's subset-run failure. Previously every
  # branch overwrote COV_EXIT and the last language's status won.
  COV_EXIT=0

  for CURRENT_LANG in $PROJECT_LANGS; do
  ADAPTER_FILE=$(resolve_adapter_path "$CURRENT_LANG")
  if [ "${CURRENT_LANG}" != "unknown" ] && [ -n "$ADAPTER_FILE" ]; then
    if source "$ADAPTER_FILE" 2>/dev/null; then
      case "$CURRENT_LANG" in
        "typescript")
          # Coverage collected during the test section above.
          # Smart selection (Issue #286): only runs changed/related tests with --coverage,
          # producing coverage/coverage-summary.json for the tested subset.
          # Stage 2 enforcement reads global coverage from the subset run.
          # #798: this used to echo "Test run was skipped — skipping coverage
          # check." — the SAME sentence the outer guard above uses for the case
          # where coverage really is skipped. Here nothing is skipped: this arm
          # only records that there is no TypeScript coverage to evaluate, and
          # the loop then continues to the next language (which is where
          # #798's csharp run kept going and re-ran the suite for 28s after
          # this line had already announced a skip). A message that describes
          # the outer decision while sitting inside an inner branch is how the
          # same output line appeared twice with two different meanings.
          # Evidence FIRST, then the skip flag -- the same precedence the outer
          # guard at the top of this section already uses. Before this, a staged
          # coverage artefact was ignored whenever the test run had been skipped
          # (no changed .ts file), so the artefact the outer guard had just
          # counted as evidence was never read: Gate 5 printed "no TS coverage
          # to evaluate" and carried on with COV_EXIT=0. Measured consequence --
          # a staged coverage-summary.json with `"pct": "Unknown"` (istanbul's
          # real unusable shape) and a staged 42% BOTH passed, because the
          # threshold comparison below never ran. "No evidence" and "evidence
          # says 42%" must not take the same branch.
          if { [ -f "coverage/coverage-summary.json" ] || [ -f "coverage/coverage-final.json" ]; } \
             && _gate5_coverage_usable; then
            echo "TypeScript coverage collected during test run."
            COV_EXIT=$((COV_EXIT || 0))
          elif [ -f "coverage/coverage-summary.json" ] || [ -f "coverage/coverage-final.json" ]; then
            # Present but produced by a different run: saying "collected during
            # test run" here is what made a five-hour-old report block a commit
            # with a percentage that described neither this commit nor this tree.
            echo "ℹ️  Coverage report on disk predates this run — ignored as stale."
            echo "    Run 'npx vitest run --coverage' to measure this tree."
            COV_EXIT=$((COV_EXIT || 0))
          elif [ "${TESTS_SKIPPED:-false}" = "true" ]; then
            echo "ℹ️  No TypeScript tests were selected — no TS coverage to evaluate."
            COV_EXIT=$((COV_EXIT || 0))
          else
            echo "ℹ️  No coverage data produced — test run was skipped (no TS changes)."
            COV_EXIT=$((COV_EXIT || 0))
          fi
          ;;
        "python")
          if command -v pytest &> /dev/null && command -v coverage &> /dev/null; then
            # Issue #45 (merged in #514, replacing a machine-side hotfix that
            # kept drifting out of the repo — the exact class #514 exists to
            # kill). BOTH the scope and the threshold must come from the
            # target repo's pyproject.toml ([tool.coverage.run] source,
            # [tool.coverage.report] fail_under — e.g. source=["src"],
            # fail_under=82): a hardcoded `--cov=. --cov-fail-under=80` counts
            # tests/ into the denominator and produced a measured 76.49%
            # false-red BLOCKED. tomllib first; a repo declaring neither gets
            # the historical `--cov=. --cov-fail-under=80` behavior verbatim.
            PY_COV_SOURCE=$(python -c "import tomllib;print(' '.join('--cov='+s for s in tomllib.load(open('pyproject.toml','rb'))['tool']['coverage']['run'].get('source',[])))" 2>/dev/null || echo "")
            PY_COV_FAIL_UNDER=$(python -c "import tomllib;print(tomllib.load(open('pyproject.toml','rb'))['tool']['coverage']['report']['fail_under'])" 2>/dev/null || echo "")
            if [ -z "$PY_COV_FAIL_UNDER" ]; then
              PY_COV_FAIL_UNDER=$(grep -oE 'fail_under *= *[0-9]+' pyproject.toml 2>/dev/null | grep -oE '[0-9]+' | head -1)
            fi
            [ -z "$PY_COV_SOURCE" ] && PY_COV_SOURCE="--cov=."
            [ -z "$PY_COV_FAIL_UNDER" ] && PY_COV_FAIL_UNDER=80

            # ── #399: smart test selection, the Python counterpart of #286 ──
            # Three tiers (lib/python-test-selection.sh holds the pure
            # decision logic + related-test lookup, unit-tested separately):
            #   changed-tests / related -> run ONLY those targets, with the
            #     repo's coverage SOURCE but WITHOUT the global fail_under
            #     (subset coverage is meaningless globally). The run is marked
            #     partial so Stage 2 warns instead of falsely blocking.
            #   full -> unchanged behavior: whole suite + real threshold.
            #   skip -> nothing test-relevant changed; no pytest at all.
            PY_CHANGED_TEST_FILES=$(printf '%s\n' "${XP_STAGED_ACM:-$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)}" \
              | filter_project_paths \
              | grep -E '(^|/)test_[^/]*\.py$|_test\.py$' || true)
            PY_CHANGED_SRC_FILES=$(printf '%s\n' "${XP_STAGED_ACM:-$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)}" \
              | filter_project_paths \
              | grep -E '\.py$' | grep -vE '(^|/)test_[^/]*\.py$|_test\.py$' || true)
            # NOT filtered on purpose: this list answers "did a requirements
            # file change", which is a property of the whole commit including
            # paths under a vendor/ tree that filter_project_paths removes.
            PY_CHANGED_ALL="${XP_STAGED_ACM:-$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)}"
            # `grep -c '.'` prints its own zero AND exits 1 on an empty list
            # (#493), so the count is derived with `|| true` + wc -l instead.
            PY_TEST_COUNT=$(printf '%s\n' "$PY_CHANGED_TEST_FILES" | grep -c '.' || true)
            PY_SRC_COUNT=$(printf '%s\n' "$PY_CHANGED_SRC_FILES" | grep -c '.' || true)
            PY_DEPS_CHANGED=0
            if python_dependency_changed $PY_CHANGED_ALL; then PY_DEPS_CHANGED=1; fi
            PY_STRATEGY=$(select_python_test_strategy "$PY_TEST_COUNT" "$PY_SRC_COUNT" "$PY_DEPS_CHANGED")

            # xdist parallel args (#516) — empty + warning when unavailable,
            # never a BLOCK; unquoted expansion is the multi-word arg list.
            PY_XDIST_ARGS=$(python_xdist_args 2>/dev/null || true)

            if [ "$PY_STRATEGY" = "skip" ]; then
              echo "ℹ️  Python: no test/source changes — skipping test run (#399)."
              # Critical-1 (#399): mark the run skipped so Stage 2's
              # enforce_python_coverage refuses to consume a stale .coverage
              # left by a prior subset run. Without this flag the gate read the
              # leftover low-% file and BLOCKED a docs-only commit that changed
              # no Python. Mirrors the TS branch's TESTS_SKIPPED guard.
              PY_TEST_SKIPPED=true
              COV_EXIT=$((COV_EXIT || 0))
            elif [ "$PY_STRATEGY" = "full" ]; then
              if [ "$PY_DEPS_CHANGED" = "1" ]; then
                echo "ℹ️  Python: dependency manifest changed — running FULL suite (#399)."
              elif [ "$PY_TEST_COUNT" -gt 20 ] 2>/dev/null; then
                echo "ℹ️  Python: $PY_TEST_COUNT changed test files (>20) — running FULL suite (#399)."
              fi
            
              pytest $PY_XDIST_ARGS $PY_COV_SOURCE --cov-fail-under="$PY_COV_FAIL_UNDER" --tb=short
              COV_EXIT=$((COV_EXIT || $?))
            else
              # changed-tests | related → resolve the exact targets.
              PY_TARGETS=""
              if [ "$PY_STRATEGY" = "changed-tests" ]; then
                PY_TARGETS="$PY_CHANGED_TEST_FILES"
              else
                for _py_src in $PY_CHANGED_SRC_FILES; do
                  _py_related=$(python_related_tests "$_py_src")
                  if [ -n "$_py_related" ]; then
                    PY_TARGETS="${PY_TARGETS}${_py_related}
"
                  fi
                done
                PY_TARGETS=$(printf '%s\n' "$PY_TARGETS" | grep -v '^$' | sort -u)
              fi

              if [ -z "$PY_TARGETS" ]; then
                # related lookup found nothing → tier 3 full run is safest.
                echo "ℹ️  Python: no related tests found for changed sources — running FULL suite (#399)."
              
                pytest $PY_XDIST_ARGS $PY_COV_SOURCE --cov-fail-under="$PY_COV_FAIL_UNDER" --tb=short
                COV_EXIT=$((COV_EXIT || $?))
              else
                PY_TARGET_COUNT=$(printf '%s\n' "$PY_TARGETS" | grep -c '.' || true)
                echo "ℹ️  Python: selective run ($PY_STRATEGY) — $PY_TARGET_COUNT target(s):"
                printf '%s\n' "$PY_TARGETS" | sed 's/^/     /'
                # Subset run: keep --cov so data is collected, but the global
                # threshold must be actively DISABLED, not merely omitted.
                # Omitting --cov-fail-under does not work (#556): pytest-cov
                # reads fail_under from pyproject on its own, so the floor
                # stayed in force, a selective run at 23% exited 1, and the
                # exit was escalated to a hard BLOCK -- printing "Partial
                # coverage ... not full suite" immediately above "BLOCKED -
                # Coverage check FAILED". --cov-fail-under=0 is the documented
                # way to switch it off for one invocation.
                PARTIAL_TEST_RUN=true
              
                pytest $PY_XDIST_ARGS $PY_COV_SOURCE --cov-fail-under=0 --tb=short $PY_TARGETS
                COV_EXIT=$((COV_EXIT || $?))
              fi
            fi
          else
            echo "pytest/coverage not available, running coverage via adapter..."
            run_coverage_output=$(run_coverage 2>&1)
            COV_EXIT=$((COV_EXIT || $?))
            echo "$run_coverage_output" | head -30
          fi
          ;;
        "go")
          if command -v go &> /dev/null; then
            # Extracted so the arm can be tested without running this repo's own
            # suite. The defect it fixes is described on the function.
            _gate5_go_coverage_arm || return 1
          fi
          ;;
        "shell")
          shell_cov_output=$(run_coverage 2>&1)
          COV_EXIT=$((COV_EXIT || $?))
          echo "$shell_cov_output" | head -10
          echo "ℹ️  Shell coverage not typically measured"
          ;;
        *)
          # #640: hand the staged set to the adapter. Java's run_coverage uses it
          # for three-tier smart selection (changed-tests -> related -> full);
          # without it the adapter deliberately runs the full suite rather than
          # guessing, so this export failing closed is safe.
          # Colon-separated: newlines do not survive every adapter's word
          # splitting, and paths with spaces stay intact inside the value.
          GATE_CHANGED_FILES=$(printf '%s' "$CHANGED_FILES" | tr '\n' ':')
          export GATE_CHANGED_FILES
          # The adapter runs inside $(...), so it cannot set PARTIAL_TEST_RUN
          # for us. It writes the chosen strategy to this file and we raise the
          # flag here, in the shell that later reads it. Without this a Java
          # subset run under 80% coverage would take the hard-BLOCK branch
          # instead of the WARN branch, exactly the bug #556 fixed for Python.
          _java_partial_file=$(mktemp 2>/dev/null || echo "")
          if [ -n "$_java_partial_file" ]; then
            export XP_GATE_PARTIAL_RUN_FILE="$_java_partial_file"
          fi
          default_cov_output=$(run_coverage 2>&1)
          COV_EXIT=$((COV_EXIT || $?))
          echo "$default_cov_output" | head -30
          unset XP_GATE_PARTIAL_RUN_FILE GATE_CHANGED_FILES
          if [ -n "$_java_partial_file" ]; then
            if [ -s "$_java_partial_file" ]; then
              PARTIAL_TEST_RUN=true
            fi
            rm -f "$_java_partial_file" 2>/dev/null || true
          fi
          ;;
      esac
    else
      # Adapter source failed — warn and let Stage 2 attempt file-based enforcement
      echo "⚠️  Could not source ${CURRENT_LANG} adapter from ${ADAPTER_FILE}, will check coverage files directly..."
      COV_EXIT=$((COV_EXIT || 0))
    fi
  else
    # No adapter available — warn and let Stage 2 attempt file-based enforcement
    echo "⚠️  No adapter found for ${CURRENT_LANG} (searched: ${ADAPTER_DIR}/, ${ADAPTER_DIR}/adapters/, ${PROJECT_GITHOOKS}/adapters/, ${SCRIPT_DIR}/adapters/) — will check coverage files directly..."
    COV_EXIT=$((COV_EXIT || 0))
  fi
  done  # end for CURRENT_LANG (Stage 1 coverage)

  # ============================================================================
  # Stage 2: UNCONDITIONAL coverage percentage enforcement
  # Always attempt to parse coverage from available sources. If percentage
  # can be determined and is < 80% → BLOCK. If no data found → warn.
  #
  # NOTE: When only a subset of test files were run (smart selection, Issue #286),
  # coverage data reflects only the tested subset. In that case we warn but don't
  # block, because the full suite coverage may be ≥80% even though the subset
  # coverage is lower.
  # ============================================================================
  COVERAGE_ENFORCED=false

  for CURRENT_LANG in $PROJECT_LANGS; do
  # #570: every comparison below reads $COVERAGE_THRESHOLD, and the messages
  # quote it. If it ever arrives empty (a helper called outside the hook, a test
  # harness that sources only the case block), `[ "$pct" -lt "" ]` is false and
  # `awk 'pct < thr'` with an empty thr is false too — the gate would PASS every
  # value, i.e. exactly the fail-open this issue is about. Fall back to the
  # historical default so an unset variable can never widen the gate.
  #
  # Kept INSIDE the loop (immediately before the case) so a harness that extracts
  # only `case ... esac` still gets the guarantee it depends on.
  if ! [[ "${COVERAGE_THRESHOLD:-}" =~ ^[0-9]+$ ]]; then
    COVERAGE_THRESHOLD=80
    COVERAGE_THRESHOLD_SOURCE="default (threshold was unset at Stage 2)"
  fi
  case "$CURRENT_LANG" in
    "typescript")
      COVERAGE_ENFORCED=true
      # Evidence FIRST, skip flag second -- the same precedence as the outer
      # guard and the stage-1 arm above. With the order reversed, a staged
      # coverage artefact was silently discarded whenever no test had been
      # selected (no changed .ts file), and Gate 5 printed
      #     ✅ PASSED - Coverage check skipped (no test/source files changed).
      # The artefact and the changed file were BOTH staged -- only the phrase
      # "no test/source files changed" was wrong, and it read as a pass. That is
      # the fail-open shape this whole issue exists to remove, sitting one branch
      # below a sibling that had already been fixed for it.
      if [ -f "coverage/coverage-summary.json" ] && _gate5_coverage_usable; then
        # #594: reject NaN at the SOURCE, not after the fact. Math.round() does
        # not fail on a non-numeric input -- it returns NaN and console.log prints
        # "NaN" -- so istanbul's "Unknown" (a file with no executable lines) sailed
        # past both the `!= "parse_error"` and `-n` guards. Emit `no_data`, which
        # the guard below already treats as "could not measure".
        COVERAGE_PERCENT=$(node -e "
          try {
            const fs = require('fs');
            const data = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));
            const pct = data && data.total && data.total.lines && data.total.lines.pct;
            console.log(Number.isFinite(pct) ? Math.round(pct) : 'no_data');
          } catch(e) { console.log('parse_error'); }
        " 2>/dev/null)
        # #594: `-n` was not enough. `[ "NaN" -lt 80 ]` is not false in bash -- it
        # is an ERROR (exit 2, "integer expression expected"), and an `if` only
        # tells zero from non-zero, so the error took the else branch: the PASS
        # branch. Require an actual integer before comparing anything.
        if [[ "$COVERAGE_PERCENT" =~ ^[0-9]+$ ]]; then
          # #570: default the threshold at the comparison site too — an empty
          # value makes test(1) fail, the branch is skipped, and low coverage is
          # reported as a pass.
          if [ "$COVERAGE_PERCENT" -lt "${COVERAGE_THRESHOLD:-80}" ]; then
            # Only a subset test run (smart selection) leaves partial coverage data;
            # a full suite run must block on <80% even when many test files changed.
            if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
              echo "⚠️  Partial coverage ${COVERAGE_PERCENT}% (subset test run, not full suite)."
              echo "    Run 'npx vitest run --coverage' for full coverage check."
            else
              # Record the verdict as well as printing it. Measured 2026-11-22:
              # these floor-miss branches printed "❌ BLOCKED - <lang> coverage N%
              # below M% threshold" and returned 1, while GATE_5_STATUS stayed
              # empty -- and an empty status renders as SKIP, so the summary line
              # one inch below reported a skip for a commit that was blocked.
              GATE_5_STATUS="BLOCK"
              xp_gate_detail_append GATE_5_DETAIL "coverage_below_floor: typescript coverage under the 80% floor"
              echo "❌ BLOCKED - TypeScript coverage ${COVERAGE_PERCENT}% below ${COVERAGE_THRESHOLD:-80}% threshold"
              return 1
            fi
          else
            echo "TypeScript coverage: ${COVERAGE_PERCENT}% ✅ (≥ ${COVERAGE_THRESHOLD:-80}%)"
          fi

          # ---- Diff coverage (#600): 指南 §10.1/§10.3 ----
          # The block above measures the WHOLE repo. A commit that changes five
          # lines and tests none of them passes as long as the global average has
          # not dipped -- so the only thing that gate ever knew about THIS change
          # was the average of everything else. This block asks the narrower and
          # more useful question: of the lines this commit touches, how many did
          # the tests execute?
          #
          # Skipped on a subset run, like the global check above: a partial run
          # legitimately leaves most changed lines unexecuted because the tests
          # covering them were deselected, and reporting that as low coverage
          # would punish the smart-selection feature for working.
          if declare -f compute_diff_coverage >/dev/null 2>&1 \
             && [ "${PARTIAL_TEST_RUN:-false}" != "true" ] \
             && [ -f "coverage/coverage-final.json" ]; then
            DIFF_COV_RANGES=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/diffcov-$$")
            DIFF_COV_LINE_T=$(diff_coverage_threshold diff_coverage_lines 90)
            DIFF_COV_BRANCH_T=$(diff_coverage_threshold diff_coverage_branches 85)
            staged_added_line_ranges > "$DIFF_COV_RANGES" 2>/dev/null || true
            if [ -s "$DIFF_COV_RANGES" ]; then
              DIFF_COV_OUT=$(compute_diff_coverage coverage/coverage-final.json \
                "$DIFF_COV_RANGES" "$DIFF_COV_LINE_T" "$DIFF_COV_BRANCH_T" 2>&1)
              DIFF_COV_RC=$?
              DIFF_COV_RESULT=$(printf '%s\n' "$DIFF_COV_OUT" | grep '^RESULT ' | head -1)
              DIFF_COV_BRANCH=$(printf '%s\n' "$DIFF_COV_OUT" | grep '^BRANCH ' | head -1)
              if [ "$DIFF_COV_RC" -eq 0 ]; then
                echo "Changed-line coverage: ${DIFF_COV_RESULT#RESULT }% ✅ (lines, ≥ ${DIFF_COV_LINE_T}%)"
                if printf '%s\n' "$DIFF_COV_OUT" | grep -q '^NA '; then
                  printf '%s\n' "$DIFF_COV_OUT" | grep '^NA ' | sed 's/^NA /     n\/a (no executable statements): /'
                fi
              elif [ "$DIFF_COV_RC" -eq 1 ]; then
                echo "❌ BLOCKED - Changed-line coverage below threshold (指南 §10.1)."
                echo "   Lines: ${DIFF_COV_RESULT#RESULT } (need ≥ ${DIFF_COV_LINE_T}%)"
                echo "   Branches: ${DIFF_COV_BRANCH#BRANCH } (need ≥ ${DIFF_COV_BRANCH_T}%)"
                printf '%s\n' "$DIFF_COV_OUT" | grep '^UNCOVERED ' | sed 's/^UNCOVERED /   untested changed lines: /'
                printf '%s\n' "$DIFF_COV_OUT" | grep '^MISSING ' | sed 's/^MISSING /   no coverage data for: /'
                echo "   Add tests for the lines listed above, or set diff_coverage_lines in"
                echo "   .xp-gate/test-profile.yaml if this file genuinely cannot be unit-tested."
                rm -f "$DIFF_COV_RANGES"
                return 1
              else
                # #570: not measurable is not a pass. (The global check above already
                # blocked on a missing/corrupt report; this arm covers the narrower
                # case where coverage-final.json itself is unreadable.)
                echo "⚠️  Changed-line coverage could not be measured (coverage-final.json unreadable)."
                echo "   See: $(printf '%s\n' "$DIFF_COV_OUT" | grep '^ERROR ' | head -1)"
              fi
            fi
            rm -f "$DIFF_COV_RANGES"
          fi
        else
          # #570: an unparseable report is not a pass. Silently continuing here
          # meant a corrupt or unexpected-shape coverage-summary.json disabled the
          # TypeScript coverage gate while the run still looked clean.
          if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
            echo "⚠️  Could not parse TypeScript coverage from coverage/coverage-summary.json (subset test run) — not blocking."
          else
            echo "❌ BLOCKED - Could not parse TypeScript coverage from coverage/coverage-summary.json."
            echo "   The report exists but carries no usable total.lines.pct, so the"
            echo "   ${COVERAGE_THRESHOLD:-80}% floor could not be checked."
            return 1
          fi
        fi
      else
        # This arm is now reached for two different inputs: no report at all, and
        # a report too old to describe this run. Name the second one before the
        # #570/#823 decision, which stays exactly as it was -- "no measurement
        # was produced" still blocks unless nothing was selected. Without this
        # line an operator reads "not found" while the file is plainly there.
        if [ -f "coverage/coverage-summary.json" ] && ! _gate5_coverage_usable; then
          echo "ℹ️  Coverage report on disk predates this run — ignored as stale."
          echo "    Run 'npx vitest run --coverage' to measure this tree."
        fi
        # #570: the report file is absent, so nothing was measured. Warning and
        # continuing made "delete coverage/coverage-summary.json" an effective way
        # to switch this gate off.
        #
        # #823: but "absent" has two causes and only one of them is a problem.
        # Measured 2026-11-16 committing a comment-only fix to a gate script --
        # Gate 5 printed, in this order,
        #     ✅ PASSED - No test or source files changed, skipping test run.
        #     ℹ️  No TypeScript tests were selected — no TS coverage to evaluate.
        #     ❌ BLOCKED - coverage/coverage-summary.json not found.
        # The gate established twice that it had nothing to measure, then demanded
        # a measurement. PARTIAL_TEST_RUN did not cover it because that flag means
        # "some tests ran"; here NO test was selected, so a commit touching nothing
        # but shell reached the strict arm of #570 and could only land with a Gate 0
        # version bump or a fabricated report.
        #
        # #570 stays intact: tests SELECTED but producing no report is still the
        # off-switch this must block. Only "nothing was selected" is exempt.
        #
        # The exemption keys on TESTS_SKIPPED ALONE, deliberately. The obvious
        # pairing -- `TESTS_SKIPPED && !TESTS_RAN_ANY` -- does not work, and the
        # probe that proved it is worth recording: on the reproduction above the
        # two flags read `skipped=true ran=true` at the same moment. TESTS_RAN_ANY
        # is set by the IaC arm when its run_tests prints "IaC tests not configured"
        # and returns 0 (gate-5-entry.sh:850-853, #760), because a runner DID
        # execute -- it just had nothing to test. So `!TESTS_RAN_ANY` is false for
        # any repo declaring iac, which is every repo using this gate the way this
        # one does. TESTS_SKIPPED is the precise signal: it is set only where the
        # test section concluded there was nothing to run.
        if [ "${TESTS_SKIPPED:-false}" = "true" ]; then
          echo "ℹ️  No tests were selected, so no coverage report was expected — skipping the coverage floor."
        elif [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
          echo "⚠️  coverage/coverage-summary.json not found (subset test run) — not blocking."
        else
          echo "❌ BLOCKED - coverage/coverage-summary.json not found."
          echo "   No coverage could be measured, so the ${COVERAGE_THRESHOLD:-80}% floor could not be"
          echo "   checked. Run 'npx vitest run --coverage' before committing."
          return 1
        fi
      fi
      ;;
    "python")
      COVERAGE_ENFORCED=true
      # Issue #523: parsing + threshold verdict live in lib/coverage-total.sh
      # (the old `grep -o '[0-9]*%'` never matched --format=total's bare
      # number, so this branch never reached the threshold). Returns 1 on
      # BLOCK after echoing the verdict.
      #
      # The verdict must be RECORDED as well as echoed. Measured 2026-11-22 on a
      # Python fixture at 48% against an 80% floor: enforce_python_coverage printed
      #
      #     ❌ BLOCKED - Python coverage 48% below 80% threshold
      #
      # and this `|| return 1` propagated the exit without ever assigning
      # GATE_5_STATUS, so the epilogue -- which only promotes an EMPTY status to PASS
      # -- left it empty and the summary rendered
      #
      #     Gate 5: Tests + Coverage    SKIP (coverage: 48%)
      #
      # beside that BLOCKED line. Console said blocked, journal said skipped. The
      # library returns the verdict and cannot record it: it has no access to the
      # gate's status variable, so the assignment belongs here, at the call site.
      if ! enforce_python_coverage; then
        GATE_5_STATUS="BLOCK"
        xp_gate_detail_append GATE_5_DETAIL "coverage_below_floor: python coverage under the 80% floor"
        return 1
      fi
      ;;
    "java")
      COVERAGE_ENFORCED=true
      # JaCoCo writes target/site/jacoco/ (Maven) or build/reports/jacoco/test/
      # (Gradle), i.e. neither path probed by the default branch below, so Java
      # needs its own branch to be measurable at all.
      #
      # #603: a MULTI-MODULE Maven repo writes one report per module --
      # whaleaudit-core/target/site/jacoco/jacoco.csv, whaleaudit-demo/... --
      # and nothing at the repo root. Probing only the root paths therefore
      # concluded "No JaCoCo report found, so the 80% floor cannot be verified"
      # and BLOCKED every Java commit of a project that had a complete report
      # sitting one directory down. A gate that cannot see the report is not
      # enforcing a floor, it is enforcing an accident of build layout.
      # Fix: probe the root paths first (single-module projects, and the
      # historical behaviour), then fall back to the module reports and
      # aggregate across them, so the floor covers every class that was built.
      jacoco_csv=""
      jacoco_all=""
      for jacoco_candidate in \
        "target/site/jacoco/jacoco.csv" \
        "build/reports/jacoco/test/jacocoTestReport.csv"; do
        [ -f "$jacoco_candidate" ] && { jacoco_csv="$jacoco_candidate"; break; }
      done
      if [ -z "$jacoco_csv" ]; then
        # Module reports. -mindepth-free walk so ./module/... is found; sorted
        # for a stable, reproducible aggregate order.
        jacoco_all=$(find . -path ./target -prune -o \
          -type f \( -name 'jacoco.csv' -path '*/target/site/jacoco/*' \) -print 2>/dev/null \
          | sort | tr '\n' ' ')
        # First module report doubles as the "report exists" witness for the
        # messages below; the aggregate sums over every one of them.
        jacoco_csv=$(echo "$jacoco_all" | awk '{print $1}')
      fi
      if [ -n "$jacoco_csv" ] && [ -n "$jacoco_all" ]; then
        _jc_n=$(echo "$jacoco_all" | awk '{print NF}')
        echo "   ℹ️  Multi-module JaCoCo: aggregating $_jc_n module report(s)."
      fi

      if [ -n "$jacoco_csv" ]; then
        # Aggregate INSTRUCTION_MISSED / INSTRUCTION_COVERED over every class row.
        # Columns are located by header name because their position is not part of
        # the CSV's stable contract.
        #
        # #603: with module reports, each file repeats the header row, so the
        # header detection is per-file (FNR == 1) rather than per-stream
        # (NR == 1). Otherwise module 2's header is summed as data, or worse,
        # the single header found in module 1 leaves the columns unset for it.
        _jc_inputs="$jacoco_csv"
        [ -n "$jacoco_all" ] && _jc_inputs="$jacoco_all"
        COVERAGE_PERCENT=$(awk -F, '
          FNR == 1 {
            missed_col = 0; covered_col = 0;
            for (i = 1; i <= NF; i++) {
              if ($i == "INSTRUCTION_MISSED") missed_col = i;
              if ($i == "INSTRUCTION_COVERED") covered_col = i;
            }
            next;
          }
          missed_col && covered_col {
            missed += $missed_col;
            covered += $covered_col;
          }
          END {
            total = missed + covered;
            if (total > 0) printf "%.2f", (covered / total) * 100;
            else print "";
          }
        ' $_jc_inputs 2>/dev/null) || COVERAGE_PERCENT=""

        if [ -n "$COVERAGE_PERCENT" ]; then
          # Compare on the unrounded value so 79.5% cannot pass as 80%.
          COVERAGE_ROUNDED=${COVERAGE_PERCENT%.*}
          if awk -v pct="$COVERAGE_PERCENT" -v thr="${COVERAGE_THRESHOLD:-80}" 'BEGIN { exit !(pct < thr) }'; then
            if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
              echo "⚠️  Partial coverage ${COVERAGE_ROUNDED}% (subset test run, not full suite)."
              echo "    Run the full test suite for a complete Java coverage check."
            else
              # Record the verdict as well as printing it. Measured 2026-11-22:
              # these floor-miss branches printed "❌ BLOCKED - <lang> coverage N%
              # below M% threshold" and returned 1, while GATE_5_STATUS stayed
              # empty -- and an empty status renders as SKIP, so the summary line
              # one inch below reported a skip for a commit that was blocked.
              GATE_5_STATUS="BLOCK"
              xp_gate_detail_append GATE_5_DETAIL "coverage_below_floor: java coverage under the 80% floor"
              echo "❌ BLOCKED - Java coverage ${COVERAGE_ROUNDED}% below ${COVERAGE_THRESHOLD:-80}% threshold"
              return 1
            fi
          else
            echo "Java coverage: ${COVERAGE_ROUNDED}% ✅ (≥ ${COVERAGE_THRESHOLD:-80}%)"
          fi
        else
          # #570: a JaCoCo report that yields no instruction data measured
          # nothing. Warning and continuing let the gate pass on no evidence.
          if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
            echo "⚠️  Could not parse Java coverage from ${jacoco_csv} (subset test run) — not blocking."
          else
            echo "❌ BLOCKED - Could not parse Java coverage from ${jacoco_csv} (no instruction data),"
            echo "   so the ${COVERAGE_THRESHOLD:-80}% floor cannot be verified."
            return 1
          fi
        fi
      else
        # #570: no report at all is the fail-open path this issue was filed for.
        if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
          echo "⚠️  No JaCoCo report found (subset test run) — not blocking."
        else
          # (#703) Diagnose BEFORE advising. The old message sent every user to
          # `mvn verify`; on a build path containing non-ASCII characters that
          # command is a dead end. Measured on a zh_CN Windows box at
          # D:\projects\SQL审计工具: the JaCoCo agent never writes jacoco.exec, it
          # does not throw, and Maven reports BUILD SUCCESS with
          #   [INFO] Skipping JaCoCo execution due to missing execution data file.
          # so `mvn verify` "fixes" nothing and the user loops. Splitting the
          # diagnosis out lets each case get an action that can actually work.
          echo "❌ BLOCKED - No JaCoCo report found, so the ${COVERAGE_THRESHOLD:-80}% Java coverage"
          echo "   floor cannot be verified."
          # The distinguishing symptom is the jacoco.exec execution data file, not
          # a missing report: a report that failed to be GENERATED and an agent
          # that never WROTE are different problems with different fixes.
          echo "   Likely cause: the JaCoCo agent did not write its execution data file"
          echo "   (target/jacoco.exec), which is what 'Skipping JaCoCo execution due to"
          echo "   missing execution data file' in the Maven log means."
          # A non-ASCII working directory is the one common cause where the usual
          # advice actively does not work, so it must be called out by name rather
          # than left for the user to discover by trying.
          case "$PWD" in
            *[!-~]*)
              echo "   ⚠️  This build path contains non-ASCII characters: ${PWD}"
              echo "   ⚠️  Re-running 'mvn verify' will NOT help on this path — JaCoCo"
              echo "       silently skips writing execution data there. Build through an"
              echo "       ASCII-only directory instead (e.g. a junction to the same tree,"
              echo "       entered with cmd's 'pushd'/'cd /d' — Git Bash's cd resolves the"
              echo "       junction back to the non-ASCII path, so it does not help)."
              ;;
            *)
              echo "   To produce it, run 'mvn verify' or 'gradle jacocoTestReport' so that"
              echo "   target/site/jacoco/jacoco.csv exists (see also: JaCoCo detection"
              echo "   in adapters/java.sh)."
              ;;
          esac
          return 1
        fi
      fi
      ;;
    "go")
      # Go enforcement already handled inline in Stage 1 (lines 933-942)
      ;;
    "shell")
      # Shell coverage not typically measured
      ;;
    "dart"|"flutter")
      COVERAGE_ENFORCED=true
      if [ -f "coverage/lcov.info" ]; then
        COVERAGE_PERCENT=$(parse_lcov_coverage "coverage/lcov.info" 2>/dev/null) || COVERAGE_PERCENT="0"
        # #570: `-ge 0`, not `!= "0"`. A measured 0% is DATA — the tool ran and
        # covered nothing — so it must reach the threshold comparison instead of
        # being folded into "could not determine".
        if [ -n "$COVERAGE_PERCENT" ] && [ "$COVERAGE_PERCENT" -ge 0 ] 2>/dev/null; then
          # #570: default at the comparison site; an empty threshold makes
          # test(1) fail and silently skips the BLOCK.
          if [ "$COVERAGE_PERCENT" -lt "${COVERAGE_THRESHOLD:-80}" ]; then
            if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
              echo "⚠️  Partial coverage ${COVERAGE_PERCENT}% (subset test run, not full suite)."
              echo "    Run the full test suite for a complete Flutter/Dart coverage check."
            else
              # Record the verdict as well as printing it -- see the typescript branch
              # above for the measurement. An unassigned status renders as SKIP.
              GATE_5_STATUS="BLOCK"
              xp_gate_detail_append GATE_5_DETAIL "coverage_below_floor: flutter/dart coverage under the 80% floor"
              echo "❌ BLOCKED - Flutter/Dart coverage ${COVERAGE_PERCENT}% below ${COVERAGE_THRESHOLD:-80}% threshold"
              return 1
            fi
          else
            echo "Flutter/Dart coverage: ${COVERAGE_PERCENT}% ✅ (≥ ${COVERAGE_THRESHOLD:-80}%)"
          fi
        else
          # #570: lcov.info exists but carries no usable hit/found pair.
          if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
            echo "⚠️  Could not determine Flutter/Dart coverage (subset test run) — not blocking."
          else
            echo "❌ BLOCKED - Could not determine Flutter/Dart coverage from coverage/lcov.info,"
            echo "   so the ${COVERAGE_THRESHOLD:-80}% floor cannot be verified."
            return 1
          fi
        fi
      else
        # #570: the fail-open path. `dart test --coverage` not run means the gate
        # has no evidence, and no evidence is not a pass.
        if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
          echo "⚠️  coverage/lcov.info not found (subset test run) — not blocking."
        else
          echo "❌ BLOCKED - coverage/lcov.info not found, so the ${COVERAGE_THRESHOLD:-80}% Flutter/Dart"
          echo "   coverage floor cannot be verified. Ensure 'dart test --coverage' was run."
          return 1
        fi
      fi
      ;;
    "powershell")
      COVERAGE_ENFORCED=true
      # #806 G5a: a repo with no Pester tests can never produce coverage.xml, yet
      # the branch below demanded one and BLOCKED -- refusing every commit that
      # touched a .ps1 on evidence the repo could not supply. The gate even printed
      # "No Pester tests found" earlier in the same run, then blocked for the
      # missing artifact anyway.
      #
      # "There are no tests to run" and "tests ran but coverage is missing" are
      # different states and must not collapse into one verdict. The first is SKIP
      # with a reason; the second stays fail-closed (#570: an unavailable
      # measurement is not a pass). Detection uses the same *.Tests.ps1 convention
      # the rest of Gate 5 uses, so a repo that acquires tests automatically gets
      # enforcement back -- there is nothing to remember to flip.
      if ! find . \( -name '*.Tests.ps1' -o -name '*.Tests.psm1' \) \
             -not -path './node_modules/*' -not -path './.git/*' \
             -print -quit 2>/dev/null | grep -q .; then
        echo "⏭️  SKIPPED - PowerShell coverage: no Pester tests in this project (*.Tests.ps1)"
        echo "    Nothing can produce coverage.xml here, so the floor is not applicable."
        echo "    This is NOT a pass: add Pester tests and coverage is enforced again."
        # A language with nothing to measure must not speak for the ones that
        # DID measure something. Gate 5 walks PROJECT_LANGS in config order
        # (typescript, shell, powershell, iac), and this branch used to demote a
        # PASS that a previous language had genuinely produced:
        #
        #     if [ "$GATE_5_STATUS" = "PASS" ]; then GATE_5_STATUS="SKIP"; fi
        #
        # Measured 2026-11-24 across 343 audit records: gate-5 has 0 PASS and 21
        # SKIP, all 13 explained skips reading "powershell: no Pester tests", in
        # a repo carrying thousands of TypeScript tests. The gate never enforced
        # anything -- because the last language to have nothing to do overwrote
        # the verdict of the one that did.
        #
        # The downgrade is therefore removed. When powershell is the ONLY
        # language that reported (nothing ran before it), the status is still
        # set below, so the "nothing to measure" state keeps its own verdict and
        # its own reason -- it simply may no longer erase someone else's.
        if [ -z "${GATE_5_STATUS:-}" ]; then
          GATE_5_STATUS="SKIP"
        fi
        xp_gate_detail_append GATE_5_DETAIL "powershell: no Pester tests (coverage not applicable)"
        COVERAGE_ENFORCED=false
      elif [ -f "coverage.xml" ]; then
        # The threshold is passed INTO node: the verdict used to be computed
        # against a hard-coded 80 inside the script, so a project that configured
        # a different floor got a verdict about a number it never set (#570).
        COVERAGE_RESULT=$(THRESHOLD="${COVERAGE_THRESHOLD:-80}" node -e "
          try {
            const fs = require('fs');
            const xml = fs.readFileSync('coverage.xml', 'utf8');
            const counters = [...xml.matchAll(/<counter\b([^>]*)\/?\s*>/gi)]
              .map((match) => Object.fromEntries(
                [...match[1].matchAll(/([\w:-]+)\s*=\s*(['\"])(.*?)\2/g)]
                  .map((attribute) => [attribute[1].toUpperCase(), attribute[3]])
              ))
              .filter((counter) => counter.TYPE === 'LINE');
            const reportCounter = counters.at(-1);
            const missed = Number(reportCounter?.MISSED);
            const covered = Number(reportCounter?.COVERED);
            const total = missed + covered;
            if (!Number.isFinite(missed) || !Number.isFinite(covered) || missed < 0 || covered < 0 || total <= 0) {
              throw new Error('invalid LINE counter');
            }
            const threshold = Number(process.env.THRESHOLD);
            // Number("") is 0, which would make every percentage "pass" — the
            // exact fail-open shape this fix is about. Refuse an unusable floor.
            if (!Number.isFinite(threshold) || threshold <= 0) {
              throw new Error('unusable THRESHOLD');
            }
            const percentage = (covered / total) * 100;
            console.log((percentage < threshold ? 'below' : 'pass') + '|' + Math.round(percentage));
          } catch (error) { console.log('parse_error'); }
        " 2>/dev/null) || COVERAGE_RESULT="parse_error"
        if [ "$COVERAGE_RESULT" != "parse_error" ] && [ -n "$COVERAGE_RESULT" ]; then
          COVERAGE_STATUS=${COVERAGE_RESULT%%|*}
          COVERAGE_PERCENT=${COVERAGE_RESULT#*|}
          if [ "$COVERAGE_STATUS" = "below" ]; then
            if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
              echo "⚠️  Partial coverage ${COVERAGE_PERCENT}% (subset test run, not full suite)."
              echo "    Run the full Pester suite for a complete PowerShell coverage check."
            else
              # Record the verdict as well as printing it -- see the typescript branch
              # above for the measurement. An unassigned status renders as SKIP.
              GATE_5_STATUS="BLOCK"
              xp_gate_detail_append GATE_5_DETAIL "coverage_below_floor: powershell coverage under the 80% floor"
              echo "❌ BLOCKED - PowerShell coverage ${COVERAGE_PERCENT}% below ${COVERAGE_THRESHOLD:-80}% threshold"
              return 1
            fi
          else
            echo "PowerShell coverage: ${COVERAGE_PERCENT}% ✅ (≥ ${COVERAGE_THRESHOLD:-80}%)"
          fi
        else
          # #570: an unparseable coverage.xml is no evidence, not a pass.
          if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
            echo "⚠️  Could not parse PowerShell coverage from coverage.xml (subset test run) - not blocking."
          else
            echo "❌ BLOCKED - Could not parse PowerShell coverage from coverage.xml,"
            echo "   so the ${COVERAGE_THRESHOLD:-80}% floor cannot be verified."
            return 1
          fi
        fi
      else
        # #570: Pester coverage not run means the gate has nothing to answer with.
        if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
          echo "⚠️  coverage.xml not found (subset test run) - not blocking."
        else
          echo "❌ BLOCKED - coverage.xml not found, so the ${COVERAGE_THRESHOLD:-80}% PowerShell"
          echo "   coverage floor cannot be verified. Ensure Pester coverage was run."
          return 1
        fi
      fi
      ;;
    "iac")
      # IaC has no coverage concept — must not borrow the TypeScript report
      # that Stage 1 leaves behind (same rule as the PowerShell branch).
      ;;
    *)
      # Default: attempt to parse coverage from common formats regardless of language
      #
      # "There are nothing to measure" is a different state from "coverage was
      # expected and is missing", and collapsing them caused a false BLOCK.
      # Measured 2026-11-23 on the csharp probe fixture: a single A.cs with no
      # test project at all produced
      #     gate 5 = BLOCK  coverage_not_determined: no standard report file for csharp
      # -- refusing a commit because a repository that has never had tests did not
      # emit coverage data. The PowerShell branch already draws this distinction
      # (#806 G5a, see above): no tests to run is SKIP with a reason, while
      # "tests ran but the report is missing" stays fail-closed (#570). This
      # branch honoured only the second half of that rule.
      #
      # Detection is the same shape as the PowerShell branch: ask whether the
      # project contains ANY test source for this language. A repo that acquires
      # tests gets enforcement back automatically.
      if ! _gate5_language_has_tests "$CURRENT_LANG"; then
        echo "⏭️  SKIPPED - ${CURRENT_LANG} coverage: no test sources in this project."
        echo "    Nothing can produce a coverage report here, so the floor is not applicable."
        echo "    This is NOT a pass: add tests and coverage is enforced again."
        GATE_5_STATUS="SKIP"
        xp_gate_detail_append GATE_5_DETAIL "${CURRENT_LANG}: no test sources (coverage not applicable)"
        COVERAGE_ENFORCED=false
      else
      COVERAGE_ENFORCED=true
      COVERAGE_PERCENT=""
      if [ -f "coverage/coverage-summary.json" ] && _gate5_coverage_usable; then
        COVERAGE_PERCENT=$(node -e "
          try {
            const fs = require('fs');
            const data = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));
            console.log(Math.round(data.total.lines.pct));
          } catch(e) { console.log('parse_error'); }
        " 2>/dev/null) || COVERAGE_PERCENT=""
      elif [ -f "coverage/lcov.info" ]; then
        if command -v parse_lcov_coverage &> /dev/null; then
          COVERAGE_PERCENT=$(parse_lcov_coverage "coverage/lcov.info" 2>/dev/null) || COVERAGE_PERCENT=""
        else
          COVERAGE_PERCENT=$(grep -oP 'SF:.*' coverage/lcov.info 2>/dev/null | wc -l || echo "0")
          # Simple fallback: check lcov for coverage percentage
          COVERAGE_PERCENT=$(grep -oP 'coverage: \K[0-9]+%' coverage/lcov.info 2>/dev/null | head -1 | tr -d '%') || COVERAGE_PERCENT=""
        fi
      else
        # #768: Cobertura is what the .NET/C# and several JVM toolchains actually
        # emit -- `dotnet test --collect:"XPlat Code Coverage"` writes ONE
        # cobertura XML per test target under TestResults/<guid>/coverage.cobertura.xml,
        # never coverage-summary.json or lcov.info. This branch only knew the two
        # JS-oriented filenames, so a C# project with full coverage data fell into
        # "Could not determine coverage percentage" and was BLOCKED with an
        # instruction to "produce coverage data" it had already produced.
        #
        # Discovery order: the conventional root file first, then the newest
        # TestResults artifact, so both `coverlet`'s default layout and a
        # hand-placed report work. Newest-first matters because TestResults
        # accumulates one directory per run and an old report must not win.
        _cob_file=""
        for _candidate in coverage/cobertura.xml coverage.cobertura.xml coverage/coverage.cobertura.xml; do
          if [ -f "$_candidate" ]; then _cob_file="$_candidate"; break; fi
        done
        if [ -z "$_cob_file" ]; then
          _cob_file=$(find . -name 'coverage.cobertura.xml' \
            -path '*TestResults*' -not -path './.git/*' 2>/dev/null \
            | while IFS= read -r _f; do printf '%s\t%s\n' "$(stat -c %Y "$_f" 2>/dev/null || stat -f %m "$_f" 2>/dev/null || echo 0)" "$_f"; done \
            | sort -rn | head -1 | cut -f2-)
        fi
        if [ -n "$_cob_file" ] && [ -f "$_cob_file" ]; then
          # Cobertura's root <coverage line-rate="..."> is the fraction covered
          # (0..1) and is authoritative; summing per-class lines double-counts.
          # A report that exists but has no parseable line-rate is `parse_error`,
          # which the caller treats as "no evidence" rather than 0% -- 0% would
          # be a *measured* value and block with the wrong reason.
          COVERAGE_PERCENT=$(node -e "
            try {
              const fs = require('fs');
              const xml = fs.readFileSync(process.argv[1], 'utf8');
              const root = xml.match(/<coverage\b[^>]*>/);
              if (!root) { console.log('parse_error'); process.exit(0); }
              const rate = root[0].match(/line-rate\s*=\s*[\"']([0-9.]+)[\"']/);
              if (!rate) { console.log('parse_error'); process.exit(0); }
              const value = Number(rate[1]);
              if (!Number.isFinite(value) || value < 0 || value > 1) { console.log('parse_error'); process.exit(0); }
              console.log(Math.round(value * 100));
            } catch (e) { console.log('parse_error'); }
          " "$_cob_file" 2>/dev/null) || COVERAGE_PERCENT=""
          if [ -n "$COVERAGE_PERCENT" ] && [ "$COVERAGE_PERCENT" != "parse_error" ]; then
            echo "   (coverage source: $_cob_file)"
          fi
        fi
      fi
      # #579: `-ge 0`, not `-gt 0`. A measured 0% is DATA -- coverage.py ran and
      # covered nothing -- not a missing value. Folding it into the
      # "could not determine" branch let a suite that tested nothing pass the
      # coverage gate with a WARNING. The two claims are different: 0% is
      # "executed, proved nothing"; undetermined is "no evidence produced".
      # #570: the threshold is defaulted HERE as well as quoted in the message.
      # A bare `[ "$COVERAGE_PERCENT" -lt "$COVERAGE_THRESHOLD" ]` with an empty
      # threshold makes test(1) fail with "integer expected", the condition is
      # false, and 16% coverage was reported as ✅ (the same fail-open shape this
      # issue is about, one line further down). `2>/dev/null` on the numeric test
      # keeps a non-numeric report on the "cannot determine" path instead of
      # dying.
      if [ -n "$COVERAGE_PERCENT" ] && [ "$COVERAGE_PERCENT" != "parse_error" ] \
         && [ "$COVERAGE_PERCENT" -ge 0 ] 2>/dev/null; then
        if [ "$COVERAGE_PERCENT" -lt "${COVERAGE_THRESHOLD:-80}" ]; then
          # Only a subset test run (smart selection) warns — the full suite may
          # still reach ≥80%; a full suite run must block.
          if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
            echo "⚠️  Partial coverage ${COVERAGE_PERCENT}% (subset test run, not full suite)."
            echo "    Run the full test suite for a complete ${CURRENT_LANG} coverage check."
          else
            # Record the verdict, not just print it. Measured 2026-11-22 on a Python
            # fixture at 48% against an 80% floor: this branch printed
            #
            #     ❌ BLOCKED - Python coverage 48% below 80% threshold
            #
            # and returned 1, while the summary one inch below still read
            #
            #     Gate 5: Tests + Coverage    SKIP (coverage: 48%)
            #
            # because the status variable was never assigned and the epilogue only
            # promotes an EMPTY status to PASS -- an empty status therefore rendered
            # as SKIP. The identical lesson was already written into the
            # "could not determine" branch below, which sets BLOCK explicitly; this
            # branch is the same defect, one condition over, and it was missed. A
            # verdict that only reaches the console is a verdict the journal
            # contradicts.
            GATE_5_STATUS="BLOCK"
            xp_gate_detail_append GATE_5_DETAIL "coverage_below_floor: ${CURRENT_LANG} ${COVERAGE_PERCENT}% < ${COVERAGE_THRESHOLD:-80}%"
            echo "❌ BLOCKED - ${CURRENT_LANG} coverage ${COVERAGE_PERCENT}% below ${COVERAGE_THRESHOLD:-80}% threshold"
            return 1
          fi
        else
          echo "${CURRENT_LANG} coverage: ${COVERAGE_PERCENT}% ✅ (≥ ${COVERAGE_THRESHOLD:-80}%)"
        fi
      else
        # #570: "could not determine" is a FAILED answer to the gate's question
        # ("is coverage at or above the floor?"), not a lenient one. Warning and
        # falling through made the generic branch fail-open: a language that
        # produced no standard report file passed the coverage gate while the
        # summary still looked clean. The ONE exception is a subset run, where
        # the global percentage is meaningless by construction.
        if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
          echo "⚠️  Could not determine ${CURRENT_LANG} coverage percentage (subset test run) — not blocking."
        else
          echo "❌ BLOCKED - Could not determine ${CURRENT_LANG} coverage percentage."
          echo "   No standard coverage report file was found, so the ${COVERAGE_THRESHOLD:-80}% floor"
          echo "   could not be checked. Produce coverage data or run a subset test run."
          # Record the verdict the gate just made. Measured 2026-11-20 on a PHP
          # fixture: this branch printed "BLOCKED - Could not determine php coverage
          # percentage" and returned 1, while the persisted report recorded
          #     gate5_tests: {"status": "SKIP", "reason": ""}
          # and overall.gatesFailed stayed 0. The console said BLOCKED, the machine-
          # readable record said "skipped, no reason", and neither was updated by this
          # return. A verdict that only reaches the console is a verdict the journal
          # contradicts.
          GATE_5_STATUS="BLOCK"
          xp_gate_detail_append GATE_5_DETAIL "coverage_not_determined: no standard report file for ${CURRENT_LANG}"
          return 1
        fi
      fi
      fi
      ;;
  esac

  if [ "$COV_EXIT" -ne 0 ]; then
    echo ""
    echo "❌ BLOCKED - Coverage check FAILED"
    return 1
  fi
  if [ "$COVERAGE_ENFORCED" = false ]; then
    echo "ℹ️  Coverage enforcement not applicable for ${CURRENT_LANG}"
  fi
  # The verdict must agree with the decision, including when the decision was to
  # hand the work to CI.
  #
  # This line used to print unconditionally. For the shell adapter -- which
  # declares tests_delegated_to_ci() and prints "Not checked by this gate --
  # verified on push/PR instead" a few lines earlier -- the log therefore ended
  # with a PASSED for a suite that ran nowhere. Measured 2026-11-19 on a shell
  # fixture whose only .bats test is `[ 1 -eq 2 ]`:
  #
  #     shell: tests run in CI bats-contracts job ...
  #        Not checked by this gate -- verified on push/PR instead.
  #     PASSED - Coverage check completed.
  #
  # The delegation is deliberate (239 bats suites serially measured 18m47s, which
  # is why CI owns that job), so the fix is not to stop delegating -- it is to stop
  # reporting a pass for it. Same family as "SKIP must be recorded, not merely
  # printed", with the polarity reversed: the skip WAS printed, and then a PASS
  # was printed on top of it.
  if [ -n "${DELEGATED_LANGS:-}" ]; then
    echo "ℹ️  Tests for ${DELEGATED_LANGS} are checked in CI, not by this gate."
    echo "   No test verdict was produced here -- absence of a failure is not a pass."
  else
    echo "✅ PASSED - Coverage check completed."
  fi
  done  # end for CURRENT_LANG (Stage 2 coverage)

  fi  # End: if [ "${TESTS_SKIPPED:-false}" != "true" ] (Issue #312 coverage skip)

  # ============================================================================
  # Stage 3: Per-file coverage check for NEW files (Issue #103)
  # New files must have ≥80% coverage individually.
  # ============================================================================
  if has_project_lang "typescript" && [ -f "coverage/coverage-summary.json" ]; then
    NEW_SOURCE_FILES=$(git diff --cached --name-only --diff-filter=A | filter_project_paths | grep -E '\.(ts|tsx)$' | grep -v '__tests__' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__snapshots__' | grep -v '\.d\.ts$' || true)
    if [ -n "$NEW_SOURCE_FILES" ]; then
      echo ""
      echo "   └─ Per-file coverage check for new files:"
      for new_file in $NEW_SOURCE_FILES; do
        # Normalize path for coverage-summary.json lookup
        NORMALIZED_PATH=$(echo "$new_file" | sed 's|^\./||')
        FILE_COV=$(node -e "
          try {
            const fs = require('fs');
            const data = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));
            const entry = data['$NORMALIZED_PATH'];
            if (entry && entry.lines) {
              console.log(Math.round(entry.lines.pct));
            } else {
              console.log('no_data');
            }
          } catch(e) { console.log('parse_error'); }
        " 2>/dev/null)
        # NOTE (#555): the 80 below is deliberately NOT $COVERAGE_THRESHOLD.
        # That one is the project-level floor a repo declares in fail_under;
        # this is the bar a single NEW file must clear to justify existing at
        # all. Tying them would mean a repo with fail_under=82 could not add a
        # file at 81% even while the project sits well above its floor.
        if [ "$FILE_COV" = "no_data" ] || [ "$FILE_COV" = "parse_error" ]; then
          echo "     ⚠️  $new_file — no coverage data (file may be excluded or not exercised)"
        elif [ "$FILE_COV" -lt 80 ]; then
          echo "     ❌ $new_file — ${FILE_COV}% coverage (below 80% per-new-file threshold)"
          NEW_FILE_COV_FAIL=true
        else
          echo "     ✅ $new_file — ${FILE_COV}% coverage"
        fi
      done
      if [ "${NEW_FILE_COV_FAIL:-false}" = "true" ]; then
        echo ""
        echo "❌ BLOCKED - New file(s) below 80% coverage threshold"
        echo "Add tests to cover the new files before committing."
        return 1
      fi
    fi
  fi
  # Only reached on the non-docs-only path. Assigning PASS outside the if/else
  # overwrote the docs-only SKIP a few hundred lines above and reported
  # "Tests + Coverage: PASS (coverage: N/A)" for a commit where no test ran
  # (#554) -- a SKIP promoted to PASS inflates the pass rate and hides that the
  # gate never executed.
  #
  # #554 follow-up: the same promotion was still happening ONE LEVEL IN. The
  # early-skip branch above (no source extension among the changed files, e.g. a
  # version bump) sets GATE_5_STATUS="SKIP", and this unguarded assignment
  # overwrote it on the way out of the same else-block. A branch that records
  # its own verdict must not be re-decided by the block epilogue: default to
  # PASS only when the sentinel is still untouched.
  #
  # Not written as a `:-PASS` expansion: AC-599-03 forbids a PASS default in
  # any `GATE_N_STATUS:-DEFAULT` expansion, because that is how an unassigned
  # gate came to render as "passed". An explicit comparison keeps both rules.
  #
  # The delegation check comes FIRST, and it is the same defect one layer down
  # from the prose fix above: a language whose tests are delegated to CI never
  # ran a test here, so recording PASS for it is a claim about work nobody did.
  # Measured on the shell fixture: the gate printed "No test verdict was produced
  # here -- absence of a failure is not a pass" and the summary line one inch
  # below still read "Gate 5: Tests + Coverage  PASS (coverage: N/A%)". The
  # summary is what a reader keeps and what the journal records.
  if [ -n "${DELEGATED_LANGS:-}" ]; then
    GATE_5_STATUS="SKIP"
    # Pass ONLY the new fragment. This used to re-prepend the existing detail
    # (`${GATE_5_DETAIL:+${GATE_5_DETAIL}; }...`), so every earlier segment was
    # duplicated inside the fragment itself -- and since the append de-duplicates
    # whole segments, a fragment that ALREADY CONTAINS them is never equal to any
    # one of them and slips through. Measured: the persisted reason read
    #
    #   shell: tests delegated ...; shell: tests delegated ...; powershell: ...
    #
    #   -- the same sentence four times, unreadable.
    xp_gate_detail_append GATE_5_DETAIL "tests delegated to CI for: ${DELEGATED_LANGS}"
  elif [ -z "$GATE_5_STATUS" ]; then
    GATE_5_STATUS="PASS"
  fi
fi

# #665: a subset run is exempt from the GLOBAL coverage floor by design (#473),
# but the exemption was never published, so the persisted report showed
# `actual.coverage = 29` beside `thresholds.lines = 82` with `status = PASS` and
# `reason = ""`. The verdict was correct; the RECORD was unreadable, and a record
# is all `xp-gate audit` and the tech-debt trackers (#636, #638) ever see. Two
# opposite situations -- "coverage really was 29% and the gate passed it" and
# "a subset run, global floor not applicable" -- rendered identically.
#
# Derived from PARTIAL_TEST_RUN at ONE place instead of being set by hand at each
# of the six branches that mark a partial run: a reason written at one call site
# and forgotten at another is the drift that produced the empty reason here.
if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
  GATE_5_COVERAGE_APPLIES_TO="subset"
  # Never overwrite a reason the branch itself recorded (docs_only_change,
  # no_code_files_changed, ...) -- those explain a different verdict.
  if [ -z "${GATE_5_DETAIL:-}" ] && [ "$GATE_5_STATUS" = "PASS" ]; then
    xp_gate_detail_append GATE_5_DETAIL "partial_test_run_coverage_not_applicable"
  fi
else
  GATE_5_COVERAGE_APPLIES_TO="project"
fi

# Gate 5c computes a verdict on every path and, until now, NOTHING read it.
# Measured: grep -rn GATE_5C_STATUS across pre-commit, gate-driver and lib/*.sh
# returned no matches outside the checker itself. The BLOCK arm was still
# effective (gate_5c_alignment returns 1 and this body does `|| return 1`), but
# the two SKIP arms printed a reason to the console and the audit row -- which
# records GATE_5_DETAIL, a variable 5c never set -- could not distinguish
# "alignment ran and was clean" from "alignment never ran".
#
# The verdict is folded into the detail rather than into GATE_5_STATUS because
# 5c is a SUB-check: a sub-check that could not run does not make the tests and
# coverage it sits beside unmeasured, and promoting SKIP over a PASS earned by
# a real test run would trade one wrong record for another. What must survive
# is the REASON, and it is prefixed so a reader can tell which sub-check it
# came from.
if [ -n "${GATE_5C_STATUS:-}" ] && [ -z "${GATE_5_DETAIL:-}" ]; then
  case "$GATE_5C_STATUS" in
    SKIP) GATE_5_DETAIL="alignment_skipped:${GATE_5C_REASON:-unspecified}" ;;
    PASS) GATE_5_DETAIL="alignment_clean" ;;
  esac
fi

  # Persist the segment breakdown into the detail so the NEXT commit's timing
  # question is already answered by data. Only appended when the clocks actually
  # ran (the early-exit arms never set them), and only when the gate ran long
  # enough for the split to mean anything -- below 3 s the segments are
  # dominated by process-startup noise and would just add bytes.
  _g5_elapsed=$(( $(gate_start_ms) - GATE_5_START ))
  if [ "${_g5t_a:-0}" != "0" ] && [ "$_g5_elapsed" -ge 3000 ]; then
    xp_gate_detail_append GATE_5_DETAIL " seg=pre:${_g5t_focus}ms,5a:${_g5t_a}ms,5b:${_g5t_b}ms,5c:${_g5t_c}ms,total:${_g5_elapsed}ms"
  fi

record_gate_audit "gate-5" "tests-coverage" "$GATE_5_STATUS" "0" "$GATE_5_START" "${GATE_5_DETAIL:-}"
  return 0
}

# Did the test run actually verify anything, or did the adapter decline to run?
#
# The gate used to answer this by grepping the adapter's output for one sentence:
#
#     printf '%s' "$TESTS_OUTPUT" | grep -q "No test runner installed locally"
#
# which is what the TYPESCRIPT adapter prints. Every other adapter words its
# skip differently, so every other adapter's skip was recorded as a pass.
# Measured 2026-11-19, shell fixture with one deliberately failing .bats test:
#
#     Running tests...
#     bats not available, skipping shell test suite (install: npm i -D bats)
#     PASSED - Unit tests passed.
#
# The same shape appears for php, powershell, swift and objectivec. A prose list
# can only contain the sentences someone remembered reading -- the exact reason
# hand-written language lists were removed from this codebase.
#
# Two signals now, in priority order:
#
#   1. The adapter printed XP_GATE_TESTS_SKIPPED. This is the contract; adapters
#      that know they declined say so once, in a form nobody has to parse.
#   2. The old TS sentence, kept so an adapter that has not been updated yet
#      still lands on the right side. Deprecated, not removed.
#
# A non-zero exit is never a skip: an adapter that exited non-zero found
# something, whatever else it printed.
_gate5_test_run_skipped() {
  local code="$1" out="$2"
  [ "$code" -eq 0 ] || return 1
  printf '%s' "$out" | grep -q 'XP_GATE_TESTS_SKIPPED' && return 0
  printf '%s' "$out" | grep -q 'No test runner installed locally' && return 0
  return 1
}

# Go coverage arm: run the suite WITH coverage and judge both outcomes.
#
# The `go` language has no meaningful split between "run the tests" and "measure
# coverage" -- `go test -coverprofile` does both -- so this arm is the only place
# a Go test failure can be noticed. It was not noticed:
#
#     go test -coverprofile=coverage.out ./... 2>/dev/null   # exit status dropped
#     TOTAL_COVERAGE=$(go tool cover -func ...)
#     if [ -n "$TOTAL_COVERAGE" ] && (( TOTAL_COVERAGE < 80 )); then return 1; fi
#     COV_EXIT=$((COV_EXIT || 0))                            # unconditional zero
#
# A failing test therefore reached the verdict only through the percentage it
# happened to leave behind. Measured on a fixture whose only test asserts
# `Add(1,1) == 3` -- it fails, and covers 100% of statements:
#
#     --- FAIL: TestDeliberatelyFailing (0.00s)
#     FAIL    p       0.044s
#     coverage: 100.0% of statements
#     PASSED - Coverage check completed.
#
# A red suite scored green. The `shell` arm ten lines below had the same job and
# did it correctly (`COV_EXIT=$((COV_EXIT || $?))`), which is what makes this a
# defect rather than a design choice.
#
# Two things are deliberately NOT done here:
#
#   - `2>/dev/null` is gone. Discarding stderr is why the failing test's own
#     output was the only clue, printed directly above a line that said PASSED.
#     The suite's output is shown so a block is attributable.
#   - A missing TOTAL_COVERAGE does NOT become a block. `go tool cover` prints
#     nothing when the profile is absent, and reading that as "0% < 80%" would
#     block every project whose tests failed to compile -- converting a compile
#     error into a coverage verdict, which is the wrong-vocabulary trap named in
#     githooks/AGENTS.md.
_gate5_go_coverage_arm() {
  local out rc total
  out=$(go test -coverprofile=coverage.out ./... 2>&1)
  rc=$?
  # Show the tail: for a failing suite that is where FAIL and the test names are.
  printf '%s\n' "$out" | tail -20

  if [ "$rc" -ne 0 ]; then
    echo "❌ BLOCKED - Go tests FAILED"
    echo "   The suite was run with coverage; a failing test is a failure whether"
    echo "   or not the coverage it measured looks acceptable."
    COV_EXIT=$((COV_EXIT || rc))
    return 1
  fi

  total=$(go tool cover -func=coverage.out 2>/dev/null | grep "^total:" | awk '{print substr($3, 1, length($3)-1)}')
  if [ -n "$total" ] && (( $(echo "$total < 80" | bc -l 2>/dev/null || echo "0") )); then
    # Record the verdict as well as printing it -- see the typescript branch
    # above for the measurement. An unassigned status renders as SKIP.
    GATE_5_STATUS="BLOCK"
    xp_gate_detail_append GATE_5_DETAIL "coverage_below_floor: go coverage under the 80% floor"
    echo "❌ BLOCKED - Go coverage ${total}% below ${COVERAGE_THRESHOLD:-80}% threshold"
    COV_EXIT=$((COV_EXIT || 1))
    return 1
  fi
  echo "Go coverage: ${total}%"
  COV_EXIT=$((COV_EXIT || 0))
  return 0
}



# Called by pre-commit's ordered driver.


