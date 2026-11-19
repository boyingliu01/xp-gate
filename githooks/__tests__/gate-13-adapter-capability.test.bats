#!/usr/bin/env bats
#
# @test REQ-GATE13-CAPABILITY the compiler gate asks adapters, never a language list
# @intent Gate 13 compiles C/C++, Java and C#. Every other language -- Go, Rust,
#         Dart, Kotlin, Swift, PHP, Ruby -- has a compiler or a type checker that
#         reports exactly the class of error this gate exists to catch, and this
#         gate asked none of them.
#
#         Measured 2026-11-19 on a Go-only project, `var x int = "not an int"`
#         staged: Gate 9 SKIPped ("not a TypeScript project", with a reason) and
#         Gate 13 said PASS. Zero of thirteen gates looked for a compiler error in
#         a language whose compiler was installed and would have answered in 200ms.
#
#         The fix is NOT a list of languages in the gate. githooks/AGENTS.md:
#
#             "Declare capabilities on the adapter, never enumerate language names.
#              A hand written list of languages can only ever contain what someone
#              remembered; this was patched twice before becoming a rule."
#
#         So an adapter declares `compiler_check_command`, printing a command that
#         runs a compile/type-check over the project and exits non-zero when it
#         finds an error. An adapter that declares nothing is not asked, and that
#         is the only place the set of covered languages lives.
#
# @covers AC-GATE13-CAP-01  an adapter that declares a checker is actually asked
# @covers AC-GATE13-CAP-02  a declared checker that fails BLOCKS the gate
# @covers AC-GATE13-CAP-03  an adapter that declares nothing is not invented for
# @covers AC-GATE13-CAP-04  no language names appear in Gate 13's dispatch
# @covers AC-GATE13-CAP-05  Go is covered in practice (real toolchain)
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO/githooks/adapters/gate-13-compiler-strictness.sh"
  WORK="$BATS_TEST_TMPDIR/w"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
}

@test "AC-GATE13-CAP-01: the capability is a declared adapter function, not a gate list" {
  # The mechanism must exist for adapters to opt into. Without this, "covered
  # languages" can only be expressed by naming them in the gate.
  grep -qE 'compiler_check_command' "$GATE" || {
    echo "Gate 13 does not consult compiler_check_command at all"
    false
  }
}

