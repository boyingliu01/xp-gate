#!/usr/bin/env bash
# ============================================================================
# Java adapter -- GATE 1 static analysis (#507 S1, DR-001/DR-002)
#
# Primary engine: wc-java-lint (`check --staged --format json`), fail-closed:
#   exit 0        -> PASS (clean)
#   exit 1        -> FAIL (violations; never downgraded in soft mode)
#   exit >=2      -> BLOCK (execution error / timeout / unusable JSON)
#   JSON without the required whitelist fields (file/rule/severity) counts as
#   unusable -> BLOCK; unknown extra fields are tolerated (additive evolution).
# Escape valves:
#   XP_GATE_WC_JAVA_LINT=soft   downgrades BLOCK-class outcomes (exit>=2,
#     timeout, unusable JSON) to SKIP+WARN (exit 3); exit-1 stays FAIL.
#   XP_GATE_WC_JAVA_LINT=report downgrades exit-1 violations to SKIP+WARN
#     (rollout/grace mode for legacy repos; #507 Delphi round-1 C-MAJOR-3).
#   An exit-0-with-objects response is a lying tool and is NEVER downgraded.
# A SKIP/WARN reason crosses the subshell boundary as an `XP_G1_REASON: ...`
# stdout line (export cannot: the caller captures command-substitution output).
# Fallback: tool not on PATH -> legacy checkstyle/pmd + p3c/whalecloud chain;
#   checkstyle AND pmd both missing -> explicit WARN and verdict must NOT be
#   PASS (exit 3, recorded in the gate-1 audit detail).
#
# Verdict contract with pre-commit's `java)` branch:
#   0 = PASS, 1 = FAIL(violations -> commit blocked), 2 = BLOCK(fail-closed),
#   3 = SKIP+WARN(non-blocking, audit records warn)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Plugin directory
PLUGIN_DIR="$SCRIPT_DIR/plugins/p3c-java"
WHALECLOUD_PLUGIN_DIR="$SCRIPT_DIR/plugins/whalecloud-java"

WC_JAVA_LINT_DEFAULT_TIMEOUT=180

# ---------------------------------------------------------------------------
# Discovery (#507 AC-507-01-05): explicit multi-form support. MSYS2/Git Bash
# `command -v` resolves .exe/.cmd only when the extension is spelled out, so
# each form is probed verbatim.
# ---------------------------------------------------------------------------
wc_java_lint_bin() {
  local candidate
  for candidate in wc-java-lint wc-java-lint.exe wc-java-lint.cmd; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# Timeout (#507 AC-507-01-09): .xp-gate/wc-java-lint-timeout (positive
# integer seconds) > default 180. Invalid values WARN and fall back -- an
# unreadable override must not silently disable the timeout.
# ---------------------------------------------------------------------------
resolve_wc_java_lint_timeout() {
  local file=".xp-gate/wc-java-lint-timeout" val=""
  if [ -f "$file" ]; then
    val=$(tr -d '[:space:]' < "$file")
  fi
  if [ -z "$val" ]; then
    echo "$WC_JAVA_LINT_DEFAULT_TIMEOUT"
    return 0
  fi
  case "$val" in
    ''|*[!0-9]*|0)
      echo "WARN - invalid $file value '${val}' (expected a positive integer), falling back to ${WC_JAVA_LINT_DEFAULT_TIMEOUT}s" >&2
      echo "$WC_JAVA_LINT_DEFAULT_TIMEOUT"
      ;;
    *) echo "$val" ;;
  esac
}

# ---------------------------------------------------------------------------
# Staged .java file set (#507 AC-507-01-10): the ONLY files handed to the
# tool in explicit-list mode. Polyglot commits keep their TS/Python files out
# of the Java engine entirely.
# ---------------------------------------------------------------------------
java_staged_files() {
  # Harness/test injection: XP_GATE_JAVA_STAGED_FILES supplies a raw file
  # list (newline-separated) so tests can exercise the .java filter without
  # a git repo. The filter still applies -- the tool never sees non-.java.
  if [ -n "${XP_GATE_JAVA_STAGED_FILES:-}" ]; then
    printf '%s\n' "$XP_GATE_JAVA_STAGED_FILES" | grep -E '\.java$' || true
    return 0
  fi
  git diff --cached --name-only --diff-filter=d 2>/dev/null \
    | grep -E '\.java$' || true
}

