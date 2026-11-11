#!/usr/bin/env bash
# ============================================================================
# gate-9 entry — extracted from pre-commit by scripts/extract-gates.cjs
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
# GATE 9: Build Integrity Check (TypeScript compilation + package + imports)
# ============================================================================

# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_9_run() {
# Java build-integrity dispatch (#507 S5, DR-003). The old gate only knew
# TypeScript: a Maven project got a permanent SKIP -- "not a TypeScript
# project" -- which is exactly the silent-no-coverage path this sprint
# removes. Verdict codes (mirror of the java.sh G1 contract):
#   0=PASS 2=BLOCK(compile failed) 3=SKIP+WARN(reason printed)
resolve_build_integrity_timeout() {
  local file=".xp-gate/build-integrity-timeout" val=""
  if [ -f "$file" ]; then
    val=$(tr -d '[:space:]' < "$file")
  fi
  if [ -z "$val" ]; then
    echo "180"
    return 0
  fi
  case "$val" in
    ''|*[!0-9]*|0)
      echo "WARN - invalid $file value '${val}' (expected a positive integer), falling back to 180s" >&2
      echo "180"
      ;;
    *) echo "$val" ;;
  esac
}

# (#708) A Java build failure has one overwhelmingly common cause that the gate
# used to say nothing about: the wrong JDK. The real reason is buried in the last
# 20 lines of Maven output, while the gate's own verdict line was only
# "❌ Java build failed (exit 1)".
#
# Measured: a pom with <maven.compiler.release>8</maven.compiler.release> built
# with JDK 8 fails with "无效的标记: --release" (invalid flag: --release) — a
# message that points at the compiler ARGUMENTS and at the project CONFIG while
# actually pointing at the JDK on PATH. Getting from that message to "change the
# JDK" takes one inference, and the gate's verdict line supplied no premise for
# it. The person debugging this suspected the release setting, then the plugin
# version, then .mvn/jvm.config — all wrong; the fix was a different JDK.
#
# So: on failure, print what JDK actually ran, what the project asks for, and —
# when the output carries the tell — state the conclusion instead of the symptom.
# Diagnostics must never change the verdict; this only adds lines.
java_bi_report_jdk_context() {
  local build_out="$1"
  local java_version="" java_home_val="${JAVA_HOME:-}"
  # `java -version` writes to stderr on every JDK. Take the version line verbatim
  # rather than parsing it: this is a diagnostic, and the raw line is what a
  # person would paste into a bug report.
  if command -v java >/dev/null 2>&1; then
    java_version=$(java -version 2>&1 | sed -n '1p')
  fi
  if [ -n "$java_version" ]; then
    echo "     JDK in use: ${java_version}"
  else
    echo "     JDK in use: (java not on PATH)"
  fi
  if [ -n "$java_home_val" ]; then
    echo "     JAVA_HOME: ${java_home_val}"
  else
    echo "     JAVA_HOME: (unset)"
  fi

  # What the project requires. Maven declares it three ways; Gradle declares it in
  # its build script. Report whichever exists — the comparison is the user's, but
  # only if both halves are visible.
  local declared=""
  if [ -f "pom.xml" ]; then
    local mvn_release mvn_source
    mvn_release=$(grep -o '<maven\.compiler\.release>[[:space:]]*[0-9][0-9]*' pom.xml 2>/dev/null \
      | sed 's/.*>[[:space:]]*//' | head -1)
    mvn_source=$(grep -o '<maven\.compiler\.source>[[:space:]]*[0-9][0-9]*' pom.xml 2>/dev/null \
      | sed 's/.*>[[:space:]]*//' | head -1)
    if [ -n "$mvn_release" ]; then
      declared="maven.compiler.release=${mvn_release}"
    elif [ -n "$mvn_source" ]; then
      declared="maven.compiler.source=${mvn_source}"
    fi
  fi
  if [ -z "$declared" ] && [ -f "build.gradle" ]; then
    local g_compat
    g_compat=$(grep -o "sourceCompatibility[[:space:]]*=[[:space:]]*['\"]\{0,1\}[0-9][0-9]*" build.gradle 2>/dev/null \
      | sed "s/.*[=][[:space:]]*['\"]\{0,1\}//" | head -1)
    [ -n "$g_compat" ] && declared="sourceCompatibility=${g_compat}"
  fi
  if [ -z "$declared" ] && [ -f "build.gradle.kts" ]; then
    local k_compat
    k_compat=$(grep -o 'sourceCompatibility[[:space:]]*=[[:space:]]*JavaVersion\.VERSION_[0-9_]*' build.gradle.kts 2>/dev/null \
      | sed 's/.*VERSION_//' | tr '_' '.' | head -1)
    [ -n "$k_compat" ] && declared="sourceCompatibility=${k_compat}"
  fi

  if [ -n "$declared" ]; then
    echo "     Project requires: ${declared}"
  else
    echo "     Project requires: (no JDK floor declared in pom.xml/build.gradle)"
  fi

  # The tell. `--release` only exists from JDK 9, so its rejection is a direct
  # statement about the JDK, not about the pom. Saying so converts a search into
  # a fix.
  case "$build_out" in
    *--release*)
      if printf '%s' "$build_out" | grep -qiE 'invalid flag|无效的标记|illegal option|unrecognized|unknown option'; then
        echo "     💡 The build passed '--release' to javac and the JDK rejected it."
        echo "        '--release' requires JDK 9 or newer; the JDK above is older than that."
        echo "        Switch to a JDK >= 9 (or remove the release/source setting if it is not intended)."
      fi
      ;;
  esac
}