@test "AC-GATE13-CAP-02: a declared checker whose command fails BLOCKS the gate" {
  # A stub adapter declares a checker that always fails. The gate must turn that
  # into a blocking verdict -- if it merely printed the output and returned PASS,
  # the whole capability would be decorative.
  printf 'package main\n' > anything.go

  run bash -c '
    cd "$1" || exit 1
    set -u
    gate13_is_disabled() { return 1; }
    gate13_reason() { :; }
    gate13_classify_changed() { printf "added\tanything.go\n"; }
    # The stub adapter: this is the ONLY thing a language has to provide.
    compiler_check_command() { printf "%s" "false"; }
    source "$2" >/dev/null 2>&1 || exit 1
    gate13_run_declared_checks
  ' _ "$WORK" "$GATE"

  [ "$status" -ne 0 ] || {
    echo "a declared checker returned non-zero and the gate still reported success"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-GATE13-CAP-03: an adapter that declares nothing is not invented for" {
  # Anti-vacuity in the other direction. If the gate fabricated a command for
  # language X because it "probably has one", a project in an unsupported language
  # would block on a tool that is not installed -- describing that as coverage.
  printf 'x\n' > anything.unknown

  run bash -c '
    cd "$1" || exit 1
    set -u
    gate13_is_disabled() { return 1; }
    gate13_reason() { :; }
    gate13_classify_changed() { printf "added\tanything.unknown\n"; }
    compiler_check_command() { return 1; }
    source "$2" >/dev/null 2>&1 || exit 1
    gate13_run_declared_checks
  ' _ "$WORK" "$GATE"

  # Declaring nothing must produce the SKIP code SPECIFICALLY, not merely "not a
  # block". This distinction is the defect: before GATE13_SKIP existed, the
  # absence of a declaration came back as PASS.
  #
  # GATE13_SKIP is 4. Asserting "0 or 4" would accept exactly the behaviour this
  # capability exists to remove, so it is pinned to 4.
  [ "$status" -eq 4 ] || {
    echo "no declaration produced rc $status; expected 4 (GATE13_SKIP)"
    echo "rc 0 here means the gate claims to have checked a language nobody can check"
    false
  }
}

@test "AC-GATE13-CAP-04: Gate 13 does not name languages when dispatching checks" {
  # The rule this codifies: a hand-written list can only ever contain what someone
  # remembered. The gate may still SOLVE language names to find an adapter (that
  # is the existing 3-tier resolution); what it must not do is branch on them.
  #
  # Assert on the dispatch helper specifically, so this cannot be satisfied by
  # deleting an unrelated comment.
  local body
  body=$(awk '/^gate13_run_declared_checks\(\)/,/^}/' "$GATE")
  [ -n "$body" ] || {
    echo "gate13_run_declared_checks is missing"
    false
  }

  local lang
  for lang in gouarustuadartkotlinswiftphprubyshellscalaelixir; do
    if printf '%s' "$body" | grep -qiE "[\"']?$(printf '%s' "$lang")[\"']?\b"; then
      echo "the dispatch helper branches on the language name '${lang}':"
      printf '%s\n' "$body"
      false
    fi
  done
}

@test "AC-GATE13-CAP-05: a real Go type error is caught end to end" {
  command -v go >/dev/null 2>&1 || skip "go not installed"

  printf 'module probe\n\ngo 1.21\n' > go.mod
  printf 'package main\n\nvar x int = "not an int"\n\nfunc main() {}\n' > main.go
  git init -q . 2>/dev/null || true
  git add -A 2>/dev/null || true

  run bash -c '
    cd "$1" || exit 1
    set -u
    gate13_is_disabled() { return 1; }
    gate13_reason() { :; }
    gate13_classify_changed() { printf "added\tmain.go\n"; }
    # What githooks/adapters/go.sh will declare.
    compiler_check_command() { printf "%s" "go vet ./..."; }
    source "$2" >/dev/null 2>&1 || exit 1
    gate13_run_declared_checks
  ' _ "$WORK" "$GATE"

  [ "$status" -ne 0 ] || {
    echo "a real Go type error was not caught"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-GATE13-CAP-06: an arm with no sources of its own reports SKIP, not PASS" {
  # The Java, C# and -fanalyzer arms each answered GATE13_PASS when they had no
  # sources. Three separate sites, one shape: an arm that evaluated nothing claimed
  # a clean result, which then made the WHOLE gate report PASS for a language no arm
  # could check.
  #
  # Measured 2026-11-19, a Ruby-only project with no checker declared:
  #     cpp  => 4 (skip)   java => 4 (skip)   csharp => 4 (skip)
  #     analyzer => 0 (PASS)  <- and the gate reported PASS
  #
  # Each arm is called with its source predicate forced empty, which is the only
  # thing that makes the "no sources" branch reachable without a toolchain.
  run bash -c '
    cd "$1" || exit 1
    set -u
    gate13_is_disabled() { return 1; }
    gate13_reason() { :; }
    gate13_java_sources() { printf ""; }
    gate13_csharp_sources() { printf ""; }
    gate13_analyzer_enabled() { return 1; }
    source "$2" >/dev/null 2>&1 || exit 1
    w=0
    for arm in gate13_run_java_analysis gate13_run_csharp_analysis gate13_run_analyzer; do
      $arm >/dev/null 2>&1
      rc=$?
      if [ "$rc" -eq 0 ]; then
        echo "$arm answered PASS with no sources"
        w=1
      fi
    done
    exit $w
  ' _ "$WORK" "$GATE"

  [ "$status" -eq 0 ] || {
    echo "an arm with no sources claims a clean result"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-GATE13-CAP-07: a passing declared checker makes the gate PASS, not SKIP" {
  # The complement of CAP-03. Once one arm really evaluated something and found it
  # clean, the gate HAS been checked even though the other arms had nothing to do.
  # Measured: a clean Go project reported SKIP until this was pinned, which reads
  # exactly like "your language is not supported".
  printf 'package main\n' > anything.go

  run bash -c '
    cd "$1" || exit 1
    set -u
    _g13_worst=0; _g13_any_skip=0; _g13_any_pass=0
    gate13_is_disabled() { return 1; }
    gate13_reason() { :; }
    gate13_classify_changed() { printf "added\tanything.go\n"; }
    compiler_check_command() { printf "%s" "true"; }
    source "$2" >/dev/null 2>&1 || exit 1
    gate13_run_declared_checks
  ' _ "$WORK" "$GATE"

  [ "$status" -eq 0 ] || {
    echo "a passing checker produced rc $status; expected 0 (PASS)"
    printf '%s\n' "$output"
    false
  }
}
