#!/usr/bin/env bats

# #717: C#/.NET projects are silently skipped by every language-routed gate.
#
# Root cause pinned here is narrower than "there is no csharp adapter": the
# detection itself can never NAME csharp. `detect_project_lang()` is an
# exclusive first-match chain whose extension arm is ordered sh -> ps1 -> ts ->
# py -> go -> kt -> java -> ... -> swift -> cpp -> m -> sh -> ps1. A C# project
# that also carries a single .sh or .js helper file therefore reports "shell" or
# "typescript" and never "csharp", which is exactly the dsh-aot-runner shape
# reported in the issue (2000+ lines of C#, ~900 lines of JS).
#
# These tests drive the detection through a fixture, not through the real repo,
# so a project may declare several languages without one shadowing the other.

setup() {
  ADAPTER_COMMON="$BATS_TEST_DIRNAME/../adapter-common.sh"
  FIXTURE=$(mktemp -d)
}

teardown() {
  rm -rf "$FIXTURE"
}

# Run detect_project_lang in a subshell cd'd into the fixture. Sourcing in the
# same shell would leak the fixture cwd into the remaining assertions.
detect_in_fixture() {
  ( cd "$FIXTURE" && source "$ADAPTER_COMMON" && detect_project_lang )
}

# ---------------------------------------------------------------------------
# AC-717-01: a pure C# project (.csproj only) is detected as csharp
# ---------------------------------------------------------------------------

@test "#717 AC-717-01: detect_project_lang reports csharp for a .csproj project" {
  touch "$FIXTURE/App.csproj"
  run detect_in_fixture
  [ "$status" -eq 0 ]
  [ "$output" = "csharp" ]
}

@test "#717 AC-717-01: a .sln alone is enough to name csharp" {
  touch "$FIXTURE/App.sln"
  run detect_in_fixture
  [ "$status" -eq 0 ]
  [ "$output" = "csharp" ]
}

# ---------------------------------------------------------------------------
# AC-717-02: the exclusive-chain failure. C# MUST NOT be shadowed by a helper
# script or a package.json that the project also carries.
# ---------------------------------------------------------------------------

@test "#717 AC-717-02: C# is not shadowed by a sibling .sh helper" {
  touch "$FIXTURE/App.csproj"
  mkdir -p "$FIXTURE/scripts"
  printf '#!/bin/sh\necho hi\n' > "$FIXTURE/scripts/build.sh"
  run detect_in_fixture
  [ "$status" -eq 0 ]
  [ "$output" = "csharp" ]
}

@test "#717 AC-717-02: C# is not shadowed by a package.json for the JS helper half" {
  touch "$FIXTURE/App.csproj"
  echo '{}' > "$FIXTURE/package.json"
  run detect_in_fixture
  [ "$status" -eq 0 ]
  [ "$output" = "csharp" ]
}

@test "#717 AC-717-02: C# is not shadowed by .cs alone with no manifest" {
  mkdir -p "$FIXTURE/src"
  echo 'class A { }' > "$FIXTURE/src/A.cs"
  run detect_in_fixture
  [ "$status" -eq 0 ]
  [ "$output" = "csharp" ]
}

# ---------------------------------------------------------------------------
# AC-717-03: the new arm must not steal projects from existing languages.
# These are the regression guards for the reordering that detection needs.
# ---------------------------------------------------------------------------

@test "#717 AC-717-03: a TypeScript project is still typescript" {
  echo '{}' > "$FIXTURE/tsconfig.json"
  mkdir -p "$FIXTURE/src"
  echo 'export const a = 1;' > "$FIXTURE/src/a.ts"
  run detect_in_fixture
  [ "$output" = "typescript" ]
}

@test "#717 AC-717-03: a Python project is still python" {
  touch "$FIXTURE/pyproject.toml"
  run detect_in_fixture
  [ "$output" = "python" ]
}

@test "#717 AC-717-03: a Go project is still go" {
  printf 'module example.com/x\n' > "$FIXTURE/go.mod"
  run detect_in_fixture
  [ "$output" = "go" ]
}

@test "#717 AC-717-03: an empty directory is still unknown" {
  run detect_in_fixture
  [ "$status" -eq 0 ]
  [ "$output" = "unknown" ]
}

# ---------------------------------------------------------------------------
# AC-717-04: the multi-language collector. detect_project_lang() answers ONE
# language, which is what the legacy routing needs; the gates need the full set,
# otherwise a C#+JS project is graded as whichever language won the chain.
# ---------------------------------------------------------------------------

# AC-717-04 originally asserted a `detect_project_langs()` collector. That
# collector was removed before landing: it had no production caller, so the
# tests were measuring a helper the gates never used (the dead-dispatch shape
# #688 deleted from the same file). The behaviour these tests cared about --
# "a C# repo is recognised, and is not shadowed by shell/typescript" -- is
# covered by AC-717-01/02 above, against `detect_project_lang()`, which the
# gates actually consume.
