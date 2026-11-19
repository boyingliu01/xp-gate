#!/usr/bin/env bash
#
# Gate x language matrix probe.
#
# WHAT THIS ANSWERS
#   For every (gate, language) pair: did the gate produce a REAL verdict?
#
#   A real verdict is PASS with something actually checked, BLOCK because it found
#   the defect, or SKIP with a reason. What the objective forbids is "not checked"
#   recorded as "checked and fine" -- i.e. PASS on a language the gate cannot read.
#
# WHY IT IS A SCRIPT AND NOT A BATS SUITE
#   It shells out to 15 toolchains and runs the real hook twice per language. As a
#   bats suite it would take the whole CI budget by itself and fail on any machine
#   missing one language's toolchain; as a probe it produces the matrix as DATA,
#   which is what the deliverable asks for.
#
# USAGE
#   bash scripts/probe-gate-matrix.sh                 # all languages
#   bash scripts/probe-gate-matrix.sh go typescript   # selected
#
# Each language gets TWO runs:
#   clean -- a well-formed project. Any BLOCK here is a false positive.
#   dirty -- the same project plus one planted defect that a compiler or analyser
#            must catch. A PASS from the gate whose subject is that defect means
#            the gate reported something it did not compute.
#
# Output is one JSON object per line (JSONL): a reader can diff two runs.
#
# ASCII only: the JSON is parsed by node on the other end.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The work root must be a NATIVE path, because python (which parses the reports)
# is a Windows program here and resolves "/tmp/..." to "C:\tmp\...", while MSYS
# bash resolves the same string to "C:\Users\<user>\AppData\Local\Temp\...".
#
# Measured cost of getting this wrong: every row in the matrix read "NO_REPORT",
# which the analyzer reported as "gate never ran" for all fourteen gates on every
# language -- a spectacular false finding produced by a path separator.
WORK_ROOT="${TMPDIR:-/tmp}/xpgate-matrix"
if command -v cygpath >/dev/null 2>&1; then
  WORK_ROOT="$(cygpath -m "$WORK_ROOT")"
fi
LANGS=()

for arg in "$@"; do
  case "$arg" in
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) LANGS+=("$arg") ;;
  esac
done

