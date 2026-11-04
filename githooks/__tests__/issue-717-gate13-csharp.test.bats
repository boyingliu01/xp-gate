#!/usr/bin/env bats

# #717 AC-717-18: Gate 13 (compiler strictness) has a C# path.
#
# The issue title names Gate 13 explicitly. A gate that a language can never
# reach is the exact "silently skipped" defect #717 exists to remove, so the
# acceptance criterion is not "the function exists" but "each verdict code is
# produced by the right situation".
#
# Verdict contract (file header): 0 PASS / 1 FAIL / 2 BLOCK / 3 WARN.
#
# Guarded on `dotnet`: without the SDK every case would report WARN and the
# FAIL/PASS assertions would be vacuous. The skip is explicit, never silent.

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
  G13="$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
  FIXTURE=$(mktemp -d)
}

teardown() {
  rm -rf "$FIXTURE"
}

_require_dotnet() {
  command -v dotnet >/dev/null 2>&1 || skip "dotnet SDK not installed"
}

# A one-project fixture whose single source file may carry real warnings.
#   $1 = "clean" | "warn"
_make_cs_project() {
  ( cd "$FIXTURE" && dotnet new classlib -o P --force >/dev/null 2>&1 ) || return 1
  rm -f "$FIXTURE/P/Class1.cs"
  if [ "$1" = "warn" ]; then
    cat > "$FIXTURE/P/Class1.cs" <<'EOF'
namespace P;
public class Class1
{
    public string Name { get; set; }
    public int Unused() { int x = 1; return 0; }
}
EOF
  else
    cat > "$FIXTURE/P/Class1.cs" <<'EOF'
namespace P;
public class Class1
{
    public required string Name { get; init; }
}
EOF
  fi
  ( cd "$FIXTURE" && git init -q . && git add -A ) >/dev/null 2>&1
}

# Run the C# analysis stage and echo "<rc>" only.
_run_g13_csharp() {
  bash -c "
    cd '$FIXTURE'
    source '$G13' 2>/dev/null
    gate13_run_csharp_analysis >/dev/null 2>&1
    echo \"rc=\$?\"
  "
}

@test "#717 AC-717-18: a clean C# project PASSES (rc=0)" {
  _require_dotnet
  _make_cs_project clean
  run _run_g13_csharp
  [ "$output" = "rc=0" ]
}

@test "#717 AC-717-18: warnings in a changed C# file FAIL under the default tier (rc=1)" {
  _require_dotnet
  _make_cs_project warn
  run bash -c "
    cd '$FIXTURE'
    XP_GATE_COMPILER_STRICTNESS=balanced
    export XP_GATE_COMPILER_STRICTNESS
    source '$G13' 2>/dev/null
    gate13_run_csharp_analysis >/dev/null 2>&1
    echo \"rc=\$?\"
  "
  [ "$output" = "rc=1" ]
}

@test "#717 AC-717-18: the same warnings only WARN under the warn-only tier (rc=3)" {
  _require_dotnet
  _make_cs_project warn
  run bash -c "
    cd '$FIXTURE'
    XP_GATE_COMPILER_STRICTNESS=warn-only
    export XP_GATE_COMPILER_STRICTNESS
    source '$G13' 2>/dev/null
    gate13_run_csharp_analysis >/dev/null 2>&1
    echo \"rc=\$?\"
  "
  [ "$output" = "rc=3" ]
}

@test "#717 AC-717-18: warnings are seen even when a previous build left outputs fresh" {
  # Measured defect: MSBuild skips compilation when outputs are up to date and a
  # skipped compile emits no diagnostics, so the first version of this gate
  # reported 0 warnings on the second run. --no-incremental is what fixes it and
  # this test is what keeps it.
  _require_dotnet
  _make_cs_project warn
  ( cd "$FIXTURE" && dotnet build P/P.csproj --nologo >/dev/null 2>&1 )
  run bash -c "
    cd '$FIXTURE'
    XP_GATE_COMPILER_STRICTNESS=balanced
    export XP_GATE_COMPILER_STRICTNESS
    source '$G13' 2>/dev/null
    gate13_run_csharp_analysis >/dev/null 2>&1
    echo \"rc=\$?\"
  "
  [ "$output" = "rc=1" ]
}

@test "#717 AC-717-18: no .cs staged produces PASS without invoking dotnet" {
  run bash -c "
    cd '$FIXTURE'
    git init -q .
    source '$G13' 2>/dev/null
    gate13_run_csharp_analysis >/dev/null 2>&1
    echo \"rc=\$?\"
  "
  [ "$output" = "rc=0" ]
}

@test "#717 AC-717-18: .cs staged with no project WARNs instead of failing silently" {
  ( cd "$FIXTURE" && git init -q . && touch Orphan.cs && git add Orphan.cs ) >/dev/null 2>&1
  run bash -c "
    cd '$FIXTURE'
    source '$G13' 2>/dev/null
    gate13_run_csharp_analysis 2>&1
    echo \"rc=\$?\"
  "
  echo "$output" | grep -q "rc=3"
  echo "$output" | grep -qi "no .NET project"
}

@test "#717 AC-717-18: a missing dotnet SDK WARNs (rc=3), never BLOCKs" {
  _make_cs_project clean
  mkdir -p "$FIXTURE/bin-shadow"
  printf '#!/bin/sh\nexit 127\n' > "$FIXTURE/bin-shadow/dotnet"
  chmod +x "$FIXTURE/bin-shadow/dotnet"
  run bash -c "
    cd '$FIXTURE'
    PATH='$FIXTURE/bin-shadow':\$PATH
    export PATH
    source '$G13' 2>/dev/null
    gate13_run_csharp_analysis >/dev/null 2>&1
    echo \"rc=\$?\"
  "
  [ "$output" = "rc=3" ]
}

@test "#717 AC-717-18: XP_GATE_DISABLE_13 disables the C# path too" {
  _make_cs_project warn
  run bash -c "
    cd '$FIXTURE'
    XP_GATE_DISABLE_13=1
    export XP_GATE_DISABLE_13
    source '$G13' 2>/dev/null
    gate13_run_csharp_analysis >/dev/null 2>&1
    echo \"rc=\$?\"
  "
  [ "$output" = "rc=0" ]
}

@test "#717 AC-717-18: pre-commit actually CALLS the C# stage" {
  # The function existing and being unreachable is the #717 defect itself.
  run grep -F "gate13_run_csharp_analysis" "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  run grep -c "gate13_run_" "$REPO_ROOT/githooks/pre-commit"
  [ "$output" -ge 4 ]
}
