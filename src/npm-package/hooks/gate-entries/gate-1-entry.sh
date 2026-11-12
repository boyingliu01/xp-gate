#!/usr/bin/env bash
# ============================================================================
# gate-1 entry — extracted from pre-commit by scripts/extract-gates.cjs
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
# GATE 1: Code Quality (Static Analysis + Linting + Shell Check combined)
# Combination of: Old Gates 1 (Static), Gate 2 (Linting), Gate 5 (Shell Check)
# v0.14.3+ (Issue #312): Skip if no code files changed
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_1_run() {
 2>&1 echo ""
 2>&1 echo "→ Gate 1: Code Quality (static analysis + linting)..."
# REQ-B: the start stamp is taken OUTSIDE the branches below. It used to be
# assigned only on the lint path, so every skipped Gate 1 recorded an empty
# GATE_1_START -> duration_ms=null with reason=poisoned_start_ms. That null is
# honest but it answers the wrong question: those commits never ran the gate, so
# the log should say SKIP, not "measurement failed".
GATE_1_START=$(gate_start_ms)
GATE_1_STATUS="PASS"
GATE_1_DETAIL=""
if ! gate_enabled 1; then
  echo "⏭️  SKIPPED - Gate 1: Code quality (not selected by XP_GATE_ONLY_GATE)"
  GATE_1_STATUS="SKIP"
  GATE_1_DETAIL="not_selected"
elif ! any_changed_files_match "\.(ts|tsx|js|jsx|py|go|java|kt|cpp|c|swift|m|mm|dart|sh|ps1|psm1|cs|csx|fs|vb|rs|php|rb|lua|pl)$" "\.ya?ml$" "\.json$" "Dockerfile" "\.tf$"; then
  # #798: this branch did NOT run a lint check, so it must not report PASSED.
  # "No code files changed" is a SKIP: the same wording Gate 3 already uses
  # ("⏭️  SKIPPED - Complexity: no changed source files in this run"). Reporting
  # ✅ PASSED here meant a project whose main language was missing from the
  # extension list got a green Gate 1 on every single commit, having analysed
  # nothing. C# was exactly that case before `.cs` was added below.
  echo "⏭️  SKIPPED - Code quality: no changed code files in this run (scope: diff)."
  GATE_1_STATUS="SKIP"
  GATE_1_DETAIL="no_matching_files"
else
if [ "$PROJECT_LANG" = "documentation-only" ]; then
  # Documentation-only project - skip static analysis
  echo "⏭️  SKIPPED - Code quality (documentation project)."
  GATE_1_STATUS="SKIP"
  GATE_1_DETAIL="documentation_project"
  
else
  for CURRENT_LANG in $PROJECT_LANGS; do
    echo "   ── Checking $CURRENT_LANG ──"
    case "$CURRENT_LANG" in
      typescript)
  # TypeScript: static analysis + linting (eslint). The type-check decision lives
  # in githooks/lib/typecheck.sh so a project's own checker (vue-tsc, svelte-check,
  # a `typecheck` script) is used instead of a hardcoded tsc that cannot resolve
  # single-file components (#436).
  #
  # Resolve the TS project directory first (#470). The probes below used to run
  # against the repo root only; in multi-language monorepos (e.g. web/ +
  # backend/, where the hook stays at the root — see the cd block above)
  # tsconfig.json / biome.json live in the language subdirectory, so the whole
  # TS half of Gate 1 silently SKIPped ("tsconfig.json not found") while a
  # project config existed. Order: repo root first (unchanged behaviour for
  # plain projects), then the detected language subdirectory, then a shallow
  # search.
  TS_PROJECT_DIR=""
  for _ts_dir in "." "${PROJECT_SUBDIR:-}"; do
    [ -z "$_ts_dir" ] && continue
    if [ -f "$_ts_dir/tsconfig.json" ] || [ -f "$_ts_dir/biome.json" ] || [ -f "$_ts_dir/biome.jsonc" ] \
       || [ -f "$_ts_dir/eslint.config.js" ] || [ -f "$_ts_dir/.eslintrc.json" ] \
       || [ -f "$_ts_dir/.eslintrc.js" ] || [ -f "$_ts_dir/.eslintrc.cjs" ]; then
      TS_PROJECT_DIR="$_ts_dir"
      break
    fi
  done
  if [ -z "$TS_PROJECT_DIR" ]; then
    _TSCONFIG_CAND=$(find . -maxdepth 2 \( -name tsconfig.json -o -name biome.json -o -name biome.jsonc -o -name eslint.config.js -o -name .eslintrc.json -o -name .eslintrc.js -o -name .eslintrc.cjs \) -not -path './.git/*' -not -path './node_modules/*' 2>/dev/null | head -1)
    if [ -n "$_TSCONFIG_CAND" ]; then
      TS_PROJECT_DIR=$(dirname "$_TSCONFIG_CAND")
    fi
  fi
  [ -z "$TS_PROJECT_DIR" ] && TS_PROJECT_DIR="."
  if [ "$TS_PROJECT_DIR" != "." ]; then
    echo "   TypeScript project directory: $TS_PROJECT_DIR/"
    # typecheck.sh is cwd-relative: run it from the TS project subdirectory in a
    # subshell so the language loop's next iteration still starts at the root.
    # Exit contract: 0 clean, 1 findings (block), 2 checker unavailable (skip).
    # A cd/source infrastructure failure must NOT read as "type errors": map it
    # to 2 (skip) so 1 stays reserved for real findings (#508 walkthrough).
    ( cd "$TS_PROJECT_DIR" 2>/dev/null || exit 2 \
      ; [ -r "${AUDIT_SCRIPT_DIR}/lib/typecheck.sh" ] || exit 2 \
      ; source "${AUDIT_SCRIPT_DIR}/lib/typecheck.sh" && run_typescript_typecheck )
    TS_CHECK_EXIT=$?
  else
    source_gate_lib "${AUDIT_SCRIPT_DIR}/lib/typecheck.sh"
    run_typescript_typecheck
    TS_CHECK_EXIT=$?
  fi
  if [ "$TS_CHECK_EXIT" -eq 1 ]; then
    return 1
  fi
    
    # Run ESLint linting if config exists (root or TS project subdirectory)
    if [ -f "$TS_PROJECT_DIR/.eslintrc.json" ] || [ -f "$TS_PROJECT_DIR/.eslintrc.js" ] || [ -f "$TS_PROJECT_DIR/.eslintrc.cjs" ] || [ -f "$TS_PROJECT_DIR/eslint.config.js" ]; then
      echo "Running ESLint linting..."
      # Filter to only TS/JS files - ESLint config ignores non-matching files
      ESLINT_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx|js|jsx)$' || true)
      if [ -n "$ESLINT_FILES" ]; then
        # File paths from git are repo-root relative, so they are correct from
        # the root. Legacy .eslintrc.* configs are discovered by walking up from
        # each linted file (found in the subdirectory automatically); flat
        # configs are discovered from the CWD, so point at them explicitly.
        if [ "$TS_PROJECT_DIR" != "." ] && [ -f "$TS_PROJECT_DIR/eslint.config.js" ]; then
          ESLINT_OUTPUT=$(run_node_bin eslint eslint/bin/eslint.js --config "$TS_PROJECT_DIR/eslint.config.js" $ESLINT_FILES -f json --no-warn-ignored 2>&1)
        else
          ESLINT_OUTPUT=$(run_node_bin eslint eslint/bin/eslint.js $ESLINT_FILES -f json --no-warn-ignored 2>&1)
        fi
        ESLINT_EXIT=$?
        if [ "$ESLINT_EXIT" -ne 0 ]; then
          if [ -f ".xp-gate/lint-baseline.json" ] && command -v node &> /dev/null; then
            # Compare against lint baseline
            BASELINE_WARNINGS=$(echo "$ESLINT_FILES" | tr ' ' '\n' | node -e "
              const fs=require('fs');const b=JSON.parse(fs.readFileSync('.xp-gate/lint-baseline.json','utf8'));
              const stdin=require('fs').readFileSync(0,'utf8').trim();
              const files=stdin?stdin.split('\n'):[];
              let total=0;for(const f of files){if(b[f])total+=b[f].totalWarnings||0}
              console.log(total);
            ")
            CURRENT_WARNINGS=$(echo "$ESLINT_OUTPUT" | node -e "
              const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
              console.log(d.reduce((s,f)=>s+(f.warningCount||0)+(f.errorCount||0),0));
            ")
            if [ "$CURRENT_WARNINGS" -gt "$BASELINE_WARNINGS" ]; then
              NEW_WARNINGS=$((CURRENT_WARNINGS - BASELINE_WARNINGS))
              echo "$ESLINT_OUTPUT" | head -30
              echo ""
              echo "❌ BLOCKED - ${NEW_WARNINGS} NEW lint error(s) (baseline: ${BASELINE_WARNINGS}, current: ${CURRENT_WARNINGS})"
              echo "Run 'xp-gate baseline reset' after fixing to update the baseline."
              return 1
            else
              REDUCED=$((BASELINE_WARNINGS - CURRENT_WARNINGS))
              if [ "$REDUCED" -gt 0 ]; then
                echo "✅ PASSED - Lint debt reduced by ${REDUCED} (${BASELINE_WARNINGS} → ${CURRENT_WARNINGS})"
              else
                echo "✅ PASSED - No new lint errors (baseline: ${BASELINE_WARNINGS})"
              fi
            fi
          else
            echo "$ESLINT_OUTPUT" | head -30
            echo ""
            echo "❌ BLOCKED - LINT ERRORS detected"
            echo "Fix the lint errors above before committing."
            echo "Tip: Run 'xp-gate baseline create' to establish a lint baseline."
            return 1
          fi
        else
          echo "✅ PASSED - ESLint linting."
        fi
      else
        echo "✅ PASSED - No staged TS/JS files to lint."
      fi
    else
      echo "ℹ️  No ESLint configuration found - Skipping"
      if [ -f "$TS_PROJECT_DIR/package.json" ] && command -v node &> /dev/null; then
        HAS_ESLINT=$(node -e "try{const p=JSON.parse(require('fs').readFileSync('$TS_PROJECT_DIR/package.json','utf8'));const d=p.devDependencies||{};const deps=p.dependencies||{};console.log((d.eslint||deps.eslint)?'yes':'no')}catch{console.log('no')}") && true
        if [ "$HAS_ESLINT" = "yes" ]; then
          echo "⚠️  WARNING: eslint is installed in package.json but no eslint config found"
          echo "   Either create .eslintrc.* / eslint.config.* or remove eslint from dependencies"
          echo "   See: https://eslint.org/docs/latest/use/configure/configuration-files"
        fi
      fi
    fi

    # ── Biome lint/format check ──
    # Default the project dir so this branch stays runnable standalone
    # (the gate-1-biome-noop suite extracts it verbatim); a no-op inside the
    # hook, where TS_PROJECT_DIR is resolved above.
    TS_PROJECT_DIR="${TS_PROJECT_DIR:-.}"
    if [ -f "$TS_PROJECT_DIR/biome.json" ] || [ -f "$TS_PROJECT_DIR/biome.jsonc" ]; then
      echo "Running Biome lint/format check..."
      # Run from the TS project directory so Biome auto-discovers its config and
      # scopes --staged to that subdirectory (mirrors the single-language subdir
      # mode, which executes after cd "$PROJECT_SUBDIR"). Empirically verified:
      # `biome check --staged .` from the subdir checks the staged files under it.
      BIOME_OUT=$(cd "$TS_PROJECT_DIR" && npx biome check --staged . 2>&1)
      BIOME_STATUS=$?
      if [ "$BIOME_STATUS" -ne 0 ]; then
        # Biome exits 1 with `internalError/io - No files were processed` when the
        # staged set yields nothing lintable (docs-only / config-only commit, or
        # everything excluded by biome.json). That is "nothing to do", not a lint
        # violation -- blocking on it makes documentation uncommittable (#458).
        # This matches the hook's stated principle: tool available + check
        # SUCCEEDS = PASS. Real violations still carry diagnostics, so they block.
        if echo "$BIOME_OUT" | grep -qE 'internalError/io|No files were processed'; then
          echo "$BIOME_OUT"
          echo "✅ PASSED - Biome check (no lintable files staged)."
        else
          echo "$BIOME_OUT" | head -50
          echo ""
          echo "❌ BLOCKED - Biome check failed"
          echo "Fix the errors above before committing."
          echo "Tip: Run 'npx biome check --write .' to auto-fix formatting and safe lint issues."
          echo "     Run 'npx biome check --write --unsafe .' to also fix unsafe lint issues."
          return 1
        fi
      else
        echo "✅ PASSED - Biome check."
      fi
    else
      if [ -f "$TS_PROJECT_DIR/package.json" ] && command -v node &> /dev/null; then
        HAS_BIOME=$(node -e "try{const p=JSON.parse(require('fs').readFileSync('$TS_PROJECT_DIR/package.json','utf8'));const d=p.devDependencies||{};const deps=p.dependencies||{};console.log((d['@biomejs/biome']||deps['@biomejs/biome'])?'yes':'no')}catch{console.log('no')}") && true
        if [ "$HAS_BIOME" = "yes" ]; then
          echo ""
          echo "⚠️  WARNING: @biomejs/biome is installed in package.json but no biome.json found"
          echo "   Create a biome.json configuration file to enable Biome linting."
          echo "   NOTE: useLiteralKeys conflicts with TypeScript TS4111 — see docs/biome-configuration.md"
          echo "   For quick setup: add '\"linter\":{\"rules\":{\"complexity\":{\"useLiteralKeys\":\"off\"}}}' to biome.json"
        fi
      fi
    fi

    # Debug statement detection (debugger statement in JS/TS)
    #
    # Dependencies and build output are filtered out first (#648). The list
    # comes from `git diff --cached`, so a project (or a CI fixture) that
    # vendors or commits its dependencies gets the dependency's OWN source
    # scanned as if it were project code. TypeScript 7.x ships a bare
    # `debugger;` in dist/internal/utils.js, which blocked commits that changed
    # nothing of their own:
    #     ❌ BLOCKED - 'debugger' statements detected:
    #     node_modules/typescript/dist/internal/utils.js:18:    debugger;
    # Pinning the dependency's version only postpones that: any package may
    # carry a debugger statement, and which one lands changes with every
    # install. The rule the gate actually wants is "no debugger in OUR code",
    # so the ignore set Gate 2 already uses decides what counts as ours — one
    # notion of build output across the gates, overridable through the same
    # XP_GATE_JSCPD_DEFAULT_IGNORE switch.
    TS_DEBUG_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx|js|jsx)$' | {
      while IFS= read -r _df; do
        [ -n "$_df" ] || continue
        if ! jscpd_is_build_output "$_df"; then
          printf '%s\n' "$_df"
        fi
      done
    } || true)
    if [ -n "$TS_DEBUG_FILES" ]; then
      # NUL-separated so paths with spaces survive; a bare $VAR would word-split.
      DEBUGGER_HITS=$(printf '%s\n' "$TS_DEBUG_FILES" | tr '\n' '\0' | xargs -0 grep -n '^\s*debugger\s*;\?\s*$' 2>/dev/null || true)
      if [ -n "$DEBUGGER_HITS" ]; then
        echo ""
        echo "❌ BLOCKED - 'debugger' statements detected:"
        echo "$DEBUGGER_HITS" | head -10
        echo ""
        echo "Remove debugger statements before committing."
        return 1
      fi
    fi
    ;;
    
    python)
  # Python: Ruff (includes syntax + linting) + mypy (optional typing)
  if ! command -v ruff &> /dev/null; then
    echo "ℹ️  ruff not available — skipping Python linting"
    echo "⏭️  SKIPPED - Code quality (ruff not available, run: pip install ruff)"
  else
    # Run Ruff (includes syntax check, linting)
    echo "Running Ruff linting (syntax + lint)..."
    # Filter to *.py/*.pyi into a bash array so each staged path is passed as
    # ONE argument even when it contains whitespace; skip ruff when no Python
    # files are staged so yaml/.gitignore are never parsed.
    RUFF_ARGS=()
    while IFS= read -r staged_file; do
      case "$staged_file" in
        *.py|*.pyi) RUFF_ARGS+=("$staged_file") ;;
      esac
    done <<< "$CHANGED_FILES"
    if [ "${#RUFF_ARGS[@]}" -eq 0 ]; then
      RUFF_OUTPUT="[]"
      RUFF_EXIT=0
    else
      RUFF_OUTPUT=$(ruff check "${RUFF_ARGS[@]}" --output-format json 2>&1)
      RUFF_EXIT=$?
    fi
    if [ "$RUFF_EXIT" -ne 0 ]; then
      if [ -f ".xp-gate/lint-baseline.json" ] && command -v node &> /dev/null; then
        # Get baseline warnings for changed Python files
        PY_FILES=$(echo "$CHANGED_FILES" | grep '\.py$' || true)
        if [ -n "$PY_FILES" ]; then
          BASELINE_WARNINGS=$(echo "$PY_FILES" | node -e "
            const fs=require('fs');const b=JSON.parse(fs.readFileSync('.xp-gate/lint-baseline.json','utf8'));
            const stdin=require('fs').readFileSync(0,'utf8').trim();
            const files=stdin?stdin.split('\n'):[];
            let total=0;for(const f of files){if(b[f])total+=b[f].totalWarnings||0}
            console.log(total);
          ")
          CURRENT_WARNINGS=$(echo "$RUFF_OUTPUT" | node -e "
            const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
            console.log(d.reduce((s,f)=>s+(f.messages?f.messages.length:0),0));
          ")
          if [ "$CURRENT_WARNINGS" -gt "$BASELINE_WARNINGS" ]; then
            NEW_WARNINGS=$((CURRENT_WARNINGS - BASELINE_WARNINGS))
            echo "$RUFF_OUTPUT" | node -e "
              const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
              for(const f of d){for(const m of f.messages||[]){console.log(m.kind+': '+m.message)}}
            " | head -30
            echo ""
            echo "❌ BLOCKED - ${NEW_WARNINGS} NEW lint error(s) (baseline: ${BASELINE_WARNINGS}, current: ${CURRENT_WARNINGS})"
            echo "Run 'xp-gate baseline reset' after fixing to update the baseline."
            return 1
          else
            REDUCED=$((BASELINE_WARNINGS - CURRENT_WARNINGS))
            if [ "$REDUCED" -gt 0 ]; then
              echo "✅ PASSED - Lint debt reduced by ${REDUCED} (${BASELINE_WARNINGS} → ${CURRENT_WARNINGS})"
            else
              echo "✅ PASSED - No new lint errors (baseline: ${BASELINE_WARNINGS})"
            fi
          fi
        else
          echo "✅ PASSED - Ruff linting (no Python files to check)."
        fi
      else
        echo "$RUFF_OUTPUT" | node -e "
          const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
          for(const f of d){for(const m of f.messages||[]){console.log(m.kind+': '+m.message)}}
        " | head -30
        echo ""
        echo "❌ BLOCKED - RUFF ERRORS detected"
        echo "Fix the lint errors above before committing."
        echo "Tip: Run 'ruff check --fix' to auto-fix some issues."
        echo "Tip: Run 'xp-gate baseline create' to establish a lint baseline."
        return 1
      fi
    else
      echo "✅ PASSED - Ruff linting."
    fi

    # Ruff format check (formatting gate)
    if command -v ruff &> /dev/null; then
      FMT_ARGS=()
      while IFS= read -r staged_file; do
        case "$staged_file" in
          *.py|*.pyi) FMT_ARGS+=("$staged_file") ;;
        esac
      done <<< "$CHANGED_FILES"
      if [ "${#FMT_ARGS[@]}" -gt 0 ]; then
        RUFF_FMT_OUTPUT=$(ruff format --check "${FMT_ARGS[@]}" 2>&1)
        RUFF_FMT_EXIT=$?
        if [ "$RUFF_FMT_EXIT" -ne 0 ]; then
          echo "$RUFF_FMT_OUTPUT" | head -20
          echo ""
          echo "❌ BLOCKED - Ruff format check failed"
          echo "Fix formatting: run 'ruff format .' to auto-format."
          return 1
        fi
        echo "✅ PASSED - Ruff format check."
      fi
    fi

    # Debug statement detection (breakpoint/pdb/ipdb)
    DEBUG_ARGS=()
    while IFS= read -r staged_file; do
      case "$staged_file" in
        *.py|*.pyi) DEBUG_ARGS+=("$staged_file") ;;
      esac
    done <<< "$CHANGED_FILES"
    if [ "${#DEBUG_ARGS[@]}" -gt 0 ]; then
      DEBUG_HITS=$(grep -n 'breakpoint()\|pdb\.set_trace()\|ipdb\.set_trace()\|import pdb\|import ipdb' "${DEBUG_ARGS[@]}" 2>/dev/null || true)
      if [ -n "$DEBUG_HITS" ]; then
        echo ""
        echo "❌ BLOCKED - Debug statements detected in Python files:"
        echo "$DEBUG_HITS" | head -10
        echo ""
        echo "Remove breakpoint()/pdb.set_trace() before committing."
        return 1
      fi
    fi
    
    # Optional: Type checking with mypy — INCREMENTAL (fast, staged-only).
    #
    # Responsibility boundary (#534):
    #   * This branch (python case) runs mypy ONLY over the staged .py/.pyi
    #     files via python_typecheck_incremental — seconds, not a full inference
    #     pass. Uses --follow-imports=silent so a change to A.py that references
    #     an unchanged B.py does NOT surface B's pre-existing diagnostics; only
    #     caller-level signature errors still block. Its exit code is captured
    #     directly (temp file), which is deterministic and does not depend on
    #     set -o pipefail (the old `... | head | tail; rc=$?` worked only under
    #     pipefail and could drop mypy's status when the pattern is copied into
    #     a non-pipefail context).
    #   * The FULL mypy pass lives OUTSIDE this hook: run_static_analysis()
    #     (githooks/adapters/python.sh) is reachable via the adapter CLI and the
    #     general adapter route, and CI installs mypy (quality-gates.yml) for
    #     typed projects. NOTE: the pre-commit python case is fully inline and
    #     never routes to run_static_analysis — so the incremental blind spot
    #     (cross-module signature break on an unchanged file) is the accepted
    #     trade-off here, backstopped by full mypy wherever that surface runs.
    #     Both paths coexist: this one is the fast pre-commit pass.
    if command -v mypy &> /dev/null; then
      # Collect staged .py/.pyi via the helper (whitespace-safe, bash-3
      # compatible — macOS default bash is 3.2, so avoid mapfile).
      MYPY_ARGS=()
      while IFS= read -r staged_file; do
        MYPY_ARGS+=("$staged_file")
      done < <(python_staged_py_files)
      python_typecheck_incremental "${MYPY_ARGS[@]}"
      MYPY_EXIT=$?
      if [ "$MYPY_EXIT" -ne 0 ]; then
        echo ""
        echo "❌ BLOCKED - MYPY TYPE ERRORS detected"
        echo "Fix the type errors above before committing."
        return 1
      fi
      echo "✅ PASSED - mypy type checking."
    else
      echo "ℹ️  Mypy not available - Skipping optional type check"
    fi
  fi
    ;;
    
    go)
  # Go: go vet + golangci-lint
  if ! command -v golangci-lint &> /dev/null; then
    echo "ℹ️  golangci-lint not available — skipping Go linting"
    echo "⏭️  SKIPPED - Code quality (golangci-lint not available)"
  else
    # #534: run golangci-lint over ONLY the staged .go files (incremental),
    # not the whole repo. `golangci-lint run` with no args scans every package
    # and dominates pre-commit time on large Go repos. golangci-lint accepts
    # explicit file targets. No staged .go files -> SKIP (nothing to lint).
    GO_FILES=$(echo "$CHANGED_FILES" | grep '\.go$' || true)
    if [ -z "$GO_FILES" ]; then
      echo "✅ PASSED - No staged Go files to lint."
    else
      echo "Running golangci-lint (incremental, staged .go)..."
      # #534: capture golangci-lint's REAL exit code via a temp file, not a
      # pipe stage's (`... | head -30; rc=$?` would take head's status; it only
      # works because of set -o pipefail, which is fragile and inconsistent with
      # the python incremental helper's temp-file pattern).
      GO_TMP=$(mktemp)
      golangci-lint run $GO_FILES > "$GO_TMP" 2>&1
      GOLANGCI_EXIT=$?
      head -30 "$GO_TMP"
      rm -f "$GO_TMP"
      if [ "$GOLANGCI_EXIT" -ne 0 ]; then
        echo ""
        echo "❌ BLOCKED - GOLANGCI-LINT ERRORS detected"
        echo "Fix the lint errors above before committing."
        return 1
      fi
      echo "✅ PASSED - golangci-lint."
    fi
  fi
    ;;
    
    shell)
  # Shell: check staged shell files only. Installed hook adapters are infrastructure,
  # not project changes, and should not be linted on unrelated commits.
  SHELL_FILES=$(echo "$CHANGED_FILES" | grep '\.sh$' || true)

  if [ -z "$SHELL_FILES" ]; then
    echo "✅ PASSED - No staged shell scripts to check."
  elif command -v shellcheck &> /dev/null; then
    echo "Running shellcheck on staged shell scripts..."
    SHELLCHECK_OUTPUT=$(shellcheck -f json $SHELL_FILES 2>&1)
    SHELLCHECK_EXIT=$?
    if [ "$SHELLCHECK_EXIT" -ne 0 ]; then
      if [ -f ".xp-gate/lint-baseline.json" ] && command -v node &> /dev/null; then
        BASELINE_WARNINGS=$(echo "$SHELL_FILES" | node -e "
          const fs=require('fs');const b=JSON.parse(fs.readFileSync('.xp-gate/lint-baseline.json','utf8'));
          const stdin=require('fs').readFileSync(0,'utf8').trim();
          const files=stdin?stdin.split('\n'):[];
          let total=0;for(const f of files){if(b[f])total+=b[f].totalWarnings||0}
          console.log(total);
        ")
        CURRENT_WARNINGS=$(echo "$SHELLCHECK_OUTPUT" | node -e "
          const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
          console.log(d.length);
        ")
        if [ "$CURRENT_WARNINGS" -gt "$BASELINE_WARNINGS" ]; then
          NEW_WARNINGS=$((CURRENT_WARNINGS - BASELINE_WARNINGS))
          echo "$SHELLCHECK_OUTPUT" | node -e "
            const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
            for(const i of d){console.log(i.file+':'+i.line+': '+i.level+': '+i.message)}
          " | head -30
          echo ""
          echo "❌ BLOCKED - ${NEW_WARNINGS} NEW shellcheck issue(s) (baseline: ${BASELINE_WARNINGS}, current: ${CURRENT_WARNINGS})"
          echo "Run 'xp-gate baseline reset' after fixing to update the baseline."
          return 1
        else
          REDUCED=$((BASELINE_WARNINGS - CURRENT_WARNINGS))
          if [ "$REDUCED" -gt 0 ]; then
            echo "✅ PASSED - Shellcheck debt reduced by ${REDUCED} (${BASELINE_WARNINGS} → ${CURRENT_WARNINGS})"
          else
            echo "✅ PASSED - No new shellcheck issues (baseline: ${BASELINE_WARNINGS})"
          fi
        fi
      else
        echo "$SHELLCHECK_OUTPUT" | node -e "
          const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
          for(const i of d){console.log(i.file+':'+i.line+': '+i.level+': '+i.message)}
        " | head -30
        echo ""
        echo "❌ BLOCKED - SHELLCHECK ERRORS detected"
        echo "Fix the shell script errors above."
        echo "Tip: Run 'xp-gate baseline create' to establish a lint baseline."
        return 1
      fi
    else
      echo "✅ PASSED - Shellcheck completed."
    fi
  else
    echo "ℹ️  shellcheck not available - Attempting basic syntax check"
    # Basic check for staged shell script files
    for sh_file in $SHELL_FILES; do
      if [ -f "$sh_file" ]; then
        bash -n "$sh_file"
        if [ $? -ne 0 ]; then
          echo "❌ BLOCKED - SYNTAX ERROR in $sh_file"
          return 1
        fi
      fi
    done
    echo "✅ PASSED - Basic shell script syntax check."
  fi
    ;;

    java)
  # GATE 1 Java: wc-java-lint with fail-closed verdicts (#507 S1, DR-001).
  # java.sh run_static_analysis verdict codes:
  #   0=PASS 1=FAIL(violations) 2=BLOCK(execution error) 3=WARN(non-blocking).
  # Every non-0/1/2 outcome is scored as WARN -- IN the denominator, so it
  # forbids an overall PASS. Delphi round-2 A-MAJOR-1: these paths used to
  # map to SKIP, which sits OUT of the denominator, letting a repo with no
  # Java engine (or findings suppressed in report mode) report PASS/10.0
  # while its Java quality was never verified.
  # The adapter applies the XP_GATE_WC_JAVA_LINT=soft escape valve itself, so
  # a 2 reaching this branch is hard: BLOCK the commit. Captured to a var
  # (not piped) so the verdict code survives regardless of output length --
  # `cmd | head` makes a long report die with SIGPIPE, which would turn a
  # real verdict into an accident of line count.
  ADAPTER_FILE=$(resolve_adapter_path "$CURRENT_LANG")
  if [ -z "$ADAPTER_FILE" ] || ! source "$ADAPTER_FILE" 2>/dev/null; then
    echo "⚠️  WARN - Java adapter not found (code quality NOT verified)"
    GATE_1_STATUS="WARN"
    GATE_1_DETAIL="java: adapter missing"
  else
    JAVA_G1_EXIT=0
    # `|| JAVA_G1_EXIT=$?` (not a bare assignment): under a set -e consumer a
    # non-zero verdict would abort the host hook before the mapping below.
    JAVA_G1_OUTPUT=$(run_static_analysis 2>&1) || JAVA_G1_EXIT=$?
    # SKIP/WARN reasons cross the command-substitution subshell as an
    # `XP_G1_REASON: ...` stdout line -- an `export` inside the adapter can
    # NEVER reach this process (#507 Delphi round-1 B-MAJOR-1: verified the
    # subshell discards the child env). Parse, then strip from display.
    JAVA_G1_REASON=$(printf '%s\n' "$JAVA_G1_OUTPUT" | sed -n 's/^XP_G1_REASON: //p' | head -1)
    if [ -n "$JAVA_G1_REASON" ]; then
      JAVA_G1_OUTPUT=$(printf '%s\n' "$JAVA_G1_OUTPUT" | grep -v '^XP_G1_REASON: ')
    fi
    [ -n "$JAVA_G1_OUTPUT" ] && echo "$JAVA_G1_OUTPUT" | head -40
    case "$JAVA_G1_EXIT" in
      0)
        echo "✅ PASSED - Java code quality (wc-java-lint)."
        ;;
      1)
        echo "❌ BLOCKED - Java static analysis violations (fix or add suppressions)"
        return 1
        ;;
      2)
        echo "❌ BLOCKED - wc-java-lint unusable (fail-closed; unset XP_GATE_WC_JAVA_LINT=soft only if you accept the risk)"
        return 1
        ;;
      3)
        echo "⚠️  WARN - Java code quality NOT verified (engine unavailable or downgraded)"
        GATE_1_STATUS="WARN"
        GATE_1_DETAIL="java: ${JAVA_G1_REASON:-unavailable (warn)}"
        ;;
      *)
        echo "⚠️  WARN - Java code quality NOT verified (unexpected verdict $JAVA_G1_EXIT)"
        GATE_1_STATUS="WARN"
        GATE_1_DETAIL="java: unexpected verdict $JAVA_G1_EXIT"
        ;;
    esac
  fi
    ;;

    powershell)
      # #547 finding 2: PowerShell had no arm here, so it fell into the generic
      # `*)` branch, where a non-zero analysis verdict printed a non-blocking
      # line and GATE_1_STATUS stayed PASS. The java arm's XP_G1_REASON
      # protocol applies verbatim: 0 = pass, 1 = block, 2 = unusable
      # (fail-closed), 3 = WARN with a reason that STAYS in the scoring
      # denominator so a skip is visible in retro instead of vanishing.
      POWERSHELL_ADAPTER=$(resolve_adapter_path "powershell")
      if [ -z "$POWERSHELL_ADAPTER" ]; then
        echo "⚠️  WARN - PowerShell adapter not found (code quality NOT verified)"
        GATE_1_STATUS="WARN"
        GATE_1_DETAIL="powershell: adapter missing"
      else
        PS_G1_EXIT=0
        # Subshell: reasons cross as `XP_G1_REASON: ...` stdout lines, exactly
        # as in the java arm — an export inside the adapter cannot reach us.
        PS_G1_OUTPUT=$(source "$POWERSHELL_ADAPTER" 2>/dev/null; run_static_analysis 2>&1) || PS_G1_EXIT=$?
        PS_G1_REASON=$(printf '%s\n' "$PS_G1_OUTPUT" | sed -n 's/^XP_G1_REASON: //p' | head -1)
        if [ -n "$PS_G1_REASON" ]; then
          PS_G1_OUTPUT=$(printf '%s\n' "$PS_G1_OUTPUT" | grep -v '^XP_G1_REASON: ')
        fi
        [ -n "$PS_G1_OUTPUT" ] && printf '%s\n' "$PS_G1_OUTPUT" | head -40
        case "$PS_G1_EXIT" in
          0)
            echo "✅ PASSED - PowerShell code quality (PSScriptAnalyzer)."
            ;;
          1)
            echo "❌ BLOCKED - PSScriptAnalyzer violations (fix or add suppressions)"
            GATE_1_STATUS="BLOCK"
            GATE_1_DETAIL="powershell: PSScriptAnalyzer findings"
            return 1
            ;;
          2)
            echo "❌ BLOCKED - PowerShell static analysis unusable (fail-closed): ${PS_G1_REASON:-unknown}"
            GATE_1_STATUS="BLOCK"
            GATE_1_DETAIL="powershell: ${PS_G1_REASON:-unusable}"
            return 1
            ;;
          3)
            echo "⚠️  WARN - PowerShell code quality NOT verified: ${PS_G1_REASON:-engine unavailable}"
            GATE_1_STATUS="WARN"
            GATE_1_DETAIL="powershell: ${PS_G1_REASON:-engine unavailable}"
            ;;
          *)
            echo "⚠️  WARN - PowerShell code quality NOT verified (unexpected verdict $PS_G1_EXIT)"
            GATE_1_STATUS="WARN"
            GATE_1_DETAIL="powershell: unexpected verdict $PS_G1_EXIT"
            ;;
        esac
      fi
      ;;

    *)
      # Route to appropriate adapter for other languages.
      #
      # #776: this arm used to PRINT findings and then leave GATE_1_STATUS
      # untouched. An adapter returning 1 -- "I ran and found violations" -- got
      # one cosmetic "may be non-blocking" line, then `⏭️ SKIPPED ... (tools
      # unavailable or failed)`, and the gate ended PASS. Every language without
      # its own arm above (C#, C/C++, Objective-C, Swift, Kotlin, Go, Python,
      # Dart, Flutter) was therefore fail-open, and the java/powershell arms' one
      # hard-won verdict protocol (#507 S1, #547, #717) was reachable by exactly
      # two languages.
      #
      # Why that matters for adoption, measured in a real project: a net8.0
      # project with TreatWarningsAsErrors=true + WarningLevel=9999 whose
      # `dotnet format --verify-no-changes` FAILED produced the three lines above
      # and a PASS. The project's own build.sh hard-failed on the identical tree,
      # so the gate was strictly weaker than the compiler it was meant to
      # institutionalise -- the exact opposite of the purpose of a shared gate.
      #
      # The protocol now applies here verbatim, per adapter verdict:
      #   0 = PASS   1 = BLOCK (ran, found problems)   2 = BLOCK (could not
      #   execute, fail-closed)   3 = WARN (skipped for a stated reason, stays in
      #   the scoring denominator so an unmeasured language is visible).
      #
      # Two mechanics are load-bearing and copied together, because either one
      # alone is a defect:
      #   - The verdict is captured into a variable, NOT read from `cmd | head`.
      #     #706 fixed `$?` becoming head's status; the java arm documents the
      #     remaining trap: a long report makes the writer die of SIGPIPE, so the
      #     verdict would depend on how much output happened to be produced. The
      #     `|| G1R_EXIT=$?` form (not a bare assignment) keeps a non-zero verdict
      #     from aborting the host hook under set -e before it is mapped.
      #   - Reasons cross the command-substitution subshell as `XP_G1_REASON:`
      #     stdout lines, since an `export` in the adapter can never reach this
      #     process (#507 Delphi round-1 B-MAJOR-1).
      ADAPTER_FILE=$(resolve_adapter_path "$CURRENT_LANG")
      if [ -n "$ADAPTER_FILE" ] && source "$ADAPTER_FILE" 2>/dev/null; then
        echo "Running static analysis for $CURRENT_LANG..."
        G1A_OUTPUT=""
        G1A_EXIT=0
        G1A_OUTPUT=$(run_static_analysis 2>&1) || G1A_EXIT=$?
        G1A_REASON=$(printf '%s\n' "$G1A_OUTPUT" | sed -n 's/^XP_G1_REASON: //p' | head -1)
        if [ -n "$G1A_REASON" ]; then
          G1A_OUTPUT=$(printf '%s\n' "$G1A_OUTPUT" | grep -v '^XP_G1_REASON: ')
        fi
        [ -n "$G1A_OUTPUT" ] && printf '%s\n' "$G1A_OUTPUT" | head -30

        echo "Running lint check for $CURRENT_LANG..."
        G1L_OUTPUT=""
        G1L_EXIT=0
        G1L_OUTPUT=$(run_lint 2>&1) || G1L_EXIT=$?
        [ -n "$G1L_OUTPUT" ] && printf '%s\n' "$G1L_OUTPUT" | head -30

        # The stricter of the two verdicts wins. Note 3 (WARN) must not mask a 1
        # or 2 from the other command: a clean formatter plus a failing analyzer
        # is still a failing source tree.
        case "${G1L_EXIT}" in
          1|2) G1_VERDICT="$G1L_EXIT" ;;
          *)   G1_VERDICT="$G1A_EXIT" ;;
        esac

        case "$G1_VERDICT" in
          0)
            echo "✅ PASSED - Language-specific code quality checks."
            ;;
          1)
            echo "❌ BLOCKED - ${CURRENT_LANG} code quality violations (fix or add suppressions)"
            GATE_1_STATUS="BLOCK"
            GATE_1_DETAIL="${CURRENT_LANG}: analyzer findings"
            return 1
            ;;
          2)
            # The substring "(… could not execute — NOT a pass)" is kept from the
            # #717 wording: issue-717-mirror-parity.test.bats asserts that exact
            # text in the npm mirror. An earlier draft of this rewrite dropped it
            # and turned a green main red — the contract is the string, not the
            # author's preference for how to phrase it.
            echo "❌ BLOCKED - ${CURRENT_LANG} toolchain could not execute — NOT a pass (fail-closed): ${G1A_REASON:-unknown}"
            echo "   A tool that could not run is not a clean tree. Install the toolchain,"
            echo "   or set the adapter's documented escape valve if you accept the risk."
            GATE_1_STATUS="BLOCK"
            GATE_1_DETAIL="${CURRENT_LANG}: ${G1A_REASON:-unusable}"
            return 1
            ;;
          3)
            echo "⚠️  WARN - ${CURRENT_LANG} code quality NOT verified: ${G1A_REASON:-adapter reported a non-blocking skip}"
            GATE_1_STATUS="WARN"
            GATE_1_DETAIL="${CURRENT_LANG}: ${G1A_REASON:-unavailable (warn)}"
            ;;
          *)
            echo "⚠️  WARN - ${CURRENT_LANG} code quality NOT verified (unexpected verdict $G1_VERDICT)"
            GATE_1_STATUS="WARN"
            GATE_1_DETAIL="${CURRENT_LANG}: unexpected verdict $G1_VERDICT"
            ;;
        esac
      else
        # If no adapter exists for this language, skip
        echo "ℹ️  No specific adapter for $CURRENT_LANG — using generic checks if any"
        echo "⏭️  SKIPPED - Code quality (no specific checks for $CURRENT_LANG)"
      fi
      ;;
    esac
  done
fi
fi  # End: if ! any_changed_files_match (Issue #312 skip)
GATE_1_STATUS="${GATE_1_STATUS:-SKIP}"
GATE_1_TOOL="${PROJECT_LANGS}"
# The java branch may set GATE_1_STATUS=WARN + a GATE_1_DETAIL warn reason
# (engine unavailable / soft or report downgrade); route it into the audit
# trail via the S2 detail plumbing so a WARN verdict is diagnosable, not
# silent. WARN stays IN the scoring denominator (Delphi round-2 A-MAJOR-1).
record_gate_audit "gate-1" "code-quality" "$GATE_1_STATUS" "0" "$GATE_1_START" "${GATE_1_DETAIL:-}"
  return 0
}


# Called by pre-commit's ordered driver.

