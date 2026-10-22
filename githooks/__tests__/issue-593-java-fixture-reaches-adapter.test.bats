#!/usr/bin/env bats
# @test REQ-593
# @intent `java-gate.test.bats` had 12 of 14 cases failing — in CI and locally
#         alike — and every one showed the same symptom: no hook output at all. Three
#         same-family stale assumptions, each independently sufficient to make the
#         assertions vacuous:
#
#         1. setup() copied ONLY `pre-commit`, so the hook died immediately:
#                FATAL: cannot load hook-module-resolution.sh (module resolution order is unavailable)
#            Measured 2/14 with the supporting tree absent.
#
#         2. With dependencies present, Gate 6 then blocked:
#                ❌ ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED
#            because the fixture has neither .archlint.yaml nor architecture.yaml.
#            Gate 6 aborts the hook before Gate 1, which is the gate these cases are
#            about. The hook's own `.architecture-skip` exemption scopes them.
#
#         3. The cases staged only pom.xml / build.gradle — no .java file. Gate 1
#            then reported "no code files changed" and SKIPped:
#                Gate 1: Code Quality                          SKIP
#            so the Java adapter was never routed and no tool name could appear.
#            Measured 10/14 with the .java file removed.
#
#         14/14 after all three.
#
#         Pin: a per-language gate fixture must (a) ship the hook's whole support tree,
#         (b) exempt the gates it is not testing, and (c) stage a file in the language
#         under test — otherwise the language adapter is never invoked.
# @covers AC-593-01, AC-593-02, AC-593-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  F="$REPO_ROOT/githooks/__tests__/java-gate.test.bats"
}

# Comment lines must be stripped before asserting on code.
#
# Measured: the first version of AC-593-01/02 grepped the whole file and stayed
# GREEN with the fix reverted, twice over — the fix's own explanatory comment names
# `hook-module-resolution.sh` and `.architecture-skip`, and stripping comments was
# still not enough because the fixture's `.git/info/exclude` heredoc lists both
# filenames as DATA. A multi-line `[[ == *"cp "*"name"* ]]` match then spans lines
# and finds two unrelated strings.
#
# So: strip comments AND require the match on ONE line. Same comment-shadowing trap
# that made an earlier #583 check pass with the step deleted.
code_only() {
  bash -c "sed 's/#.*//' '$1'"
}

# True when one line of $1 matches the extended regex $2.
has_line() {
  code_only "$1" | grep -qE -- "$2"
}

@test "AC-593-01: the java fixture ships the hook support tree" {
  [ -f "$F" ] || {
    echo "$F is gone -- this test's subject no longer exists"
    return 1
  }
  # Require an actual `cp ... hook-module-resolution.sh` command on ONE line — not
  # the name appearing anywhere. Measured: a bare-name check, and a multi-line
  # `cp` + name check, both stayed GREEN with the copy reverted, because the
  # fixture's `.git/info/exclude` heredoc also lists the file.
  has_line "$F" 'cp .*hook-module-resolution\.sh' || {
    echo "the java fixture does not copy hook-module-resolution.sh."
    echo "Without it the hook aborts with 'FATAL: cannot load' before any gate runs."
    return 1
  }
  has_line "$F" 'cp .*adapter-common\.sh' || {
    echo "the java fixture does not copy adapter-common.sh"
    return 1
  }
  # Directory copies, not a hand-listed subset: listing files by name is how this
  # fixture drifted stale in the first place.
  has_line "$F" 'cp -R .*/lib/\.' || {
    echo "the java fixture does not copy githooks/lib as a directory"
    return 1
  }
  has_line "$F" 'cp -R .*/adapters/\.' || {
    echo "the java fixture does not copy githooks/adapters as a directory"
    return 1
  }
}

@test "AC-593-02: the java fixture exempts Gate 6 architecture validation" {
  # Require a token-creating command (`: > .architecture-skip`) on ONE line.
  # Measured: a bare-name check stayed GREEN with the line reverted, because the
  # `.git/info/exclude` heredoc lists the filename as data.
  has_line "$F" '> \.architecture-skip' || {
    echo "the java fixture does not create .architecture-skip."
    echo "Gate 6 then blocks with 'ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED'"
    echo "before Gate 1 — the gate these cases actually assert on — can run."
    return 1
  }
  # And the exemption must still be a real mechanism in the hook.
  grep -q '\.architecture-skip' "$REPO_ROOT/githooks/pre-commit" || {
    echo "pre-commit no longer honours .architecture-skip; re-read this test"
    return 1
  }
}

@test "AC-593-03: the java tool cases stage a real .java source file" {
  run code_only "$F"
  local code="$output"

  # The helper must exist...
  [[ "$code" == *"add_java_source()"* ]] || {
    echo "the java fixture has no add_java_source helper."
    echo "Staging only pom.xml makes Gate 1 SKIP ('no code files changed'), so the"
    echo "Java adapter never runs and no tool name can appear in the output."
    return 1
  }
  # ...it must actually emit Java...
  [[ "$code" == *"App.java"* ]] || {
    echo "the helper does not write a .java file"
    return 1
  }
  # ...and the cases that assert on Java tooling must call it.
  #
  # #599: this used to require >= 4 call sites, because there were four
  # Java-tool cases (CheckStyle / PMD / SpotBugs / all-three). Those were
  # consolidated into two verdict cases after it turned out they were asserting
  # on Maven plugin NAMES the adapter never invokes. A hard floor of 4 encoded
  # that now-deleted shape. The invariant is "every case that asserts on Java
  # tooling stages a .java file" — stated as a floor of 2, and kept as a floor
  # (not an exact count) so adding a case does not break it.
  run bash -c "grep -cE '^  add_java_source\$' '$F'"
  [ "$status" -eq 0 ] || {
    echo "no case calls add_java_source:"
    echo "$output"
    return 1
  }
  [ "${output//[[:space:]]/}" -ge 2 ] || {
    echo "only ${output} case(s) call add_java_source; the Java-tool cases need it"
    return 1
  }
}
