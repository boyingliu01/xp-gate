#!/usr/bin/env bash
# C# / .NET adapter (#717)
#
# Contract: pre-commit sources this file and calls run_static_analysis /
# run_lint / run_tests / run_coverage directly (#688 — no dispatcher sits in
# between). Every function must therefore exist and must return a status the
# caller can turn into a verdict.
#
# Two lessons from the sibling adapters are load-bearing here:
#
#   1. #706 (kotlin.sh): a failed BUILD must not swallow an analyzer that works
#      on its own. `dotnet format` reads .cs sources and needs no successful
#      build, so it runs regardless of what the build said. The build failure is
#      recorded and reported, never hidden.
#
#   2. #703/#708 (java.sh): "tool not installed" and "tool ran and failed" need
#      different fixes, so they get different messages. A missing dotnet is a
#      SKIP with an install hint, not a BLOCK -- the project may not be a .NET
#      one after all.
#
# Windows note (#717): on this machine `dotnet test` aborts before running a
# single case with `Win32Exception (5) Access is denied` from the VSTest
# testhost -- an environment fault, reproducible under both git-bash and
# PowerShell. run_tests() below therefore reports "test host did not start"
# separately from "tests failed", because a gate that reads the former as the
# latter would block every commit in a working repo.

# ---------------------------------------------------------------------------
# Project discovery
# ---------------------------------------------------------------------------