# ---------------------------------------------------------------------------
# JSON whitelist validation (#507 AC-507-01-07, DR-002).
# Contract shape: a JSON array of FLAT violation objects, each carrying
# file/rule/severity (line optional). Checks are grep-based by design:
#   - STRING LITERALS ARE STRIPPED BEFORE COUNTING (#507 Delphi round-1
#     A-MAJOR-1): violation messages routinely contain braces ("'{' is not
#     preceded...") or the words file/rule/severity -- counting raw text made
#     perfectly valid output false-BLOCK. After stripping, only structural
#     braces and structural keys remain.
#   - unknown extra fields add occurrences of their own keys, never remove
#     the required ones -> tolerated (additive evolution);
#   - any object missing a required key desynchronizes the per-key occurrence
#     counts from the object count -> unusable -> BLOCK;
#   - a truncated response (no closing bracket) is unusable -> BLOCK.
# Prints the violation (object) count on success; returns 1 if unusable.
# ---------------------------------------------------------------------------
wc_java_json_violation_count() {
  local json_file="$1"
  [ -s "$json_file" ] || return 1

  # Array-shaped: opens with [ and closes with ]. (A bare [] is valid clean
  # output; an object wrapper is outside the pinned contract.)
  [ "$(head -c 1 "$json_file")" = "[" ] || return 1
  local tail
  tail=$(tr -d '[:space:]' < "$json_file" | tail -c 1)
  [ "$tail" = "]" ] || return 1

  # Strip string VALUE literals (`: "..."` -> `: ""`). Keys must survive
  # (they are the tokens being counted); values must vanish (violation
  # messages routinely contain braces or the words file/rule/severity --
  # #507 Delphi round-1 A-MAJOR-1). JSON strings cannot contain raw newlines
  # (they are \n escapes), so line-wise sed is safe. The leftmost-match rule
  # consumes an entire value string in one go, including any `: "` sequences
  # inside it. Broken JSON masks badly -> counts desynchronize -> BLOCK,
  # which is the correct fail-closed direction.
  local structural obj_count file_count rule_count sev_count
  structural=$(sed 's/:\([[:space:]]*\)"\([^"\\]\|\\.\)*"/:\1""/g' "$json_file" 2>/dev/null)
  obj_count=$(grep -o '{' <<< "$structural" | wc -l | tr -d '[:space:]')
  file_count=$(grep -o '"file"' <<< "$structural" | wc -l | tr -d '[:space:]')
  rule_count=$(grep -o '"rule"' <<< "$structural" | wc -l | tr -d '[:space:]')
  sev_count=$(grep -o '"severity"' <<< "$structural" | wc -l | tr -d '[:space:]')
  [ "$obj_count" -eq "$file_count" ] || return 1
  [ "$obj_count" -eq "$rule_count" ] || return 1
  [ "$obj_count" -eq "$sev_count" ] || return 1

  echo "$obj_count"
}

# Distinct staged-file names from a violations JSON (reporting only).
wc_java_json_files() {
  grep -o '"file"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null \
    | sed 's/.*"\([^"]*\)"$/\1/' | sort -u | head -10
}

