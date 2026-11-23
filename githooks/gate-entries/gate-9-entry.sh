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
if ! gate_enabled 9; then
  # Recorded, not merely printed: this arm set the status and returned with no
  # journal line, so wherever XP_GATE_ONLY_GATE selects a subset, "deselected on
  # purpose" and "not part of this chain" were identical to every audit consumer.
  echo "⏭️  SKIPPED - Gate 9: Build integrity (not selected by XP_GATE_ONLY_GATE)"
  GATE_9_STATUS="SKIP"
  GATE_9_DETAIL="not_selected"
  # The detail was assigned and then dropped: this call omitted the sixth
  # argument, so `grep -rn GATE_9_DETAIL` found exactly one line -- the
  # assignment -- and shellcheck flagged it SC2034. The row was written, but
  # without the reason, which is the half that separates "deselected on purpose"
  # from "the chain never reached here". githooks/AGENTS.md: a SKIP row with no
  # reason is a bug, not a pass.
  record_gate_audit "gate-9" "build-integrity" "$GATE_9_STATUS" "0" "$(gate_start_ms)" "$GATE_9_DETAIL"
  return 0
fi

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
# Languages present in this change set that the gate cannot check. Empty means
# "everything in the change set was either verified or not applicable"; a value
# means "this commit contains code nobody built". Initialised empty rather than
# left unset so the PASS warning below is safe under `set -u`.
GATE_9_UNVERIFIED=""

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
    # CHANGED_FILES is NEWLINE-separated (gate-0-entry.sh builds it with
    # printf '%s\n'). This used to be `tr ' ' ','`, which did neither half of
    # that correctly:
    #
    #   - it never converted the actual separator, so every newline survived
    #     into the argument the checker received (splitChangedFiles only splits
    #     on ','), and
    #   - it converted any space INSIDE a path, so "src/my file.ts" arrived as
    #     the two fragments "src/my" and "file.ts" -- neither of which exists.
    #
    # Measured: `--changed-files "src/my file.ts"` reached the checker as
    # "src/my,file.ts" and the import scan reported a file it had never opened.
    # The tsc half is unaffected (it compiles from projectRoot, not from this
    # list), which is why the defect never blocked anything -- the import check
    # simply stopped covering the file.
    CHANGED_FILES_CSV=$(printf '%s' "$CHANGED_FILES" | tr '\n' ',')
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
        # DO NOT `return 1` here.
        #
        # This used to return immediately, which skipped the aggregation at the
        # bottom of this file AND the record_gate_audit call below it. The commit
        # was still blocked (the driver saw the non-zero return), but the run
        # report kept GATE_9_STATUS at its initialised "SKIP" and the audit line
        # recorded SKIP too.
        #
        # Measured 2026-11-19 on a TypeScript fixture with `const x: number =
        # "not a number"`:
        #
        #     stdout : tsc: FAIL  TypeScript compilation failed with 1 error(s)
        #              BLOCKED - Gate 9: Build integrity check failed
        #     report : gate9_build_integrity.status = "SKIP"
        #              overall.gatesFailed = 0, failedGates = []
        #
        # So the gate blocked correctly and recorded the opposite. Every
        # downstream reader -- the report, the audit journal, gate-coverage --
        # saw a skip.
        #
        # The aggregation below turns GATE_9_TS_STATUS=BLOCK into
        # GATE_9_STATUS=BLOCK, and gate_9_run returns non-zero from there, so the
        # commit is still blocked; only now the record agrees with the behaviour.
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
        # Same defect as the TypeScript branch above: returning here skipped the
        # aggregation and the audit record, so a blocked Java build was written to
        # the report as SKIP. Falling through lets GATE_9_JAVA_STATUS=BLOCK reach
        # the aggregation, which produces the non-zero return.
        ;;
      *)
        GATE_9_JAVA_STATUS="SKIP"
        echo "     ⏭️  SKIPPED - Build integrity Java (see reason above)"
        ;;
    esac
  elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    # This arm printed a warning and set NOTHING. GATE_9_JAVA_STATUS kept its
    # initial "SKIP", which the aggregation below cannot distinguish from "Java
    # was not part of this change". Measured on a TS+Gradle fixture: tsc passed,
    # the Java half was never built, and the gate reported PASS with no line
    # saying that a language in the change set went unverified.
    #
    # Gradle support is genuinely backlog (#507 DR-003), so this must not block.
    # But "we could not check your Java" is a different fact from "nothing to
    # check", and it has to reach both the human and the journal.
    GATE_9_JAVA_STATUS="SKIP"
    GATE_9_UNVERIFIED="java:gradle_unsupported"
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
#
# DEFECT C: GATE_9_UNVERIFIED promised more than it delivered. Its comment says
# "a value means 'this commit contains code nobody built'", and the aggregation
# below says an unverified part "must SAY so" -- but only the Gradle arm ever set
# it. Measured 2026-11-19 on a Go fixture with a deliberate type error
# (`var x int = "not an int"`): Gate 9 skipped with "Not a TypeScript project",
# Gate 13 passed with "No staged C/C++ source files", and no gate built the file.
#
# Collected HERE, driven by PROJECT_LANGS rather than by listing the languages
# this gate cannot build: such a list can only cover what someone remembered,
# which is how the defect arose. Every language in the change set that is not one
# of the two halves that can run is, by definition, unverified.
#
# --- What this block does NOT do, and why ---
#
# githooks/AGENTS.md forbids hand-maintained language lists, and the extension
# table below looks like one. It is a deliberate exception with a named cost, so
# it is written down rather than discovered later:
#
#   * PROJECT_LANGS is the authority for WHICH languages exist in this repo, and
#     the loop is driven by it. A language missing from the table cannot be
#     invented here; at worst one that IS present gets no note.
#   * The table only maps language -> extension for languages already in
#     PROJECT_LANGS. It cannot route work to an adapter -- the drift that rule
#     exists to prevent. A new adapter that is added to PROJECT_LANGS but not
#     here degrades to "no unverified note for that language", which is the
#     PRE-EXISTING behaviour, not a new failure.
#   * The real extension authority is src/npm-package/lib/language-tools.js,
#     which is JavaScript and reachable only from the CLI. Calling node from this
#     bash hot path to read it would cost a process spawn (measured >150ms cold
#     on this machine) on every commit, to improve a message. That trade is
#     wrong for a gate on the commit path.
#
# Known cost: a future adapter's extension must be added here or its commits get
# no unverified note. AC-GATE9-VERDICT-04/05 pin the behaviour for go; the
# fallback `*)` arm below is what keeps an unknown language from producing a
# meaningless blanket warning.
#
# Scoped to the CHANGE SET, not the project: a repo that happens to contain a
# .py file must not warn on a TypeScript-only commit. AC-GATE9-VERDICT-03 pins
# that a fully verified change carries no note.
if [ "${DOCS_ONLY_COMMIT:-false}" != "true" ]; then
  for _g9_lang in $PROJECT_LANGS; do
    case "$_g9_lang" in
      typescript|java) continue ;;   # these have real halves above
    esac
    # Only when the change set actually touches that language.
    case "$_g9_lang" in
      python)      _g9_rx='\.py$' ;;
      go)          _g9_rx='\.go$' ;;
      rust)        _g9_rx='\.rs$' ;;
      csharp)      _g9_rx='\.cs$' ;;
      cpp|c)       _g9_rx='\.(c|cc|cpp|cxx|h|hpp)$' ;;
      kotlin)      _g9_rx='\.kts?$' ;;
      swift)       _g9_rx='\.swift$' ;;
      dart)        _g9_rx='\.dart$' ;;
      php)         _g9_rx='\.php$' ;;
      ruby)        _g9_rx='\.rb$' ;;
      shell)       _g9_rx='\.(sh|bash)$' ;;
      powershell)  _g9_rx='\.ps1$' ;;
      objectivec)  _g9_rx='\.m$' ;;
      iac)         _g9_rx='\.(tf|tfvars)$' ;;
      *)           _g9_rx="" ;;
    esac
    # An unrecognised language with no pattern cannot be confirmed absent, and
    # claiming "unverified" for every language would make the note meaningless.
    [ -n "$_g9_rx" ] || continue
    if printf '%s\n' "${CHANGED_FILES:-}" | grep -qE "$_g9_rx"; then
      GATE_9_UNVERIFIED="${GATE_9_UNVERIFIED:+${GATE_9_UNVERIFIED}, }${_g9_lang}:no_build_integrity_half"
    fi
  done
  unset _g9_lang _g9_rx
