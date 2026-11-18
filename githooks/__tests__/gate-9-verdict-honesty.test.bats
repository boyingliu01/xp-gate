#!/usr/bin/env bats
#
# @test REQ-GATE9-VERDICT-HONESTY
# @intent Gate 9 could report PASS while never building one of the languages in
#         the change set, and it could print a green tick over its own SKIP.
#
#         DEFECT A -- the tick was unconditional:
#
#             echo "✅ Gate 9 completed in ${GATE_9_DURATION}s"
#
#         Measured on a Python-only fixture, whose entire output was:
#
#             ℹ️  Not a TypeScript project - skipping build integrity check
#             ⏭️  SKIPPED - Build integrity (not a TypeScript project)
#             ✅ Gate 9 completed in 0s
#             status=SKIP
#
#         Two lines saying "skipped" followed by a green tick. The journal was
#         right and the last line a human reads was wrong -- the defect family
#         this repo has removed from four other gates.
#
#         DEFECT B -- the Gradle arm set no status at all:
#
#             elif [ -f "build.gradle" ]; then
#               echo "⚠️  ... Gradle is not implemented yet"
#               echo "⏭️ SKIPPED ..."
#             fi
#
#         GATE_9_JAVA_STATUS kept its initial "SKIP", which the aggregation
#         cannot distinguish from "Java was not in this change". Measured on a
#         TS+Gradle fixture: tsc passed, the Java half was never built, and the
#         gate reported PASS with nothing saying a language went unverified.
#
#         Gradle support is genuinely backlog (#507 DR-003), so the correct fix
#         is NOT to block -- it is to make "could not check your Java" reach both
#         the human and the journal, instead of silently folding into a pass.
#
#         These tests drive gate_9_run with stubs so the verdict logic is
#         exercised without spawning tsc or mvn.
#
# @covers AC-GATE9-VERDICT-01 AC-GATE9-VERDICT-02 AC-GATE9-VERDICT-03
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WORK="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$WORK/src"
  cd "$WORK" || return 1
  git init -q .
  node -e "require('fs').writeFileSync('package.json', JSON.stringify({name:'t',version:'1.0.0'}))"
  node -e "require('fs').writeFileSync('tsconfig.json', JSON.stringify({compilerOptions:{noEmit:true},include:['src/**/*.ts']}))"
  printf 'export const ok = 1;\n' > src/a.ts
  printf 'class A {}\n' > A.java
  # Gate 9 locates its checker at $PROJECT_ROOT/src/build-integrity/gate-10.ts and
  # takes the "script not found" SKIP arm when it is absent. Without this
  # placeholder the fixture would never reach the TS half at all, so every
  # assertion below would be made against a gate that had already skipped for an
  # unrelated reason -- passing for the wrong cause. run_tsx is stubbed, so this
  # file is never executed.
  mkdir -p src/build-integrity
  printf '// placeholder: run_tsx is stubbed in these tests\n' > src/build-integrity/gate-10.ts
  git add -A
  AUDIT_LOG="$BATS_TEST_TMPDIR/audit.log"
  : > "$AUDIT_LOG"
}

# Drive gate_9_run with every external dependency stubbed.
#   $1 = space separated changed files
#   $2 = "pass" or "fail" for the tsx half
run_gate9() {
  local changed="$1" tsx_outcome="$2"
  # gate_9_run reads PROJECT_ROOT through to_native_path, so the stub must pass
  # the real path through unchanged rather than re-resolving it.
  GATE9_CHANGED="$changed" GATE9_TSX="$tsx_outcome" \
  GATE9_ROOT="$(cygpath -w "$WORK")" GATE9_AUDIT="$AUDIT_LOG" \
  REPO_DIR="$REPO" bash -c '
    source "$REPO_DIR/githooks/gate-entries/gate-9-entry.sh" 2>/dev/null
    PROJECT_LANG=typescript
    DOCS_ONLY_COMMIT=false
    PROJECT_ROOT="$GATE9_ROOT"
    CHANGED_FILES="$GATE9_CHANGED"
    gate_enabled() { return 0; }
    to_native_path() { printf "%s" "$1"; }
    gate_start_ms() { date +%s%3N; }
    record_gate_audit() { printf "%s|%s\n" "$3" "${6:-}" >> "$GATE9_AUDIT"; }
    # Stub the toolchain resolver so no real tsx/esbuild spawn happens.
    run_tsx() {
      printf "Gate 10: Build Integrity Check\n"
      [ "$GATE9_TSX" = "pass" ] && return 0
      return 1
    }
    gate_9_run
  ' 2>&1
}

@test "AC-GATE9-VERDICT-01: a SKIP does not print a green tick" {
  printf 'plugins { id "java" }\n' > build.gradle
  rm -f package.json tsconfig.json
  git add -A

  run run_gate9 "A.java" pass

  [[ "$output" != *"✅ Gate 9 completed"* ]] || {
    echo "a skipped gate still printed the success tick; output was:"
    printf '%s\n' "$output"
    return 1
  }
  [[ "$output" == *"skipped"* ]]
}

@test "AC-GATE9-VERDICT-02: an unbuilt Java half is named in a PASS" {
  # TS half passes; the Java half cannot build under Gradle.
  printf 'plugins { id "java" }\n' > build.gradle
  git add -A

  run run_gate9 "src/a.ts A.java" pass

  [[ "$output" == *"PASSED"* ]] || { echo "expected the gate to still pass"; return 1; }
  [[ "$output" == *"NOT verified"* ]] || {
    echo "PASS did not say that the Java half went unverified; output was:"
    printf '%s\n' "$output"
    return 1
  }
  grep -q 'gradle_unsupported' "$AUDIT_LOG" || {
    echo "the journal did not record why Java went unverified: $(cat "$AUDIT_LOG")"
    return 1
  }
}

@test "AC-GATE9-VERDICT-03: a fully verified change carries no unverified note" {
  # The companion: a warning that fires on every commit would be ignored, and
  # this note is only useful if it means something when it appears.
  rm -f A.java build.gradle
  git add -A

  run run_gate9 "src/a.ts" pass

  # A clean PASS prints the tick, not a "PASSED" line -- that line exists only
  # to carry the unverified note. Assert the tick, which is the real contract.
  [[ "$output" == *"Gate 9 completed"* ]] || {
    echo "expected a clean PASS to tick; output was:"
    printf '%s\n' "$output"
    return 1
  }
  [[ "$output" != *"NOT verified"* ]] || {
    echo "a TypeScript-only commit reported unverified languages:"
    printf '%s\n' "$output"
    return 1
  }
}