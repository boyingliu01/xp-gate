#!/usr/bin/env bash
# ============================================================================
# gate-6 entry — extracted from pre-commit by scripts/extract-gates.cjs
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
# GATE 6: Architecture & Tech Debt (Combines Old Gate 8 - Boy Scout and Gate 9 - Architecture)
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_6_run() {
 2>&1 echo ""
 2>&1 echo "→ Gate 6: Architecture & tech debt..."
GATE_6_START=$(gate_start_ms)

# First Part: Architecture Validation (previously Gate 9)
2>&1 echo "   └─ Architecture validation:"

if [ "$PROJECT_LANG" = "documentation-only" ]; then
  echo "     ✅ Skipped (documentation project)."

elif has_project_lang "powershell" 2>/dev/null || [ "$PROJECT_LANG" = "powershell" ]; then
  echo "     ℹ️  No PowerShell architecture tooling available"
     echo "     ⏭️  SKIPPED - Architecture validation (no tool for PowerShell)"

else
  run_archlint() (
    cd "$PROJECT_ROOT" || exit 1
    if [ "$ARCHLINT_KIND" = "npx" ]; then
      npx @archlinter/cli "$@"
    elif [ "${ARCHLINT_NODE:-0}" = "1" ]; then
      node "$ARCHLINT_BIN" "$@"
    else
      "$ARCHLINT_BIN" "$@"
    fi
  )

  # Check if architecture config exists (use $PROJECT_ROOT — hook may have cd'd to a subdir via ARCH-03)
  if [ -f "$PROJECT_ROOT/architecture.yaml" ] || [ -f "$PROJECT_ROOT/.architecturerc" ] || [ -f "$PROJECT_ROOT/.archlint.yaml" ]; then
    # #686: an `architecture.yaml` is NOT evidence that layer boundaries are
    # checked. Gate 6 only ever tested for the file's existence; archlint is
    # invoked without --config, and even with a config it cannot enforce layers:
    # @archlinter/cli 0.16.0 lists a `layer_violation` detector but produces no
    # results for it under any configuration (-A, -d layer_violation, enabled:
    # true, globs, exact paths — all exit 0 with zero layer findings). See
    # docs/plans/2026-11-02-arch-01-gate6-layers-not-enforced-design.md §2.2.
    #
    # So a repo that declares layers gets a generic-smell check and a green
    # verdict, which reads as "layers are clean". It is not: nothing looked.
    # This block records that fact as a per-language reason so the quality
    # report cannot score the dimension as covered, and emits a marker the
    # terminal output can be asserted against.
    #
    # Deliberately NOT a capability probe: archlint silently tolerates unknown
    # config keys, so "it did not complain" is a tautological guard — it would
    # return "supported" no matter what. File presence is the only honest input.
    GATE_6_LAYERS_UNCHECKED=0
    if [ -f "$PROJECT_ROOT/architecture.yaml" ] || [ -f "$PROJECT_ROOT/.architecturerc" ]; then
      # The declaration is now read by a checker of our own, so the warning
      # below is no longer "nothing looked at this" — it is "archlint did not".
      # The verdict on layer boundaries comes from gate-6-layers.sh; this flag
      # only records that archlint's generic-smell pass measured no layers.
      GATE_6_LAYERS_UNCHECKED=1
    fi

    # Layer-boundary enforcement (#686 / #691 / #728).
    # This runs in addition to archlint, not instead of it: archlint checks
    # generic smells (cycles, god modules, dead code) and its layer_violation
    # detector is a measured no-op, so the dependency direction has to be
    # checked directly. The checker always builds the whole-repo import graph —
    # a layer violation is an edge between two directories, so an incremental
    # per-directory scan structurally cannot see one.
    LAYER_CHECKER=""
    if [ -f "$GATE_DIR/gate-6-layers.sh" ]; then
      LAYER_CHECKER="$GATE_DIR/gate-6-layers.sh"
    elif [ -f "$(git rev-parse --show-toplevel 2>/dev/null)/githooks/gate-6-layers.sh" ]; then
      LAYER_CHECKER="$(git rev-parse --show-toplevel)/githooks/gate-6-layers.sh"
    fi
    if [ -n "$LAYER_CHECKER" ]; then
      LAYER_OUT=$(cd "$PROJECT_ROOT" && bash "$LAYER_CHECKER" 2>&1)
      LAYER_RC=$?
      printf '%s\n' "$LAYER_OUT" | sed 's/^/  /'
      case "$LAYER_RC" in
        0)
          GATE_6_LAYER_STATUS="PASS"
          ;;
        1)
          GATE_6_LAYER_STATUS="FAIL"
          GATE_6_STATUS="FAIL"
          ;;
        2)
          # Config present but unusable: fail closed. Reporting PASS here is the
          # exact defect #686 documented, one level deeper.
          GATE_6_LAYER_STATUS="BLOCK"
          GATE_6_STATUS="FAIL"
          ;;
        3)
          # WARN (no layer config, or only baselined violations).
          GATE_6_LAYER_STATUS="WARN"
          ;;
        *)
          # Any other exit means the checker itself did not complete: 126/127
          # (not executable / not found), 137 (killed), or a bash error. Mapping
          # those to WARN would let a crashed checker pass as "not checked",
          # which is #686's defect one level deeper — the gate would look like it
          # covered layers while nothing ran. Fail closed.
          GATE_6_LAYER_STATUS="BLOCK"
          GATE_6_STATUS="FAIL"
          GATE_6_LAYER_REASON="layer_checker_crashed_rc_${LAYER_RC}"
          GATE_6_LAYER_CRASHED=1
          ;;
      esac
      GATE_6_LAYER_REASON=${GATE_6_LAYER_REASON:-$(printf '%s\n' "$LAYER_OUT" | sed -n 's/^ *reason: *//p' | head -1)}
    else
      # The checker is missing, so the dimension is unmeasured — say so rather
      # than letting the gate look like it covered layers.
      GATE_6_LAYER_STATUS="WARN"
      GATE_6_LAYER_REASON="layer_checker_missing"
      echo "     ⚠️  [WARN:LAYER_CHECKER_MISSING] gate-6-layers.sh not found — layer boundaries NOT checked."
    fi
    if [ "${GATE_6_LAYER_CRASHED:-0}" = "1" ]; then
      echo "     ❌ [BLOCK:LAYER_CHECKER_CRASHED] gate-6-layers.sh exited $LAYER_RC without a verdict."
      echo "        A checker that did not finish has not checked anything — fail closed."
    fi
    # #537: per-language reason bookkeeping. Gate 3/4 are single-language gates
    # and get away with one scalar reason; Gate 6 loops, so a scalar would lose
    # information ("TS passed, PS has no detector" cannot be one string).
    # Bash 4 associative array, with a scalar aggregate for the legacy field.
    GATE_6_REASON=""
    GATE_6_LANG_REASONS=""
    if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
      declare -A GATE_6_REASON_BY_LANG=()
    fi
    # Different architecture tools per language
    for CURRENT_LANG in $PROJECT_LANGS; do
    case "$CURRENT_LANG" in
      "typescript")
        # Prefer node on the package's own entry over the .bin shim: the shim's
        # exec bit and extension vary by platform and package manager (npm writes
        # archlint, archlint.cmd and archlint.ps1 on Windows), so `-x .bin/...`
        # is true here while the no-extension shim is what Git Bash would run.
        # `node <entry>` sidesteps all of that and also avoids npx's ~1.6 s
        # package resolution (measured: 1909 ms via npx vs 319 ms direct).
        if [ -f "$PROJECT_ROOT/node_modules/@archlinter/cli/bin/archlint.js" ] && command -v node >/dev/null 2>&1; then
          ARCHLINT_KIND="binary"
          ARCHLINT_BIN="$PROJECT_ROOT/node_modules/@archlinter/cli/bin/archlint.js"
          ARCHLINT_NODE=1
        elif [ -x "$PROJECT_ROOT/node_modules/.bin/archlint" ]; then
          ARCHLINT_KIND="binary"
          ARCHLINT_BIN="$PROJECT_ROOT/node_modules/.bin/archlint"
        elif command -v archlint >/dev/null 2>&1; then
          ARCHLINT_KIND="binary"
          ARCHLINT_BIN="$(command -v archlint)"
        elif probe_archlint_available "$PROJECT_ROOT"; then
          # The three branches above are what this helper checks locally; it only
          # reaches for npx when the probe is explicitly enabled
          # (XP_GATE_NPX_PROBE=1). The old form always did, so on a machine with
          # no archlint it downloaded the package, answered --version, and ran a
          # tool the project never depended on -- see
          # docs/incidents/2026-11-09-command-could-not-run-*.
          ARCHLINT_KIND="npx"
        else
          echo "     ❌ BLOCKED - archlint not installed"
          echo "     Install with: npm install --save-dev @archlinter/cli"
          return 1
        fi
         echo "     Running archlint for TypeScript..."
          # #640: archlint costs ~8s and scans the whole tree, but an architecture
          # violation cannot be introduced by a commit that touches no source file.
          # Gating on "did any source change" removes the single largest fixed cost
          # from docs/config-only commits without weakening the check at all.
          if ! printf '%s\n' "${XP_STAGED_ACM:-}" | grep -qE '\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|kts|rs|cpp|cc|cxx|c|h|hpp|swift|dart|cs|csx|fs|vb)$'; then
            echo "     ⏭️  SKIPPED - Architecture validation (no source files changed)"
            ARCHLINT_OUTPUT=""
            ARCHLINT_EXIT=0
          elif [ -f "$PROJECT_ROOT/.architecture-baseline.json" ]; then
            ARCHLINT_OUTPUT=$(run_archlint diff .architecture-baseline.json --fail-on high 2>&1)
            ARCHLINT_EXIT=$?
          else
            ARCHLINT_OUTPUT=$(run_archlint scan . -f table --quiet 2>&1)
            ARCHLINT_EXIT=$?
          fi
         echo "$ARCHLINT_OUTPUT" | tail -30
         if [ "$ARCHLINT_EXIT" -ne 0 ]; then
           echo ""
           echo "❌ BLOCKED - Architecture violations detected"
             if [ -f "$PROJECT_ROOT/.architecture-baseline.json" ]; then
             echo "New architecture violations found (baseline ratchet mode)."
             echo "Fix the new violations above, or update the baseline with: npx @archlinter/cli snapshot -o .architecture-baseline.json"
           else
             echo "Fix the architecture violations above before committing."
             echo "Or generate a baseline for gradual adoption: npx @archlinter/cli snapshot -o .architecture-baseline.json"
           fi
           return 1
         fi
           if [ -f "$PROJECT_ROOT/.architecture-baseline.json" ]; then
           echo "     ✅ TypeScript architecture validation completed (baseline ratchet mode)."
         else
           echo "     ✅ TypeScript architecture validation completed (zero-tolerance mode). no baseline found."
         fi
         # #537: archlint actually ran here, so there is no skip reason. The
         # matrix reads an absent reason + PASS status as `covered`.
         ;;
      "python")
        # detect any import-linter carrier (incl. pyproject.toml [tool.importlinter])
        if [ -f "$PROJECT_ROOT/.import-linter.yml" ] || [ -f "$PROJECT_ROOT/import_linter_config.yml" ] || [ -f "$PROJECT_ROOT/.importlinter" ] || grep -q '^\[tool\.importlinter\]' "$PROJECT_ROOT/pyproject.toml" 2>/dev/null; then
          if require_tool "lint-imports" "Gate 6" "pip install import-linter"; then
            echo "     Running import-linter for Python..."
            # run at PROJECT_ROOT (hook may have cd'd); block on exit code
            LINT_IMPORTS_OUTPUT=$(cd "$PROJECT_ROOT" && lint-imports 2>&1)
            LINT_IMPORTS_EXIT=$?
            echo "$LINT_IMPORTS_OUTPUT" | head -30
            if [ "$LINT_IMPORTS_EXIT" -ne 0 ]; then
              echo ""
              echo "❌ BLOCKED - Python architecture contract violations (import-linter)"
              echo "Fix the broken contracts above before committing."
              return 1
            fi
            echo "     ✅ Python architecture validation completed."
          else
            echo "     ❌ BLOCKED - import-linter not installed"
            echo "     Install with: pip install import-linter"
            return 1
          fi
        else
          echo "     ℹ️  No import-linter config found (.import-linter.yml/.importlinter/[tool.importlinter]) - skipping"
          echo "     ⏭️  SKIPPED - Python architecture validation (no config)"
          # #537: no config means Python architecture was NOT measured. Without
          # this the matrix would call it `covered` simply because the branch
          # recorded nothing — the exact false-confidence the matrix prevents.
          if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
            GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="architecture_not_configured"
          fi
        fi
        ;;
      "go")
        if [ -f "arch-go.yaml" ] || [ -f "arch-go.yml" ]; then
          if require_tool "arch-go" "Gate 6" "go install github.com/arch-go/arch-go@latest"; then
            echo "     Running arch-go for Go..."
            # #630: #602 replaced the vacuous Java arm with a status-based verdict,
            # but the Go arm kept the identical fail-open shape: it piped arch-go
            # output into `head` and then printed "Go architecture validation
            # completed" unconditionally. A pipeline's status is `head`'s -- 0 for
            # ANY non-empty output -- so every arch-go result, contract violations
            # included, printed "completed" and the commit landed. A gate that
            # cannot fail is not a gate. Capture the checker's own status and
            # block on it, as the Python arm above and run_java_build_integrity do.
            arch-go check 2>&1 | head -20
            # The pipeline's own status is head's, so the checker's verdict has
            # to come from PIPESTATUS[0] (#630). This is the same reading #602
            # installed for Java via run_java_build_integrity.
            _go_arch_rc="${PIPESTATUS[0]}"
            if [ "$_go_arch_rc" -ne 0 ]; then
              echo ""
              echo "❌ BLOCKED - Go architecture contract violations (arch-go, exit $_go_arch_rc)"
              echo "Fix the layering violation(s) above before committing."
              GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="architecture_tests_failed"
              return 1
            fi
            echo "     ✅ Go architecture validation completed."
          else
            echo "     ❌ BLOCKED - arch-go not installed"
            echo "     Install with: go install github.com/arch-go/arch-go@latest"
            return 1
          fi
        else
          echo "     ℹ️  No arch-go.yaml found - skipping Go architecture"
          echo "     ⏭️  SKIPPED - Go architecture validation (no config)"
          # #537: same reasoning as the Python branch above.
          if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
            GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="architecture_not_configured"
          fi
        fi
        ;;
      "java")
        # #602: this branch used to be a guaranteed PASS no matter what happened.
        #   1) The test-dir probe hardcoded `src/test/java/architecture` at the
        #      repo root. A multi-module Maven repo (core/ + demo/) puts the arch
        #      tests under <module>/src/test/java/..., so the probe missed them
        #      and the gate took the SKIP path -- reporting architecture as
        #      "not configured" for a repo that HAS such tests.
        #   2) Even when it did run, `mvn ... | head -20` yields head's exit
        #      status (0) as the pipeline result, so the `||` fallback never
        #      fired and `echo "✅ ... completed"` printed unconditionally. A
        #      failing architecture test was reported as success. Verified:
        #      `false | head -20` exits 0; with `set -o pipefail` it exits 1.
        # Fix: discover the test source roots instead of guessing one path, and
        # judge the build by PIPESTATUS[0] (the pattern run_java_build_integrity
        # already uses), so the verdict comes from the build, not from `head`.
        _java_arch_roots=""
        if [ -f "pom.xml" ] || [ -x "./mvnw" ]; then
          # Any */src/test/java dir (module-relative root), including the repo
          # root itself, which find prints as ./src/test/java -> root ".".
          while IFS= read -r _root; do
            [ -n "$_root" ] && _java_arch_roots="${_java_arch_roots} ${_root}"
          done <<JAVAARCHROOTS