# ---------------------------------------------------------------------------
# Primary engine (#507 AC-507-01-01/02/06/09).
# Prints a human-readable report on stdout; returns the verdict code.
# ---------------------------------------------------------------------------
run_wc_java_lint() {
  local bin="" timeout_s out_file err_file exit_code count

  if ! bin=$(wc_java_lint_bin); then
    return 9  # not installed -> caller falls back to the legacy chain
  fi

  timeout_s=$(resolve_wc_java_lint_timeout)
  out_file=$(mktemp "${TMPDIR:-/tmp}/wc-java-lint.XXXXXX")
  err_file="${out_file}.err"

  # Primary contract call: the tool inspects the index itself.
  # `|| exit_code=$?` keeps a non-zero verdict from killing the host when
  # this module is sourced into a `set -e` consumer (repo convention,
  # cf. gate-4.sh's `|| PRINCIPLES_EXIT=$?`).
  exit_code=0
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_s" "$bin" check --staged --format json >"$out_file" 2>"$err_file" || exit_code=$?
  else
    echo "     ⚠️  'timeout' command not available - running wc-java-lint without a timeout guard" >&2
    "$bin" check --staged --format json >"$out_file" 2>"$err_file" || exit_code=$?
  fi

  # Usage-error fallback (#507 AC-507-01-06): an older build without --staged
  # answers with a usage message and exit>=2. Retry with the explicit staged
  # .java list; any OTHER exit>=2 stays an execution error.
  if [ "$exit_code" -ge 2 ] \
     && grep -qiE 'unknown option|unrecognized option|^usage' "$err_file" "$out_file" 2>/dev/null; then
    local staged_args=()
    while IFS= read -r jf; do
      [ -n "$jf" ] && staged_args+=("$jf")
    done <<< "$(java_staged_files)"
    if [ "${#staged_args[@]}" -gt 0 ]; then
      exit_code=0
      if command -v timeout >/dev/null 2>&1; then
        timeout "$timeout_s" "$bin" check --format json "${staged_args[@]}" >"$out_file" 2>"$err_file" || exit_code=$?
      else
        "$bin" check --format json "${staged_args[@]}" >"$out_file" 2>"$err_file" || exit_code=$?
      fi
    fi
  fi

  if [ -s "$err_file" ]; then
    sed 's/^/     /' "$err_file"
  fi

  case "$exit_code" in
    0)
      if ! count=$(wc_java_json_violation_count "$out_file"); then
        echo "❌ wc-java-lint output is not a usable violations JSON (fail-closed, #507 DR-001)"
        rm -f "$out_file" "$err_file"
        if [ "${XP_GATE_WC_JAVA_LINT:-}" = "soft" ]; then
          # Unusable output IS an execution-class failure (the tool exists but
          # its response cannot be trusted) -- same class as exit>=2, covered
          # by the escape valve (#507 Delphi round-1 B-MAJOR-5).
          echo "⚠️  XP_GATE_WC_JAVA_LINT=soft: unusable JSON downgraded to SKIP+WARN"
          echo "XP_G1_REASON: wc-java-lint unusable JSON (soft downgrade)"
          return 3
        fi
        return 2
      fi
      if [ "$count" -gt 0 ]; then
        # Contract says exit 0 means clean; objects + 0 is a LYING tool, not a
        # broken one. It claims success while reporting violations -- there is
        # no trustworthy interpretation, so soft/report must NOT downgrade it
        # (deliberately outside the escape valve; #507 Delphi round-1 B-MAJOR-5).
        echo "❌ wc-java-lint exited 0 but reported $count violation object(s) - inconsistent response"
        rm -f "$out_file" "$err_file"
        return 2
      fi
      rm -f "$out_file" "$err_file"
      echo "✅ wc-java-lint: clean"
      return 0
      ;;
    1)
      if count=$(wc_java_json_violation_count "$out_file"); then
        echo "❌ wc-java-lint: $count violation(s) in:"
        wc_java_json_files "$out_file" | sed 's/^/       /'
      else
        echo "❌ wc-java-lint reported violations but the JSON was unusable"
      fi
      rm -f "$out_file" "$err_file"
      if [ "${XP_GATE_WC_JAVA_LINT:-}" = "report" ]; then
        # Rollout/grace mode (#507 Delphi round-1 C-MAJOR-3): a legacy repo
        # adopting wc-java-lint carries pre-existing violations; hard-blocking
        # every commit gives no migration path. report mode degrades REAL
        # violations to SKIP+WARN (scored in the denominator, never a PASS)
        # so teams can burn down findings before switching back to enforcing.
        echo "⚠️  XP_GATE_WC_JAVA_LINT=report: violations downgraded to SKIP+WARN (rollout mode)"
        echo "⚠️  Java code quality NOT enforcing - burn down the findings, then unset report mode"
        echo "XP_G1_REASON: wc-java-lint report mode: ${count:-unknown} violation(s) suppressed"
        return 3
      fi
      return 1
      ;;
    *)
      rm -f "$out_file" "$err_file"
      if [ "$exit_code" -eq 124 ]; then
        echo "❌ wc-java-lint timed out after ${timeout_s}s"
      else
        echo "❌ wc-java-lint failed with exit code $exit_code"
      fi
      if [ "${XP_GATE_WC_JAVA_LINT:-}" = "soft" ]; then
        echo "⚠️  XP_GATE_WC_JAVA_LINT=soft: execution failure downgraded to SKIP+WARN (#507 DR-001 escape valve)"
        echo "⚠️  Java static analysis SKIPPED - the engine exists but is broken; do not treat this as a clean run"
        # The reason crosses the command-substitution subshell boundary via a
        # prefixed stdout line (export does NOT: the caller captures this
        # function's output, so the subshell env is discarded -- #507 Delphi
        # round-1 B-MAJOR-1). pre-commit parses and strips the line.
        echo "XP_G1_REASON: wc-java-lint broken (soft downgrade)"
        export XP_GATE_JAVA_G1_REASON="wc-java-lint broken (soft downgrade)"
        return 3
      fi
      return 2
      ;;
  esac
}

