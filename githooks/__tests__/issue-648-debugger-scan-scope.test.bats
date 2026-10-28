#!/usr/bin/env bats
# @test REQ-648
# @intent Gate 1's debugger detection scanned every staged .ts/.js path, including
#         dependencies. A project that commits its dependencies (vendoring, a CI
#         fixture using `git add -A`, an accidental commit) then had the
#         dependency's OWN source scanned as project code, and the gate blocked a
#         commit that changed nothing of its own. TypeScript 7.x ships a bare
#         `debugger;` in dist/internal/utils.js, so `npm install typescript` plus
#         `git add -A` was enough to fail a clean commit.
#
#         The fix reuses Gate 2's existing ignore set rather than inventing a
#         second rule, so "what counts as our code" has one definition across the
#         gates. These tests pin BOTH halves: dependencies are filtered, and real
#         project debugger statements still block. A filter that swallowed
#         everything would pass the first half and be a catastrophe, so the
#         anti-vacuity cases here matter more than the filter cases.
# @covers AC-648-01, AC-648-02, AC-648-03, AC-648-04, AC-648-05, AC-648-06

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/jscpd-run.sh"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# The exact filter expression Gate 1 uses, extracted from the hook so these tests
# fail if the hook and this harness ever disagree about the rule. Reading it out
# of pre-commit (rather than restating it here) is what makes the test pin the
# real implementation instead of a copy of it.
debug_filter_source() {
  awk '/# Debug statement detection \(debugger statement in JS\/TS\)/,/^    if \[ -n "\$TS_DEBUG_FILES" \]/' "$HOOK" \
    | sed -n '/TS_DEBUG_FILES=\$(echo/,/^    if \[ -n/p' \
    | sed '$d'
}

# Runs Gate 1's path filter over a newline-separated list, in a subshell that has
# the ignore-set library loaded exactly as the hook does.
#
# Prints nothing when everything was filtered: `printf '%s\n' "$TS_DEBUG_FILES"`
# would emit a single newline for the empty string, so a test asserting `""` would
# compare against "\n" and mis-read a working filter as a leak. Command
# substitution strips trailing newlines, but printing the empty variable still
# produces one — hence the explicit guard. The hook itself is unaffected: it
# tests `[ -n "$TS_DEBUG_FILES" ]`, which is false for both "" and "\n".
filter_paths() {
  (
    source "$LIB"
    CHANGED_FILES="$1"
    eval "$(debug_filter_source)" 2>/dev/null
    [ -n "$TS_DEBUG_FILES" ] && printf '%s\n' "$TS_DEBUG_FILES"
    exit 0
  )
}

@test "AC-648-01: a dependency's own debugger statement is filtered out of the scan" {
  # The regression from the issue: node_modules/typescript/dist/internal/utils.js
  out="$(filter_paths 'node_modules/typescript/dist/internal/utils.js')"
  [ "$out" = "" ]
}

@test "AC-648-02: project source is still scanned (the gate is not weakened)" {
  # ANTI-VACUITY. If the filter swallowed everything, AC-648-01 would also pass
  # and the gate would silently stop working. This is the case that must NOT be
  # filtered, and it is what the whole gate exists for.
  out="$(filter_paths 'src/app.ts')"
  [ "$out" = "src/app.ts" ]
}

@test "AC-648-03: a mixed list keeps the project files and drops the dependency ones" {
  out="$(filter_paths 'node_modules/typescript/dist/internal/utils.js
src/app.ts
node_modules/other/index.js
lib/util.tsx')"
  [ "$out" = "src/app.ts
lib/util.tsx" ]
}

@test "AC-648-04: build output directories are filtered for the same reason" {
  # dist/build/coverage/out/.next/.nuxt/vendor/target are all in Gate 2's ignore
  # set. A build artifact carrying a debugger statement is not a committed
  # debugging aid, and two gates disagreeing about what a build artifact is would
  # be its own defect.
  out="$(filter_paths 'dist/bundle.js
build/app.js
coverage/report.js
out/gen.ts
target/classes/x.js')"
  [ "$out" = "" ]
}

@test "AC-648-05: XP_GATE_JSCPD_DEFAULT_IGNORE=0 restores the old whole-tree scan" {
  # The escape hatch has to keep working, and its scope is now wider than Gate 2:
  # it governs both gates. Pinned so the widening is a decision, not a surprise.
  out="$( XP_GATE_JSCPD_DEFAULT_IGNORE=0 filter_paths 'node_modules/typescript/dist/internal/utils.js' )"
  [ "$out" = "node_modules/typescript/dist/internal/utils.js" ]
}

@test "AC-648-06: paths containing spaces survive the filter" {
  # The hook changed the grep input to NUL-delimited for exactly this, so the
  # filter must not reintroduce word-splitting upstream of it.
  out="$(filter_paths 'my dir/app file.ts')"
  [ "$out" = "my dir/app file.ts" ]
}
