#!/usr/bin/env bats
# @test REQ-598 PowerShell CCN ratchet compares like with like
# @intent The PowerShell ratchet branch of gate-3.sh called
#         lib/Measure-PowerShellComplexity.ps1 with `-Threshold 1`, while the
#         baseline is collected at the real threshold (5 by default). Every
#         function with CCN >= 2 therefore printed OVER, and the judgement then
#         diffed those OVER rows against a baseline that can never contain a
#         CCN 2-4 entry: a brand-new, well-factored function was reported as
#             <file>:<line>  <name>  new function at ccn=4
#         and the commit was BLOCKED. The gate rejected exactly the shape it
#         exists to encourage -- the more carefully a function was split, the
#         more certainly it failed.
#
#         Two separate defects are pinned here:
#           1. threshold divergence between the two calls to the script;
#           2. path normalisation: the measurement emits absolute paths while a
#              repo-side baseline stores repo-relative ones, so every EXISTING
#              function also looked new (a real regression was reported as a
#              "new function" -- right verdict, wrong reason).
# @covers AC-598-01 AC-598-02 AC-598-03

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
GATE3="$REPO_ROOT/githooks/gate-3.sh"
MEASURE="$REPO_ROOT/githooks/lib/Measure-PowerShellComplexity.ps1"

setup() {
  WORK="$BATS_TEST_TMPDIR/psratchet"
  mkdir -p "$WORK/src"
  cd "$WORK" || return 1
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  git config core.hooksPath "$WORK/.git/hooks"

  # An existing function already recorded at ccn=2.
  cat > src/Lib.psm1 <<'PS'
function Get-A {
  param($x)
  if ($x) { return 1 }
  return 0
}
PS

  echo 1.0.0 > VERSION
  printf '# C\n## [1.0.0]\n- init\n' > CHANGELOG.md
  echo '# p' > README.md
  git add -A
  git commit --no-verify -q -m init

  # Baseline in the shape a repo-side generator writes it: repo-RELATIVE path.
  printf '{"functions":[{"file":"src/Lib.psm1","name":"Get-A","ccn":2}]}\n' \
    > .xp-gate-powershell-ccn-baseline.json
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
}

have_pwsh() {
  command -v pwsh >/dev/null 2>&1 || command -v powershell.exe >/dev/null 2>&1
}

# Run the hook and fail loudly if Gate 3 did not actually execute.
#
# Without this guard a "no regression found" assertion is satisfied by a gate
# that never ran: the pre-commit pipeline legitimately SKIPs Gate 3 with
# "no changed source files in this run (scope: diff)" when it does not consider
# the tree to contain changed source, and on the pre-#598 implementation it
# SKIPs PowerShell unconditionally. Both would make the absence-assertions below
# pass while proving nothing -- which is the same failure mode as the bug.
run_gate3() {
  run bash "$REPO_ROOT/githooks/pre-commit"
  GATE3_MEASURED=1
  if [[ "$output" != *"function(s)"* ]] \
    && [[ "$GATE3_OUTPUT" != *"increased cyclomatic complexity"* ]] \
    && [[ "$output" != *"newly added function(s)"* ]]; then
    GATE3_MEASURED=0
  fi
  return 0
}

# Drive gate-3.sh DIRECTLY, in the fixture repo, with the Gate 3 contract stubbed.
#
# The full pre-commit pipeline resolves GATE_DIR through tier probing, which on a
# machine with a global install points at ~/.config/xp-gate/adapters -- so a test
# that edits $REPO_ROOT/githooks/gate-3.sh and runs pre-commit can silently
# exercise a DIFFERENT file. That is how an earlier revision of this suite
# "passed" against a gate it never loaded. Running the file under test directly
# removes the indirection: what is asserted is what executed.
run_gate3_direct() {
  # gate-3.sh builds the script path from $AUDIT_SCRIPT_DIR and then hands it to
  # to_native_path(). That helper expects a POSIX path ("/d/..."); a value with a
  # drive letter ("D:/...") is passed through unchanged, and cygpath then cannot
  # produce a usable Windows path. `cd && pwd` in this environment can yield
  # either spelling, so normalise explicitly.
  local audit_dir="$REPO_ROOT/githooks"
  if command -v cygpath >/dev/null 2>&1; then
    audit_dir=$(cygpath -u "$audit_dir")
  fi

  # Write the driver to a file: the Gate 3 contract is two stubs plus one source
  # call, and inlining it into `bash -c '...'` produced quoting hazards.
  cat > "$WORK/_gate3_driver.sh" <<'DRIVER'
#!/usr/bin/env bash
gate_start_ms() { echo 0; }
record_gate_audit() { :; }
# gate-3.sh relies on to_native_path() from lib/native-path.sh to convert the
# script path for pwsh (#581). The real pipeline sources that helper before
# Gate 3 runs; a direct invocation must supply the same context or the gate
# receives a POSIX path, measures zero files, and reports "no functions".
if [ -f "$AUDIT_SCRIPT_DIR/lib/native-path.sh" ]; then
  # shellcheck source=/dev/null
  source "$AUDIT_SCRIPT_DIR/lib/native-path.sh"
fi
source "$AUDIT_SCRIPT_DIR/gate-3.sh"
echo "STATUS=${GATE_3_STATUS:-}"
DRIVER
  # Capture through a file, not $(...): the gate legitimately exits non-zero
  # when it blocks, and under bats' errexit a failing subshell would abort the
  # test before the assertions run. Disable errexit around the call only.
  local out_file="$WORK/_gate3_output.txt"
  set +e
  ( cd "$WORK" && PROJECT_LANG=powershell \
      AUDIT_SCRIPT_DIR="$audit_dir" \
      bash "$WORK/_gate3_driver.sh" >"$out_file" 2>&1 )
  GATE3_RC=$?
  set -e
  GATE3_OUTPUT=$(cat "$out_file")
  GATE3_MEASURED=1
  if [[ "$GATE3_OUTPUT" != *"function(s)"* ]] \
    && [[ "$GATE3_OUTPUT" != *"increased cyclomatic complexity"* ]] \
    && [[ "$GATE3_OUTPUT" != *"newly added function(s)"* ]]; then
    GATE3_MEASURED=0
  fi
  return 0
}