# ---------------------------------------------------------------------------
_is_whalecloud_enabled() {
  # Check if whalecloud-java plugin is enabled
  [ -d "$WHALECLOUD_PLUGIN_DIR" ] && \
    ([ -f "config/pmd/whalecloud-ruleset.xml" ] || \
     grep -q 'xp-gate-whalecloud-java\|xpGateWhalecloudCheck' pom.xml build.gradle build.gradle.kts 2>/dev/null)
}

_detect_java_build() {
  if [ -f "pom.xml" ]; then
    echo "maven"
  elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    echo "gradle"
  else
    echo "none"
  fi
}

# ---------------------------------------------------------------------------
# Legacy fallback (#507 AC-507-01-03): only reached when wc-java-lint is not
# installed. Prints one WARN per missing plugin dir; if neither checkstyle
# nor pmd is available the verdict must NOT be PASS (exit 3, audit warn).
# ---------------------------------------------------------------------------
run_legacy_analysis() {
  local build_system lint_tools=0 worst=0 rc=0

  build_system=$(_detect_java_build)

  if [ ! -d "$PLUGIN_DIR" ]; then
    echo "⚠️  p3c-java plugin directory missing: $PLUGIN_DIR"
  fi
  if [ ! -d "$WHALECLOUD_PLUGIN_DIR" ]; then
    echo "⚠️  whalecloud-java plugin directory missing: $WHALECLOUD_PLUGIN_DIR"
  fi

  # Every engine's verdict is AGGREGATED (#507 blind review MAJOR-1): a tool
  # that reports violations must never degrade to a silent PASS -- that was
  # the exact anti-pattern this sprint exists to remove.
  local out_file
  out_file=$(mktemp "${TMPDIR:-/tmp}/java-legacy.XXXXXX")

  # CheckStyle with Google style (legacy fallback)
  if command -v checkstyle &>/dev/null; then
    lint_tools=$((lint_tools + 1))
    rc=0
    checkstyle -c /google_checks.xml . >"$out_file" 2>&1 || rc=$?
    sed -n '1,20p' "$out_file"
    [ "$rc" -ne 0 ] && worst=1
  fi

  # PMD error detection (legacy fallback)
  if command -v pmd &>/dev/null; then
    lint_tools=$((lint_tools + 1))
    rc=0
    pmd check -d . -R category/java/errorprone.xml >"$out_file" 2>&1 || rc=$?
    sed -n '1,20p' "$out_file"
    [ "$rc" -ne 0 ] && worst=1
  fi
  rm -f "$out_file"

  if [ "$lint_tools" -eq 0 ]; then
    echo "⚠️  No Java static-analysis engine available: wc-java-lint, checkstyle and pmd all missing"
    echo "⚠️  Java code quality NOT verified - verdict is SKIP+WARN, not PASS (#507 AC-507-01-03)"
    echo "   Install wc-java-lint (preferred) or checkstyle/pmd to restore verification"
    _XP_JAVA_LEGACY_WARN=1
    echo "XP_G1_REASON: legacy tools unavailable (warn)"
    export XP_GATE_JAVA_G1_REASON="legacy tools unavailable (warn)"
  fi

  # p3c-pmd check (Alibaba coding guidelines) — primary Java quality gate
  # (`-Dpmd.failOnViolation=true` makes violations exit non-zero).
  rc=0
  _run_p3c_check "$build_system" || rc=$?
  [ "$rc" -ne 0 ] && worst=1

  # WhaleCloud Java Coding Standards — overlay on top of p3c-pmd
  rc=0
  _run_whalecloud_check "$build_system" || rc=$?
  [ "$rc" -ne 0 ] && worst=1

  if [ "$worst" -ne 0 ]; then
    echo "  ❌ legacy Java analysis found violations"
    return 1
  fi
  if [ "${_XP_JAVA_LEGACY_WARN:-0}" = "1" ]; then
    return 3
  fi
  return 0
}

