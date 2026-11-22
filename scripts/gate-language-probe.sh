#!/usr/bin/env bash
# ============================================================================
# gate-language-probe.sh — prove a gate BLOCKS real defects in a real language
#
# WHY THIS EXISTS
#   "The gate has a branch for language X" and "the gate blocks a defect in
#   language X" are different claims, and only the second is worth anything.
#   Structural tests -- a registry row exists, an arm mentions the extension, a
#   function is defined -- stay green when an adapter is a stub, invokes a tool on
#   the wrong path, or parses a format the tool no longer emits.
#
#   Measured in this repository, one instance of each shape:
#     - Gate 13 loaded a 1458-line copy while the maintained 1770-line copy sat
#       unused, so the declared-check arm did not exist. Every structural test
#       passed.
#     - Gate 12 resolved its scanner one directory too high, so the awk file was
#       never found. All three content checks silently reported nothing. PASS.
#     - Gate 4 printed "NOT ANALYSED: python" while the report recorded PASS with
#       an empty reason.
#     - Gate 8 refused a commit over a leaked token and recorded SKIP.
#
#   A probe is the only thing that catches these: put a defect in front of the
#   gate and require it to refuse.
#
# THE CONTRACT, PER CASE
#   defective input -> must NOT be PASS   (the gate really looks)
#   clean input     -> must NOT be FAIL   (the gate is not a constant)
#
#   Requiring only the first half passes a gate that always blocks; only the
#   second passes one that never does.
#
# "NOT PASSED" IS THE CONTRACT, NOT "BLOCKED"
#   SKIP and WARN are acceptable outcomes for the defective arm, because the
#   principle is that "not checked" must never be recorded as "passed". What is
#   never acceptable is PASS. A gate that honestly warns it could not analyse PHP
#   without a manifest is working; one that says PASS is not.
#
# EACH ARM GETS ITS OWN REPO
#   The gate writes into .xp-gate/ and .quality-history.jsonl. Reusing one repo
#   means the second arm's change set is entirely gate output, so the gate
#   concludes "no changed code files" and skips. Measured twice before the cause
#   was found, on python then on php.
#
# USAGE
#   bash scripts/gate-language-probe.sh             # every case
#   bash scripts/gate-language-probe.sh python_gate1 go_gate1
#   bash scripts/gate-language-probe.sh --list      # what is available
#   KEEP_PROBE=1 PROBE_WORK_ROOT=/tmp/x bash scripts/gate-language-probe.sh
# ============================================================================
set -uo pipefail

_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$_SCRIPT_DIR/.." && pwd)
GATE_HOME="$REPO_ROOT/githooks"
WORK_ROOT=${PROBE_WORK_ROOT:-$(mktemp -d)}

# Separator for the optional second-file argument. One character, so a probe can
# pass "Bad.csproj<TAB><project/>" and have the helper split it.
TAB=$(printf '\t')

PASSED=0
FAILED=0
SKIPPED=0
RESULTS=()

# Filled by probe_defect so the caller can report the status it observed.
PROBE_STATUS=""

cleanup() { [ "${KEEP_PROBE:-0}" = "1" ] || rm -rf "$WORK_ROOT"; }
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "────────────────────────────────────────────────────────────"; }

# ---------------------------------------------------------------------------
# Probe repo and gate invocation
# ---------------------------------------------------------------------------

# A fresh probe repo, printed on stdout.
#
# The branch name matters: XP_GATE_ONLY_GATE is refused on main/master, so it has
# to be something else. The .nohooks directory has to EXIST and contain nothing:
# git rejects a hooksPath that is not a directory, the base commit then fails, and
# because this function silences its own output the failure surfaced much later as
# an empty change set.
new_probe() {
  local name="$1"
  local dir="$WORK_ROOT/$name"
  rm -rf "$dir"
  mkdir -p "$dir"
  ( cd "$dir" \
    && git init -q -b "probe-$name" \
    && git config user.email probe@example.com \
    && git config user.name probe \
    && git config core.hooksPath "$GATE_HOME" ) >/dev/null 2>&1
  # A base commit WITH A FILE. gitleaks (gate 8) reports "0 commits scanned" for a
  # repository with no history, and for an empty commit, so it would read its own
  # empty history as a clean scan. Hooks are detached through an empty directory
  # rather than --no-verify, which this repository forbids.
  ( cd "$dir" \
    && printf 'probe base' > .probe-base \
    && git add .probe-base \
    && git -c core.hooksPath="$WORK_ROOT/.nohooks" commit -qm base ) >/dev/null 2>&1
  printf '%s' "$dir"
}