# Print the workspace argument `dotnet build` / `dotnet format` should be given.
#
# Both commands accept a directory, a .sln or a .csproj — but a DIRECTORY is
# ambiguous when a solution and a project file sit at the same level:
#
#   `dotnet format <dir>`  → Unhandled exception: System.IO.FileNotFoundException:
#                            已在 '<dir>' 中同时找到 MSBuild 项目文件和解决方案文件
#   `dotnet build <dir>`   → MSBUILD : error MSB1050: "<dir>" 文件夹中包含多个
#                            项目或解决方案文件
#
# Neither is a source verdict, but the callers cannot tell them apart from a real
# finding -- format's abort exits 1 like "1 change required", and build's abort
# exits 1 like "compilation failed". Measured on this host with a root .sln and a
# root .csproj: directory form rc=1 for both, rc=0 for both when the file is
# named. Naming the file removes the ambiguity the tools refuse to guess about.
#
# WHICH file, though, is not a matter of preference:
#
#   * The .sln only governs what it REFERENCES. `dotnet new sln` produces a valid
#     solution that references nothing, and `dotnet format <that .sln>` then
#     checks zero files and exits 0 — a silently empty gate. Measured: violated
#     sources, sln with no Project(...) entries -> rc=0 and no findings.
#   * The same violated sources with the project added to the sln -> the
#     WHITESPACE errors are reported.
#
# So a solution is used only when it actually contains a Project entry; otherwise
# the single .csproj is named; otherwise the directory is returned and the tool
# decides (correct when no ambiguity exists).
_workspace_arg() {
  local root="$1"
  local sln csproj count
  sln=$(find "$root" -maxdepth 1 -name "*.sln" -type f 2>/dev/null | sed -n '1p; 1q')
  if [ -n "$sln" ] && grep -qE '^Project\(' "$sln" 2>/dev/null; then
    printf '%s\n' "$sln"
    return 0
  fi
  # No usable solution at this root. A single .csproj is unambiguous; several are
  # not, and the tools want the directory in that case (they walk the tree).
  count=$(find "$root" -maxdepth 1 -name "*.csproj" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" = "1" ]; then
    csproj=$(find "$root" -maxdepth 1 -name "*.csproj" -type f 2>/dev/null | sed -n '1p; 1q')
    printf '%s\n' "$csproj"
    return 0
  fi
  printf '%s\n' "$root"
}

# Print the directory that owns the build, or nothing.
#
# A .sln at the root is the usual shape; a bare .csproj is the single-project
# shape; Directory.Build.props can declare a tree with neither. All three are
# accepted because `dotnet` itself accepts all three.
_detect_dotnet_root() {
  local found
  found=$(find . -maxdepth 2 -name "*.sln" -type f -not -path "./.git/*" 2>/dev/null | sed -n '1p; 1q')
  if [ -n "$found" ]; then
    dirname "$found"
    return 0
  fi
  found=$(find . -maxdepth 2 -name "*.csproj" -type f -not -path "./.git/*" 2>/dev/null | sed -n '1p; 1q')
  if [ -n "$found" ]; then
    dirname "$found"
    return 0
  fi
  if [ -f "Directory.Build.props" ]; then
    echo "."
    return 0
  fi
  return 1
}

# Echo the dotnet entry point, or nothing when the SDK is absent.
#
# Deliberately does NOT bundle the bare `dotnet` invocation into a single
# string: the .exe suffix matters on Windows and callers need the tokens.
_detect_dotnet() {
  if command -v dotnet >/dev/null 2>&1; then
    echo "dotnet"
    return 0
  fi
  if command -v dotnet.exe >/dev/null 2>&1; then
    echo "dotnet.exe"
    return 0
  fi
  return 1
}

# Print the first staged/changed .cs file, or nothing. Used only for messages.
_csharp_changed_hint() {
  printf '%s\n' "${CHANGED_FILES:-}" | grep -E '\.cs$' | sed -n '1p'
}

# ---------------------------------------------------------------------------
# Code quality (Gate 1)
# ---------------------------------------------------------------------------

run_static_analysis() {
  local dotnet_root dotnet ver build_out build_rc format_out format_rc
  dotnet_root=$(_detect_dotnet_root) || {
    echo "No .NET project marker found (.sln / *.csproj / Directory.Build.props)"
    return 0
  }

  dotnet=$(_detect_dotnet) || {
    # SKIP, not BLOCK: no SDK means nothing was measured, and the caller maps a
    # non-zero return to "tools unavailable" which it reports honestly.
    echo "dotnet SDK not found"
    echo "   Install: winget install Microsoft.DotNet.SDK.8 | brew install --cask dotnet-sdk | apt-get install dotnet-sdk-8.0"
    return 2
  }

  ver=$("$dotnet" --version 2>/dev/null | sed -n '1p')
  echo "dotnet SDK ${ver:-unknown} (project: ${dotnet_root})"

  # --- build (recorded, not authoritative) -------------------------------
  # `--nologo` keeps the banner out; `-warnaserror` is Gate 13's job, not Gate
  # 1's, so the build here only needs to answer "does this compile".
  #
  # Same ambiguity as `format` below, with a different symptom: `dotnet build`
  # on a directory holding both markers fails with MSB1050 ("the folder contains
  # more than one project or solution file"). That is a build that could not be
  # ATTEMPTED, not a build that failed, and it would report an otherwise clean
  # project as BUILD FAILED.
  build_target=$(_workspace_arg "$dotnet_root")
  build_out=$("$dotnet" build "$build_target" --nologo -v quiet 2>&1)
  build_rc=$?
  if [ "$build_rc" -ne 0 ]; then
    echo "BUILD FAILED (dotnet build exited $build_rc):"
    printf '%s\n' "$build_out" | grep -iE "error|fail" | sed -n '1,10p'
    echo "   Analysis still runs below: dotnet format reads sources directly"
    echo "   and its verdict does not depend on the build."
  fi

  # --- analyzer (authoritative) -----------------------------------------
  # `dotnet format --verify-no-changes` is the closest C# equivalent of
  # `eslint --max-warnings 0`: formatting + the configured analyzers, exit 0
  # only when everything is clean.
  #
  # The workspace argument is the FILE when the root carries both a .sln and a
  # .csproj — see _workspace_arg. Handing it the bare directory there
  # makes the tool abort with an ambiguity exception and exit 1, which is
  # indistinguishable from "1 change required".
  format_target=$(_workspace_arg "$dotnet_root")
  format_out=$("$dotnet" format "$format_target" --verify-no-changes --verbosity quiet 2>&1)
  format_rc=$?

  # (#717) A command that could not RUN is not a command that found problems.
  # 127 = not found, 126 = not executable. Without this arm a broken or shadowed
  # `dotnet` made `dotnet format` exit 127, which the code below turned into
  # "127 change(s) required or analyzer finding(s)" and returned 1 -- reported to
  # the user as a code-quality FAILURE of their sources. Measured before the fix:
  # a stub `dotnet` exiting 127 produced exactly that message.
  case "$format_rc" in
    126|127)
      echo "dotnet format could not execute (exit ${format_rc}) — NOT a source verdict"
      echo "   The 'dotnet' on PATH is missing or not executable."
      return 2
      ;;
  esac

  if [ "$format_rc" -eq 0 ]; then
    echo "FORMAT OK - dotnet format reports no changes required"
  else
    printf '%s\n' "$format_out" | sed -n '1,20p'
    echo "dotnet format: ${format_rc} change(s) required or analyzer finding(s)"
  fi

  # A real finding wins over a build failure: the build failure is already
  # printed above, and returning 1 here makes the caller report the stronger
  # statement. Returning the build's status when analysis is clean would hide
  # which of the two actually happened.
  if [ "$format_rc" -ne 0 ]; then
    return 1
  fi
  # Same reasoning for the build: 126/127 means the build never ran, so there is
  # no "compiles / does not compile" answer to report.
  case "$build_rc" in
    126|127) echo "dotnet build could not execute (exit ${build_rc}) — NOT a build verdict"; return 2 ;;
  esac
  return "$build_rc"
}

