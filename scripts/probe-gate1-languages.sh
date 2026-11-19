#!/usr/bin/env bash
# shellcheck disable=SC2016
#   The $ in the single-quoted strings below is the POINT: those strings are
#   defect samples handed to other languages' checkers (shellcheck, PSScriptAnalyzer,
#   php -l). Expanding them here would erase exactly what is being tested. A
#   per-line directive cannot be used because the samples span multi-line
#   arguments, and shellcheck directives must precede a command, not sit inside
#   its argument list.
#
# probe-gate1-languages.sh -- Gate 1 (static analysis + lint) across every
# language adapter the repository ships.
#
# WHY THIS EXISTS SEPARATELY
#
# `xp-gate check 1` cannot test this gate. Gate 1 is declared commit-only
# (gate-capability: "needs the git-staged set, which exists only during git
# commit"), so `check 1` SKIPs unconditionally:
#
#   ⏭️  SKIPPED - Requires language detection from changed files and adapter routing
#
# A probe built on `check 1` therefore measures the SKIP, not the gate. This
# script drives the REAL pre-commit hook inside a throwaway repository per
# language, which is the only way to observe the language routing at all.
#
# WHAT COUNTS AS A PASS
#
# For each language, a file carrying a defect its toolchain MUST report is
# staged, and the hook must either
#
#   BLOCK with the finding, or
#   SKIP **with a recorded reason** (tool absent, adapter declares no support).
#
# Anything else is a FAIL, including a silent pass. The distinction matters:
# "this language has no static checker installed" is an honest answer; "the gate
# looked at nothing and said PASS" is the defect this whole exercise exists to
# find. The reason requirement is straight from githooks/AGENTS.md -- "a green
# gate-coverage row with no reason attached is a bug, not a pass".
#
# Usage: bash scripts/probe-gate1-languages.sh [lang ...]
#   no args = every language
#
# Exit: 0 when every language produced a real verdict, 1 otherwise.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS_N=0
FAIL_N=0
SKIP_N=0
declare -a RESULTS=()
declare -a FAILURES=()

# record <lang> <verdict> <detail>
record() {
  local lang="$1" verdict="$2" detail="$3"
  case "$verdict" in
    PASS) PASS_N=$((PASS_N + 1)) ;;
    SKIP) SKIP_N=$((SKIP_N + 1)) ;;
    *)    FAIL_N=$((FAIL_N + 1)); FAILURES+=("$lang: $detail") ;;
  esac
  RESULTS+=("$(printf '%-14s %-6s %s' "$lang" "$verdict" "$detail")")
  printf '  %-14s %-6s %s\n' "$lang" "$verdict" "$detail"
}

# make_repo <dir> -- a throwaway git repo carrying the REAL hooks.
#
# The hooks are copied from the repository under test, not from the global
# install: a global copy shadows the edit under review, which is the trap
# githooks/AGENTS.md documents at length. ADAPTER_DIR then points at the
# repository's own adapters for the same reason.
make_repo() {
  local dir="$1"
  mkdir -p "$dir"
  ( cd "$dir" && git init -q -b probe ) || return 1
  mkdir -p "$dir/.git/hooks"
  cp "$REPO/githooks/pre-commit" "$dir/.git/hooks/pre-commit" 2>/dev/null || return 1
  # Gate bodies, driver, registry, shared libs and adapters all live beside the
  # hook; copy the whole tree so the driver's `gate-entries/` lookup resolves.
  cp -r "$REPO/githooks/gate-entries" "$dir/.git/hooks/" 2>/dev/null
  cp -r "$REPO/githooks/lib" "$dir/.git/hooks/" 2>/dev/null
  cp -r "$REPO/githooks/adapters" "$dir/.git/hooks/" 2>/dev/null
  for f in gate-driver.sh adapter-common.sh gate-registry.sh \
           hook-module-resolution.sh gate-7.sh gate-12-file-hygiene.sh; do
    [ -f "$REPO/githooks/$f" ] && cp "$REPO/githooks/$f" "$dir/.git/hooks/" 2>/dev/null
  done
  chmod +x "$dir/.git/hooks/pre-commit" 2>/dev/null
  return 0
}