if [ ${#LANGS[@]} -eq 0 ]; then
  LANGS=(go typescript python java kotlin dart cpp csharp php shell powershell swift objectivec iac flutter)
fi

# --- fixtures ---------------------------------------------------------------
#
# write_fixture lang clean|dirty
#
# Every fixture is self-contained and one directory deep. A language whose
# toolchain is absent still gets a fixture: the probe then records what the gates
# say about a language nobody can check, which is the interesting case.
write_fixture() {
  local lang="$1" mode="$2" bad=0
  [ "$mode" = "dirty" ] && bad=1

  case "$lang" in
    go)
      printf 'module probe\n\ngo 1.21\n' > go.mod
      # Fixture design, learned the hard way: the planted defect must be the ONLY
      # thing any tool could object to.
      #
      #   `var x int` unused        -> golangci-lint `unused` on the CLEAN fixture.
      #   `var x int = 2`           -> staticcheck ST1023 "should omit type int".
      #   `x := "not an int"`       -> not a type error at all; Go infers string.
      #
      # Passing a wrong-typed literal into a function that takes int is a real
      # compile error, and the clean counterpart is idiomatic Go that golangci-lint
      # reports 0 issues on (measured).
      if [ "$bad" = 1 ]; then
        printf 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(intOf("not an int"))\n}\n\nfunc intOf(v int) int { return v }\n' > main.go
      else
        printf 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(intOf(1))\n}\n\nfunc intOf(v int) int { return v }\n' > main.go
      fi
      ;;
    typescript)
      printf '{"compilerOptions":{"strict":true,"noEmit":true},"include":["*.ts"]}\n' > tsconfig.json
      printf '{"name":"probe","version":"1.0.0"}\n' > package.json
      # One source file has no architecture to violate, and archlint god_module
      # flags any single-file project (measured: 1 smell on a four-line file).
      # Gate 6 fails closed on a missing config by design, so the fixture
      # declares the exemption the design provides.
      : > .architecture-skip
      if [ "$bad" = 1 ]; then
        printf 'const x: number = "not a number";\nexport default x;\n' > a.ts
      else
        printf 'const x: number = 1;\nexport default x;\n' > a.ts
      fi
      ;;
    python)
      if [ "$bad" = 1 ]; then
        printf 'def f() -> int:\n    return "not an int"\n' > a.py
      else
        printf 'def f() -> int:\n    return 1\n' > a.py
      fi
      ;;
    java)
      mkdir -p src/main/java
      printf '<project><modelVersion>4.0.0</modelVersion><groupId>p</groupId><artifactId>p</artifactId><version>1</version></project>\n' > pom.xml
      if [ "$bad" = 1 ]; then
        printf 'package p;\npublic class A { public int f() { return "no"; } }\n' > src/main/java/A.java
      else
        printf 'package p;\npublic class A { public int f() { return 1; } }\n' > src/main/java/A.java
      fi
      ;;
    kotlin)
      if [ "$bad" = 1 ]; then
        printf 'fun intOf(v: Int): Int = v\n\nfun main() {\n    println(intOf("not an int"))\n}\n' > a.kt
      else
        printf 'fun intOf(v: Int): Int = v\n\nfun main() {\n    println(intOf(1))\n}\n' > a.kt
      fi
      ;;
    dart)
      printf 'name: probe\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n' > pubspec.yaml
      mkdir -p lib
      if [ "$bad" = 1 ]; then
        printf 'int f() {\n  return "not an int";\n}\n' > lib/a.dart
      else
        printf 'int f() {\n  return 1;\n}\n' > lib/a.dart
      fi
      ;;
    cpp)
      if [ "$bad" = 1 ]; then
        printf 'int main() { return not_a_symbol; }\n' > a.cpp
      else
        printf 'int main() { return 1; }\n' > a.cpp
      fi
      ;;
    csharp)
      printf '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n' > p.csproj
      if [ "$bad" = 1 ]; then
        printf 'class A { public int F() { return "no"; } }\n' > A.cs
      else
        printf 'class A { public int F() { return 1; } }\n' > A.cs
      fi
      ;;
    php)
      if [ "$bad" = 1 ]; then
        printf '<?php\nfunction f(): int { return "no"; }\n' > a.php
      else
        printf '<?php\nfunction f(): int { return 1; }\n' > a.php
      fi
      ;;
    shell)
      if [ "$bad" = 1 ]; then
        printf '#!/usr/bin/env bash\nf() { echo "$#" ; }\nf "unclosed\n' > a.sh
      else
        printf '#!/usr/bin/env bash\nf() { echo "$#" ; }\nf "ok" 1\n' > a.sh
      fi
      ;;
    powershell)
      if [ "$bad" = 1 ]; then
        printf 'function f { return "no" \n' > a.ps1
      else
        printf 'function f { return 1 }\n' > a.ps1
      fi
      ;;
    swift)
      if [ "$bad" = 1 ]; then
        printf 'let x: Int = "not an int"\n' > a.swift
      else
        printf 'let x: Int = 1\n' > a.swift
      fi
      ;;
    objectivec)
      if [ "$bad" = 1 ]; then
        printf '#import <Foundation/Foundation.h>\nint main() { int x = "no"; return x; }\n' > a.m
      else
        printf '#import <Foundation/Foundation.h>\nint main() { int x = 1; return x; }\n' > a.m
      fi
      ;;
    iac)
      if [ "$bad" = 1 ]; then
        printf 'resource "aws_s3_bucket" "b" {\n  bucket = "probe"\n  acl    = "not-a-real-acl-value"\n}\n' > main.tf
      else
        printf 'resource "aws_s3_bucket" "b" {\n  bucket = "probe-ok-1"\n}\n' > main.tf
      fi
      ;;
    flutter)
      printf 'name: probe\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n' > pubspec.yaml
      mkdir -p lib
      if [ "$bad" = 1 ]; then
        printf 'import "package:flutter/material.dart";\n\nint f() {\n  return "not an int";\n}\n' > lib/a.dart
      else
        printf 'import "package:flutter/material.dart";\n\nint f() {\n  return 1;\n}\n' > lib/a.dart
      fi
      ;;
    *)
      return 1
      ;;
  esac
}

first_source() {
  case "$1" in
    go) echo main.go ;;
    typescript) echo a.ts ;;
    python) echo a.py ;;
    java) echo src/main/java/A.java ;;
    kotlin) echo a.kt ;;
    dart|flutter) echo lib/a.dart ;;
    cpp) echo a.cpp ;;
    csharp) echo A.cs ;;
    php) echo a.php ;;
    shell) echo a.sh ;;
    powershell) echo a.ps1 ;;
    swift) echo a.swift ;;
    objectivec) echo a.m ;;
    iac) echo main.tf ;;
    *) echo "" ;;
  esac
}