run_java_build_integrity() {
  local timeout_s build_bin
  # Wrapper first: mvnw pins the project's own Maven version.
  if [ -x "./mvnw" ]; then
    build_bin="./mvnw"
  elif command -v mvn >/dev/null 2>&1; then
    build_bin="mvn"
  else
    echo "     ⚠️  Java changes staged but no Maven build tool found (mvnw/mvn)"
    echo "     ⏭️  SKIPPED - Build integrity Java (no build tool)"
    return 3
  fi

  timeout_s=$(resolve_build_integrity_timeout)
  # (#708) Keep the output: the failure branch has to read it to tell a wrong-JDK
  # failure from any other one. Displayed through `tail -20` exactly as before, so
  # the visible build log is unchanged.
  local bi_out
  if command -v timeout >/dev/null 2>&1; then
    bi_out=$(timeout "$timeout_s" "$build_bin" -q -DskipTests compile 2>&1)
  else
    bi_out=$("$build_bin" -q -DskipTests compile 2>&1)
  fi
  local rc=$?
  printf '%s\n' "$bi_out" | tail -20
  if [ "$rc" -eq 0 ]; then
    echo "     ✅ Java build integrity verified (mvn -q -DskipTests compile)."
    return 0
  fi
  if [ "$rc" -eq 124 ]; then
    echo "     ⏱️  Java build timed out after ${timeout_s}s."
    echo "     ⏭️  SKIPPED - Build integrity Java (timeout)"
    return 3
  fi
  echo "     ❌ Java build failed (exit $rc)"
  java_bi_report_jdk_context "$bi_out"
  return 2
}

2>&1 echo ""
2>&1 echo "→ Gate 9: Build integrity... "
GATE_9_START=$(gate_start_ms)
# Sub-status aggregation (#507 Delphi round-1 B-MAJOR-4): each half records
# its own outcome; GATE_9_STATUS is aggregated after both. The previous
# single-variable design made a Maven-only repo (TS half never runs, Java
# half passes) record an ETERNAL SKIP -- a real compile verification that
# never appeared as PASS, contradicting S5's own motivation.
GATE_9_TS_STATUS="SKIP"
GATE_9_JAVA_STATUS="SKIP"
GATE_9_STATUS="SKIP"

if [ "$DOCS_ONLY_COMMIT" = true ]; then
  # REQ-F2: tsc cannot observe a markdown edit. The commit-level docs-only
  # verdict was already consulted by Gates 2 and 5 but not here, so a pure docs
  # commit still paid ~11s for a compile that had nothing new to compile.
  # Recorded as SKIP (not PASS): nothing was verified.
  GATE_9_TS_STATUS="SKIP"
  GATE_9_JAVA_STATUS="SKIP"
  echo "   ⏭️  SKIPPED - Build integrity (docs-only commit)."
elif [ "$PROJECT_LANG" = "documentation-only" ]; then
  echo "   ⏭️  SKIPPED - Build integrity (documentation project)."
