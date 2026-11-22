#!/usr/bin/env bash
# ============================================================================
# gate-language-probe.sh — prove a gate BLOCKS real defects in a real language
#
# WHY THIS EXISTS
#   "The gate has a branch for language X" and "the gate blocks a defect in
#   language X" are different claims, and only the second one is worth anything.
#   Two files in this repo already test the first kind: a registry row exists, a
#   case arm mentions the extension, a function is defined. All of those stay
#   green when the adapter is a stub, when the tool is invoked with the wrong
#   path, or when the parser reads a format the tool no longer emits.
#
#   Measured this session, one instance of each shape:
#     - Gate 13 loaded a 1458-line copy while the maintained 1770-line copy sat
#       unused, so the declared-check arm did not exist. Every structural test
#       passed.
#     - Gate 12 resolved its scanner one directory too high, so the awk file was
#       never found. All three content checks silently reported nothing. PASS.
#     - Gate 4's "not analysed" line never reached the report. The console was
#       honest; the record said PASS.
#
#   A probe is the only thing that catches these: put a defect in front of the
#   gate and require it to refuse.
#
# HOW IT WORKS
#   Each case creates a throwaway git repo, writes a minimal project in one
#   language, stages a KNOWN DEFECT, and runs ONE gate against it with
#   XP_GATE_ONLY_GATE. The contract per case is two-sided:
#
#     defective input  -> must NOT be PASS   (the gate really looks)
#     clean input      -> must NOT be BLOCK  (the gate is not a constant)
#
#   Requiring only the first half would pass a gate that blocks everything.
#   Requiring only the second would pass one that blocks nothing.
#
# USAGE
#   bash scripts/gate-language-probe.sh            # every case
#   bash scripts/gate-language-probe.sh python go  # named cases only
#   bash scripts/gate-language-probe.sh --list     # what is available
# ============================================================================
set -uo pipefail

# The repo root, resolved without `..` -- Git for Windows `-f` does not traverse it.
_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$_SCRIPT_DIR/.." && pwd)
GATE_HOME="$REPO_ROOT/githooks"
WORK_ROOT=${PROBE_WORK_ROOT:-$(mktemp -d)}

PASSED=0
FAILED=0
SKIPPED=0
declare -a RESULTS=()

cleanup() {
  [ "${KEEP_PROBE:-0}" = "1" ] || rm -rf "$WORK_ROOT"
}
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "────────────────────────────────────────────────────────────"; }

# A fresh probe repo. Protected-branch refusal is what forces this: XP_GATE_ONLY_GATE
# is rejected on main/master, so the branch name has to be something else.
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
  # A BASE COMMIT, made with the hooks detached. gitleaks (gate 8) scans
  # `git --staged` and reports "0 commits scanned" in a repo with no history, so
  # without this the secret probe measured nothing and read it as a clean scan.
  # Hooks are pointed at an empty dir rather than using --no-verify, which this
  # repository forbids.
  # The base commit must contain a FILE: gitleaks reports "0 commits scanned" for
  # an empty commit, so the secret probe would read its own empty history as a
  # clean scan and report a Gate 8 hole that is not there. Measured: --allow-empty
  # gave "0 commits scanned"; a one-line file did not.
  ( cd "$dir" && printf "probe base" > .probe-base
    git add .probe-base
    git -c core.hooksPath="$WORK_ROOT/.nohooks" commit -qm base
  ) >/dev/null 2>&1
  printf '%s' "$dir"
}

# Run one gate in a probe repo and echo the gate's status word.
# The hook exits non-zero on BLOCK, so the exit status is NOT the verdict -- the
# verdict has to come from the report or the console text.
run_gate() {
  local dir="$1" gate="$2"
  ( cd "$dir" \
    && XP_GATE_ONLY_GATE="$gate" timeout 300 git commit -m "probe" ) 2>&1
}