run_lint() {
  run_static_analysis
}

# ---------------------------------------------------------------------------
# Tests (Gate 5)
# ---------------------------------------------------------------------------

# Succeeds when any project in the tree declares a test dependency.
#
# Without this probe `dotnet test` on a solution with no test project exits 0
# and prints nothing, which reads as "all tests passed" for a project that has
# no tests at all -- the same silent-success shape #717 is about.
_has_test_project() {
  local root="${1:-.}"
  find "$root" -maxdepth 3 -name "*.csproj" -type f -not -path "./.git/*" 2>/dev/null | while IFS= read -r proj; do
    if grep -qiE 'Microsoft\.NET\.Test\.Sdk|Microsoft\.TestPlatform<xunit|NUnit|MSTest\.TestFramework' "$proj" 2>/dev/null; then
      printf '%s\n' "$proj"
      break
    fi
  done | sed -n '1p'
}

run_tests() {
  local dotnet_root dotnet out rc
  dotnet_root=$(_detect_dotnet_root) || { echo "No .NET project marker found"; return 0; }
  dotnet=$(_detect_dotnet) || { echo "dotnet SDK not found"; return 2; }

  local test_proj
  test_proj=$(_has_test_project "$dotnet_root")
  if [ -z "$test_proj" ]; then
    echo "No test project found in ${dotnet_root}"
    echo "   A .csproj must reference Microsoft.NET.Test.Sdk / xunit / NUnit / MSTest to run under dotnet test"
    return 2
  fi
  echo "Test project: ${test_proj}"

  out=$("$dotnet" test "$test_proj" --nologo 2>&1)
  rc=$?
  printf '%s\n' "$out" | sed -n '1,25p'

  if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -qiE 'Win32Exception|Access is denied|拒绝访问|test host 进程已退出|Testhost.*exited'; then
    # The testhost never started, so nothing was verified. Reporting this as a
    # test FAILURE would block every commit in a repo whose tests are fine;
    # reporting it as PASS would be a lie. 2 is the "could not execute" channel
    # the adapters already use (java.sh's G1 contract).
    echo "dotnet test could not start the test host (environment fault, not a test verdict)"
    echo "   Known on this host: VSTest testhost aborts with Win32Exception (5) even when invoked outside git-bash"
    return 2
  fi
  return "$rc"
}

# ---------------------------------------------------------------------------
# Coverage (Gate 5)
# ---------------------------------------------------------------------------
#
# Silently returning 0 here would let Gate 5 read "no coverage file" as "no
# coverage requirement". The output just tells the caller which artifact the
# gate is looking for; the threshold verdict stays with the caller.
# Newest coverage.cobertura.xml under $1, honouring an optional find time filter
# in $2. Extracted so the "which report is the current one" rule lives in one
# place: run_coverage and Gate 5's own discovery must agree, or the adapter and
# the gate will quote different numbers for the same run.
_csharp_newest_cobertura() {
  local root="$1" time_filter="${2:-}"
  # shellcheck disable=SC2086  # $time_filter is deliberately word-split
  find "$root" -name "coverage.cobertura.xml" -type f $time_filter 2>/dev/null \
    | while IFS= read -r f; do
        printf '%s\t%s\n' "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)" "$f"
      done \
    | sort -rn | head -1 | cut -f2-
}