require_gate3_measured() {
  if [ "${GATE3_MEASURED:-0}" != "1" ]; then
    echo "Gate 3 did not measure PowerShell functions; its output was:"
    echo "${GATE3_OUTPUT:-$output}" | sed -n '1,40p'
    return 1
  fi
  return 0
}

@test "AC-598-01: both calls to the measurement script use the resolved threshold" {
  # Structural: the bug was one call passing a literal 1. Assert no call site
  # passes a hardcoded threshold, and that both interpolate PS_CC_THRESHOLD.
  run grep -n 'PS_CC_SCRIPT.*-Threshold' "$GATE3"
  [ "$status" -eq 0 ]

  # Every invocation that reaches pwsh must interpolate the resolved value.
  run bash -c "grep -n 'PS_CC_SCRIPT.*-Threshold' '$GATE3' | grep -vc 'PS_CC_THRESHOLD'"
  [ "$status" -eq 1 ] || [ "$output" = "0" ]

  # And the literal that caused #598 must not appear in a call site.
  run bash -c "grep -E 'PS_CC_SCRIPT.*-Threshold (1|5)\b' '$GATE3' || true"
  [ -z "$output" ]
}

@test "AC-598-02: a new low-CCN function is not a regression" {
  have_pwsh || skip "no PowerShell engine"

  # Add a NEW function at CCN 4 -- below the threshold of 5, and therefore
  # absent from the baseline by construction. Pre-fix this printed
  # "new function at ccn=4" and blocked.
  cat > src/Lib.psm1 <<'PS'
function Get-A {
  param($x)
  if ($x) { return 1 }
  return 0
}
function Get-NewSmall {
  param($y)
  if ($y -gt 1) { return 1 }
  if ($y -gt 2) { return 2 }
  if ($y -gt 3) { return 3 }
  return 0
}
PS

  echo 1.0.1 > VERSION
  printf '# C\n## [1.0.1]\n- add\n' > CHANGELOG.md
  git add -A

  run_gate3_direct
  require_gate3_measured
  [ "$GATE3_RC" -eq 0 ]

  # POSITIVE assertion first: the gate must actually have MEASURED something.
  # Without it this test passes on an implementation that still SKIPs PowerShell
  # outright -- "no regression" is trivially true when nothing runs, which is
  # exactly how this dimension stayed unmeasured for so long.
  [[ "$GATE3_OUTPUT" == *"function(s)"* ]]
  [[ "$GATE3_OUTPUT" == *"ratchet"* || "$GATE3_OUTPUT" == *"threshold"* ]]

  # Then the regression that #598 reported must not appear.
  [[ "$GATE3_OUTPUT" != *"new function at ccn="* ]]
  [[ "$GATE3_OUTPUT" != *"increased cyclomatic complexity"* ]]
}

@test "AC-598-03: a real regression names the old and new CCN" {
  have_pwsh || skip "no PowerShell engine"

  # Get-A goes from ccn=2 (baseline) to ccn=6. This MUST block, and the message
  # must say "ccn 2 -> 6" rather than "new function" -- the absolute-vs-relative
  # path divergence used to hide the baseline entry entirely.
  cat > src/Lib.psm1 <<'PS'
function Get-A {
  param($x)
  if ($x -gt 1) { if ($x -gt 2) { if ($x -gt 3) { if ($x -gt 4) { if ($x -gt 5) { return 1 } } } } }
  return 0
}
PS

  echo 1.0.1 > VERSION
  printf '# C\n## [1.0.1]\n- refactor\n' > CHANGELOG.md
  git add -A

  run_gate3_direct
  require_gate3_measured
  [[ "$GATE3_OUTPUT" == *"ccn 2 -> 6"* ]]
  [[ "$GATE3_OUTPUT" == *"increased cyclomatic complexity"* ]]
}

@test "AC-598-04: the measurement script emits the population a ratchet needs" {
  have_pwsh || skip "no PowerShell engine"

  cat > "$BATS_TEST_TMPDIR/sample.psm1" <<'PS'
function Get-One {
  if ($x) { return 1 }
  return 0
}
PS

  # -List emits FUNC rows for everything, not just the over-threshold ones.
  run pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File "$MEASURE" -Path "$BATS_TEST_TMPDIR/sample.psm1" -Threshold 5 -List
  [ "$status" -eq 0 ]
  [[ "$output" == *"FUNC "*"Get-One ccn=2"* ]]
  [[ "$output" == *"functions_measured=1"* ]]
  [[ "$output" == *"max_ccn=2"* ]]
}