# --- one run -----------------------------------------------------------------

# The report JSON is the authority, not the printed table.
#
# Measured while building this probe: parsing the human table produced ABSENT for
# eight of fourteen gates on a Python project where the run report showed Gate 1
# PASS, Gate 2 PASS, Gate 3 PASS and so on. The table is only printed when
# something fails or warns -- a clean run prints no table at all. A probe that
# read it would have reported "gates 1,2,3,4,5 ABSENT" as a product defect.
#
# githooks/AGENTS.md states the rule this follows: "Verdicts must come from
# structured output, not exit codes." The same applies to a probe reading a gate.
run_case() {
  local lang="$1" mode="$2" only="${3:-}"
  local dir="$WORK_ROOT/$lang"
  local out rc tag

  tag="${mode}${only:+-only-$only}"
  if [ -n "$only" ]; then
    # XP_GATE_ONLY_GATE isolates one gate. Needed because Gate 5 (tests +
    # coverage) blocks every minimal fixture -- one source file with no test suite
    # and no coverage report cannot satisfy an 80% floor. Without this second
    # pass, Gates 6 and 4 were never reached for ANY language, and the matrix
    # showed them as "not run" in every row.
    out=$(cd "$dir" && XP_GATE_ONLY_GATE="$only" timeout 900 git commit -m "$tag" 2>&1)
  else
    out=$(cd "$dir" && timeout 900 git commit -m "$tag" 2>&1)
  fi
  rc=$?

  # Keep the raw run for diagnosis. Without this, every wrong conclusion about
  # "the gate reported X" had to be re-derived by hand from a fixture that no
  # longer exists.
  printf '%s\n' "$out" > "$WORK_ROOT/${lang}-${tag}.log"

  PROBE_LANG="$lang" PROBE_MODE="$tag" PROBE_RC="$rc" PROBE_REPORT="$out" \
    PROBE_DIR="$dir" \
    python - <<'PY'
import os, re, json, glob

order = ["0", "1", "2", "3", "8", "10", "7", "5", "6", "4", "9", "11", "12", "13"]

# Map a gate NUMBER to the report key naming it. The report is keyed by a
# generated name (gate1_static_analysis), and NT is bound by the registry -- so
# read the digit prefix rather than hardcoding a second table that could drift.
def gate_num(key):
    m = re.match(r"^gate([0-9]+[a-c]?)_", key)
    return m.group(1) if m else None

report_dir = os.path.join(os.environ["PROBE_DIR"], ".xp-gate", "reports", "pre-commit")
files = sorted(glob.glob(os.path.join(report_dir, "*.json")))
data = None
if files:
    try:
        with open(files[-1], encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        data = None

gates = []
if data and isinstance(data.get("gates"), dict):
    found = {}
    for key, val in data["gates"].items():
        num = gate_num(key)
        if num is None or not isinstance(val, dict):
            continue
        found[num] = {
            "gate": num,
            "name": val.get("name") or "",
            "verdict": (val.get("status") or "UNKNOWN").upper(),
            "detail": val.get("detail") or val.get("reason") or "",
        }
    for gid in order:
        gates.append(found.get(gid, {"gate": gid, "name": "", "verdict": "ABSENT", "detail": ""}))
    source = "report"
else:
    # No report: the hook refused before writing one (protected branch, gate 0
    # block, crash). Record that rather than 14 identical ABSENTs.
    for gid in order:
        gates.append({"gate": gid, "name": "", "verdict": "NO_REPORT", "detail": ""})
    source = "none"

stopped = re.search(r"Chain stopped at Gate ([0-9]+[a-c]?)", os.environ["PROBE_REPORT"])
print(json.dumps({
    "language": os.environ["PROBE_LANG"],
    "mode": os.environ["PROBE_MODE"],
    "commit_rc": int(os.environ["PROBE_RC"]),
    "source": source,
    "report": os.path.basename(files[-1]) if files else None,
    "chain_stopped_at": stopped.group(1) if stopped else None,
    "gates": gates,
}, sort_keys=True))
PY
}

probe_language() {
  local lang="$1"
  local dir="$WORK_ROOT/$lang"

  # rm -rf can fail with "Device or resource busy" when a previous probe run still
  # has the directory as its cwd. That failure used to be INVISIBLE: mkdir -p
  # happily reused the residue, `git init` then failed inside a directory it could
  # not own, its stderr went to /dev/null, and every subsequent run in that
  # language produced "no report" -- which the analyzer reported as "gate never
  # ran" for all fourteen gates. A cleanup failure must stop the language, not
  # silently produce fourteen false findings.
  rm -rf "$dir" 2>/dev/null
  if [ -e "$dir" ]; then
    echo "cannot clear $dir -- a previous probe may still be running there" >&2
    return 0   # skip this language; the others are still worth measuring
  fi
  mkdir -p "$dir" || return 1
  cd "$dir" || return 1

  write_fixture "$lang" clean >/dev/null 2>&1 || { echo "no fixture for $lang" >&2; return 1; }

  # git init must be checked. A silent failure here produced a language whose
  # every row read "no report", with nothing in the output saying why.
  if ! git init -q -b "probe-$lang" . >/dev/null 2>&1; then
    echo "git init failed in $dir" >&2
    return 1
  fi
  git config user.email "probe@example.com"
  git config user.name "probe"
  # Build residue must not enter the baseline. `dotnet build` (Gate 5/9) writes
  # obj/ and bin/ into the fixture, and without this the baseline commit carried 17
  # compiled files -- which then slowed every subsequent case and made the change
  # set unreadable. This is fixture hygiene, not a product behaviour under test.
  printf "obj/
bin/
node_modules/
.dart_tool/
*.o
*.class
__pycache__/
.pytest_cache/
.ruff_cache/
target/
build/
" > .gitignore
  git config commit.gpgsign false
  git config core.hooksPath "$REPO_ROOT/githooks"

  git add -A >/dev/null 2>&1
  git -c core.hooksPath= commit -q --no-verify -m "baseline" >/dev/null 2>&1

  # CLEAN run: change the project WITHOUT changing its meaning, its formatting, or
  # any identifier that a toolchain assigns a role to.
  #
  # This took four attempts, and every wrong version produced a confident, FALSE
  # product defect:
  #
  #   1. Append a bare newline         -> content-identical, gates saw an empty
  #                                       change set and measured nothing.
  #   2. Append "// clean-run marker"  -> illegal in Python; Gate 1 correctly FAILED.
  #      Reported as "Gate 1 blocks a clean Python project".
  #   3. Append "# clean-run marker"   -> legal, but ruff format disliked the
  #      trailing newline; Gate 1 correctly FAILED again.
  #   4. sed s/\bmain\b/main2/         -> renamed Go's entry point; golangci-lint
  #      correctly called func main2 unused; Gate 1 correctly FAILED again.
  #
  # All four were the probe's bug wearing a product bug's clothes. The lesson is
  # not "write a better marker": a toolchain that knows what an identifier MEANS
  # can veto any edit that looks harmless.
  #
  # What works is rewriting a literal VALUE in the fixture. Every fixture has
  # exactly one by construction (`= 1`), the result is a real diff, and no
  # compiler, linter or formatter has an opinion about it.
  local src
  src=$(first_source "$lang")
  if [ -n "$src" ] && [ -f "$src" ]; then
    sed -i 's/\b1\b/2/' "$src" 2>/dev/null || true
  fi
  git add -A >/dev/null 2>&1
  run_case "$lang" clean

  # DIRTY run: plant the defect.
  write_fixture "$lang" dirty >/dev/null 2>&1
  git add -A >/dev/null 2>&1
  run_case "$lang" dirty

  # SECOND PASS, gates 6 and 4 only.
  #
  # Gate 5 (tests + coverage) blocks every minimal fixture: one source file with
  # no test suite and no coverage report cannot clear an 80% floor, and the gate
  # is fail-closed by design. That is correct behaviour and it is also why Gates 6
  # and 4 were never reached for ANY language -- the matrix showed them "not run"
  # in every single row, which told us nothing about them.
  #
  # XP_GATE_ONLY_GATE isolates them. It is refused on protected branches, which is
  # why every fixture lives on its own probe-* branch.
  run_case "$lang" dirty 6
  run_case "$lang" dirty 4
}

mkdir -p "$WORK_ROOT"

for lang in "${LANGS[@]}"; do
  probe_language "$lang"
done
