#!/usr/bin/env bats
# @test REQ-NPX-GUARD-AWK-EQUIVALENCE
#
# @intent scripts/check-no-npx-probe.sh scans every hook source for two defects:
# probing a tool through npx (`npx <tool> --version`) and RUNNING one through npx
# (`npx <tool> check .`, which installs the package when absent). Gate 12c runs it
# on every commit that touches hook sources.
#
# It answered by calling is_probe_line() once per line. Measured 2026-11-20 on this
# repository at load 0.00, three runs:
#
#     shell loop : 7301 / 6478 / 6445 ms over ~33.4k lines in 112 files
#     cat | wc -l:  258 ms
#
# The ~6.2 s difference is bash per-line call overhead on Windows -- a fifth of a
# commit spent in the interpreter. The awk translation answers in ~1.2 s.
#
# THE RISK THIS SUITE GUARDS
#
# This guard has been broken twice by simplification: first by `grep -v '#'`, which
# dropped CODE lines and let an injected `if npx vitest --version; then` pass as
# clean. So the awk form is a line-for-line translation of the shell predicates,
# the shell form is kept as the fallback, and both are tied together by tests that
# feed the same corpus through each and demand identical output.
#
# Two hazards found while doing this, both pinned below:
#
#   1. The `echo`/`printf` exemption is ORDER-SENSITIVE (`*echo*npx*`): a probe
#      that prints AFTER npx is still a probe. A "both words present" test exempts
#      it, and the corpus caught exactly that on the first run.
#   2. This MSYS awk prints NOTHING when the input arrives on a pipe, while the
#      same content passed as a filename argument is detected. Silent -- no error,
#      just no findings.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$REPO_ROOT/scripts/check-no-npx-probe.sh"
  AWK="$REPO_ROOT/scripts/lib/no-npx-probe.awk"
  CASES="$REPO_ROOT/scripts/lib/__fixtures__/no-npx-probe-cases.txt"
}

# @covers the awk program exists and the shell fallback is retained
@test "the awk translation exists and the shell fallback is retained" {
  [ -f "$AWK" ]
  # The fallback is what makes a host without awk still run the guard.
  run grep -c '^is_probe_line()' "$SCRIPT"
  [ "$output" = "1" ]
  run grep -c '^npx_runs_tool()' "$SCRIPT"
  [ "$output" = "1" ]
}

# @covers both predicates agree with the shell on a corpus of boundary shapes
@test "awk and shell predicates produce identical output on the corpus" {
  [ -f "$CASES" ]

  local mode pfn
  for mode in probe run; do
    if [ "$mode" = "probe" ]; then pfn=is_probe_line; else pfn=npx_runs_tool; fi

    local from_awk from_shell
    from_awk=$(awk -v mode="$mode" -f "$AWK" "$CASES" 2>/dev/null \
      | sed 's|^[^:]*:|L|')

    from_shell=$(bash -c '
      source <(sed -n "/^npx_runs_tool()/,/^}/p;/^is_probe_line()/,/^}/p" "$1")
      n=0
      while IFS= read -r line; do
        n=$((n + 1))
        if "$2" "$line"; then printf "L:%s: %s\n" "$n" "$line"; fi
      done < "$3"
    ' _ "$SCRIPT" "$pfn" "$CASES" 2>/dev/null \
      | sed 's|^[^:]*:|L|')

    if [ "$from_awk" != "$from_shell" ]; then
      echo "mode=$mode differs (awk < , shell >)"
      diff <(printf '%s\n' "$from_awk") <(printf '%s\n' "$from_shell") || true
      return 1
    fi
    # Anti-vacuity: both answering nothing would also "agree".
    [ -n "$from_awk" ] || { echo "mode=$mode matched nothing"; return 1; }
  done
}

# @covers the pipe hazard: paths must be passed as arguments
@test "the script passes paths to awk as arguments, not through a pipe" {
  run grep -c 'awk -v mode=probe -f "\$scan_awk" \$_awk_input' "$SCRIPT"
  [ "$output" = "1" ]
}

# @covers the detection that matters: a planted probe still fails the guard
@test "a planted npx probe is still detected after the rewrite" {
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  # Build a miniature repo that has the same SHAPE the guard expects. The guard
  # resolves scan_roots and scan_awk RELATIVE TO CWD, so running the real script
  # from inside this tree exercises the real code path with no sed rewriting.
  mkdir -p "$tmp/githooks/adapters" "$tmp/githooks/lib" \
           "$tmp/githooks/gate-entries" "$tmp/scripts/lib"
  cp "$AWK" "$tmp/scripts/lib/no-npx-probe.awk"
  cp "$SCRIPT" "$tmp/scripts/check-no-npx-probe.sh"
  for h in pre-commit pre-push post-commit post-merge; do
    printf '#!/usr/bin/env bash\n' > "$tmp/githooks/$h"
  done
  printf '#!/usr/bin/env bash\n' > "$tmp/githooks/adapter-common.sh"
  printf '#!/usr/bin/env bash\n' > "$tmp/githooks/lib/toolchain-path.sh"
  printf '#!/usr/bin/env bash\nif npx semgrep --version; then :; fi\n' \
    > "$tmp/githooks/lib/planted.sh"

  cd "$tmp" || return 1
  run bash scripts/check-no-npx-probe.sh

  # Anti-vacuity: the guard must actually have scanned the plant.
  [ "$status" -ne 0 ]
  echo "$output" | grep -q 'planted.sh'
}
