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
  build_out=$("$dotnet" build "$dotnet_root" --nologo -v quiet 2>&1)
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
  format_out=$("$dotnet" format "$dotnet_root" --verify-no-changes --verbosity quiet 2>&1)
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

  echo "Collecting coverage: dotnet test --collect:\"XPlat Code Coverage\""
  local out rc
  out=$("$dotnet" test "$test_proj" --nologo --collect:"XPlat Code Coverage" 2>&1)
  rc=$?
  printf '%s\n' "$out" | sed -n '1,15p'

  local report
  report=$(find "$dotnet_root" -name "coverage.cobertura.xml" -type f -newermt "-10 minutes" 2>/dev/null | sed -n '1p; 1q')
  if [ -z "$report" ]; then
    report=$(find "$dotnet_root" -name "coverage.cobertura.xml" -type f 2>/dev/null | sed -n '1p; 1q')
  fi

  if [ -z "$report" ]; then
    echo "coverage.cobertura.xml not produced — coverage NOT measured"
    echo "   Requires coverlet.collector in the test project"
    return 2
  fi
  echo "Coverage report: ${report}"
  return "$rc"
}
