#!/usr/bin/env bash
# Gate x language effectiveness probe.
#
# Creates one project per language, stages a file with a KNOWN defect for a
# given gate, and asks: did the gate produce a real verdict, and was it the
# RIGHT verdict?
#
# The failure this exists to catch is not "the gate crashed". It is a gate that
# reports PASS (or worse, records a pass) over code it never examined -- the
# defect family named in both AGENTS files.
#
# Usage: bash scripts/probe-gate-matrix.sh [gate_key ...]
# Exit: 0 only when every probed combination produced the expected verdict.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/xp-probe-matrix"
rm -rf "$WORK"; mkdir -p "$WORK"

PASS_N=0; FAIL_N=0; SKIP_N=0
declare -a FAILURES=()

# --- helpers ---------------------------------------------------------------

# make_project <dir> <lang> <filename> <content>
make_project() {
  local dir="$1" lang="$2" file="$3" content="$4"
  mkdir -p "$dir"
  ( cd "$dir" && git init -q -b probe ) || return 1
  printf '%s\n' "$content" > "$dir/$file"
  # Minimal manifests so language detection has something to key on.
  case "$lang" in
    typescript) printf '{"name":"p","version":"1.0.0"}\n' > "$dir/package.json" ;;
    python)     printf '[project]\nname="p"\n' > "$dir/pyproject.toml" ;;
    go)         printf 'module p\n\ngo 1.21\n' > "$dir/go.mod" ;;
    java)       printf '<project/>\n' > "$dir/pom.xml" ;;
    kotlin)     printf '<project/>\n' > "$dir/pom.xml" ;;
    csharp)     printf '<Project Sdk="Microsoft.NET.Sdk"/>\n' > "$dir/p.csproj" ;;
    cpp|c)      printf 'cmake_minimum_required(VERSION 3.10)\nproject(p)\n' > "$dir/CMakeLists.txt" ;;
    swift)      printf '// swift-tools-version:5.5\n' > "$dir/Package.swift" ;;
    dart)       printf 'name: p\n' > "$dir/pubspec.yaml" ;;
    shell)      printf '#!/bin/sh\n' > "$dir/run.sh" ;;
    powershell) printf '# p\n' > "$dir/run.ps1" ;;
    iac)        printf 'terraform {}\n' > "$dir/main.tf" ;;
  esac
  ( cd "$dir" && git add -A && git -c user.email=p@p -c user.name=p \
      -c core.hooksPath= commit -q --no-verify -m init ) || return 1
  return 0
}

# stage_change <dir> <file> <content>
stage_change() {
  printf '%s\n' "$3" > "$1/$2"
  ( cd "$1" && git add "$2" )
}

# run_gate <dir> <lang> -> echoes the gate's console output
run_gate() {
  # Run the REPO's CLI, not the globally installed one. Measured the hard way: a
  # probe against the global `xp-gate` reported gate-6 PASS after the repo copy
  # already blocked, because a global install shadows the edit -- the exact trap
  # githooks/AGENTS.md warns about. A probe that measures a different binary than
  # the one under review is measuring the difference, not the product.
  # Two traps met here at once.
  #
  # 1. The global `xp-gate` on PATH was v0.38.9 while the repo is v0.38.21, so a
  #    probe against it measured a twelve-release-old binary and reported
  #    gate-6 PASS after the repo copy already blocked.
  # 2. The repo CLI only loads from its own package directory: run from the repo
  #    root it dies with ERR_MODULE_NOT_FOUND (src/scripts/generate-deploy-
  #    manifest.cjs), and that crash reads as "the gate found nothing".
  #
  # So: enter src/npm-package, then cd into the fixture. A probe that measures a
  # different binary than the one under review measures the difference.
  ( cd "$REPO/src/npm-package" && cd "$1" && timeout 300 node "$REPO/src/npm-package/bin/xp-gate.js" check "$2" 2>&1 ) || true
}

# record <name> <expected> <output>
record() {
  local name="$1" expect="$2" out="$3"
  local verdict="NONE"
  if printf '%s' "$out" | grep -qiE '❌|BLOCKED|FAIL'; then verdict="BLOCK"
  elif printf '%s' "$out" | grep -qiE '⏭️|SKIPPED|SKIP'; then verdict="SKIP"
  elif printf '%s' "$out" | grep -qiE '✅|PASSED|PASS'; then verdict="PASS"
  fi

  if [ "$verdict" = "$expect" ]; then
    PASS_N=$((PASS_N + 1))
    printf '  ✅ %-42s %-6s (expected %s)\n' "$name" "$verdict" "$expect"
  elif [ "$verdict" = "SKIP" ] && [ "$expect" = "SKIP" ]; then
    SKIP_N=$((SKIP_N + 1))
    printf '  ⏭️  %-42s %-6s (expected %s)\n' "$name" "$verdict" "$expect"
  else
    FAIL_N=$((FAIL_N + 1))
    FAILURES+=("$name: got $verdict, expected $expect")
    printf '  ❌ %-42s %-6s (expected %s)\n' "$name" "$verdict" "$expect"
    printf '%s\n' "$out" | tail -6 | sed 's/^/       | /'
  fi
}