elif [ -f "package.json" ] && [ -f "tsconfig.json" ]; then
  GATE_9_SCRIPT=""
  if [ -f "$PROJECT_ROOT/src/build-integrity/gate-10.ts" ]; then
    GATE_9_SCRIPT="$PROJECT_ROOT/src/build-integrity/gate-10.ts"
  elif [ -f ".xp-gate/modules/build-integrity/gate-10.ts" ]; then
    GATE_9_SCRIPT=".xp-gate/modules/build-integrity/gate-10.ts"
  elif [ -f "$HOME/.config/xp-gate/modules/build-integrity/gate-10.ts" ]; then
    GATE_9_SCRIPT="$HOME/.config/xp-gate/modules/build-integrity/gate-10.ts"
  fi

  # #581: the script path goes to node.exe. On WSL $HOME is /home/<user>, which node.exe
  # resolves to <current drive>:\home\<user>\... -- module not found -- and Gate 9 then
  # reported "Build integrity check failed" with advice to fix type errors in the USER'S
  # code. Convert the path first so the failure, if any, is a real one.
  if [ -n "$GATE_9_SCRIPT" ]; then
    GATE_9_SCRIPT=$(to_native_path "$GATE_9_SCRIPT")
  fi
  # Same for the project root, which reaches both node and tsx as an absolute path.
  GATE_9_PROJECT_ROOT=$(to_native_path "$PROJECT_ROOT")

  if [ -n "$GATE_9_SCRIPT" ]; then
    CHANGED_FILES_CSV=$(echo "$CHANGED_FILES" | tr ' ' ',')
    GATE_9_OUTPUT=$(mktemp)
    if RUN_TSX_TIMEOUT=120s run_tsx "$GATE_9_SCRIPT" --changed-files "$CHANGED_FILES_CSV" --project-root "$GATE_9_PROJECT_ROOT" --timeout 115000 > "$GATE_9_OUTPUT" 2>&1; then
      GATE_9_TS_STATUS="PASS"
      echo "     ✅ Build integrity check passed."
    else
      GATE_9_EXIT=$?
      if [ $GATE_9_EXIT -eq 124 ]; then
        GATE_9_TS_STATUS="SKIP"
        echo "     ⏱️  Build integrity check timed out (120s). SKIPPED."
      else
        GATE_9_TS_STATUS="BLOCK"
        cat "$GATE_9_OUTPUT"
        echo ""
        echo "❌ BLOCKED - Gate 9: Build integrity check failed"
        echo "Fix type errors, broken imports, or package manifest issues before committing."
        rm -f "$GATE_9_OUTPUT"
        return 1
      fi
    fi
    rm -f "$GATE_9_OUTPUT"
  else
    echo "     ℹ️  Build integrity script not found - skipping"
    echo "     ⏭️  SKIPPED - Build integrity (gate-10.ts not available)"
  fi
else
  echo "     ℹ️  Not a TypeScript project - skipping build integrity check"
  echo "     ⏭️  SKIPPED - Build integrity (not a TypeScript project)"
fi

# Java dispatch (#507 S5): runs when .java files are staged, regardless of
# whether the TypeScript half ran. Gradle-only repos SKIP+WARN (gradle
# support is backlog; DR-003).
if echo "$CHANGED_FILES" | grep -q '\.java$'; then
  if [ -f "pom.xml" ]; then
    JAVA_BI_EXIT=0
    run_java_build_integrity || JAVA_BI_EXIT=$?
    case "$JAVA_BI_EXIT" in
      0)
        GATE_9_JAVA_STATUS="PASS"
        ;;
      2)
        GATE_9_JAVA_STATUS="BLOCK"
        echo ""
        echo "❌ BLOCKED - Gate 9: Java build integrity check failed"
        echo "Fix the compile errors before committing."
        return 1
        ;;
      *)
        GATE_9_JAVA_STATUS="SKIP"
        echo "     ⏭️  SKIPPED - Build integrity Java (see reason above)"
        ;;
    esac
  elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    echo "     ⚠️  Java changes staged but this is a Gradle project - build integrity for Gradle is not implemented yet"
    echo "     ⏭️  SKIPPED - Build integrity Java (Gradle backlog, #507 DR-003)"
  else
    echo "     ℹ️  Java changes staged but no Maven/Gradle build file - skipping Java build integrity"
  fi
fi

# Aggregate the two halves (#507 Delphi round-1 B-MAJOR-4): PASS when every
# half that RAN passed (TS PASS + Java SKIP, or vice versa, both count),
# SKIP only when NOTHING ran, BLOCK on any failure (normally unreachable --
# failing halves exit 1 inline). This replaces the blind-review MINOR-1
# single-variable guard: with explicit sub-statuses a Java PASS no longer
# "resurrects" a TS SKIP -- each half keeps its own record and the gate
# reflects the union of what was actually verified.
GATE_9_STATUS="SKIP"
if [ "$GATE_9_TS_STATUS" = "PASS" ] || [ "$GATE_9_JAVA_STATUS" = "PASS" ]; then
  GATE_9_STATUS="PASS"
fi
if [ "$GATE_9_TS_STATUS" = "BLOCK" ] || [ "$GATE_9_JAVA_STATUS" = "BLOCK" ]; then
  GATE_9_STATUS="BLOCK"
fi

GATE_9_END=$(gate_start_ms)
GATE_9_DURATION_MS=$((GATE_9_END - GATE_9_START))
GATE_9_DURATION=$((GATE_9_DURATION_MS / 1000))
echo "✅ Gate 9 completed in ${GATE_9_DURATION}s"
record_gate_audit "gate-9" "build-integrity" "$GATE_9_STATUS" "0" "$GATE_9_START"
echo ""
# ============================================================================
  return 0
}



# Called by pre-commit's ordered driver.

