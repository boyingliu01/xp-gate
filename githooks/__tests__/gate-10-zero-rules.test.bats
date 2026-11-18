#!/usr/bin/env bats
#
# @test REQ-GATE10-ZERO-RULES-PASS
# @intent Gate 10 reports PASS over a scan that loaded no rules, and semgrep's
#         own output says which case happened.
#
#         The gate distinguishes three states from the JSON:
#
#             results > 0                -> findings (BLOCK)
#             results == 0, errors == 0  -> clean  (PASS)
#             results == 0, errors > 0   -> nothing judged (#518, SKIP)
#
#         A scan that loaded NO RULES produces `results: []` and `errors: []` --
#         a legal, successful, empty report -- so it lands in the PASS arm.
#
#         Measured with a local config containing `rules: []`:
#             {"results":[],"errors":[],"time":{"rules":[]},"paths":{"scanned":[]}}
#
#         This is not hypothetical. #717 found the shape in one language:
#         p/security-audit carries no C# rules, so a .cs file with a textbook SQL
#         injection scored 0. That was fixed by adding a second --config; the
#         SHAPE stayed reachable for every other cause -- registry unreachable
#         mid-scan, an empty cached ruleset, a bad --config path.
#
#         A security gate reporting "clean" because it loaded nothing is the
#         failure the fail-closed convention exists to prevent.
#
#         WHICH SIGNAL TO USE was measured, twice, because two plausible ones are
#         both wrong:
#
#           time.rules      -- semgrep's per-rule PROFILING list. Empty on every
#                              healthy run: a 225-rule scan reports time.rules:[].
#                              Guarding on it turns every good scan into a SKIP.
#           paths.scanned   -- right for the empty-ruleset case, but it ALSO reads
#                              0 when the changed files are deliberately
#                              suppressed via .semgrepignore. Measured: the
#                              semgrepignore suite's suppression case went red,
#                              went red, reporting deliberate suppression as
#                              "nothing was examined".
#
#         What separates the cases is the rule count semgrep prints:
#
#             rules: []         -> "No code rules to run."
#             p/security-audit  -> "with 225 Code rules:"
#
# @covers AC-GATE10-ZERO-RULES-01 AC-GATE10-ZERO-RULES-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$REPO/githooks/gate-10.sh"
}

@test "AC-GATE10-ZERO-RULES-01: the gate inspects whether any rules loaded" {
  grep -q 'No code rules to run' "$SCRIPT" || {
    echo "gate-10.sh never checks the loaded rule count; a scan with no rules"
    echo "reports clean because results:[] and errors:[] are both empty"
    return 1
  }
  # And it must NOT guard on the two signals measured to be wrong. Comment lines
  # are excluded: the explanation quotes both field names in prose.
  ! grep -vE '^[[:space:]]*(#|//)' "$SCRIPT" | grep -q 'time[.?]*\.rules' || {
    echo "gate-10.sh reads time.rules, which is empty on every normal scan"
    return 1
  }
  ! grep -vE '^[[:space:]]*(#|//)' "$SCRIPT" | grep -q 'paths\.scanned' || {
    echo "gate-10.sh reads paths.scanned, which is also 0 for .semgrepignore'd files"
    return 1
  }
}

@test "AC-GATE10-ZERO-RULES-02: a no-rules scan cannot reach the PASS arm" {
  # BEHAVIOURAL. An earlier version of this test only checked that the string
  # `zero_rules` appears in the file, and it stayed green when the guard was
  # replaced with `elif false` -- it passed against a gate with no working guard.
  #
  # The real guard expression is extracted and evaluated against the four cases
  # that matter.
  local guard
  guard=$(grep -oE 'elif \[ "\$\{V_RESULTS:-0\}" -eq 0 \][^;]*; then' "$SCRIPT" \
    | head -1 | sed 's/^elif //; s/; then$//')
  [ -n "$guard" ] || {
    echo "could not extract the no-rules guard from gate-10.sh"
    echo "without it, a scan that loaded nothing takes the clean-scan PASS arm"
    return 1
  }

  # The guard must defer to findings: a real finding means semgrep plainly ran.
  [[ "$guard" == *"V_RESULTS"* ]] || {
    echo "the guard ignores V_RESULTS: a reported finding would be filed as"
    echo "'loaded no rules' instead of blocking"
    return 1
  }

  # no rules reported + no findings -> guard fires (this is not a clean scan)
  V_RESULTS=0 SEMGREP_OUTPUT=$'Scanning 1 file (only git-tracked):\n  No code rules to run.'
  eval "$guard" || {
    echo "with 'No code rules to run' the guard did not fire; the run reaches PASS"
    return 1
  }
  # a real run -> guard must NOT fire, or every clean scan becomes a SKIP
  SEMGREP_OUTPUT=$'Scanning 1 file with 225 Code rules:'
  if eval "$guard"; then
    echo "a healthy scan with 225 rules was treated as 'no rules'"
    return 1
  fi
  # a finding -> guard must NOT fire, whatever stderr says
  V_RESULTS=1 SEMGREP_OUTPUT='No code rules to run.'
  if eval "$guard"; then
    echo "a reported finding was downgraded to SKIP"
    return 1
  fi
}

@test "AC-GATE10-ZERO-RULES-02b: a no-rules scan reports SKIP end to end" {
  # Drives the real body with a stub semgrep that reproduces the measured empty-
  # ruleset output, so the verdict and the reason are both observed rather than
  # inferred from source.
  local work="$BATS_TEST_TMPDIR/g10"
  mkdir -p "$work/bin"
  git -C "$work" init -q -b g10fixture
  printf 'export const v = 1;\n' > "$work/app.ts"
  git -C "$work" -c user.email=t@t -c user.name=t -c core.hooksPath= add app.ts

  cat > "$work/bin/semgrep" <<'STUB'
#!/bin/sh
# The measured shape of a zero-rules run: empty results, empty errors, and the
# "No code rules to run." line on stderr.
printf '%s\n' '{"version":"1.185.0","results":[],"errors":[],"paths":{"scanned":[]}}'
printf '%s\n' 'Scanning 1 file (only git-tracked):' '  No code rules to run.' >&2
exit 0
STUB
  chmod +x "$work/bin/semgrep"

  cat > "$work/drive.sh" <<'DRIVER'
set -u
cd "__WORK__" || exit 9
GATE_10_START=1
HOME="__WORK__/nohome"
PATH="__WORK__/bin:$PATH"
gate_start_ms() { echo 1; }
record_gate_audit() { :; }
. "__WORK__/gate-10.sh"
printf 'STATUS=%s REASON=%s\n' "${GATE_10_STATUS:-unset}" "${GATE_10_REASON:-unset}"
DRIVER
  sed -i "s|__WORK__|$work|g" "$work/drive.sh"
  mkdir -p "$work/nohome"
  cp "$SCRIPT" "$work/gate-10.sh"

  run bash "$work/drive.sh"
  [[ "$output" == *"STATUS=SKIP"* ]] || {
    echo "a zero-rules scan did not report SKIP; output:"
    printf '%s\n' "$output" | tail -12
    return 1
  }
  [[ "$output" == *"REASON=zero_rules"* ]] || {
    echo "the skip carries no distinguishable reason; output:"
    printf '%s\n' "$output" | tail -6
    return 1
  }
}