# Run one gate in a probe repo; stdout+stderr are the gate's console output.
# The hook exits non-zero on a refusal, so the exit status is NOT the verdict --
# the verdict has to be read from the report or from the gate's own banner.
run_gate() {
  local dir="$1" gate="$2"
  ( cd "$dir" && XP_GATE_ONLY_GATE="$gate" timeout 300 git commit -m "probe" ) 2>&1
}

# The status word for a gate, from the newest report, falling back to the banner.
gate_status() {
  local dir="$1" gate="$2" out="$3"
  local f st
  # shellcheck disable=SC2012  # report names are timestamps this gate wrote
  f=$(ls -t "$dir"/.xp-gate/reports/pre-commit/*.json 2>/dev/null | head -1)
  if [ -n "$f" ]; then
    st=$(REPORT="$f" GATE="$gate" node -e '
      const fs = require("fs");
      try {
        const r = JSON.parse(fs.readFileSync(process.env.REPORT, "utf8"));
        const want = "gate" + process.env.GATE;
        // Report keys are "gate1_static_analysis" / "gate13_compiler_strictness".
        // Matching on want + "_" (with a trailing separator) finds nothing for
        // gate1, which silently pushed every python probe onto the console path.
        const k = Object.keys(r.gates || {}).find((key) => {
          const l = key.toLowerCase();
          return l === want || l.startsWith(want + "_");
        });
        if (k && r.gates[k] && r.gates[k].status) { console.log(r.gates[k].status); process.exit(0); }
      } catch (e) { /* fall through to the banner */ }
      console.log("");
    ' 2>/dev/null)
    if [ -n "$st" ]; then printf '%s' "$st"; return; fi
  fi
  # The gate's OWN banner is the only reliable console line: "  Gate 4: Principles  PASS".
  # An earlier version matched any line containing the gate number and therefore
  # read the driver's "Gates not named are recorded as SKIP/not_selected" banner,
  # reporting SKIP for a gate that had just blocked.
  local banner
  banner=$(printf '%s' "$out" | grep -E "^[[:space:]]*Gate ${gate}:" | tail -1)
  if [ -n "$banner" ]; then
    case "$banner" in
      *FAIL*|*BLOCK*) printf 'FAIL' ;;
      *WARN*)         printf 'WARN' ;;
      *SKIP*)         printf 'SKIP' ;;
      *PASS*)         printf 'PASS' ;;
      *)              printf 'UNKNOWN' ;;
    esac
    return
  fi
  if printf '%s' "$out" | grep -q "BLOCKED"; then printf 'FAIL'
  else printf 'UNKNOWN'; fi
}

# ---------------------------------------------------------------------------
# Assertions and bookkeeping
# ---------------------------------------------------------------------------

expect_not() {
  local label="$1" actual="$2" forbidden="$3"
  if [ "$actual" = "$forbidden" ]; then
    say "    ✗ $label: got $actual (must not be $forbidden)"
    return 1
  fi
  say "    ✓ $label: $actual"
  return 0
}

record() {
  local name="$1" ok="$2" detail="$3"
  if [ "$ok" = "1" ]; then
    PASSED=$((PASSED + 1))
    RESULTS+=("PASS  $name  $detail")
  else
    FAILED=$((FAILED + 1))
    RESULTS+=("FAIL  $name  $detail")
  fi
}

skip_case() {
  local name="$1" why="$2"
  SKIPPED=$((SKIPPED + 1))
  RESULTS+=("SKIP  $name  $why")
  say "  ⏭  $name — $why"
}

