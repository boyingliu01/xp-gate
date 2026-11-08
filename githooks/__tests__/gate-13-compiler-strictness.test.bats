#!/usr/bin/env bats
# @test REQ-001
# @test REQ-006
# @test REQ-007
# @intent Gate 13 (Compiler Strictness) — SLICE-1: the verdict contract, compiler
#         selection, the cross-compilation predicate and the timeout budget.
#
#         The problem this gate exists for: XP-Gate never invokes the C/C++
#         compiler for analysis. `githooks/adapters/cpp.sh` only runs
#         clang-tidy/cppcheck over the first 20 files, and Gate 9's build-integrity
#         half is TypeScript-and-Maven only. A measured `g++ -Wall -Wextra` pass
#         over an innocuous-looking file reports -Wnon-virtual-dtor, -Wreorder,
#         -Wparentheses, -Wclass-memaccess, -Wold-style-cast and -Wswitch-default —
#         real defects no linter in the chain is positioned to see.
#
#         These cases pin the contract BEFORE the implementation exists (TDD RED).
#         Everything is exercised through the gate script's own functions, sourced
#         into the test shell, so no fixture repository and no real compiler are
#         required for the logic cases.
#
#         Verdict contract inherited from pre-commit's established java.sh /
#         powershell.sh protocol (#507):
#           0 = PASS, 1 = FAIL/BLOCK, 2 = fail-closed BLOCK (ran but unusable),
#           3 = WARN (tool missing / timeout / warn-only) — in the denominator,
#               never PASS.
#         Requirement round 2 (architecture CI-02) established that a TIMEOUT is
#         always 3, never 2: a timeout is incomplete coverage, not a wrong
#         conclusion, and promoting it would turn machine load into a failed commit.
#
# @covers AC-001-01, AC-001-02, AC-001-03, AC-001-04, AC-006-03, AC-007-01, AC-007-02, AC-008-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
  TEST_DIR="$(mktemp -d)"
  export TEST_DIR

  cd "$TEST_DIR" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  # Without this the machine-wide core.hooksPath runs the real suite on every
  # fixture commit.
  git config core.hooksPath .git/hooks
  mkdir -p bin
}

teardown() {
  cd / || return 1
  rm -rf "$TEST_DIR"
}

# Source the gate with the analysis stages suppressed, exposing only the helpers.
load_gate() {
  # shellcheck source=/dev/null
  source "$GATE"
}

# ---------------------------------------------------------------- existence

@test "SLICE-1: gate script exists and is executable" {
  [ -f "$GATE" ]
  [ -x "$GATE" ]
}

@test "SLICE-1: gate defines the verdict-code constants" {
  load_gate
  [ "$GATE13_PASS" = "0" ]
  [ "$GATE13_FAIL" = "1" ]
  [ "$GATE13_BLOCK" = "2" ]
  [ "$GATE13_WARN" = "3" ]
}

# ------------------------------------------------- AC-001-01 compiler choice

@test "AC-001-01: CXX from the environment wins over PATH lookup" {
  cat > bin/g++ <<'EOF'
#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "g++ (fake) 99.1"; exit 0; }
exit 0
EOF
  cat > bin/myprefix-custom-cxx <<'EOF'
#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "custom-cxx (fake) 42"; exit 0; }
exit 0
EOF
  chmod +x bin/g++ bin/myprefix-custom-cxx
  export PATH="$TEST_DIR/bin:$PATH"
  export CXX="$TEST_DIR/bin/myprefix-custom-cxx"
  mkdir -p src && echo 'int main(){return 0;}' > src/a.cpp

  load_gate
  run gate13_select_cxx
  [ "$status" -eq 0 ]
  [[ "$output" == *"myprefix-custom-cxx"* ]]
}

@test "AC-001-01: the compiler selection basis is reported" {
  cat > bin/g++ <<'EOF'
#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "g++ (fake) 99.1"; exit 0; }
exit 0
EOF
  chmod +x bin/g++
  export PATH="$TEST_DIR/bin:$PATH"
  unset CXX

  load_gate
  run gate13_select_cxx
  [ "$status" -eq 0 ]
  # Either an environment/Makefile narrative or an explicit PATH basis is fine,
  # but a silent pick is not — the gate must say why it chose what it chose.
  [[ "$output" == *"g++"* ]]
}

# ---------------------------------------------- AC-001-02 no compiler at all