# #798 / #794: run_coverage() below is `dotnet test --collect:...`, i.e. it runs
# and validates the SAME suite run_tests() runs. #798 measured one commit at
# 28.5s for run_tests + 30.0s for run_coverage with identical results (319
# passing both times) — the first pass contributed no verdict at all.
#
# Declaring it here is what lets Gate 5 run the suite once. The decision lives in
# the adapter because the adapter is what knows its toolchain; a hook-level
# `if [ "$CURRENT_LANG" = ... ]` had already been written twice (#794) and would
# need writing again for every new language.
coverage_runs_tests() { return 0; }

run_coverage() {
  local dotnet_root dotnet
  dotnet_root=$(_detect_dotnet_root) || { echo "No .NET project marker found"; return 0; }
  dotnet=$(_detect_dotnet) || { echo "dotnet SDK not found"; return 2; }

  local test_proj
  test_proj=$(_has_test_project "$dotnet_root")
  if [ -z "$test_proj" ]; then
    echo "No test project found in ${dotnet_root} — coverage not measurable"
    return 2
  fi

  # A project that ships its own .runsettings must be honoured. Coverlet's
  # defaults (IncludeTestAssembly=false, no Include filter) are wrong for any
  # solution whose tests link the production sources via <Compile Include> rather
  # than project-referencing them: the assembly under test IS the test assembly,
  # so coverlet instruments nothing and writes a syntactically valid report with
  # line-rate="0" and an EMPTY <packages/>. Gate 5 then blocks on "0% coverage"
  # for a suite that measures 67% when run the project's own way -- a false
  # negative that looks exactly like a real coverage failure.
  #
  # Measured on dsh-aot-runner: without --settings the report was
  # `<coverage line-rate="0" ... lines-valid="0">` with `<packages />`; with the
  # project's runsettings the same command produced line-rate="0.6724".
  local settings_arg="" rs
  for rs in tests/*/coverage.runsettings tests/coverage.runsettings \
            coverage.runsettings .runsettings coverage/.runsettings; do
    if [ -f "$rs" ]; then settings_arg="--settings $rs"; break; fi
  done
  if [ -z "$settings_arg" ]; then
    # Fall back to any runsettings anywhere in the tree before giving up.
    rs=$(find . -name '*.runsettings' -type f -not -path './.git/*' 2>/dev/null \
      | while IFS= read -r f; do printf '%s\t%s\n' "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)" "$f"; done \
      | sort -rn | head -1 | cut -f2-)
    [ -n "$rs" ] && settings_arg="--settings $rs"
  fi
  if [ -n "$settings_arg" ]; then
    echo "   Using project runsettings: ${settings_arg#--settings }"
  fi

  echo "Collecting coverage: dotnet test --collect:\"XPlat Code Coverage\""
  local out rc
  # shellcheck disable=SC2086  # $settings_arg is deliberately word-split
  out=$("$dotnet" test "$test_proj" --nologo --collect:"XPlat Code Coverage" $settings_arg 2>&1)
  rc=$?
  printf '%s\n' "$out" | sed -n '1,15p'

  # #768: pick the report THIS run produced, not an arbitrary one.
  #
  # `find ... | sed -n '1p; 1q'` returned whichever directory the filesystem
  # enumerated first. TestResults accumulates one <guid>/ per run, so after a
  # second run the "first" hit can be an earlier run's report -- and when that run
  # was from a different test target, its report legitimately says 0%. Measured on
  # a real repo: live coverage was 67%, the adapter announced the stale 0% report,
  # and Gate 5 blocked with "csharp coverage 0% below 80% threshold".
  #
  # Sort by modification time so "the report" means "the one just written". The
  # stat arm is guarded for both GNU (-c) and BSD/macOS (-f) spellings, with 0 as
  # a last resort so an unsupported stat cannot empty the list.
  local report
  report=$(_csharp_newest_cobertura "$dotnet_root" "-newermt -10 minutes")
  if [ -z "$report" ]; then
    report=$(_csharp_newest_cobertura "$dotnet_root" "")
  fi

  if [ -z "$report" ]; then
    echo "coverage.cobertura.xml not produced — coverage NOT measured"
    echo "   Requires coverlet.collector in the test project"
    return 2
  fi
  echo "Coverage report: ${report}"
  return "$rc"
}