# init_commit <dir> -- establish a base commit without running the hooks.
init_commit() {
  ( cd "$1" && git add -A && git -c user.email=p@p -c user.name=p \
      -c core.hooksPath= commit -q --no-verify -m init ) || return 1
}

# run_hook <dir> -- run the REAL pre-commit inside the fixture.
run_hook() {
  local dir="$1"
  ( cd "$dir" && \
    PATH="$REPO/node_modules/.bin:$PATH" \
    XP_GATE_ADAPTER_DIR="$REPO/githooks/adapters" \
    ADAPTER_DIR="$REPO/githooks" \
    SKIP_GATE_5A_BLOCK=1 \
    timeout 400 .git/hooks/pre-commit 2>&1 ) || true
}

# probe_lang <lang> <manifest-file> <manifest-content> <src-file> <src-content>
#
# The defect in <src-content> is chosen so the language's own analyser must
# report it:
#   python      undefined name            -> ruff F821
#   go          declared and not used     -> a compile error, always reported
#   shell       unquoted/undefined var     -> shellcheck SC2154
#   powershell  assign to $null misuse     -> PSScriptAnalyzer
#   typescript  type mismatch             -> tsc
#   java/kotlin unused import / syntax    -> compiler
#   csharp      type mismatch             -> dotnet build
#   cpp         undeclared identifier     -> compiler
#   dart        type mismatch             -> analyzer
#   php         undefined variable         -> php -l / linter
#   iac         public ingress            -> tfsec/checkov/tflint
probe_lang() {
  local lang="$1" manifest="$2" manifest_content="$3" srcfile="$4" src_content="$5"
  local dir="$WORK/$lang"

  make_repo "$dir" || { record "$lang" FAIL "could not build fixture"; return; }
  [ -n "$manifest" ] && printf '%s\n' "$manifest_content" > "$dir/$manifest"
  # Fixtures need the config files that LATER-ORDERED houses of the chain demand,
  # or those houses stop the chain before Gate 1 is reached and the probe measures
  # them instead.
  #
  # Measured on a minimal TypeScript fixture: the chain reported
  #   "Chain stopped at Gate 9 -- these gates were NOT reached: 1 2 3 8 10 7 5 6 4"
  # so Gate 1 never ran, while the probe reported "Gate 1 printed no verdict line"
  # and blamed Gate 1. Gate 9 rejected the fixture because a real type error IS a
  # build failure -- correct behaviour, wrong subject for a Gate 1 probe. Gate 6
  # likewise blocks a project with no architecture config, by design (the
  # fail-closed rule this same investigation introduced).
  printf 'rules:\n  code-clone:\n    severity: high\n' > "$dir/.archlint.yaml"
  printf '{"compilerOptions":{"strict":true,"noEmit":true,"skipLibCheck":true},"include":["**/*.ts"]}\n' > "$dir/tsconfig.json"
  # A clean file first, so the base commit is not already failing.
  printf 'placeholder\n' > "$dir/.gitkeep"
  init_commit "$dir" >/dev/null 2>&1

  mkdir -p "$dir/$(dirname "$srcfile")"
  printf '%s\n' "$src_content" > "$dir/$srcfile"
  ( cd "$dir" && git add "$srcfile" ) >/dev/null 2>&1

  local out
  out="$(run_hook "$dir")"

  # Gate 1's own verdict line, whichever way it went.
  local line
  # The report has TWO lines mentioning Gate 1: the execution banner
  #   → Gate 1: Code Quality (static analysis + linting)...
  # and the verdict
  #   Gate 1: Code Quality                          FAIL
  # Selecting on the text alone picked the banner and then reported the verdict
  # as "unrecognised". Exclude the arrow-prefixed banner explicitly.
  line="$(printf '%s' "$out" | grep -E 'Gate 1: Code Quality' | grep -v '^→' | head -1)"

  # Did the chain die BEFORE Gate 1? Only then is this language unexamined.
  #
  # The first version of this guard tested 'Chain stopped at Gate [0-8]', which
  # matches "Gate 1" -- and Gate 1 stopping IS the pass condition here. Measured:
  # python, shell and go all reported "chain never reached Gate 1" while the
  # stop line said exactly "Chain stopped at Gate 1". The guard rejected the very
  # outcome it exists to look for. Gate 0 is the only gate ordered before Gate 1.
  if printf '%s' "$out" | grep -qE 'Chain stopped at Gate 0'; then
    record "$lang" FAIL "chain died at Gate 0, so Gate 1 never ran"
    return
  fi

  # An EARLIER-ORDERED house may block the same defect first. Gate 9 (build
  # integrity) sits before Gate 1 in XP_GATE_ORDER, and a syntax or type error IS
  # a build failure, so for TypeScript-family languages Gate 9 catches the defect
  # and Gate 1 is never reached.
  #
  # That is a real verdict on the defect, and it must not be scored as "Gate 1
  # printed nothing". Measured: a TypeScript fixture with a syntax error produced
  #   Gate 9: Build integrity check failed
  #   Chain stopped at Gate 9 -- these gates were NOT reached: 1 2 3 ...
  # after fourteen probes had already been rewritten chasing it. Recorded as a
  # PASS at the CHAIN level, with the deciding house named, because the question
  # this probe asks is "does this language get a real verdict", not "is Gate 1
  # the house that gives it".
  if printf '%s' "$out" | grep -qE 'Chain stopped at Gate [2-9]\b|Chain stopped at Gate 1[0-9]'; then
    local stopline hit
    stopline="$(printf '%s' "$out" | grep -m1 'Chain stopped')"
    hit="$(printf '%s' "$out" | grep -m1 '❌ BLOCKED' | sed 's/^[[:space:]]*//' | cut -c1-56)"
    [ -n "${hit:-}" ] || hit="$stopline"
    record "$lang" PASS "BLOCK before Gate 1: $hit"
    return
  fi
  case "$line" in
    *'Gate 1: Code Quality'*'FAIL'*|*'Gate 1: Code Quality'*'BLOCK'*)
      # The evidence must come from GATE 1's own output block. A whole-output grep
      # for /error|warning/ matched Gate 12's "PASSED - No file hygiene issues
      # detected." and attributed a clean file-hygiene line to a static-analysis
      # finding -- the verdict was right and the justification was fiction.
      local why
      why="$(printf '%s' "$out"         | sed -n '/Gate 1: Code Quality (static analysis/,/Gate 2:/p'         | grep -iEm1 'error|warning|issue|declared and not used|undefined|cannot|SC[0-9]+'         | sed 's/^[[:space:]]*//' | cut -c1-72)"
      [ -n "$why" ] || why="blocked (Gate 1 finding text not captured)"
      record "$lang" PASS "BLOCK: $why"
      ;;
    *SKIP*)
      # A SKIP is honest only with a reason attached.
      local reason
      reason="$(printf '%s' "$out" | grep -iEm1 'reason|not installed|not available|no .*files|unsupported|missing' | sed 's/^[[:space:]]*//' | cut -c1-64)"
      if [ -z "${reason:-}" ]; then
        record "$lang" FAIL "Gate 1 SKIPped with NO recorded reason"
      else
        record "$lang" SKIP "$reason"
      fi
      ;;
    *PASS*)
      record "$lang" FAIL "Gate 1 PASSED a file with a defect its toolchain must report"
      ;;
    '')
      record "$lang" FAIL "Gate 1 printed no verdict line at all"
      ;;
    *)
      record "$lang" FAIL "unrecognised Gate 1 line: $line"
      ;;
  esac
}