run_lint() {
  run_static_analysis
}

run_tests() {
  local build_system
  build_system=$(_detect_java_build)

  if [ "$build_system" = "maven" ]; then
    mvn test -q 2>&1 | tail -15
    return "${PIPESTATUS[0]}"
  elif [ "$build_system" = "gradle" ]; then
    gradle test --quiet 2>&1 | tail -15
    return "${PIPESTATUS[0]}"
  else
    echo "No Maven/Gradle project detected"
    return 1
  fi
}

_detect_jacoco_configured() {
  local build_system="$1"
  if [ "$build_system" = "maven" ]; then
    # Check for jacoco-maven-plugin in pom.xml
    grep -q 'jacoco-maven-plugin\|org.jacoco' pom.xml 2>/dev/null && return 0
    # Check for jacoco.xml report already generated
    [ -f "target/site/jacoco/jacoco.xml" ] && return 0
    return 1
  elif [ "$build_system" = "gradle" ]; then
    # Check for jacoco plugin in build.gradle or build.gradle.kts
    grep -q "id.*jacoco\|apply.*plugin.*jacoco\|jacoco" build.gradle build.gradle.kts 2>/dev/null && return 0
    [ -f "build/reports/jacoco/test/jacocoTestReport.xml" ] && return 0
    return 1
  fi
  return 1
}

run_coverage() {
  local build_system
  build_system=$(_detect_java_build)

  if [ "$build_system" = "maven" ]; then
    if _detect_jacoco_configured "$build_system"; then
      mvn test jacoco:report -q 2>&1 | tail -10
      return "${PIPESTATUS[0]}"
    else
      echo "ℹ️  JaCoCo not configured in pom.xml — SKIP coverage check"
      echo "   To enable: add jacoco-maven-plugin to your pom.xml"
      return 0
    fi
  elif [ "$build_system" = "gradle" ]; then
    if _detect_jacoco_configured "$build_system"; then
      gradle jacocoTestReport --quiet 2>&1 | tail -10
      return "${PIPESTATUS[0]}"
    else
      echo "ℹ️  JaCoCo not configured in Gradle build — SKIP coverage check"
      echo "   To enable: add 'id \"jacoco\"' to your build.gradle plugins block"
      return 0
    fi
  else
    echo "No Maven/Gradle project detected"
    return 1
  fi
}

run_p3c_check() {
  _run_p3c_check "$(_detect_java_build)"
}

# Legacy maven invocations are network-facing (plugin/rule resolution against
# remote repositories). Without a guard a cold cache can hang pre-commit for
# minutes (#507 Delphi round-1 C-MAJOR-2). Same timeout file as the primary
# engine: .xp-gate/wc-java-lint-timeout. Degrades safely when `timeout` is
# unavailable (rc 127 must never be mistaken for a tool verdict).
_legacy_maven_run() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$(resolve_wc_java_lint_timeout)" "$@"
  else
    echo "     ⚠️  'timeout' command not available - legacy maven call runs unguarded" >&2
    "$@"
  fi
}

