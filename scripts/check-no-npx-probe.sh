#!/usr/bin/env bash
# Guard: no gate may answer "is this tool installed?" by asking the registry.
#
# A command that could not RUN is not a command that found problems. `npx <tool>
# --version` looks like a harmless existence check, but npx's contract is
# "install it if missing, then run it" -- so the probe CHANGES the environment
# it was asked about. Measured on this machine (2026-11-09):
#
#   $ npx vitest --version              # vitest not in the project at all
#   vitest/5.1.0                        # rc=0 -- downloaded and ran it
#
#   $ npx --no-install stryker --version
#   npm http fetch GET 200 .../stryker 697ms (cache miss)
#   npm error npx canceled due to missing packages   # rc=1, but it ASKED
#
# `--no-install` prevents the install and nothing else: it still queries the
# registry on every call (697 ms cold, 105 ms revalidating), inside a pre-commit
# hook, and offline it blocks until npm's own timeout.
#
# The second failure mode is worse than slow. Once any earlier misuse populates
# the npx cache, the same probe starts answering rc=0 for a tool the project
# never depended on -- a corrupted verdict that hides itself, because the cached
# path is faster and quieter than a real install.
#
# Context: #795, and docs/incidents/2026-11-09-command-could-not-run-instead-of-found-problems.md
# Convention: AGENTS.md sec.REQ-GATE-PROBE-SHORTCUT (XP_GATE_NPX_PROBE=1 opt-in).
#
# Scope: the hook sources and adapters that run inside a commit. Test fixtures
# deliberately plant stub `npx` binaries and are excluded -- they assert what
# the code does rather than asking whether a tool exists.
set -euo pipefail

fail() {
  printf '%s\n' "FAIL: $1" >&2
  exit 1
}

# Every path below is repository-relative, so the guard must not depend on the
# caller's working directory. It silently did: run from anywhere else it
# reported `missing expected hook source: githooks/pre-commit` -- a FALSE ALARM
# that says the hooks are gone when the truth is that the guard looked in the
# wrong tree. It went unnoticed because interactive use always cds to the repo
# root first; the CI BATS suite, which runs each case from its own directory,
# found it immediately. Failing on a wrong-tree read is the safe direction, but
# it is still the guard accusing the codebase of a defect the guard invented.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || fail "cannot enter repository root: $REPO_ROOT"

scan_roots=(
  "githooks/pre-commit"
  "githooks/pre-push"
  "githooks/post-commit"
  "githooks/post-merge"
  "githooks/adapter-common.sh"
  "githooks/adapters"
  "githooks/gate-entries"
  "githooks/lib"
)

for root in "${scan_roots[@]}"; do
  [ -e "$root" ] || fail "missing expected hook source: $root"
done

# The file allowed to run an npx probe, because it owns the documented opt-in.
# `probe_npx_enabled` (XP_GATE_NPX_PROBE=1, same convention as
# src/gates/common-process.ts) keeps projects that deliberately rely on
# npx-provided tooling -- typically CI -- working. The guard must not delete the
# escape hatch; it must keep it GATED.
allowed_file='githooks/lib/toolchain-path.sh'

# A SECOND defect shape, and the expensive one: RUNNING a tool through npx.
#
# `npx <tool> --version` costs a registry round trip. `npx <tool> check .` costs a
# DOWNLOAD: npx's contract is to install the package when it is missing. Measured
# on a fixture holding only biome.json + package.json + src/ (no node_modules):
#   npx biome check .   -> still running after 60 s, killed
# That is why Gate 5b (BATS) was 18m47s of a 22m24s CI job -- one install attempt
# per fixture -- and why the lint arms of the adapters were the single most
# expensive thing in the pipeline. The probe guard above could not see it: there
# is no `--version` on the line.
#
# The rule is the project's existing policy (AGENTS.md: "npx is never used to
# probe a tool by default", and "npx --no-install is NOT an exception"): resolve
# the tool yourself. `--no-install` is rejected too -- it prevents the install but
# still queries the registry on every commit.
#
# Scope is the lint call sites only, not every file. A suggested-command echo
# ("Run 'npx biome check --write .' to auto-fix") is guidance for a HUMAN and must
# never start costing runtime; the guard has to tell that apart from an actual
# invocation, which is why it is a separate predicate rather than a wider grep.
npx_runs_tool() {
  local line="$1" code
  code="${line%%\#*}"
  case "$code" in
    *npx*) ;;
    *) return 1 ;;
  esac
  # The invocation form only: npx followed by whitespace and a word.
  case "$code" in
    *npx\ *) ;;
    *) return 1 ;;
  esac
  # A `command -v npx` / `type -P npx` is an existence CHECK on npx itself, not a
  # tool invocation, and cannot install anything.
  case "$code" in
    *"command -v npx"* | *"type -P npx"* | *"which npx"*) return 1 ;;
  esac
  # Flags that change npx's own behaviour are fine; what must not appear is a
  # TOOL name being handed to npx to execute.
  case "$code" in
    *"npx --version"* | *"npx --help"*) return 1 ;;
  esac
  # Guidance PRINTED for a human ("Run 'npx biome check --write .' to auto-fix")
  # is not an invocation and must not be flagged: the operator runs it once, by
  # hand, and it is the documented way to apply Biome's own fixes. Detected by the
  # line being an echo/printf of a suggestion. This is the ONE shape the guard has
  # to distinguish by intent rather than syntax, so it is written as tightly as
  # possible -- an `echo` or `printf` that merely mentions the command.
  case "$code" in
    *echo*npx* | *printf*npx*) return 1 ;;
  esac
  return 0
}