fi

GATE_9_STATUS="SKIP"
if [ "$GATE_9_TS_STATUS" = "PASS" ] || [ "$GATE_9_JAVA_STATUS" = "PASS" ]; then
  GATE_9_STATUS="PASS"
fi
if [ "$GATE_9_TS_STATUS" = "BLOCK" ] || [ "$GATE_9_JAVA_STATUS" = "BLOCK" ]; then
  GATE_9_STATUS="BLOCK"
fi
# A SKIP must carry a reason. Measured 2026-11-23: all 19 gate-9 SKIP records in
# .xp-gate/audit.jsonl had an empty reason, which makes the row indistinguishable
# from "this gate decided nothing was needed" and from "the gate is broken".
# The reason is only empty because this gate's two halves are TypeScript and Java:
# a change set carrying neither has nothing for it to build, and that is the
# honest answer. Recording it turns a blank into a statement.
if [ "$GATE_9_STATUS" = "SKIP" ] && [ -z "${GATE_9_UNVERIFIED:-}" ]; then
  GATE_9_UNVERIFIED="no_change_needing_build_integrity"
fi
# A PASS that leaves part of the change set unverified is still a PASS -- the
# unverified language is backlog, not a defect in this commit -- but it must SAY
# so. This is the same rule as everywhere else in this hook: never let the
# absence of a verdict read as a positive one.
if [ "$GATE_9_STATUS" = "PASS" ] && [ -n "${GATE_9_UNVERIFIED:-}" ]; then
  echo "     ⚠️  Gate 9 PASSED for the languages it can check; NOT verified: ${GATE_9_UNVERIFIED}"