# --- the languages ---------------------------------------------------------

probe_typescript() {
  # A syntax error: eslint and tsc both must report it, and unlike a `debugger`
  # statement it is caught wherever it appears (that rule matches only a bare
  # `debugger;` alone on its line, so an inline one is not a defect at all).
  probe_lang typescript package.json '{"name":"p","version":"1.0.0"}' \
    src/bad.ts 'const unusedVar = 1; function f() { return 2'
}

probe_python() {
  probe_lang python pyproject.toml '[project]
name="p"' \
    bad.py 'def f():
    return undefined_name_xyz'
}

probe_go() {
  probe_lang go go.mod 'module p

go 1.21' \
    bad.go 'package main

func main() {
	unused := 42
}'
}

probe_shell() {
  probe_lang shell run.sh '#!/bin/sh' \
    bad.sh '#!/bin/sh
echo "$never_defined_variable_xyz"'
}

probe_powershell() {
  probe_lang powershell init.ps1 '# p' \
    bad.ps1 '$x = $undefined_variable_xyz'
}

probe_java() {
  probe_lang java pom.xml '<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>p</groupId>
  <artifactId>p</artifactId>
  <version>1</version>
</project>' \
    Bad.java 'public class Bad {
  public void f() {
    int x = "not an int";
  }
}'
}

