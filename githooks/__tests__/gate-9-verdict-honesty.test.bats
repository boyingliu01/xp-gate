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
  GATE9_CHANGED="$changed" GATE9_TSX="$tsx_outcome" GATE9_LANGS="${3:-typescript java}" \
  GATE9_ROOT="$(cygpath -w "$WORK")" GATE9_AUDIT="$AUDIT_LOG" \
  REPO_DIR="$REPO" bash -c '
    source "$REPO_DIR/githooks/gate-entries/gate-9-entry.sh" 2>/dev/null
    PROJECT_LANG=typescript
    # Gate 9 collects unverified languages by walking PROJECT_LANGS, which
    # pre-commit always sets. The harness must supply it, or that loop is dead
    # code under test and AC-04/05 would pass for the wrong reason.
    PROJECT_LANGS="${GATE9_LANGS:-typescript java}"
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
@test "AC-GATE9-VERDICT-04: a PASS names languages in the change set that were never built" {
  # DEFECT C, the same shape as B one level out.
  #
  # GATE_9_UNVERIFIED is initialised empty with this comment:
  #
  #     Languages present in this change set that the gate cannot check. Empty
  #     means "everything in the change set was either verified or not
  #     applicable"; a value means "this commit contains code nobody built".
  #
  # and the aggregation says:
  #
  #     A PASS that leaves part of the change set unverified is still a PASS --
  #     the unverified language is backlog, not a defect in this commit -- but it
  #     must SAY so.
  #
  # Only the Gradle arm ever sets it. Measured 2026-11-19 on a Go fixture with a
  # deliberate type error (`var x int = "not an int"`):
  #
  #     → Gate 9: Build integrity...
  #          ℹ️  Not a TypeScript project - skipping build integrity check
  #          ⏭️  SKIPPED - Build integrity (not a TypeScript project)
  #     ⏭️  Gate 9 skipped in 0s (nothing was verified)
  #
  # and Gate 13 on the same commit:
  #
  #     ℹ️  No staged C/C++ source files -- nothing to compile
  #     Gate 13 (PASS) completed in 1s
  #
  # So the file did not compile, no gate built it, and nothing said so. The
  # mechanism to say so already existed and was documented; it just was not wired
  # to any language except Java-via-Gradle.
  #
  # The fix is not to add Go support -- it is to make the promise the code
  # already makes true. A TS-only commit keeps its clean tick (AC-03 pins that);
  # a commit carrying a language nobody can build must carry the note.
  printf 'package main\n\nfunc main() { var x int = "not an int"; _ = x }\n' > main.go
  git add -A

  run run_gate9 "src/a.ts main.go" pass "typescript go"

  [[ "$output" == *"NOT verified"* ]] || {
    echo "a Go change passed Gate 9 with no note that Go was never built:"
    printf '%s\n' "$output"
    return 1
  }
  [[ "$output" == *"go"* ]] || {
    echo "the unverified note did not name the language:"
    printf '%s\n' "$output"
    return 1
  }
}

@test "AC-GATE9-VERDICT-05: the unverified note reaches the audit journal, not just the screen" {
  # The comment says the fact "has to reach both the human and the journal".
  # A note that only reaches stdout is invisible to `xp-gate audit`, which is the
  # only thing the tech-debt trackers read -- the #665 lesson from Gate 5.
  printf 'package main\n\nfunc main() { var x int = "not an int"; _ = x }\n' > main.go
  git add -A

  run run_gate9 "src/a.ts main.go" pass "typescript go"

  local journal
  journal=$(cat "$AUDIT_LOG")
  [[ "$journal" == *"go"* ]] || {
    echo "the journal recorded no unverified language; audit log was:"
    printf '%s\n' "$journal"
    return 1
  }
}