fi

GATE_9_END=$(gate_start_ms)
GATE_9_DURATION_MS=$((GATE_9_END - GATE_9_START))
GATE_9_DURATION=$((GATE_9_DURATION_MS / 1000))
# The tick used to be unconditional: `✅ Gate 9 completed` printed even when the
# gate had just announced "not a TypeScript project - skipping". Measured on a
# Python-only fixture:
#     ℹ️  Not a TypeScript project - skipping build integrity check
#     ⏭️  SKIPPED - Build integrity (not a TypeScript project)
#     ✅ Gate 9 completed in 0s
# status=SKIP
# Two lines of "skipped" followed by a green tick is the exact shape this
# codebase keeps having to remove: the journal said SKIP while the last line the
# human reads said success. The tick now follows the verdict it summarises.
case "$GATE_9_STATUS" in
  PASS) echo "✅ Gate 9 completed in ${GATE_9_DURATION}s" ;;
  # The SKIP line must name the languages it could not build, when there are any.
  # "nothing was verified" is true but not actionable: on a Go commit it does not
  # say WHICH language went unchecked, and the reader has no way to tell this
  # apart from a docs-only commit where there was genuinely nothing to build.
  # GATE_9_UNVERIFIED is already computed for the PASS note above and the journal;
  # the SKIP line was the one place it still went unsaid.
  SKIP)
    if [ -n "${GATE_9_UNVERIFIED:-}" ]; then
      echo "⏭️  Gate 9 skipped in ${GATE_9_DURATION}s — no build-integrity half for: ${GATE_9_UNVERIFIED}"
    else
      echo "⏭️  Gate 9 skipped in ${GATE_9_DURATION}s (nothing was verified)"
    fi
    ;;
  *)    echo "❌ Gate 9 blocked in ${GATE_9_DURATION}s" ;;
esac
record_gate_audit "gate-9" "build-integrity" "$GATE_9_STATUS" "0" "$GATE_9_START" "${GATE_9_UNVERIFIED:-}"
echo ""
# ============================================================================
  # Return what the aggregated status says.
  #
  # This was an unconditional `return 0` -- safe only because the two BLOCK
  # branches bailed out with their own `return 1` before reaching here. Those
  # early returns skipped the aggregation and the audit record, so the report and
  # the journal recorded SKIP for a commit that was correctly blocked.
  #
  # Removing the early returns without changing this line would have been worse:
  # the gate would have printed "BLOCKED" and returned success. Both halves move
  # together, which is why the tests pin the RECORDED status and the RETURN CODE,
  # not either one alone.
  [ "$GATE_9_STATUS" = "BLOCK" ] && return 1
  return 0
}



# Called by pre-commit's ordered driver.