_run_p3c_check() {
  local build_system="$1"

  echo "  Running p3c-pmd Alibaba Coding Guidelines check..."

  if [ "$build_system" = "maven" ]; then
    if grep -q '<id>xp-gate-p3c</id>' pom.xml 2>/dev/null; then
      # Profile already installed — use it (timeout-guarded: legacy maven
      # resolves plugins/rulesets over the network, a cold cache must not
      # hang pre-commit unbounded -- #507 Delphi round-1 C-MAJOR-2)
      _legacy_maven_run mvn pmd:check -P xp-gate-p3c -Dpmd.failOnViolation=true 2>&1 | tail -30
      return "${PIPESTATUS[0]}"
    else
      # Profile not installed. The inline ruleset paths (/rulesets/java/ali-*)
      # resolve INSIDE the p3c-pmd jar — without that dependency in the pom,
      # maven cannot resolve them and exits non-zero, which BLOCKed the commit
      # on every real project without p3c configured (#507 Delphi round-1
      # C-MAJOR-1). "Not configured" is an opt-out, not a violation: only run
      # inline when the pom actually declares p3c-pmd.
      if grep -q 'p3c-pmd' pom.xml 2>/dev/null; then
        _legacy_maven_run mvn pmd:check \
          -Dpmd.rulesets="/rulesets/java/ali-comment.xml,/rulesets/java/ali-concurrent.xml,/rulesets/java/ali-constant.xml,/rulesets/java/ali-exception.xml,/rulesets/java/ali-flowcontrol.xml,/rulesets/java/ali-naming.xml,/rulesets/java/ali-oop.xml,/rulesets/java/ali-orm.xml,/rulesets/java/ali-other.xml,/rulesets/java/ali-set.xml" \
          -Dpmd.failOnViolation=true \
          -DprintFailingErrors=true \
          2>&1 | tail -30
        local result="${PIPESTATUS[0]}"

        if [ "$result" -ne 0 ]; then
          echo ""
          echo "  ⚠️  p3c-pmd check FAILED — Alibaba Coding Guidelines violations found"
          echo "  To permanently enable: bash $PLUGIN_DIR/scripts/install-maven-p3c.sh"
          return 1
        fi

        echo "  ✅ p3c-pmd check passed"
        return 0
      else
        echo "  ℹ️  p3c-pmd not configured in pom.xml — skipping (opt-in, not a violation)"
        echo "  To enable: bash $PLUGIN_DIR/scripts/install-maven-p3c.sh"
        return 0
      fi
    fi

  elif [ "$build_system" = "gradle" ]; then
    if grep -q 'xp-gateP3cCheck\|p3c-pmd' build.gradle 2>/dev/null || \
       grep -q 'xp-gateP3cCheck\|p3c-pmd' build.gradle.kts 2>/dev/null; then
      gradle xp-gateP3cCheck --quiet 2>&1 | tail -20
      return "${PIPESTATUS[0]}"
    else
      echo "  ℹ️  p3c-pmd not configured in Gradle build"
      echo "  To enable: bash $PLUGIN_DIR/scripts/install-gradle-p3c.sh"
      return 0
    fi
  fi

  echo "  ℹ️  No Maven/Gradle project — Skipping p3c-pmd"
  return 0
}

_run_whalecloud_check() {
  local build_system="$1"

  if ! _is_whalecloud_enabled; then
    return 0
  fi

  echo "  Running WhaleCloud Java Coding Standards check..."

  if [ "$build_system" = "maven" ]; then
    if grep -q '<id>xp-gate-whalecloud-java</id>' pom.xml 2>/dev/null; then
      # timeout-guarded, same rationale as the p3c branch (C-MAJOR-2)
      _legacy_maven_run mvn pmd:check checkstyle:check spotbugs:check \
        -P xp-gate-whalecloud-java -Dpmd.failOnViolation=true \
        2>&1 | tail -30
      return "${PIPESTATUS[0]}"
    else
      echo "  ⚠️  whalecloud-java profile not installed in pom.xml"
      echo "  To enable: bash $WHALECLOUD_PLUGIN_DIR/scripts/install-maven-whalecloud.sh"
      return 0
    fi

  elif [ "$build_system" = "gradle" ]; then
    if grep -q 'xp-gateWhalecloudCheck' build.gradle 2>/dev/null || \
       grep -q 'xp-gateWhalecloudCheck' build.gradle.kts 2>/dev/null; then
      gradle xp-gateWhalecloudCheck --quiet 2>&1 | tail -20
      return "${PIPESTATUS[0]}"
    else
      echo "  ⚠️  whalecloud-java not configured in Gradle build"
      echo "  To enable: bash $WHALECLOUD_PLUGIN_DIR/scripts/install-gradle-whalecloud.sh"
      return 0
    fi
  fi

  return 0
}

run_whalecloud_check() {
  _run_whalecloud_check "$(_detect_java_build)"
}

# ---------------------------------------------------------------------------
# GATE 1 entry (#507 S1). wc-java-lint first; legacy chain only on discovery
# miss. The old direct mvn/gradle compile here moved to Build Integrity (S5).
# ---------------------------------------------------------------------------
run_static_analysis() {
  local rc=0
  # `|| rc=$?` (not a bare call): under a set -e consumer a non-zero verdict
  # would otherwise abort the host hook instead of returning the verdict code.
  run_wc_java_lint || rc=$?
  if [ "$rc" -eq 9 ]; then
    echo "ℹ️  wc-java-lint not found - falling back to legacy Java analysis"
    rc=0
    run_legacy_analysis || rc=$?
    return "$rc"
  fi
  return "$rc"
}