# Write one file into a probe repo, creating parents.
#
# mkdir -p first: a probe file may live at src/main/java/com/example/interfaces/
# rest/. Redirection alone does not create parents, so the write failed, nothing
# was staged, and four probes reported "gate did not block" against an empty
# change set.
write_probe_file() {
  local dir="$1" path="$2" content="$3"
  mkdir -p "$(dirname "$dir/$path")"
  printf '%s' "$content" > "$dir/$path"
}

# Stage ONLY the file(s) under test.
#
# A bare `git add -A` also stages the gate's own output (.xp-gate/,
# .quality-history.jsonl); on a second run the change set is then entirely gate
# artefacts and the gate concludes "no changed code files".
stage_probe_files() {
  local dir="$1"; shift
  ( cd "$dir" && git add -- "$@" ) >/dev/null 2>&1
}

# Write every extra "path<TAB>content" argument into the probe repo.
#
# More than one extra is needed: gate 9 only recognises a TypeScript project when
# package.json AND tsconfig.json both exist, and a probe that wrote just one of them
# measured a SKIP that looked like a gate verdict.
# Give a probe repo the gate's own checker source, so the probe measures THIS
# repository and not whatever happens to be installed globally.
#
# Gate 9 resolves its checker through a three-tier chain:
#
#   $PROJECT_ROOT/src/build-integrity/gate-10.ts
#   .xp-gate/modules/build-integrity/gate-10.ts
#   $HOME/.config/xp-gate/modules/build-integrity/gate-10.ts
#
# A probe repo has none of those, so every measurement silently fell through to the
# THIRD tier -- a stale global copy. Measured 2026-11-22: the entry-point fix was
# committed and verified by direct invocation, yet the probe still reported PASS on a
# manifest whose main pointed nowhere, because the gate had loaded the previous
# release from ~/.config/xp-gate. A probe that reports the installed artifact while
# claiming to test the working tree is worse than no probe: it read exactly like a
# product defect and cost a full round of re-measuring.
#
# Linking the real directory (rather than copying) keeps the probe honest when the
# source changes between runs, and needs no sync step to remember.
link_gate_source() {
  local dir="$1"
  [ -d "$REPO_ROOT/src/build-integrity" ] || return 0
  # SECOND tier on purpose: .xp-gate/modules/ is where gate 9 looks next, and it is
  # NOT a path the probe's tsconfig include glob covers. Linking into src/ instead
  # made the probe compile this repository's own checker sources as if they were the
  # probe project code. Measured 2026-11-22: 65 tsc errors, and the clean arm that
  # must never be refused came back BLOCK.
  local target="$dir/.xp-gate/modules/build-integrity"
  mkdir -p "$dir/.xp-gate/modules"
  ln -s "$REPO_ROOT/src/build-integrity" "$target" 2>/dev/null || cp -r "$REPO_ROOT/src/build-integrity" "$target"
}