@test "AC-GATE9-VERDICT-06: the not-selected SKIP carries its reason into the journal" {
  # GATE_9_DETAIL="not_selected" is assigned and then never used: the audit call
  # one line below omits the detail argument entirely.
  #
  #     GATE_9_STATUS="SKIP"
  #     GATE_9_DETAIL="not_selected"
  #     record_gate_audit "gate-9" "build-integrity" "$GATE_9_STATUS" "0" "$(gate_start_ms)"
  #
  # So the comment above it ("Recorded, not merely printed") is half true: a row
  # is written, but without the reason, which is the half that distinguishes
  # "deselected on purpose" from "the chain never got here". githooks/AGENTS.md
  # is explicit that SKIP must carry why, and that a green row with no reason is
  # a bug rather than a pass.
  #
  # Measured: grep -rn GATE_9_DETAIL finds exactly one line -- the assignment --
  # and shellcheck reports it as SC2034 unused.
  local journal="$BATS_TEST_TMPDIR/j.log"
  : > "$journal"

  G9_AUDIT="$journal" REPO_DIR="$REPO" bash -c '
    source "$REPO_DIR/githooks/gate-entries/gate-9-entry.sh" 2>/dev/null
    gate_enabled() { return 1; }   # gate_9_run asks gate_enabled 9, not XP_GATE_ONLY_GATE
    gate_start_ms() { date +%s%3N; }
    # $6 is the optional detail (see record_gate_audit in githooks/pre-commit).
    record_gate_audit() { printf "%s|%s\n" "$3" "${6:-}" >> "$G9_AUDIT"; }
    XP_GATE_ONLY_GATE=5
    gate_9_run
  ' > /dev/null 2>&1

  local line
  line=$(cat "$journal")
  [[ "$line" == *"not_selected"* ]] || {
    echo "the journal row for a deselected gate carries no reason; row was:"
    printf '%s\n' "$line"
    return 1
  }
}

@test "AC-GATE9-VERDICT-07: a SKIP names the language it could not build" {
  # DEFECT C's last unsaid half. With the Go collection in place the journal and
  # the PASS note both name the language, but on a Go-only commit the gate SKIPs
  # (no TS project, no Java build file), and the SKIP line read:
  #
  #     ⏭️  Gate 9 skipped in 0s (nothing was verified)
  #
  # which is true and unactionable. A docs-only commit and a Go commit that
  # nobody built produced the same line. Measured 2026-11-19: the trace showed
  # GATE_9_UNVERIFIED=go:no_build_integrity_half was correctly computed and then
  # printed nowhere, because the note above only fires for PASS.
  printf 'package main\n\nfunc main() { var x int = "not an int"; _ = x }\n' > main.go
  git add -A
  rm -f src/a.ts package.json tsconfig.json
  git add -A

  run run_gate9 "main.go" pass "go"

  [[ "$output" == *"go"* ]] || {
    echo "a SKIP over a Go change did not name Go:"
    printf '%s\n' "$output"
    return 1
  }
}


@test "AC-GATE9-VERDICT-08: a SKIP with no unbuildable language keeps its plain reason" {
  # Anti-vacuity for AC-07. If every SKIP carried a language list, the note would
  # stop meaning anything -- the failure mode this repository keeps producing when
  # a warning is made unconditional to fix a case where it was missing.
  #
  # The cleanest no-language SKIP is the docs-only commit: Gate 9 short-circuits
  # before any language detection, and its SKIP must stay a plain statement.
  GATE9_DOCS=1 REPO_DIR="$REPO" bash -c '
    source "$REPO_DIR/githooks/gate-entries/gate-9-entry.sh" 2>/dev/null
    PROJECT_LANG=documentation-only
    PROJECT_LANGS=""
    DOCS_ONLY_COMMIT=true
    CHANGED_FILES="README.md"
    gate_enabled() { return 0; }
    gate_start_ms() { date +%s%3N; }
    record_gate_audit() { :; }
    run_tsx() { return 0; }
    gate_9_run
  ' > "$BATS_TEST_TMPDIR/o.txt" 2>&1

  local out
  out=$(cat "$BATS_TEST_TMPDIR/o.txt")
  [[ "$out" == *"nothing was verified"* ]] || {
    echo "a docs-only SKIP lost its plain reason; output was:"
    printf '%s\n' "$out"
    return 1
  }
  [[ "$out" != *"no build-integrity half for"* ]] || {
    echo "a docs-only SKIP invented a language list; output was:"
    printf '%s\n' "$out"
    return 1
  }
}
