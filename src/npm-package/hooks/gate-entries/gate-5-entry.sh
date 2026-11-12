#!/usr/bin/env bash
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

# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_5_run() {
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
  GATE_5_DETAIL="not_selected"

elif [ "$PROJECT_LANG" = "documentation-only" ] || [ "$DOCS_ONLY_COMMIT" = true ]; then
  echo "⏭️  SKIPPED - Tests & coverage (documentation-only commit — no code changed to test)."
  GATE_5_STATUS="SKIP"
  GATE_5_DETAIL="docs_only_change"

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
  GATE_5_FOCUS_BLOCKED=0
  GATE_5_SKIP_COUNT=0
  GATE_5_DELETED_TESTS=""
  if declare -f classify_test_focus >/dev/null 2>&1; then
    STAGED_TEST_FILES=$(printf '%s\n' "${XP_STAGED_ACM:-$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)}" \
      | filter_project_paths | grep -E '\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|cs|scala|ps1)$|(^|/)(test_[^/]*\.py|[^/]*_test\.(py|go))$' || true)
    if [ -n "$STAGED_TEST_FILES" ]; then
      while IFS= read -r _tf; do
        [ -n "$_tf" ] || continue
        _tf_content=$(git show ":$tf" 2>/dev/null) || _tf_content=$(cat "$_tf" 2>/dev/null || true)
        [ -n "$_tf_content" ] || continue

        # --- focus markers: BLOCK ---
        _focus_hits=$(printf '%s\n' "$_tf_content" | classify_test_focus || true)
        if [ -n "$_focus_hits" ]; then
          # XP_GATE_ALLOW_ONLY=1 is an explicit, audited override for the one
          # legitimate case (debugging an unrelated failure mid-bisect). It is
          # opt-in per run and printed, never silent.
          if [ "${XP_GATE_ALLOW_ONLY:-0}" = "1" ]; then
            echo "⚠️  WARN - focus marker in $_tf (allowed by XP_GATE_ALLOW_ONLY=1)"
            record_gate_audit "gate-5-focus-override" "focus-override" "WARN" 1 "$GATE_5_START" "file=$_tf"
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

      # --- deleted test files: WARN ---
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
  fi

  if [ "$GATE_5_FOCUS_BLOCKED" -gt 0 ]; then
    echo ""
    echo "❌ BLOCKED - Gate 5: $GATE_5_FOCUS_BLOCKED test-hygiene violation(s) (see above)."
    echo "   Focus markers (.only/fit/fdescribe) make CI run one case and report green;"
    echo "   tautological assertions and empty catches verify nothing at all."
    echo "   See skills/test-driven-development/testing-anti-patterns.md"
    echo "   Remove them, or add '@assertion-justified: <reason>' for a reviewed exception."
    record_gate_audit "gate-5-focus" "test-focus" "FAIL" "$GATE_5_FOCUS_BLOCKED" "$GATE_5_START" "blocked=1"
    return 1
  fi

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
  CODE_EXTENSIONS="\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|kts|cs|csx|cpp|cc|cxx|c|h|hpp|swift|m|mm|dart|sh|ps1)$"
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
    GATE_5_DETAIL="no_code_files_changed"
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
          if [ "$TESTS_EXIT_CODE" -eq 0 ] && printf '%s' "$TESTS_OUTPUT" | grep -q "No test runner installed locally"; then
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
        if adapter_declares_coverage_runs_tests; then
          echo "ℹ️  ${CURRENT_LANG}: coverage run includes the tests — deferring test execution to a single pass."
          TESTS_DEFERRED=true
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
            if printf '%s' "$TESTS_OUTPUT" | grep -q "No test runner installed locally"; then
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
  if [ "${TESTS_SKIPPED:-false}" = "true" ] && [ "${TESTS_RAN_ANY:-false}" != "true" ]; then
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
          if [ "${TESTS_SKIPPED:-false}" = "true" ]; then
            echo "ℹ️  No TypeScript tests were selected — no TS coverage to evaluate."
            COV_EXIT=$((COV_EXIT || 0))
          elif [ -f "coverage/coverage-summary.json" ]; then
            echo "TypeScript coverage collected during test run."
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
              # shellcheck disable=SC2086
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
                # shellcheck disable=SC2086
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
                # shellcheck disable=SC2086
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
            go test -coverprofile=coverage.out ./... 2>/dev/null
            TOTAL_COVERAGE=$(go tool cover -func=coverage.out 2>/dev/null | grep "^total:" | awk '{print substr($3, 1, length($3)-1)}')
            if [ -n "$TOTAL_COVERAGE" ] && (( $(echo "$TOTAL_COVERAGE < 80" | bc -l 2>/dev/null || echo "0") )); then
              echo "❌ BLOCKED - Go coverage $TOTAL_COVERAGE% below ${COVERAGE_THRESHOLD:-80}% threshold"
              return 1
            fi
            echo "Go coverage: $TOTAL_COVERAGE%"
            COV_EXIT=$((COV_EXIT || 0))
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
      if [ "${TESTS_SKIPPED:-false}" = "true" ]; then
        echo "✅ PASSED - Coverage check skipped (no test/source files changed)."
      elif [ -f "coverage/coverage-summary.json" ]; then
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
        # #570: the report file is absent, so nothing was measured. Warning and
        # continuing made "delete coverage/coverage-summary.json" an effective way
        # to switch this gate off.
        if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
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
      enforce_python_coverage || return 1
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
      if [ -f "coverage.xml" ]; then
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
      COVERAGE_ENFORCED=true
      COVERAGE_PERCENT=""
      if [ -f "coverage/coverage-summary.json" ]; then
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
          return 1
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
  echo "✅ PASSED - Coverage check completed."
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
  if [ -z "$GATE_5_STATUS" ]; then
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
    GATE_5_DETAIL="partial_test_run_coverage_not_applicable"
  fi
else
  GATE_5_COVERAGE_APPLIES_TO="project"
fi

record_gate_audit "gate-5" "tests-coverage" "$GATE_5_STATUS" "0" "$GATE_5_START" "${GATE_5_DETAIL:-}"
  return 0
}



# Called by pre-commit's ordered driver.