write_extra_files() {
  local dir="$1"; shift
  local extra xpath xcontent
  for extra in "$@"; do
    [ -n "$extra" ] || continue
    xpath=${extra%%"$TAB"*}
    xcontent=${extra#*"$TAB"}
    write_probe_file "$dir" "$xpath" "$xcontent"
  done
}

# probe_defect <suffix> <gate> <file> <content> <label> [<extra-file>]
#   extra-file is "path<TAB>content" — C# needs a .csproj beside the .cs.
probe_defect() {
  local suffix="$1" gate="$2" file="$3" content="$4" label="$5"
  shift 5
  local dir out st
  dir=$(new_probe "$suffix")
  write_probe_file "$dir" "$file" "$content"
  # Gate 9 reads its checker from the PROJECT tree; without this the probe
  # silently measured the installed release instead of this working tree.
  [ "$gate" = "9" ] && link_gate_source "$dir"
  write_extra_files "$dir" "$@"
  stage_probe_files "$dir" "$file"
  out=$(run_gate "$dir" "$gate")
  st=$(gate_status "$dir" "$gate" "$out")
  PROBE_STATUS="$st"
  expect_not "$label not passed" "$st" "PASS"
}

# probe_clean <suffix> <gate> <file> <content> [<extra-file>]
#   The same project, written clean: the gate must not refuse it.
probe_clean() {
  local suffix="$1" gate="$2" file="$3" content="$4"
  shift 4
  local dir out st
  dir=$(new_probe "$suffix")
  write_probe_file "$dir" "$file" "$content"
  # Gate 9 reads its checker from the PROJECT tree; without this the probe
  # silently measured the installed release instead of this working tree.
  [ "$gate" = "9" ] && link_gate_source "$dir"
  write_extra_files "$dir" "$@"
  stage_probe_files "$dir" "$file"
  out=$(run_gate "$dir" "$gate")
  st=$(gate_status "$dir" "$gate" "$out")
  expect_not "clean input not refused" "$st" "FAIL"
}

# ---------------------------------------------------------------------------
# CASES
#
# Each case documents why its defect is the right one. Several were rewritten
# after the first version fired a false alarm against the gate: a probe that says
# "the gate is blind" is wrong often enough that the defect has to be one the
# tool provably reports.
# ---------------------------------------------------------------------------

probe_python_gate1() {
  local ok=1 st
  probe_defect py-g1-bad 1 broken.py 'def f(:
    return 1
' "syntax error" || ok=0
  st="$PROBE_STATUS"
  probe_clean py-g1-ok 1 broken.py 'def f() -> int:
    return 1
' || ok=0
  record "python/gate-1" "$ok" "syntax error -> $st"
}

probe_go_gate1() {
  if ! command -v go >/dev/null 2>&1; then skip_case "go/gate-1" "go not installed"; return; fi
  local ok=1 st
  probe_defect go-g1-bad 1 a.go 'package p

func F() {
	undefinedThing()
}
' "undefined call" || ok=0
  st="$PROBE_STATUS"
  probe_clean go-g1-ok 1 a.go 'package p

func F() int { return 1 }
' || ok=0
  record "go/gate-1" "$ok" "undefined call -> $st"
}

probe_java_gate1() {
  if ! command -v javac >/dev/null 2>&1; then skip_case "java/gate-1" "javac not installed"; return; fi
  local ok=1 st
  # A PACKAGE DECLARATION and a non-utility class shape are part of "clean" here.
  # PMD's quickstart ruleset fires NoPackage and UseUtilityClass on a bare
  # "public class X { static ... }", so the first clean sample was refused by
  # gate 1 for reasons that had nothing to do with the defect being probed --
  # a false accusation against the gate, of exactly the kind the comment at the
  # top of this file warns about. Measured 2026-11-22.
  # A LINT defect, not a type error. Type checking is gate 9's job: the adapter
  # says so at line 938 ("The old direct mvn/gradle compile here moved to Build
  # Integrity"). Probing a type error against gate 1 produced a false accusation
  # for two rounds -- javac caught it, checkstyle/pmd/lizard correctly did not.
  probe_defect java-g1-bad 1 src/main/java/probe/OrderCalculator.java 'package probe;

public class OrderCalculator {
  public int total() {
    int x = 1;
    return x;
  }
}
' "unnecessary local before return" || ok=0
  st="$PROBE_STATUS"
  probe_clean java-g1-ok 1 src/main/java/probe/OrderCalculator.java 'package probe;

public class OrderCalculator {
  public int total() { return 1; }
}
' || ok=0
  record "java/gate-1" "$ok" "pmd lint -> $st"
}

probe_csharp_gate1() {
  if ! command -v dotnet >/dev/null 2>&1; then skip_case "csharp/gate-1" "dotnet not installed"; return; fi
  local ok=1 st proj
  # A .csproj is REQUIRED. Without one `dotnet build` refuses with MSB1003 ("no
  # project or solution file in the current directory"), which is a PROBE defect
  # and not a gate defect; the first version shipped only the .cs and read the
  # resulting PASS as a hole in gate 1.
  proj='<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
'
  probe_defect cs-g1-bad 1 Bad.cs 'public class Bad {
  public static int F() { return "not an int"; }
}
' "type error" "Bad.csproj${TAB}${proj}" || ok=0
  st="$PROBE_STATUS"
  probe_clean cs-g1-ok 1 Bad.cs 'public class Bad {
  public static int F() { return 1; }
}
' "Bad.csproj${TAB}${proj}" || ok=0
  record "csharp/gate-1" "$ok" "type error -> $st"
}