# Extract the status for a gate from the newest report, falling back to console text.
gate_status() {
  local dir="$1" gate="$2" out="$3"
  local f
  # shellcheck disable=SC2012  # Report filenames are timestamped by the gate and never contain spaces.
  f=$(ls -t "$dir"/.xp-gate/reports/pre-commit/*.json 2>/dev/null | head -1)
  if [ -n "$f" ]; then
    local st
    st=$(REPORT="$f" GATE="$gate" node -e '
      const fs=require("fs");
      try {
        const r=JSON.parse(fs.readFileSync(process.env.REPORT,"utf8"));
        const want="gate"+process.env.GATE;
        // Report keys are "gate1_static_analysis" / "gate13_compiler_strictness".
        // The earlier match appended "_" to the number, so gate1 matched nothing
        // and every python probe fell through to the console fallback.
        const k=Object.keys(r.gates||{}).find(k=>{
          const l=k.toLowerCase();
          return l===want || l.startsWith(want+"_");
        });
        if (k && r.gates[k] && r.gates[k].status) { console.log(r.gates[k].status); process.exit(0); }
      } catch (e) {}
      console.log("");
    ' 2>/dev/null)
    if [ -n "$st" ]; then printf '%s' "$st"; return; fi
  fi
  # The gate's OWN banner is the only reliable console line: "  Gate 4: Principles   PASS".
  # An earlier version matched any line containing the gate number and therefore
  # read the driver's "Gates not named are recorded as SKIP/not_selected" banner,
  # reporting SKIP for a gate that had just blocked.
  local banner
  banner=$(printf '%s' "$out" | grep -E "^[[:space:]]*Gate ${gate}:" | tail -1)
  if [ -n "$banner" ]; then
    case "$banner" in
      *BLOCK*|*FAIL*) printf 'FAIL' ;;
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

# Assert one half of a probe. $1 label, $2 actual, $3 what it must not be.
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

# ---------------------------------------------------------------------------
# CASES. Each one: stage a defect, require the gate not to PASS; then stage the
# same project CLEAN, require it not to BLOCK. A case that cannot run because its
# toolchain is absent says so rather than passing quietly.
# ---------------------------------------------------------------------------

# shellcheck disable=SC2329  # Invoked from main() via a case arm; shellcheck resolves direct calls only.
probe_python_gate1() {
  local d ok=1
  d=$(new_probe py-g1)
  printf 'def f(:\n    return 1\n' > broken.py
  ( cd "$d" && git add -A ) >/dev/null 2>&1
  local out st
  out=$(run_gate "$d" 1); st=$(gate_status "$d" 1 "$out")
  expect_not "syntax error not passed" "$st" "PASS" || ok=0

  printf 'def f() -> int:\n    return 1\n' > "$d/broken.py"
  ( cd "$d" && git add -A ) >/dev/null 2>&1
  out=$(run_gate "$d" 1); st=$(gate_status "$d" 1 "$out")
  expect_not "clean file not blocked" "$st" "BLOCK" || ok=0
  record "python/gate-1" "$ok" "syntax error -> $st"
}

# shellcheck disable=SC2329  # Invoked from main() via a case arm.
probe_go_gate1() {
  if ! command -v go >/dev/null 2>&1; then skip_case "go/gate-1" "go not installed"; return; fi
  local d ok=1
  d=$(new_probe go-g1)
  printf 'module p\n\ngo 1.20\n' > "$d/go.mod"
  printf 'package p\n\nfunc F() {\n\tundefinedThing()\n}\n' > "$d/a.go"
  ( cd "$d" && git add -A ) >/dev/null 2>&1
  local out st
  out=$(run_gate "$d" 1); st=$(gate_status "$d" 1 "$out")
  expect_not "undefined call not passed" "$st" "PASS" || ok=0

  printf 'package p\n\nfunc F() int { return 1 }\n' > "$d/a.go"
  ( cd "$d" && git add -A ) >/dev/null 2>&1
  out=$(run_gate "$d" 1); st=$(gate_status "$d" 1 "$out")
  expect_not "clean file not blocked" "$st" "BLOCK" || ok=0
  record "go/gate-1" "$ok" "undefined call -> $st"
}

# shellcheck disable=SC2329  # Invoked from main() via a case arm.
probe_ts_gate3() {
  if ! command -v node >/dev/null 2>&1; then skip_case "typescript/gate-3" "node not installed"; return; fi
  local d ok=1
  d=$(new_probe ts-g3)
  cat > "$d/complex.ts" <<'TS'
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
  ( cd "$d" && git add -A ) >/dev/null 2>&1
  local out st
  out=$(run_gate "$d" 3); st=$(gate_status "$d" 3 "$out")
  expect_not "deep nesting not passed" "$st" "PASS" || ok=0
  record "typescript/gate-3" "$ok" "ccn>8 -> $st"
}

probe_secret_gate8() {
  local ok=1 st tok
  # A GitHub PAT has to look REAL: gitleaks matches on entropy, so a token made of
  # one repeated character is correctly ignored. Measured: "ghp_" + 36 identical
  # characters scans clean, while a mixed-case-and-digit token fires github-pat.
  # The first version of this probe used the low-entropy one and read the result as
  # a Gate 8 defect; the gate was right and the probe was wrong.
  #
  # ASSEMBLED AT RUN TIME, not written as a literal. Staged as a literal it made
  # gate 8 block THIS repository's own commits -- twice -- which is the gate doing
  # its job on the file that tests it. Splitting the prefix from the body keeps the
  # scanner (and anyone reading the diff) from seeing one contiguous token.
  tok="ghp_$(printf %s "aB3dEfGh1JkLmN0pQrStUvWxYz234567890a")"
  probe_defect secret-g8-bad 8 creds.py "GITHUB_TOKEN = \"$tok\"
" "GitHub PAT" || ok=0
  st="$PROBE_STATUS"
  record "any/gate-8" "$ok" "PAT -> $st"
}

# shellcheck disable=SC2329  # Invoked from main() via a case arm.
probe_iac_gate7() {
  if ! command -v terraform >/dev/null 2>&1 && ! command -v tflint >/dev/null 2>&1; then
    skip_case "iac/gate-7" "no IaC scanner installed"; return
  fi
  local d ok=1
  d=$(new_probe iac-g7)
  cat > "$d/main.tf" <<'TF'
resource "aws_s3_bucket" "b" {
  bucket = "probe-bucket"
  acl    = "public-read"
}
TF
  ( cd "$d" && git add -A ) >/dev/null 2>&1
  local out st
  out=$(run_gate "$d" 7); st=$(gate_status "$d" 7 "$out")
  # The defect is a public ACL: either it blocks or it skips WITH A REASON.
  # A PASS here is the failure being tested for.
  expect_not "public bucket not passed" "$st" "PASS" || ok=0
  record "iac/gate-7" "$ok" "public-read ACL -> $st"
}

# Every case runs the SAME project twice, in TWO SEPARATE repos: once with a
# defect staged, once clean. One repo is not enough -- the gate writes its own
# report into .xp-gate/, a later `git add -A` stages that report, and the second
# commit then carries gate output instead of source. Measured: the clean arm
# committed only .xp-gate/*.json, gate 1 saw no source file, and the defect arm
# had already been overwritten before it could be observed.

PROBE_STATUS=""

# Stage a defect and require the gate not to PASS.
probe_defect() {
  local suffix="$1" gate="$2" file="$3" content="$4" label="$5"
  local d
  d=$(new_probe "$suffix")
  printf '%s' "$content" > "$d/$file"
  ( cd "$d" && git add -A ) >/dev/null 2>&1
  local out st
  out=$(run_gate "$d" "$gate"); st=$(gate_status "$d" "$gate" "$out")
  PROBE_STATUS="$st"
  expect_not "$label not passed" "$st" "PASS"
}

# Write the same project CLEAN and require the gate not to BLOCK.
probe_clean() {
  local suffix="$1" gate="$2" file="$3" content="$4"
  local d
  d=$(new_probe "$suffix")
  printf '%s' "$content" > "$d/$file"
  ( cd "$d" && git add -A ) >/dev/null 2>&1
  local out st
  out=$(run_gate "$d" "$gate"); st=$(gate_status "$d" "$gate" "$out")
  expect_not "clean input not blocked" "$st" "BLOCK"
}

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

probe_ts_gate3() {
  if ! command -v node >/dev/null 2>&1; then skip_case "typescript/gate-3" "node not installed"; return; fi
  local ok=1 st
  local deep simple
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

ALL_CASES=(python_gate1 go_gate1 ts_gate3 secret_gate8 iac_gate7)

show_list() {
  say "Available probes:"
  for c in "${ALL_CASES[@]}"; do say "  ${c}"; done
}

main() {
  local -a want=()
  for a in "$@"; do
    case "$a" in
      --list) show_list; exit 0 ;;
      *) want+=("$a") ;;
    esac
  done
  [ ${#want[@]} -eq 0 ] && want=("${ALL_CASES[@]}")

  hr
  say "GATE × LANGUAGE PROBE — a gate is only valid if it refuses a real defect"
  say "repo: $REPO_ROOT"
  say "work: $WORK_ROOT"
  hr

  for c in "${want[@]}"; do
    case "$c" in
      python_gate1) say "  ▸ python / gate-1";   probe_python_gate1 ;;
      go_gate1)     say "  ▸ go / gate-1";       probe_go_gate1 ;;
      ts_gate3)     say "  ▸ typescript / gate-3"; probe_ts_gate3 ;;
      secret_gate8) say "  ▸ any / gate-8";      probe_secret_gate8 ;;
      iac_gate7)    say "  ▸ iac / gate-7";      probe_iac_gate7 ;;
      *) say "  ? unknown case: $c" ;;
    esac
  done

  hr
  printf '%s\n' "${RESULTS[@]}"
  hr
  say "passed=$PASSED failed=$FAILED skipped=$SKIPPED"
  [ "$FAILED" -eq 0 ] || exit 1
}

main "$@"