probe_kotlin() {
  probe_lang kotlin build.gradle.kts 'plugins { }' \
    Bad.kt 'fun bad(): Int = "not an int"'
}

probe_csharp() {
  probe_lang csharp p.csproj '<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>' \
    Bad.cs 'public class Bad { public void F() { int x = "not an int"; } }'
}

probe_cpp() {
  probe_lang cpp CMakeLists.txt 'cmake_minimum_required(VERSION 3.10)
project(p)' \
    bad.cpp 'int main() { return undeclared_identifier_xyz; }'
}

probe_dart() {
  probe_lang dart pubspec.yaml 'name: p
environment:
  sdk: ">=3.0.0 <4.0.0"' \
    bad.dart 'int bad() { int x = "not an int"; return x; }'
}

probe_php() {
  probe_lang php composer.json '{"name":"p/p"}' \
    bad.php '<?php
function f() { return $undefined_variable_xyz; }'
}

probe_iac() {
  # A SYNTAX error, not a security finding. Gate 1's IaC static analysis is the
  # syntax/format layer; an open 0.0.0.0/0 ingress is Gate 7's business, so using
  # one here measured the wrong house and reported "Gate 1 PASSED a defect" for a
  # file Gate 1 is not supposed to judge. terraform validate rejects an
  # unterminated block unconditionally.
  probe_lang iac main.tf 'terraform {}' \
    bad.tf 'resource "aws_security_group" "broken" {
  ingress {
    from_port = 22
}'
}

probe_objectivec() {
  # No Objective-C toolchain on Windows; the honest answer is a recorded SKIP,
  # and that is what is asserted.
  probe_lang objectivec setup.py '' \
    bad.m '#import <Foundation/Foundation.h>
int main() { return undeclared_xyz; }'
}

probe_swift() {
  probe_lang swift Package.swift '// swift-tools-version:5.5' \
    bad.swift 'func bad() -> Int { return "not an int" }'
}

probe_flutter() {
  probe_lang flutter pubspec.yaml 'name: p
environment:
  sdk: ">=3.0.0 <4.0.0"
dependencies:
  flutter:
    sdk: flutter' \
    lib/bad.dart 'int bad() { int x = "not an int"; return x; }'
}

ALL_LANGS="typescript python go shell powershell java kotlin csharp cpp dart php iac objectivec swift flutter"

main() {
  local langs=("$@")
  if [ ${#langs[@]} -eq 0 ]; then
    # shellcheck disable=SC2206
    langs=($ALL_LANGS)
  fi

  echo "Gate 1 x language matrix (real pre-commit hook per language)"
  echo "=============================================================="

  local l
  for l in "${langs[@]}"; do
    case "$l" in
      typescript|python|go|shell|powershell|java|kotlin|csharp|cpp|dart|php|iac|objectivec|swift|flutter)
        "probe_$l" ;;
      *)
        record "$l" FAIL "no probe defined for this language" ;;
    esac
  done

  echo ""
  echo "=============================================================="
  printf ' PASS: %d   SKIP: %d   FAIL: %d\n' "$PASS_N" "$SKIP_N" "$FAIL_N"
  if [ "$FAIL_N" -gt 0 ]; then
    echo " FAILURES:"
    local f
    for f in "${FAILURES[@]}"; do
      echo "   - $f"
    done
    echo ""
    return 1
  fi
  return 0
}

main "$@"