probe_php_gate1() {
  if ! command -v php >/dev/null 2>&1; then skip_case "php/gate-1" "php not installed"; return; fi
  local ok=1 st
  probe_defect php-g1-bad 1 bad.php '<?php
function f( {
    return 1;
}
' "syntax error" || ok=0
  st="$PROBE_STATUS"
  probe_clean php-g1-ok 1 bad.php '<?php
function f(): int {
    return 1;
}
' || ok=0
  record "php/gate-1" "$ok" "syntax error -> $st"
}

probe_ts_gate3() {
  if ! command -v node >/dev/null 2>&1; then skip_case "typescript/gate-3" "node not installed"; return; fi
  local ok=1 st deep simple
  deep=$(cat <<'TS'
export function tangled(a: number, b: number): number {
  if (a > 0) { if (b > 0) { if (a > b) { if (b > 1) { if (a > 2) {
    return 1;
  } } } } }
  if (a < 0) { if (b < 0) { return 2; } }
  if (a === b) { return 3; }
  if (a !== b) { return 4; }
  switch (a) { case 1: return 5; case 2: return 6; case 3: return 7; default: return 8; }
}
TS
)
  probe_defect ts-g3-bad 3 complex.ts "$deep" "ccn over threshold" || ok=0
  st="$PROBE_STATUS"
  simple=$(cat <<'TS'
export function add(a: number, b: number): number {
  return a + b;
}
TS
)
  probe_clean ts-g3-ok 3 complex.ts "$simple" || ok=0
  record "typescript/gate-3" "$ok" "ccn -> $st"
}

probe_gate4_principles() {
  if ! command -v node >/dev/null 2>&1; then skip_case "java/gate-4" "node not installed"; return; fi
  local ok=1 st bad good
  # A rule that is `error` BY DEFAULT. Every clean-code rule ships as warning or
  # info, so the first version of this probe -- a deep-nesting pyramid -- measured
  # nothing: gate 4 correctly printed "2 warnings" and correctly PASSED, and that
  # PASS was read as a gate hole. Same mistake as the low-entropy token in gate 8:
  # the probe was wrong and the gate was right.
  # `arch.controller` is error by default: a class in interfaces/rest must end in
  # "Controller".
  bad=$(cat <<'JAVA'
package com.example.interfaces.rest;

public class OrderEndpoint {
    public String get() {
        return "ok";
    }
}
JAVA
)
  good=$(cat <<'JAVA'
package com.example.interfaces.rest;

public class OrderController {
    public String get() {
        return "ok";
    }
}
JAVA
)
  probe_defect g4-bad 4 src/main/java/com/example/interfaces/rest/OrderEndpoint.java "$bad" "misnamed controller" || ok=0
  st="$PROBE_STATUS"
  probe_clean g4-ok 4 src/main/java/com/example/interfaces/rest/OrderEndpoint.java "$good" || ok=0
  record "java/gate-4" "$ok" "arch.controller naming -> $st"
}

probe_gate2_duplicates() {
  local ok=1 d out
  # Gate 2 DOES NOT BLOCK ON DUPLICATES. gate-2-entry.sh line 93 says so in as many
  # words: "jscpd found duplicated code (warning, not blocking by default)", and the
  # 48.72% figure in the comment there is this exact fixture. So a PASS over a
  # duplicate is the designed verdict, not a defect -- an earlier version of this
  # probe read it as a hole and was wrong.
  #
  # What is still worth proving is that jscpd REALLY RAN and really found the
  # clone. Otherwise "not blocking" is indistinguishable from "never looked", which
  # is the defect this file exists to catch. So this case asserts on the console
  # report instead of on the status word -- and it is the only case here that does,
  # for the documented reason above.
  local dup
  dup=$(cat <<'JS'
export function alpha(rows) {
  let total = 0;
  let count = 0;
  let sumSquares = 0;
  for (const row of rows) {
    if (row.amount > 0) {
      total += row.amount;
      count += 1;
      sumSquares += row.amount * row.amount;
    } else if (row.amount < 0) {
      total -= row.amount;
      count += 1;
      sumSquares += row.amount * row.amount;
    }
  }
  const mean = count === 0 ? 0 : total / count;
  const variance = count === 0 ? 0 : sumSquares / count - mean * mean;
  return { total, count, mean, variance };
}

export function beta(rows) {
  let total = 0;
  let count = 0;
  let sumSquares = 0;
  for (const row of rows) {
    if (row.amount > 0) {
      total += row.amount;
      count += 1;
      sumSquares += row.amount * row.amount;
    } else if (row.amount < 0) {
      total -= row.amount;
      count += 1;
      sumSquares += row.amount * row.amount;
    }
  }
  const mean = count === 0 ? 0 : total / count;
  const variance = count === 0 ? 0 : sumSquares / count - mean * mean;
  return { total, count, mean, variance };
}
JS
)
  d=$(new_probe g2-dup)
  write_probe_file "$d" dup.js "$dup"
  stage_probe_files "$d" dup.js
  out=$(run_gate "$d" 2)
  if printf '%s' "$out" | grep -q "Clone found"; then
    say "    ✓ jscpd reported the clone"
  else
    say "    ✗ jscpd did not report the clone (it may not have analysed the file)"
    ok=0
  fi
  # And the gate must not have called it a failure either: duplicates are a
  # warning by design.
  local st
  st=$(gate_status "$d" 2 "$out")
  if [ "$st" = "FAIL" ]; then
    say "    ✗ duplicates were treated as blocking; the documented contract says warning"
    ok=0
  else
    say "    ✓ duplicates are a warning, status $st"
  fi
  record "javascript/gate-2" "$ok" "clone detected, non-blocking -> $st"
}

probe_gate10_sast() {
  if ! command -v semgrep >/dev/null 2>&1; then skip_case "python/gate-10" "semgrep not installed"; return; fi
  local ok=1 st bad good
  # eval / shell=True on request data: the canonical SAST finding.
  bad=$(cat <<'PY'
import subprocess


def run(cmd):
    subprocess.call(cmd, shell=True)
    return eval(cmd)
PY
)
  good=$(cat <<'PY'
import subprocess


def run(argv):
    return subprocess.call(argv, shell=False)
PY
)
  probe_defect g10-bad 10 danger.py "$bad" "shell=True + eval" || ok=0
  st="$PROBE_STATUS"
  probe_clean g10-ok 10 danger.py "$good" || ok=0
  record "python/gate-10" "$ok" "eval/shell=True -> $st"
}

probe_secret_gate8() {
  local ok=1 st tok
  # A GitHub PAT has to look REAL: gitleaks matches on entropy, so a token of one
  # repeated character is correctly ignored. Measured: "ghp_" plus 36 identical
  # characters scans clean, while a mixed-case-and-digit token fires github-pat.
  # The first version used the low-entropy one, read the clean scan as a Gate 8
  # hole, and was wrong.
  #
  # ASSEMBLED AT RUN TIME, not written as a literal: staged as a literal it made
  # gate 8 block THIS repository's own commits -- twice -- which is the gate doing
  # its job on the file that tests it.
  tok="ghp_$(printf %s 'aB3dEfGh1JkLmN0pQrStUvWxYz234567890a')"
  probe_defect secret-g8-bad 8 creds.py "GITHUB_TOKEN = \"$tok\"
" "GitHub PAT" || ok=0
  st="$PROBE_STATUS"
  record "any/gate-8" "$ok" "PAT -> $st"
}

probe_ts_gate9() {
  if ! command -v node >/dev/null 2>&1; then skip_case "typescript/gate-9" "node not installed"; return; fi
  local ok=1 st pkggood pkgbad tsconf src
  # Gate 9's TypeScript half needs a real package.json: without a "files" field the
  # pack check SKIPs (by design -- npm ships everything and the question has no
  # answer), and without package.json at all the gate SKIPs entirely.
  pkggood='{"name":"p","version":"1.0.0","main":"src/index.ts","files":["src"],"scripts":{"build":"tsc"}}'
  # The measured defect: main points at a path the tarball does not contain. Before
  # the fix this produced "pack: PASS, Overall: PASS" for a package with no loadable
  # entry point.
  pkgbad='{"name":"p","version":"1.0.0","main":"src/nonexistent.js","files":["src"],"scripts":{"build":"tsc"}}'
  tsconf='{"compilerOptions":{"strict":true,"target":"ES2020","module":"commonjs","noEmit":true},"include":["src/**/*"]}'
  src='export function add(a: number, b: number): number {
  return a + b;
}
'
  # BOTH files are required: gate 9 recognises a TypeScript project only when
  # package.json AND tsconfig.json exist, and a probe that wrote just one of them
  # measured a SKIP that looked like a verdict.
  probe_defect ts-g9-bad 9 src/index.ts "$src" "unreachable main"     "package.json${TAB}${pkgbad}" "tsconfig.json${TAB}${tsconf}" || ok=0
  st="$PROBE_STATUS"
  probe_clean ts-g9-ok 9 src/index.ts "$src"     "package.json${TAB}${pkggood}" "tsconfig.json${TAB}${tsconf}" || ok=0
  record "typescript/gate-9" "$ok" "unreachable main -> $st"
}