$(find . -path ./target -prune -o -type d -path '*/src/test/java' -print 2>/dev/null \
  | sed 's|^\./||; s|/src/test/java$||; s|^src/test/java$|.|')
JAVAARCHROOTS
        elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
          _java_arch_roots="."
        fi

        # Only the roots that actually contain an *Architecture* test count.
        _java_arch_hit=""
        for _r in $_java_arch_roots; do
          _probe_dir="$_r/src/test/java"
          [ "$_r" = "." ] && _probe_dir="src/test/java"
          if find "$_probe_dir" -name '*Architecture*' -type f 2>/dev/null | head -1 | grep -q .; then
            _java_arch_hit="${_java_arch_hit} ${_r}"
          fi
        done

        if [ -n "$_java_arch_hit" ]; then
          echo "     Running Java architecture tests (roots:$_java_arch_hit)..."
          _java_arch_rc=0
          if [ -f "pom.xml" ] || [ -x "./mvnw" ]; then
            _mvn_bin="mvn"
            [ -x "./mvnw" ] && _mvn_bin="./mvnw"
            # -pl <module> -am runs only the module that holds the tests (plus
            # what it needs); quoting the whole root list into one -Dtest works
            # for Surefire because it accepts comma-separated patterns.
            for _r in $_java_arch_hit; do
              if [ "$_r" = "." ]; then
                "$_mvn_bin" -q test -Dtest='*Architecture*' 2>&1 | tail -20
              else
                "$_mvn_bin" -q -pl "$_r" -am test -Dtest='*Architecture*' 2>&1 | tail -20
              fi
              _rc="${PIPESTATUS[0]}"
              [ "$_rc" -ne 0 ] && _java_arch_rc="$_rc"
            done
          elif [ -x "./gradlew" ]; then
            ./gradlew test --tests '*Architecture*' 2>&1 | tail -20
            _java_arch_rc="${PIPESTATUS[0]}"
          fi

          if [ "$_java_arch_rc" -ne 0 ]; then
            echo ""
            echo "❌ BLOCKED - Java architecture test(s) failed (exit $_java_arch_rc)"
            echo "Fix the layering violation(s) above before committing."
            GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="architecture_tests_failed"
            return 1
          fi
          echo "     ✅ Java architecture validation completed."
        else
          echo "     ℹ️  No *Architecture* test sources found under */src/test/java - skipping"
          echo "     ⏭️  SKIPPED - Architecture validation (no tests)"
          # #537: no test files means Java architecture was NOT measured.
          if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
            GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="architecture_not_configured"
          fi
        fi
        ;;
      "csharp")
        # #717: C# had no arm at all, so it fell through to the `*)` default
        # below and was reported as "not configured for csharp" -- a language
        # the gate silently could not measure, with no way to configure it
        # either, because the config file was never looked for.
        #
        # Architecture for .NET is normally expressed as *tests* (NetArchTest,
        # ArchUnitNET, or a plain xUnit project asserting layering). There is no
        # universal CLI, so this arm keys off a config the project opts into,
        # exactly like the Go arm's arch-go.yaml.
        if [ -f "arch-csharp.yaml" ] || [ -f ".xp-gate/arch-csharp.yaml" ]; then
          _cs_arch_cfg="arch-csharp.yaml"
          [ -f "$_cs_arch_cfg" ] || _cs_arch_cfg=".xp-gate/arch-csharp.yaml"
          # Find an architecture test project: a .csproj whose name or contents
          # mention architecture tests. Guessing one fixed path is the #602
          # defect, which reported "not configured" for repos that had them.
          _cs_arch_proj=""
          while IFS= read -r _p; do
            [ -n "$_p" ] || continue
            if grep -qiE "architecture|archunit|netarchtest" "$_p" 2>/dev/null; then
              _cs_arch_proj="$_p"
              break
            fi
          done <<CSARCHPROJ
