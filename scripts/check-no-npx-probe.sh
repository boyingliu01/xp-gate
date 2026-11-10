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

scan_roots=(
  "githooks/pre-commit"
  "githooks/pre-push"
  "githooks/post-commit"
  "githooks/post-merge"
  "githooks/adapter-common.sh"
  "githooks/adapters"
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

# What counts as a probe: an `npx` invocation whose arguments include
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

# The opt-in itself must stay gated. A future edit that drops the
# `probe_npx_enabled &&` condition would re-open the hole while the scan above
# still passes, because that file is allowed.
[ -f "$allowed_file" ] || fail "missing $allowed_file"
if grep -qE 'npx.*--version' "$allowed_file"; then
  grep -B5 -E 'npx.*--version' "$allowed_file" | grep -q 'probe_npx_enabled' ||
    fail "$allowed_file runs an npx probe without a probe_npx_enabled guard"
fi

printf '%s\n' "PASS: no gate probes tool availability through npx ($files_checked files, opt-in still gated)"
