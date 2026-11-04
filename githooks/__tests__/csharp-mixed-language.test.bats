#!/usr/bin/env bats
# @test REQ-732
# @intent Walkthrough round 3 (FC-02) flagged that the highest-risk claim in this
#         sprint -- "xp-gate supports C#" -- had no test covering the mixed-language
#         shape it is most likely to meet in practice. The #717 issue describes a
#         real repository that is 2031 lines of C# plus ~900 lines of JS: a .NET
#         project carrying a JS or shell half is the normal case, not the exotic
#         one, and it is exactly where an exclusive first-match detector can lose
#         a language silently.
#
#         Round 2 marked this "untested"; round 3 called it the sprint's
#         highest-risk open item. These tests exist to turn that from an
#         unmeasured claim into a measured one: detection must answer C# for a
#         mixed repo, and the other languages must remain reachable when no .NET
#         manifest is present.
# @covers AC-717-26, AC-717-27, AC-717-28

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER_COMMON="$REPO_ROOT/githooks/adapter-common.sh"
  WORK="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$WORK"
}

teardown() {
  cd /
  rm -rf "$WORK"
}

# Create a repo-shaped fixture in $WORK and cd into it.
make_repo() {
  cd "$WORK" || return 1
  git init -q .
}

# --- detection order: C# first, others unreachable -------------------------

@test "mixed C# + JS + shell repo detects as csharp (the 2031-line case)" {
  make_repo
  printf '<Project Sdk="Microsoft.NET.Sdk"></Project>\n' > App.csproj
  printf '{"name":"web","version":"1.0.0"}\n' > package.json
  printf '{"compilerOptions":{}}\n' > tsconfig.json
  mkdir -p src
  printf 'class A {}\n' > src/A.cs
  printf 'console.log(1)\n' > src/index.js
  printf '#!/bin/sh\necho hi\n' > build.sh

  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && detect_project_lang"
  [ "$status" -eq 0 ]
  [ "$output" = "csharp" ]
}

@test "a .sln alone is enough to detect csharp" {
  make_repo
  printf 'Microsoft Visual Studio Solution File\n' > App.sln
  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && detect_project_lang"
  [ "$output" = "csharp" ]
}

@test "Directory.Build.props alone is enough to detect csharp" {
  make_repo
  printf '<Project></Project>\n' > Directory.Build.props
  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && detect_project_lang"
  [ "$output" = "csharp" ]
}

# --- no regression: pre-existing languages still detected -----------------

@test "a TypeScript-only repo still detects as typescript" {
  make_repo
  printf '{"compilerOptions":{}}\n' > tsconfig.json
  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && detect_project_lang"
  [ "$output" = "typescript" ]
}

@test "a Python-only repo still detects as python" {
  make_repo
  printf '[project]\nname="x"\n' > pyproject.toml
  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && detect_project_lang"
  [ "$output" = "python" ]
}

@test "a Go-only repo still detects as go" {
  make_repo
  printf 'module x\n' > go.mod
  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && detect_project_lang"
  [ "$output" = "go" ]
}

@test "a shell-only repo still detects as shell" {
  make_repo
  printf '#!/bin/sh\necho hi\n' > run.sh
  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && detect_project_lang"
  [ "$output" = "shell" ]
}

# --- has_csharp_sources: the predicate the C# arms hang on ----------------

@test "has_csharp_sources finds a .cs file" {
  make_repo
  mkdir -p src
  printf 'class A {}\n' > src/A.cs
  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && has_csharp_sources"
  [ "$status" -eq 0 ]
}

@test "has_csharp_sources is false without .cs files" {
  make_repo
  printf 'console.log(1)\n' > index.js
  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && has_csharp_sources"
  [ "$status" -ne 0 ]
}

@test "has_csharp_sources ignores obj/ and bin/ build output" {
  # A repository that once ran `dotnet build` carries generated .cs under obj/.
  # Counting those would make every repo with build residue look like a C# repo.
  make_repo
  mkdir -p obj/Debug bin
  printf '// generated\n' > obj/Debug/AssemblyInfo.cs
  printf '// generated\n' > bin/Gen.cs
  run bash -c "cd '$WORK' && . '$ADAPTER_COMMON' && has_csharp_sources"
  [ "$status" -ne 0 ]
}