probe_gate12_hygiene() {
  local ok=1 st
  # Trailing whitespace plus a missing final newline: exactly what gate 12 reports
  # ("Issues: trailing-whitespace no-eof-newline" -> WARN).
  #
  # A CODE file, not a .txt: a documentation-only commit takes the gate's
  # diff-scoped short-circuit and the heavy checks are skipped by design. Measured
  # 2026-11-22 -- the first version used bad.txt and read the short-circuit as the
  # gate being blind.
  #
  # WARN is the correct verdict here, not BLOCK: file hygiene is advisory in this
  # repository. The contract is "must not be PASS", and WARN with named issues is
  # the gate doing its job.
  probe_defect g12-bad 12 bad.py 'x = 1   
y = 2' "trailing ws + no EOF newline" || ok=0
  st="$PROBE_STATUS"
  probe_clean g12-ok 12 bad.py 'x = 1
y = 2
' || ok=0
  record "any/gate-12" "$ok" "trailing ws -> $st"
}

probe_java_gate13() {
  if ! command -v javac >/dev/null 2>&1; then skip_case "java/gate-13" "javac not installed"; return; fi
  local ok=1 st
  # A type error, which is gate 13's job and no other gate's: gate 1 runs
  # checkstyle/pmd/spotbugs/lizard (none do type checking), and gate 9 SKIPs a repo
  # with no Maven/Gradle build file. Measured 2026-11-22 -- before the adapter
  # declared javac, this defect passed every gate.
  probe_defect java-g13-bad 13 src/main/java/probe/OrderCalculator.java 'package probe;

public class OrderCalculator {
  public static int total() {
    return "not an int";
  }
}
' "incompatible return type" || ok=0
  st="$PROBE_STATUS"
  probe_clean java-g13-ok 13 src/main/java/probe/OrderCalculator.java 'package probe;

public class OrderCalculator {
  public static int total() { return 1; }
}
' || ok=0
  record "java/gate-13" "$ok" "type error -> $st"
}