$(git ls-files '*.csproj' 2>/dev/null)
CSARCHPROJ

          if [ -z "$_cs_arch_proj" ]; then
            echo "     ℹ️  No architecture test project found - skipping C# architecture"
            echo "     ⏭️  SKIPPED - C# architecture validation (no arch test project)"
            if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
              GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="architecture_not_configured"
            fi
          elif ! command -v dotnet >/dev/null 2>&1; then
            echo "     ⏭️  SKIPPED - C# architecture validation (dotnet SDK not installed)"
            if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
              GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="tool_missing"
            fi
          else
            echo "     Running C# architecture tests ($_cs_arch_proj)..."
            # Same reading as the Go/Java arms (#630/#602): the checker's own
            # status decides the verdict. Piping into `tail` and printing
            # "completed" unconditionally is the fail-open shape those issues
            # removed; PIPESTATUS[0] is what keeps this arm from repeating it.
            dotnet test "$_cs_arch_proj" --nologo 2>&1 | tail -20
            _cs_arch_rc="${PIPESTATUS[0]}"
            if [ "$_cs_arch_rc" -ne 0 ]; then
              echo ""
              echo "❌ BLOCKED - C# architecture violations ($_cs_arch_proj, exit $_cs_arch_rc)"
              echo "Fix the layering violation(s) above before committing."
              if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
                GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="architecture_tests_failed"
              fi
              return 1
            fi
            echo "     ✅ C# architecture validation completed."
          fi
        else
          echo "     ℹ️  No arch-csharp.yaml found - skipping C# architecture"
          echo "     ⏭️  SKIPPED - C# architecture validation (no config)"
          if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
            GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="architecture_not_configured"
          fi
        fi
        ;;
      *)
        echo "     ⏭️  SKIPPED - Architecture validation (not configured for $CURRENT_LANG)"
        # #537: archlint ships no detector for this language. Say so in a way
        # the quality report can read, instead of leaving the dimension silent.
        if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
          GATE_6_REASON_BY_LANG["$CURRENT_LANG"]="no_archlint_detector"
        fi
        ;;
    esac
    done  # end for CURRENT_LANG (architecture)

    # #537: fold the per-language reasons into the legacy scalar. Homogeneous
    # reasons survive as-is; a genuine mix becomes the `mixed` sentinel, which
    # classify_coverage_reason() maps to `unknown` (fail closed) rather than
    # pretending one language's verdict covers all of them.
    #
    # `declare -A` inside a function is FUNCTION-LOCAL in bash, and the report
    # is written by generate_quality_report() — a different function. So the
    # assoc array is flattened into this global string, which the report parses.
    # (Found by running the hook: the matrix reported tool_missing for
    # typescript because the lookup saw an empty array.)
    GATE_6_LANG_REASONS=""
    _g6_seen=""
    _g6_mixed=0
    # #686: a language that archlint actually measured and passed still carries a
    # reason when the repo declared layer boundaries, because the layer dimension
    # itself was never measured. Only languages WITHOUT a reason get this stamp —
    # an existing reason (tool missing, tests failed, ...) is more specific and
    # must not be overwritten. The `-z` test is what keeps this honest: stamping
    # unconditionally would erase the real reason and make every language look
    # alike in the report.
    if [ "${GATE_6_LAYERS_UNCHECKED:-0}" = "1" ] && [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
      for _g6_lang in $PROJECT_LANGS; do
        if [ -z "${GATE_6_REASON_BY_LANG[$_g6_lang]:-}" ]; then
          GATE_6_REASON_BY_LANG["$_g6_lang"]="layers_config_not_enforced"
        fi
      done
    fi
    for _g6_lang in $PROJECT_LANGS; do
      _g6_r=""
      if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
        _g6_r="${GATE_6_REASON_BY_LANG[$_g6_lang]:-}"
      fi
      if [ -n "$_g6_r" ]; then
        GATE_6_LANG_REASONS="${GATE_6_LANG_REASONS:+$GATE_6_LANG_REASONS,}${_g6_lang}=${_g6_r}"
        if [ -z "$_g6_seen" ]; then
          _g6_seen="$_g6_r"
        elif [ "$_g6_seen" != "$_g6_r" ]; then
          _g6_mixed=1
        fi
      fi
    done
    if [ "$_g6_mixed" = "1" ]; then
      GATE_6_REASON="mixed"
    else
      GATE_6_REASON="$_g6_seen"
    fi

    # #602 (status): a language that was really measured and passed leaves NO skip
    # reason behind (see the #537 comment in the typescript arm: "archlint
    # actually ran here, so there is no skip reason"). The verdict was never
    # upgraded to match, so Gate 6 reported SKIP even when every language in
    # the project had been validated and passed -- a measured dimension
    # rendered as unmeasured. That is the mirror image of the bug #537 fixed,
    # and the report could not tell the two apart.
    #
    # Upgrade to PASS only when the measurement actually happened for EVERY
    # language: no language may carry a skip reason. A single skipped language
    # keeps the gate non-PASS, so "some languages measured" cannot be scored
    # as a full success.
    if [ -z "$GATE_6_LANG_REASONS" ] && [ -n "$PROJECT_LANGS" ]; then
      GATE_6_STATUS="PASS"
    fi
  else
    # Architecture config is REQUIRED — BLOCK if missing
    if [ -f "$PROJECT_ROOT/.architecture-skip" ]; then
      echo "     ⚠️  Architecture config missing but .architecture-skip present — allowed to skip"
      echo "     ⏭️  SKIPPED - Architecture validation (.architecture-skip exemption)"
      # #537: an explicit exemption is "not applicable", not "tool missing".
      GATE_6_REASON="architecture_skip_exemption"
    else
      echo ""
      echo "❌ ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED"
      echo "   Required configuration file (.archlint.yaml / architecture.yaml) is NOT found."
      echo "   Architecture Quality Gate requires explicit architecture constraints."
      echo ""
      echo "   Quick fix: create .archlint.yaml with: npx archlint init --no-interactive"
      echo "   Or write one by hand — this is archlint's own config format, and the"
      echo "   only one it actually reads:"
      echo "     rules:"
      echo "       cyclic_dependency:"
      echo "         severity: high"
      echo "       god_module:"
      echo "         severity: high"
      echo ""
      # #686: this used to recommend a top-level `layers:` block. That format is
      # silently ignored by @archlinter/cli 0.16.0 (verified against a fixture
      # with a textbook domain->infra violation: the layer_violation detector is
      # listed by `archlint detectors list` but produces no results under any
      # configuration, including -A and an explicit -d layer_violation). The hint
      # therefore taught users to write a file that bought them nothing while
      # Gate 6 reported green — the worst possible combination.
      echo "   NOTE: layer-boundary rules are NOT enforced by archlint 0.16.0."
      echo "   Do not write a top-level 'layers:' block expecting it to be checked;"
      echo "   Gate 6 will tell you when that changes. See #686 / #690 / #692."
      echo ""
      echo "   After creating the config, retry the commit."
      echo "   (To skip with warning, create .architecture-skip file)"
      return 1
    fi
  fi
fi

# Second Part: Boy Scout Rule (previously Gate 8) - Unified Enforcement
2>&1 echo "   └─ Boy Scout Rule enforcement:"

if [ "$PROJECT_LANG" = "documentation-only" ]; then
  echo "     ✅ Skipped (documentation project)."
  
else
  # Check for Boy Scout script in installed modules first, then project src/
  BOY_SCOUT_SCRIPT=""
  if [ -f ".xp-gate/modules/principles/boy-scout.ts" ]; then
    BOY_SCOUT_SCRIPT=".xp-gate/modules/principles/boy-scout.ts"
  elif [ -f "src/principles/boy-scout.ts" ]; then
    BOY_SCOUT_SCRIPT="src/principles/boy-scout.ts"
  fi
  
  if [ -n "$BOY_SCOUT_SCRIPT" ]; then
    echo "     Checking Boy Scout Rule compliance..."
    
    # Separate new files and modified files.
    #
    # src/npm-package/** is a byte-identical MIRROR of canonical sources
    # (plugins/**, src/principles/**, githooks/**) produced by
    # sync-package-content.js at publish time. Checking it here double-counts
    # every warning: the mirror path enters the baseline instead of the source
    # path, so a violation gets recorded against a path nobody edits and the
    # real source path stays unbudgeted. Exclude it and let the mirroring be
    # governed by Mirror Parity in CI, which compares content rather than
    # re-linting it. (See the same exclusion in adapters/powershell.sh.)
    MIRROR_EXCLUDE="$MIRROR_PATH_FILTER"
    # filter_project_paths also removes dependencies and build output (#649):
    # a staged node_modules/ or dist/ file is not budgetable project code, and
    # entering it in the Boy Scout baseline would budget a path nobody edits.
    NEW_FILES=$(git diff --cached --name-only --diff-filter=A | filter_project_paths | grep -v "$MIRROR_EXCLUDE" | grep -v "$DASHBOARD_PATH_FILTER" | tr '\n' ' ')
    MODIFIED_FILES=$(git diff --cached --name-only --diff-filter=M | filter_project_paths | grep -v "$MIRROR_EXCLUDE" | grep -v "$DASHBOARD_PATH_FILTER" | tr '\n' ' ')
    
    if [ -z "$NEW_FILES" ] && [ -z "$MODIFIED_FILES" ]; then
      echo "     ✅ No new or modified files to check."
    else
      # Run Boy Scout Rule enforcement
      if command -v npx &> /dev/null || [ -f "${PROJECT_ROOT:-$(pwd)}/node_modules/tsx/dist/cli.mjs" ]; then
        # Skip if no files to check
        if [ -z "$(echo "$NEW_FILES" | tr -d ' ')" ] && [ -z "$(echo "$MODIFIED_FILES" | tr -d ' ')" ]; then
          echo "     ✅ No new or modified source files for Boy Scout check."
        else
          BOY_SCOUT_OUTPUT=$(run_tsx "$BOY_SCOUT_SCRIPT" \
            --new-files "$(echo "$NEW_FILES" | tr ' ' ',')" \
            --modified-files "$(echo "$MODIFIED_FILES" | tr ' ' ',')" \
            --baseline ".warnings-baseline.json" 2>&1)
        
        BOY_SCOUT_EXIT=$?
        
        if [ "$BOY_SCOUT_EXIT" -ne 0 ]; then
          echo "$BOY_SCOUT_OUTPUT"
          echo ""
          echo "❌ BLOCKED - Boy Scout Rule violation"
          echo "Requirements:"
          echo "  - NEW files: must have zero warnings"
          echo "  - MODIFIED files: cannot increase warnings from baseline"
          echo "  - Files with ≤5 warnings: must clear to zero"
          return 1
        fi
        
        # Check output for violations
        VIOLATION_COUNT=$(echo "$BOY_SCOUT_OUTPUT" | grep -c '"enforcement": "BLOCK"' 2>/dev/null || true)
        VIOLATION_COUNT=${VIOLATION_COUNT:-0}
        if [ "$VIOLATION_COUNT" -gt 0 ]; then
          echo "$BOY_SCOUT_OUTPUT"
          echo ""
          echo "❌ BLOCKED - Boy Scout Rule violations detected ($VIOLATION_COUNT)"
          return 1
        fi

        # REQ-4 (#452): the auto-init rewrites a committed file, which used to
        # surface as an unexplained dirty ` M .warnings-baseline.json` after
        # every commit that touched a first-time-modified file. Stage it so the
        # budget update travels with the commit that caused it; when the
        # baseline is unchanged (the common case) this is a no-op.
        if [ -n "$(git status --porcelain -- .warnings-baseline.json 2>/dev/null)" ]; then
          git add .warnings-baseline.json 2>/dev/null || true
          echo "     ℹ️  .warnings-baseline.json auto-updated and staged with this commit."
        fi

        echo "     ✅ PASSED - Boy Scout Rule compliance."
        fi
      else
        echo "     ℹ️  npx/tsx not available - skipping Boy Scout Rule"
        echo "     ⏭️  SKIPPED - Boy Scout Rule (Node.js/tsx not available)"
      fi
    fi
  else
    echo "     ℹ️  Boy scout rule not available in project - skipping"
    echo "     ⏭️  SKIPPED - Boy Scout Rule (not available in project)"
  fi
fi
# A PASS here must mean 'the checks ran and found nothing'. The two
# branches above print 'SKIPPED - not configured/available'; stamping PASS
# after them turned 'nothing was checked' into a scored success.
if [ -n "${GATE_6_STATUS:-}" ]; then
  : # a branch that really ran already decided the verdict
else
  GATE_6_STATUS="SKIP"
fi
record_gate_audit "gate-6" "architecture-boy-scout" "$GATE_6_STATUS" "${BS_BLOCKED:-0}" "$GATE_6_START"

# ============================================================================
  return 0
}



# Called by pre-commit's ordered driver.