@test "AC-001-02: no usable C/C++ compiler yields WARN (3), never PASS" {
  # A shim that exists on PATH but cannot run models the real failure: a broken
  # toolchain, a missing shared library, a wrong-architecture PATH entry.
  # `command -v` sees it; the usability probe must reject it, and the gate must
  # degrade to WARN rather than route into analysis and report a bogus verdict.
  cat > bin/g++ <<'EOF'
#!/usr/bin/env bash
exit 127
EOF
  chmod +x bin/g++
  export PATH="$TEST_DIR/bin:$PATH"
  unset CC
  export CXX="$TEST_DIR/bin/g++"
  echo 'int main(){return 0;}' > a.cpp

  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_WARN" ]
  [ "$status" -ne "$GATE13_PASS" ]
}

# ------------------------------------- AC-001-03 cross-compilation predicate

@test "AC-001-03: cross-compile is detected from a non-empty CROSS_COMPILE" {
  load_gate
  CROSS_COMPILE="arm-linux-gnueabihf-" run gate13_is_cross_compiling "g++"
  [ "$status" -eq 0 ]
}

@test "AC-001-03: cross-compile is detected from a prefixed compiler basename even when CROSS_COMPILE is empty" {
  load_gate
  unset CROSS_COMPILE
  run gate13_is_cross_compiling "arm-linux-gnueabihf-g++"
  [ "$status" -eq 0 ]
}

@test "AC-001-03: cross-compile is detected for aarch64 and riscv prefixed toolchains" {
  load_gate
  run gate13_is_cross_compiling "aarch64-none-elf-gcc"
  [ "$status" -eq 0 ]
  run gate13_is_cross_compiling "riscv64-unknown-elf-g++"
  [ "$status" -eq 0 ]
}

@test "AC-001-03: a plain host compiler is NOT cross-compiling" {
  load_gate
  unset CROSS_COMPILE
  run gate13_is_cross_compiling "g++"
  [ "$status" -ne 0 ]
  run gate13_is_cross_compiling "/usr/bin/clang++"
  [ "$status" -ne 0 ]
}

@test "AC-001-03: a versioned host compiler (g++-13) is NOT cross-compiling" {
  load_gate
  unset CROSS_COMPILE
  run gate13_is_cross_compiling "g++-13"
  [ "$status" -ne 0 ]
}

@test "AC-001-03: cross-compilation skips the gate with WARN, never a host-compiler compile" {
  export CROSS_COMPILE="aarch64-linux-gnu-"
  echo 'int main(){return 0;}' > a.cpp

  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_WARN" ]
  [[ "$output" == *"cross"* ]]
}

# ------------------------------------------- AC-001-04 unusable named compiler

@test "AC-001-04: an explicitly named but broken CXX is reported, not silently replaced" {
  cat > bin/g++ <<'EOF'
#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "g++ (fake) 99.1"; exit 0; }
exit 0
EOF
  chmod +x bin/g++
  export PATH="$TEST_DIR/bin:$PATH"
  export CXX="$TEST_DIR/bin/does-not-exist-cxx"
  echo 'int main(){return 0;}' > a.cpp

  load_gate
  run gate13_run_cpp_analysis
  # WARN, and the message must name the unusable compiler the user asked for.
  [ "$status" -eq "$GATE13_WARN" ]
  [[ "$output" == *"does-not-exist-cxx"* ]]
}

# ------------------------------------------------- AC-007-01 timeout budget

@test "AC-007-01: timeout defaults to 120 seconds" {
  unset XP_GATE_COMPILER_TIMEOUT
  load_gate
  run gate13_timeout_budget
  [ "$status" -eq 0 ]
  [ "$output" -eq 120 ]
}

@test "AC-007-01: XP_GATE_COMPILER_TIMEOUT overrides the file" {
  mkdir -p .xp-gate
  echo "300" > .xp-gate/compiler-gate-timeout
  export XP_GATE_COMPILER_TIMEOUT=45
  load_gate
  run gate13_timeout_budget
  [ "$output" -eq 45 ]
}

@test "AC-007-01: .xp-gate/compiler-gate-timeout overrides the default" {
  mkdir -p .xp-gate
  echo "300" > .xp-gate/compiler-gate-timeout
  unset XP_GATE_COMPILER_TIMEOUT
  load_gate
  run gate13_timeout_budget
  [ "$output" -eq 300 ]
}

@test "AC-007-01: an invalid timeout value falls back to 120 and warns" {
  mkdir -p .xp-gate
  echo "not-a-number" > .xp-gate/compiler-gate-timeout
  unset XP_GATE_COMPILER_TIMEOUT
  load_gate
  # The reason line travels on stderr (so it can never pollute a captured
  # value); bats' `run` merges stderr, so the value is the LAST line.
  run gate13_timeout_budget
  [ "${lines[-1]}" -eq 120 ]
  [[ "$output" == *"XP_G13_REASON"* ]]
}

