#!/usr/bin/env bats
# @test REQ-870
# @intent Gate 2 skipped entirely when a commit touched a non-ASCII filename (#870).
#
#         `git diff --cached --name-only` honours `core.quotepath` (default true)
#         and prints a staged "docs/验证.md" as "docs/\351\252\214\350\257\201.md"
#         with surrounding quotes. That string is not a path. Gate 0 published it
#         as CHANGED_FILES, and every gate downstream treated it as a real file:
#
#             jscpd: "Error: path does not exist: docs/\351\252\214..." -> exit 1
#             Gate 2: "SKIPPED - Duplicate code (jscpd run error)"
#
#         jscpd abandons the whole run on the first missing path, so the commit's
#         ordinary files were not scanned either. Measured: a commit touching
#         good.js and 验证.js reported `⏭️ SKIPPED`, with ZERO files examined --
#         neither file checked, and no error naming the ordinary one.
#
#         Gates 0 and 1 read the same CHANGED_FILES but filter with
#         `grep -E '\.(ts|js)$'`, which simply never matches an escaped name: the
#         same miss, silent. jscpd is only where it became visible.
#
#         The fix belongs where the list is built -- one place, so a scanner added
#         later inherits it -- not in Gate 2 alone.
#
#         ASSERTION SHAPE: these tests run gate_0_run itself and read the
#         CHANGED_FILES it sets, rather than re-running the git command the fix
#         uses. Re-running that command proves only that `-c core.quotepath=false`
#         works, which is a git fact, not this repository's behaviour -- an
#         earlier draft of this file passed on UNFIXED code for exactly that
#         reason, and only the source-grep test failed.
# @covers AC-870-01, AC-870-02
bats_require_minimum_version 1.5.0

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE0="$REPO_ROOT/githooks/gate-entries/gate-0-entry.sh"
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q -b main .
  git config user.email test@example.com
  git config user.name Test
  git config core.hooksPath /dev/null

  # The gate body calls helpers from the hook libs; make them resolvable, and
  # stub the two it needs that no test fixture provides.
  export XP_GATE_LIB_PATH="$REPO_ROOT/githooks/lib"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# Stage one ASCII file and one CJK-named file.
stage_mixed_commit() {
  mkdir -p docs
  printf 'var a = 1;\n' > good.js
  printf '# 说明\n' > "docs/验证记录.md"
  git add -A
  git -c user.email=test@example.com -c user.name=Test commit -qm init

  printf 'var b = 2;\n' >> good.js
  printf '\n补充\n' >> "docs/验证记录.md"
  git add -A
}

# Source gate-0 and run gate_0_run in a subshell, then echo CHANGED_FILES.
# Prints one path per line. Any gate output is sent to stderr so it cannot
# contaminate the path list under assertion.
gate0_changed_files() {
  bash -c '
    set +e
    source "$1" >/dev/null 2>&1
    gate_0_run >/dev/null 2>&1
    printf "%s\n" "$CHANGED_FILES"
  ' _ "$GATE0" 2>/dev/null
}

@test "REQ-870: git's default quotepath escapes the CJK name (the bug's input)" {
  stage_mixed_commit

  # Pin the premise rather than assume it: if git ever stops escaping by default,
  # this suite's whole reason for existing changes and should fail loudly here.
  run git -c core.quotepath=true diff --cached --name-only --diff-filter=ACM
  [ "$status" -eq 0 ]
  [[ "$output" == *'docs/\351\252\214\350\257\201'* ]]
  # Quoted AND escaped -- the quotes are what makes it unusable as a path.
  [[ "$output" == *'"docs/\351'* ]]
}

@test "REQ-870: Gate 0 CHANGED_FILES carries the real UTF-8 path" {
  stage_mixed_commit

  run gate0_changed_files
  # If the gate could not run in this fixture, say so here rather than report a
  # passing assertion about an empty list.
  [ -n "$output" ]

  [[ "$output" == *'docs/验证记录.md'* ]]
  # An octal escape or a stray quote means the bug is back.
  [[ "$output" != *'\351\252\214'* ]]
  [[ "$output" != *'"docs'* ]]
}

@test "REQ-870: every path Gate 0 lists can actually be opened" {
  stage_mixed_commit

  run gate0_changed_files
  [ -n "$output" ]

  # The blast radius, stated as the invariant that matters: jscpd dies on the
  # first path it cannot open, taking every other file in the run with it. So a
  # path being *listed* is not the property to assert (the bug listed good.js
  # too); being *openable* is. Each line must resolve to a real file.
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    [ -e "$path" ] || {
      echo "listed but not openable: $path" >&2
      return 1
    }
  done <<< "$output"

  # And both files are among them, so the loop above is not vacuous.
  [[ "$output" == *'good.js'* ]]
  [[ "$output" == *'docs/验证记录.md'* ]]
}

@test "REQ-870: BOTH places that query git disable quotepath" {
  # Two sites, and they must agree. The #640 cache (STAGED_FILES -> XP_STAGED_ACM)
  # is computed first and every consumer prefers it, so fixing only the consumer
  # leaves the cache re-populating the escaped form -- which is exactly what
  # happened while developing this fix: the consumer was patched, the tests still
  # failed, because the cache won.
  #
  # A source-level pin, kept alongside the behavioural tests: it catches an edit
  # that drops the flag even on a machine whose global git config would mask the
  # effect (core.quotepath=false globally makes the behavioural tests pass anyway).
  run grep -n 'quotepath=false diff' "$GATE0"

  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 2 ]
  [[ "$output" == *'STAGED_FILES='* ]]
  [[ "$output" == *'RAW_CHANGED_FILES='* ]]
}
