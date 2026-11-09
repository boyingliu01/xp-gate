#!/usr/bin/env bats

# #783: `dotnet format` / `dotnet build` workspace disambiguation.
#
# A repo carrying BOTH a .sln and a .csproj at its root makes a bare
# `dotnet format <dir>` (and `dotnet build <dir>`) abort:
#
#   Unhandled exception: System.IO.FileNotFoundException: 已在 '<dir>' 中同时
#   找到 MSBuild 项目文件和解决方案文件。请指定要与 <workspace> 参数一起使用的文件。
#
# That abort exits 1 -- indistinguishable to the pre-#783 adapter from "1 change
# required" -- so the gate reports a code-quality FAILURE of clean sources.
# Measured on dsh-aot-runner (root .sln + root .csproj): directory form rc=1,
# `dotnet format <the .sln>` rc=0, sources unchanged and already clean.
#
# This is the same "a command that could not RUN is not a command that found
# problems" distinction as #717, one arm further: #717 covered 126/127 (could not
# execute at all); #783 covers a tool that starts, then crashes on ambiguity.
#
# The unit under test is `_workspace_arg`, which decides what workspace
# argument the tool receives. Testing it directly (rather than scaffolding a
# full .NET project) keeps these fast and independent of the SDK's project
# templates; the SDK is only needed for the end-to-end arm.

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
  ADAPTER="$REPO_ROOT/githooks/adapters/csharp.sh"
  FIXTURE=$(mktemp -d)
}

teardown() {
  rm -rf "$FIXTURE"
}

_require_dotnet() {
  command -v dotnet >/dev/null 2>&1 || skip "dotnet SDK not installed"
}

_write_linked_sln() {
  printf 'Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "App", "App.csproj", "{11111111-1111-1111-1111-111111111111}"\nEndProject\n' > "$FIXTURE/App.sln"
}

@test "#783 AC-783-1: .sln + .csproj at the root resolves to the .sln" {
  _write_linked_sln
  touch "$FIXTURE/App.csproj"
  run bash -c "source '$ADAPTER'; _workspace_arg '$FIXTURE'"
  [ "$status" -eq 0 ]
  # The solution is the superset, so naming it is at least as complete as naming
  # one project; and it is never the ambiguous directory.
  [ "$output" = "$FIXTURE/App.sln" ]
}

@test "#783 AC-783-2: a lone .csproj resolves to that .csproj, not the directory" {
  touch "$FIXTURE/App.csproj"
  run bash -c "source '$ADAPTER'; _workspace_arg '$FIXTURE'"
  [ "$status" -eq 0 ]
  [ "$output" = "$FIXTURE/App.csproj" ]
}

@test "#783 AC-783-3: a .sln that REFERENCES a project resolves to the .sln" {
  printf 'Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "App", "App.csproj", "{11111111-1111-1111-1111-111111111111}"\nEndProject\n' > "$FIXTURE/App.sln"
  run bash -c "source '$ADAPTER'; _workspace_arg '$FIXTURE'"
  [ "$status" -eq 0 ]
  [ "$output" = "$FIXTURE/App.sln" ]
}

@test "#783 AC-783-8: an EMPTY .sln is not used: it would check nothing and exit 0" {
  # `dotnet new sln` writes a valid solution with no Project(...) entries, and
  # `dotnet format <that .sln>` scans zero files and reports success -- i.e.
  # preferring the .sln blindly turns the gate into a vacuous PASS. Measured:
  # violated sources + sln with no Project entries -> rc=0, no findings; the same
  # sources with the project linked in -> WHITESPACE errors reported.
  printf '\xef\xbb\xbf\nMicrosoft Visual Studio Solution File, Format Version 12.00\n' > "$FIXTURE/App.sln"
  touch "$FIXTURE/App.csproj"
  run bash -c "source '$ADAPTER'; _workspace_arg '$FIXTURE'"
  [ "$status" -eq 0 ]
  [ "$output" = "$FIXTURE/App.csproj" ]
}

@test "#783 AC-783-4: no project file at all falls back to the directory" {
  run bash -c "source '$ADAPTER'; _workspace_arg '$FIXTURE'"
  [ "$status" -eq 0 ]
  # Nothing to disambiguate; the caller's marker detection decides whether to run
  # at all. Passing the directory keeps that path unchanged.
  [ "$output" = "$FIXTURE" ]
}

@test "#783 AC-783-5: several .csproj and no .sln keeps the directory (no false pick)" {
  touch "$FIXTURE/A.csproj" "$FIXTURE/B.csproj"
  run bash -c "source '$ADAPTER'; _workspace_arg '$FIXTURE'"
  [ "$status" -eq 0 ]
  # Picking one arbitrarily would silently stop checking the other. The directory
  # is the honest answer when the tree, not a single file, is the subject.
  [ "$output" = "$FIXTURE" ]
}

@test "#783 AC-783-6: called from inside the root, the relative form resolves too" {
  _write_linked_sln
  touch "$FIXTURE/App.csproj"
  # _detect_dotnet_root returns the directory as written by the caller (often
  # "."), so the helper must behave when handed a relative root, not only an
  # absolute temp path. A fix that only works on absolute paths would still break
  # the real hook, which runs with cwd = repo root.
  run bash -c "cd '$FIXTURE' && source '$ADAPTER' && _workspace_arg ."
  [ "$status" -eq 0 ]
  [[ "$output" == *App.sln ]]
}

@test "#783 AC-783-7: on a real ambiguous root the resolved argument avoids the crash" {
  _require_dotnet
  # A REAL project tree. Empty marker files are enough for the helper's decision
  # logic (AC-1..6) but not here: `dotnet format` restores the project, and an
  # empty .csproj fails restore with "System.Exception: Restore operation failed"
  # -- which would make this test measure the fixture instead of the fix.
  ( cd "$FIXTURE" && dotnet new console -o . --force >/dev/null 2>&1 ) || skip "could not scaffold a .NET fixture"
  local proj
  proj=$(find "$FIXTURE" -maxdepth 1 -name '*.csproj' -type f 2>/dev/null | sed -n '1p; 1q')
  [ -n "$proj" ] || skip "could not scaffold a .NET fixture"
  ( cd "$FIXTURE" && dotnet new sln -n P --format sln --force >/dev/null 2>&1 ) || skip "could not create a solution"
  ( cd "$FIXTURE" && dotnet sln P.sln add "$proj" >/dev/null 2>&1 ) || skip "could not link the project"
  # Both markers now sit at the same level -- the real trigger.
  [ "$(dirname "$proj")" = "$FIXTURE" ] || skip "fixture did not produce a same-level pair"

  run bash -c "
    source '$ADAPTER'
    dotnet format '$FIXTURE' --verify-no-changes --verbosity quiet >/dev/null 2>&1
    echo \"dir_rc=\$?\"
    dotnet format \"\$(_workspace_arg '$FIXTURE')\" --verify-no-changes --verbosity quiet >/dev/null 2>&1
    echo \"file_rc=\$?\"
  "
  # Precondition: the ambiguity is real on this host+SDK. If it is not, this test
  # cannot observe the fix and must say so rather than pass vacuously.
  echo "$output" | grep -qE '^dir_rc=1$' || skip "directory form did not reproduce the ambiguity here"
  # Sources are `dotnet new`-generated, i.e. already clean, so the named workspace
  # must report success. Non-zero would mean a genuine finding leaked in.
  echo "$output" | grep -qE '^file_rc=0$'
}