# ------------------------------------------------ AC-007-02 timeout is WARN

@test "AC-007-02: a timeout is verdict 3 (WARN), never 2 (fail-closed)" {
  load_gate
  run gate13_classify_timeout
  [ "$status" -eq "$GATE13_WARN" ]
  [ "$status" -ne "$GATE13_BLOCK" ]
}

@test "AC-007-02: timeout output carries an explicit coverage-incomplete marker" {
  load_gate
  run gate13_classify_timeout
  [[ "$output" == *"TIMEOUT"* ]]
  [[ "$output" == *"incomplete"* ]]
}

# ------------------------------------------- AC-006-03 verdict 2 is reserved

@test "AC-006-03: verdict 2 is reserved for untrustworthy output, not for missing tools" {
  load_gate
  # The kill switch and a missing tool both map to 3; only a self-contradictory
  # tool result maps to 2.
  run gate13_classify_unusable
  [ "$status" -eq "$GATE13_BLOCK" ]
}

# ------------------------------------------------ AC-008-02 kill switch

@test "AC-008-02: XP_GATE_DISABLE_13=1 skips the gate entirely" {
  export XP_GATE_DISABLE_13=1
  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_WARN" ]
  [[ "$output" == *"disabled"* || "$output" == *"DISABLE_13"* ]]
}

@test "AC-008-02: the kill switch is orthogonal to the strictness tier" {
  export XP_GATE_DISABLE_13=1
  export XP_GATE_COMPILER_STRICTNESS=strict
  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_WARN" ]
}

# ------------------------------------------- #780 C# strictness flags
#
# The C# path used to run a bare `dotnet build`, inheriting whatever the audited
# project declared. A project with TreatWarningsAsErrors=false therefore passed
# with real warnings: measured "1 warning, 0 errors, build succeeded" on a
# fixture holding an unused field (CS0414) and a method that could be static
# (CA1822). The gate decides BLOCK from the build's exit code, so it saw nothing
# it could act on -- a strictness gate that only mirrors the project's own
# settings is not a gate.
#
# These cases pin that the flags are produced here, from outside the project,
# and that they actually promote both compiler diagnostics AND analyzer rules.

@test "#780: balanced tier promotes warnings to errors" {
  load_gate
  run gate13_csharp_flags balanced
  [ "$status" -eq 0 ]
  [[ "$output" == *"-warnaserror"* ]]
}

@test "#780: balanced tier raises the warning level and analyzer level" {
  load_gate
  run gate13_csharp_flags balanced
  [ "$status" -eq 0 ]
  # -warnaserror alone only covers CS*; CA* severity comes from AnalysisLevel.
  [[ "$output" == *"-p:WarningLevel=9999"* ]]
  [[ "$output" == *"-p:AnalysisLevel=latest-recommended"* ]]
}

@test "#780: balanced tier does NOT force Nullable on the audited project" {
  load_gate
  run gate13_csharp_flags balanced
  [ "$status" -eq 0 ]
  # Measured: -p:Nullable=enable opts the project into a language feature it
  # may not be written for (CS8632 -> CS8603 on the same line). Raising the bar
  # on existing code is this gate's job; changing compilation semantics is not.
  [[ "$output" != *"Nullable"* ]]
}

@test "#780: balanced tier does NOT force code-style enforcement" {
  load_gate
  run gate13_csharp_flags balanced
  [ "$status" -eq 0 ]
  # Measured: EnforceCodeStyleInBuild emits ZERO IDE diagnostics on a project
  # with no .editorconfig -- it only amplifies config the project already has,
  # so it cannot be sold as part of the strictness guarantee.
  [[ "$output" != *"EnforceCodeStyleInBuild"* ]]
}

@test "#780: strict tier adds AnalysisMode on top of balanced" {
  load_gate
  run gate13_csharp_flags strict
  [ "$status" -eq 0 ]
  [[ "$output" == *"-p:AnalysisMode=AllEnabledByDefault"* ]]
  # and keeps everything balanced had
  [[ "$output" == *"-warnaserror"* ]]
  [[ "$output" == *"-p:AnalysisLevel=latest-recommended"* ]]
}

@test "#780: balanced tier does NOT enable every analyzer by default" {
  load_gate
  run gate13_csharp_flags balanced
  [ "$status" -eq 0 ]
  # AnalysisMode=AllEnabledByDefault surfaces rules that are suggestion/hidden
  # by default (CA1707 among them); it must stay opt-in via the strict tier.
  [[ "$output" != *"AllEnabledByDefault"* ]]
}