probe_ts_gate13() {
  if ! command -v node >/dev/null 2>&1; then skip_case "typescript/gate-13" "node not installed"; return; fi
  local ok=1 st tsconf
  # A tsconfig that IS strict, so "clean" and "defective" differ only in the code.
  # Gate 13 reads the project's declared strictness through compiler_check_command;
  # a configuration nobody chose would make the probe measure tsc's defaults.
  tsconf=$(cat <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "module": "commonjs",
    "noEmit": true
  }
}
JSON
)
  # Implicit any: the canonical strict-mode failure. Verified by hand 2026-11-22 --
  # tsc reports TS7006 for this file and nothing for the fixed one, so the probe is
  # measuring the type checker rather than guessing at it.
  #
  # THIS CASE ALSO CAUGHT A REAL GATE DEFECT: before the fix the TypeScript adapter
  # declared no compiler_check_command, so Gate 13 printed "no compiler/type-checker
  # declared for this language" and SKIPPED -- on a project that ships a tsconfig.
  probe_defect ts-g13-bad 13 bad.ts 'export function f(x) {
  return x + 1;
}
' "implicit any" "tsconfig.json${TAB}${tsconf}" || ok=0
  st="$PROBE_STATUS"
  probe_clean ts-g13-ok 13 bad.ts 'export function f(x: number): number {
  return x + 1;
}
' "tsconfig.json${TAB}${tsconf}" || ok=0
  record "typescript/gate-13" "$ok" "implicit any -> $st"
}