# --- probes ----------------------------------------------------------------
# Each probe stages a file that MUST be caught, or a clean one that MUST pass.
# The negative probe (a real defect) is what proves the gate examined anything.

probe_gate0() {   # version consistency
  local d="$WORK/g0"
  make_project "$d" typescript pkg.json '{}' || return
  printf '{"name":"p","version":"9.9.9"}\n' > "$d/package.json"
  printf '1.0.0\n' > "$d/VERSION"
  printf '{"name":"p","version":"1.0.0"}\n' > "$d/package.json"
  ( cd "$d" && git add -A && git -c user.email=p@p -c user.name=p -c core.hooksPath= commit -q --no-verify -m base )
  # Now break it: VERSION and package.json disagree.
  printf '2.0.0\n' > "$d/VERSION"
  stage_change "$d" VERSION '2.0.0'
  # Gate 0 needs git-staged context; `check 0` outside a hook SKIPs by design.
  record "gate-0 skips without staged context" SKIP "$(run_gate "$d" 0)"
}

probe_gate2() {   # duplicate code
  local d="$WORK/g2"
  make_project "$d" typescript s.ts 'export function a(x:number){return x*2;}' || return
  local big
  big=$(node -e 'let s="";for(let i=0;i<40;i++)s+="function f"+i+"(a,b){if(a>b){return a+b;}else{return a-b;}}\n";process.stdout.write(s)')
  stage_change "$d" dup1.ts "$big"
  stage_change "$d" dup2.ts "$big"
  # Gate 2 is REPORT-ONLY by design: every language arm prints findings as info
  # and never sets FAIL. Verified: no path in gate-2-entry.sh assigns GATE_2_STATUS=FAIL.
  record "gate-2 reports duplicates (advisory)" PASS "$(run_gate "$d" 2)"
}

probe_gate3() {   # complexity
  local d="$WORK/g3"
  make_project "$d" typescript s.ts 'export const a=1;' || return
  local complex
  complex=$(node -e '
    let f="export function deep(a,b,c,d,e,f2,g,h){\n";
    let n=0;
    for(let i=0;i<25;i++){f+="  ".repeat(1)+"if(a==="+i+"){b+="+i+";}\n";}
    f+="  return a+b+c+d+e+f2+g+h;\n}\n";
    process.stdout.write(f)')
  stage_change "$d" cx.ts "$complex"
  record "gate-3 complexity blocks" BLOCK "$(run_gate "$d" 3)"
}

probe_gate8() {   # secret scanning (fail-closed)
  local d="$WORK/g8"
  make_project "$d" typescript u.ts 'export const a=1;' || return
  # Assembled at run time, not written literally: a valid GitHub token in the
  # script body makes GATE 8 block this very file -- which is the gate working
  # correctly, and it did (the commit adding this probe was stopped by it).
  # Splitting the literal keeps the probe effective without turning the probe
  # into the leak it hunts for.
  local _fake_gh="ghp_16C7e42F292c6912E7710c838347A"
  local _fake_tail="e178B4a"
  stage_change "$d" leak.ts "export const TOKEN = \"$_fake_gh$_fake_tail\";"
  record "gate-8 secret blocks" BLOCK "$(run_gate "$d" 8)"
  # And the clean direction: a clean file must not be blamed.
  local d2="$WORK/g8b"
  make_project "$d2" typescript u.ts 'export const a=1;' || return
  stage_change "$d2" clean.ts 'export const b = 2;'
  record "gate-8 clean passes" PASS "$(run_gate "$d2" 8)"
}

probe_gate10() {  # SAST
  local d="$WORK/g10"
  make_project "$d" typescript u.ts 'export const a=1;' || return
  stage_change "$d" sqli.ts 'import {exec} from "child_process";
export function run(c:string){exec(c);}'
  record "gate-10 injection blocks" BLOCK "$(run_gate "$d" 10)"
}

# --- main ------------------------------------------------------------------

probe_gate4() {   # principles (clean code / SOLID)
  local d="$WORK/g4"
  make_project "$d" typescript base.ts 'export const base = 1;' || return
  # Deep nesting is a real WARNING-level finding, and the only prescription
  # below ERROR. Built with genuine nesting (5 levels) -- an earlier fixture of
  # 30 FLAT if-statements was not deep at all and proved nothing.
  stage_change "$d" messy.ts 'export function messy(a: number, b: number, c: number) {
  let r = 0;
  if (a > 1) { if (b > 2) { if (c > 3) { if (a > 5) { r = 1; } else { r = 2; } } else { r = 3; } } else { r = 4; } } else { r = 5; }
  return r;
}'
  local out; out=$(run_gate "$d" 4)
  # Gate 4 blocks on ERROR only; WARNING is handed to the Boy Scout Rule, by
  # design ("will be handled by Boy Scout Rule"). So the finding must APPEAR,
  # and the gate must not block on it. Asserting BLOCK here would encode a
  # requirement the gate never had.
  if printf '%s' "$out" | grep -qiE 'deep-nesting|WARNING'; then
    PASS_N=$((PASS_N+1)); printf '  ✅ %-42s %-6s
' "gate-4 reports deep nesting" "REPORT"
  else
    FAIL_N=$((FAIL_N+1)); FAILURES+=("gate-4 deep nesting: not reported")
    printf '  ❌ %-42s %-6s
' "gate-4 reports deep nesting" "NONE"
    printf '%s
' "$out" | tail -6 | sed 's/^/       | /'
  fi
}