@test "#780: warn-only tier injects no flags at all" {
  load_gate
  run gate13_csharp_flags warn-only
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "#780: an unknown tier falls back to balanced, never to nothing" {
  load_gate
  run gate13_csharp_flags not-a-tier
  [ "$status" -eq 0 ]
  # Falling back to "no flags" would silently disable the gate; the caller
  # already normalises unknown tiers via gate13_resolve_tier, but the flag
  # builder must not be the weaker link.
  [[ "$output" == *"-warnaserror"* ]]
}

@test "#780: no tier default means balanced" {
  load_gate
  run gate13_csharp_flags
  [ "$status" -eq 0 ]
  [[ "$output" == *"-warnaserror"* ]]
  [[ "$output" != *"AllEnabledByDefault"* ]]
}

# --------------------------------- #780 integration: real build, not strings
#
# The unit cases above assert flag *composition*. They cannot catch a flag that
# is syntactically wrong or that csc rejects -- which is the exact class of bug
# a strictness gate must not have. This case actually invokes dotnet on a
# fixture, so the flag set is proven to work as a whole.
#
# Skipped when no .NET SDK is present (CI on Linux runners often lacks one);
# the gate itself already returns WARN in that case, so skipping the test keeps
# the suite honest instead of silently passing.

@test "#780 integration: injected flags turn a warning into a BLOCK on a real build" {
  if ! command -v dotnet >/dev/null 2>&1 || ! dotnet --version >/dev/null 2>&1; then
    skip "dotnet SDK not installed"
  fi

  mkdir -p loose
  cat > loose/Loose.csproj <<'CSPROJ'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <OutputType>Library</OutputType>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
CSPROJ
  cat > loose/Probe.cs <<'CSPROJ'
namespace Loose;
public sealed class Probe
{
    private static int _unused = 42;
    public int InstanceMethod() => 1;
}
CSPROJ

  load_gate
  local flags
  flags=$(gate13_csharp_flags balanced)

  # Baseline: how the gate used to build -- project settings only.
  run dotnet build loose/Loose.csproj --nologo --no-incremental -clp:NoSummary
  [ "$status" -eq 0 ]
  [[ "$output" == *"CS0414"* ]]

  # With injected flags the same tree must fail, and must surface BOTH a
  # compiler diagnostic (CS0414) and an analyzer one (CA1822) -- the pair that
  # proves -warnaserror and AnalysisLevel are both doing work.
  run dotnet build loose/Loose.csproj --nologo --no-incremental -clp:NoSummary $flags
  [ "$status" -ne 0 ]
  [[ "$output" == *"CS0414"* ]]
  [[ "$output" == *"CA1822"* ]]
}

@test "#780 integration: a project that already fails still fails, not less" {
  if ! command -v dotnet >/dev/null 2>&1 || ! dotnet --version >/dev/null 2>&1; then
    skip "dotnet SDK not installed"
  fi

  mkdir -p strict
  cat > strict/Strict.csproj <<'CSPROJ'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <OutputType>Library</OutputType>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
CSPROJ
  cat > strict/Probe.cs <<'CSPROJ'
namespace Strict;
public sealed class Probe
{
    private static int _unused = 42;
}
CSPROJ

  load_gate
  local flags
  flags=$(gate13_csharp_flags balanced)

  # The gate must never *relax* a project that was stricter on its own.
  run dotnet build strict/Strict.csproj --nologo --no-incremental -clp:NoSummary $flags
  [ "$status" -ne 0 ]
  [[ "$output" == *"CS0414"* ]]
}

@test "#780 integration: warn-only tier leaves the project's own verdict intact" {
  if ! command -v dotnet >/dev/null 2>&1 || ! dotnet --version >/dev/null 2>&1; then
    skip "dotnet SDK not installed"
  fi

  mkdir -p wo
  cat > wo/Wo.csproj <<'CSPROJ'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <OutputType>Library</OutputType>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
CSPROJ
  cat > wo/Probe.cs <<'CSPROJ'
namespace Wo;
public sealed class Probe
{
    private static int _unused = 42;
}
CSPROJ

  load_gate
  local flags
  flags=$(gate13_csharp_flags warn-only)

  # warn-only injects nothing, so a lax project still builds: the caller is the
  # one that downgrades the verdict to WARN. This pins that contract.
  run dotnet build wo/Wo.csproj --nologo --no-incremental -clp:NoSummary $flags
  [ "$status" -eq 0 ]
}