lint_call_files=(
  "githooks/adapters/typescript.sh"
  "githooks/gate-entries/gate-1-entry.sh"
)


# `--version`. Matched per line, after stripping comments.
#
# Why a real parser instead of `grep -v '#'`: the first version of this script
# filtered comment lines with `grep -vE ':[[:space:]]*#' && ...`, which silently
# dropped CODE lines too and let an injected `if npx vitest --version; then`
# pass as clean. A guard that cannot fail when the defect is present is worse
# than no guard, because it certifies the thing it was supposed to check.
is_probe_line() {
  local line="$1" code
  # Drop a trailing comment. `${line%%\#*}` is a bash builtin, not a subprocess:
  # this runs once per line over ~16k lines, and spawning two `grep` processes
  # per line took the script from seconds to over five minutes on this machine.
  code="${line%%\#*}"
  # Drop the diagnostic redirect `2>&1`, which contains no '#' but commonly sits
  # directly before a trailing comment.
  code="${code//2>&1/}"
  # A probe mentions npx and --version on the same statement.
  case "$code" in
    *npx*) ;;
    *) return 1 ;;
  esac
  case "$code" in
    *--version*) ;;
    *) return 1 ;;
  esac
  # Exclude prose that merely names the pattern without invoking it: a `$ npx ...`
  # transcript line inside a comment is already removed above, but a heredoc of
  # documentation is not -- require the invocation to follow a shell word
  # boundary (start, after whitespace, or after a command separator).
  case "$code" in
    *npx\ * | *npx) ;;
    *) return 1 ;;
  esac
  return 0
}

violations=""
files_checked=0

while IFS= read -r file; do
  [ -n "$file" ] || continue
  files_checked=$((files_checked + 1))
  lineno=0
  while IFS= read -r line; do
    lineno=$((lineno + 1))
    if is_probe_line "$line"; then
      [ "$file" = "$allowed_file" ] && continue
      violations="${violations}${file}:${lineno}: ${line}
"
    fi
  done <"$file"
done <<EOF
$(find "${scan_roots[@]}" -type f \( -name '*.sh' -o -name 'pre-commit' -o -name 'pre-push' -o -name 'post-commit' -o -name 'post-merge' \) -not -path '*/__tests__/*' | sort)
EOF

# Anti-vacuity: if the scan saw no files, every assertion below passes without
# having looked at anything. That is exactly the failure mode this guard exists
# to catch, so it must not exhibit it.
[ "$files_checked" -gt 0 ] || fail "scanned no files -- the guard is not looking at anything"

if [ -n "$violations" ]; then
  printf '%s\n' "FAIL: a gate probes tool availability by consulting the registry:" >&2
  printf '%s' "$violations" >&2
  printf '%s\n' "" >&2
  printf '%s\n' "Use a local check instead -- node_modules/.bin/<tool>, the package's" >&2
  printf '%s\n' "own entry file, or \`command -v <tool>\`:" >&2
  printf '%s\n' '  if [ -x "node_modules/.bin/semgrep" ]; then ...' >&2
  printf '%s\n' "" >&2
  printf '%s\n' "npx --no-install is NOT an exception: it prevents the install, not the" >&2
  printf '%s\n' "registry query. See docs/incidents/2026-11-09-command-could-not-run-*." >&2
  exit 1
fi

# Anti-vacuity for the second check: if a declared lint call site has gone missing,
# its half of the guard silently stops looking at anything. Same reasoning as the
# file count above.
for lint_file in "${lint_call_files[@]}"; do
  [ -f "$lint_file" ] || fail "missing expected lint call site: $lint_file"
done

run_violations=""
run_files_checked=0
for lint_file in "${lint_call_files[@]}"; do
  run_files_checked=$((run_files_checked + 1))
  lineno=0
  while IFS= read -r line; do
    lineno=$((lineno + 1))
    if npx_runs_tool "$line"; then
      run_violations="${run_violations}${lint_file}:${lineno}: ${line}
"
    fi
  done <"$lint_file"
done

if [ -n "$run_violations" ]; then
  printf '%s\n' "FAIL: a gate RUNS a tool through npx, which installs it when absent:" >&2
  printf '%s' "$run_violations" >&2
  printf '%s\n' "" >&2
  printf '%s\n' "Resolve the tool instead -- node_modules/.bin/<tool>, then PATH:" >&2
  printf '%s\n' '  BIOME_BIN=$(node_modules/.bin/biome 2>/dev/null || type -P biome)' >&2
  printf '%s\n' "" >&2
  printf '%s\n' "Measured: 'npx biome check .' on a fixture with no node_modules was" >&2
  printf '%s\n' "still running after 60 s (it was downloading). That single shape cost" >&2
  printf '%s\n' "18m47s of a 22m24s CI job. See" >&2
  printf '%s\n' "docs/plans/2026-11-12-ci-bats-runtime-optimization.md." >&2
  exit 1
fi

# The opt-in itself must stay gated. A future edit that drops the
# `probe_npx_enabled &&` condition would re-open the hole while the scan above
# still passes, because that file is allowed.
[ -f "$allowed_file" ] || fail "missing $allowed_file"
if grep -qE 'npx.*--version' "$allowed_file"; then
  grep -B5 -E 'npx.*--version' "$allowed_file" | grep -q 'probe_npx_enabled' ||
    fail "$allowed_file runs an npx probe without a probe_npx_enabled guard"
fi

printf '%s\n' "PASS: no gate probes tool availability through npx ($files_checked files, opt-in still gated)"