probe_gate6() {   # architecture
  local d="$WORK/g6"
  make_project "$d" typescript base.ts 'export const base = 1;' || return
  # No architecture config at all: the gate must not pass silently.
  stage_change "$d" more.ts 'export const more = 2;'
  local out; out=$(run_gate "$d" 6)
  local verdict="NONE"
  if printf '%s' "$out" | grep -qiE '❌|BLOCKED'; then verdict="BLOCK"
  elif printf '%s' "$out" | grep -qiE '⏭️|SKIPPED'; then verdict="SKIP"
  elif printf '%s' "$out" | grep -qiE '✅|PASSED'; then verdict="PASS"
  fi
  # Either BLOCK (config required) or SKIP-with-reason is defensible; a bare PASS
  # over a repo with no architecture constraints is not.
  if [ "$verdict" = "BLOCK" ] || [ "$verdict" = "SKIP" ]; then
    PASS_N=$((PASS_N+1)); printf '  ✅ %-42s %-6s (expected BLOCK or SKIP)\n' "gate-6 no config is not a pass" "$verdict"
  else
    FAIL_N=$((FAIL_N+1)); FAILURES+=("gate-6 no config: got $verdict")
    printf '  ❌ %-42s %-6s (expected BLOCK or SKIP)\n' "gate-6 no config is not a pass" "$verdict"
    printf '%s\n' "$out" | tail -6 | sed 's/^/       | /'
  fi
}

probe_gate7() {   # IaC security
  local d="$WORK/g7"
  make_project "$d" iac main.tf 'resource "null_resource" "a" {}' || return
  # An open security group is a textbook IaC finding.
  stage_change "$d" bad.tf 'resource "aws_security_group" "open" {
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}'
  local out; out=$(run_gate "$d" 7)
  local verdict="NONE"
  if printf '%s' "$out" | grep -qiE '❌|BLOCKED'; then verdict="BLOCK"
  elif printf '%s' "$out" | grep -qiE '⏭️|SKIPPED'; then verdict="SKIP"
  elif printf '%s' "$out" | grep -qiE '✅|PASSED'; then verdict="PASS"
  fi
  if [ "$verdict" = "BLOCK" ]; then
    PASS_N=$((PASS_N+1)); printf '  ✅ %-42s %-6s\n' "gate-7 open SG blocks" "$verdict"
  else
    FAIL_N=$((FAIL_N+1)); FAILURES+=("gate-7 open SG: got $verdict")
    printf '  ❌ %-42s %-6s (expected BLOCK)\n' "gate-7 open SG blocks" "$verdict"
    printf '%s\n' "$out" | tail -8 | sed 's/^/       | /'
  fi
}

# --- main (must come last: bash defines functions as it reads) ---

echo "=============================================="
echo " GATE EFFECTIVENESS PROBE"
echo "=============================================="

# Arguments are gate keys. `"${@:-...}"` would quote the whole default list into
# ONE word, so `probe-gate-matrix.sh 4 6 7` found nothing and reported 0/0/0 --
# a probe that silently probed nothing, which is the very defect it hunts.
if [ "$#" -eq 0 ]; then
  set -- 0 2 3 8 10
fi

for key in "$@"; do
  fn="probe_gate${key}"
  if declare -f "$fn" >/dev/null 2>&1; then
    echo ""
    echo "-- gate-$key --"
    "$fn"
  else
    echo ""
    echo "-- gate-$key -- (no probe defined)"
  fi
done

echo ""
echo "=============================================="
printf ' PASS: %d   FAIL: %d   SKIP: %d\n' "$PASS_N" "$FAIL_N" "$SKIP_N"
if [ "$FAIL_N" -gt 0 ]; then
  echo " FAILURES:"
  printf '   - %s\n' "${FAILURES[@]}"
fi
echo "=============================================="
[ "$FAIL_N" -eq 0 ]

# --- gates 4, 6, 7 ---------------------------------------------------------