probe_iac_gate7() {
  if ! command -v terraform >/dev/null 2>&1 && ! command -v tflint >/dev/null 2>&1; then
    skip_case "iac/gate-7" "no IaC scanner installed"; return
  fi
  local ok=1 st tf
  tf=$(cat <<'TF'
resource "aws_s3_bucket" "b" {
  bucket = "probe-bucket"
  acl    = "public-read"
}
TF
)
  probe_defect iac-g7-bad 7 main.tf "$tf" "public bucket" || ok=0
  st="$PROBE_STATUS"
  record "iac/gate-7" "$ok" "public-read ACL -> $st"
}

# ---------------------------------------------------------------------------

ALL_CASES=(
  python_gate1 go_gate1 java_gate1 csharp_gate1 php_gate1
  ts_gate3 gate4_principles gate2_duplicates gate10_sast
  secret_gate8 iac_gate7 ts_gate13 java_gate13 gate12_hygiene ts_gate9
)

show_list() {
  say "Available probes:"
  for c in "${ALL_CASES[@]}"; do say "  ${c}"; done
}

dispatch() {
  local c="$1"
  case "$c" in
    python_gate1)     say "  ▸ python / gate-1";     probe_python_gate1 ;;
    go_gate1)         say "  ▸ go / gate-1";         probe_go_gate1 ;;
    java_gate1)       say "  ▸ java / gate-1";       probe_java_gate1 ;;
    csharp_gate1)     say "  ▸ csharp / gate-1";     probe_csharp_gate1 ;;
    php_gate1)        say "  ▸ php / gate-1";        probe_php_gate1 ;;
    ts_gate3)         say "  ▸ typescript / gate-3"; probe_ts_gate3 ;;
    gate4_principles) say "  ▸ java / gate-4";       probe_gate4_principles ;;
    gate2_duplicates) say "  ▸ javascript / gate-2"; probe_gate2_duplicates ;;
    gate10_sast)      say "  ▸ python / gate-10";    probe_gate10_sast ;;
    secret_gate8)     say "  ▸ any / gate-8";        probe_secret_gate8 ;;
    iac_gate7)        say "  ▸ iac / gate-7";        probe_iac_gate7 ;;
    ts_gate13)        say "  ▸ typescript / gate-13"; probe_ts_gate13 ;;
    java_gate13)      say "  ▸ java / gate-13";      probe_java_gate13 ;;
    gate12_hygiene)   say "  ▸ any / gate-12";       probe_gate12_hygiene ;;
    ts_gate9)         say "  ▸ typescript / gate-9";  probe_ts_gate9 ;;
    *) say "  ? unknown case: $c"; return 1 ;;
  esac
}

main() {
  local -a want=()
  local a c
  for a in "$@"; do
    case "$a" in
      --list) show_list; exit 0 ;;
      *) want+=("$a") ;;
    esac
  done
  [ ${#want[@]} -eq 0 ] && want=("${ALL_CASES[@]}")

  mkdir -p "$WORK_ROOT/.nohooks"

  hr
  say "GATE × LANGUAGE PROBE — a gate is only valid if it refuses a real defect"
  say "repo: $REPO_ROOT"
  say "work: $WORK_ROOT"
  hr

  for c in "${want[@]}"; do
    dispatch "$c" || true
  done

  hr
  printf '%s\n' "${RESULTS[@]}"
  hr
  say "passed=$PASSED failed=$FAILED skipped=$SKIPPED"
  [ "$FAILED" -eq 0 ] || exit 1
}

main "$@"
