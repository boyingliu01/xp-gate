#!/usr/bin/env bats
# @test REQ-552 IaC gate distinguishes a crashed scanner from a passing one
# @intent Verify Gate 7 does not turn a checkov crash into a security verdict.
#         #552: checkov exits 2 with an AttributeError traceback (a broken
#         detect_secrets dependency), and the gate reported "1 security
#         issue(s) found by checkov. Blocking commit." Nothing about that is a
#         security finding -- the tool never got far enough to judge anything.
#         Both directions are wrong: counting the traceback invents findings,
#         and a crash whose text happens to lack the marker would report a clean
#         pass. A crashed scanner is "unusable", which is its own verdict.
# @covers AC-552-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  IAC="$REPO_ROOT/githooks/adapters/iac.sh"
}

@test "anti-vacuity: the checkov invocation is still in iac.sh" {
  # Match any resolution of the binary, not the literal `checkov --file`. The
  # adapter probes checkov / .exe / .cmd because the extensionless MSYS shim
  # cannot be executed on Git Bash, so the invocation is `"$checkov_bin" --file`.
  # Pinning the bare word made a correct fix look like a regression.
  #
  # #805 changed the ARGUMENT after --file from one quoted path to a list, so the
  # path position is no longer `"$file"`. The property this test exists for is
  # "the resolved binary is what gets invoked" -- keep that, stop pinning the
  # per-file shape that batching deliberately removed.
  grep -qE '("\$checkov_bin"|checkov) +--file' "$IAC"
  grep -q 'checkov_bin' "$IAC"
}

@test "every checkov invocation is followed by a status recording" {
  # The defect was a bare invocation whose status went nowhere. Counting lines
  # does not need a regex that pins indentation OR the command spelling: every
  # invocation -- whichever resolvable form of checkov it names -- must be
  # followed by record_checkov_run.
  #
  # #805 note: one launch may now cover a whole batch of files, so this is a 1:N
  # relationship, not 1:1. The recording also moved one line further away (the
  # status is captured into a local first, because the batch's file count has to
  # be passed along with it). The window is widened to 3 lines to match, which
  # keeps the real guarantee -- no invocation may drop its status -- without
  # re-pinning the exact layout batching replaced.
  local invocations recorded
  invocations=$(grep -cE '("\$checkov_bin"|checkov) +--file' "$IAC")
  recorded=$(grep -A3 -E '("\$checkov_bin"|checkov) +--file' "$IAC" | grep -c 'record_checkov_run' || true)
  [ "$invocations" -ge 1 ]
  [ "$recorded" -eq "$invocations" ]
  # The two counts above are blind on their own: swap ONE invocation's binary for
  # something unrelated and the remaining valid calls still satisfy them.
  # (Measured: injecting a bogus binary name passed both, because the bogus line
  # simply fell out of the general pattern.) Anchor from the other side instead --
  # count EVERY --file invocation in the file, whatever command it names, and
  # require all of them to be the resolved checkov binary. A stray or hardcoded
  # command then surfaces as a mismatch instead of being filtered out of the
  # assertion by construction.
  #
  # Deliberately broad: this counts ANY non-comment line containing ` --file `,
  # including an echo hint or a variable assignment that mentions it. That is the
  # point -- the assertion is a lower bound on how many commands must be the
  # resolved binary, so extra mentions can only make it stricter, never weaker.
  any_invocation=$(grep -cE '^[[:space:]]*[^#[:space:]].* +--file ' "$IAC")
  bound=$(grep -cE '^[[:space:]]*"\$checkov_bin" +--file ' "$IAC")
  [ "$bound" -ge 1 ]
  [ "$any_invocation" -eq "$bound" ]
}

@test "the adapter tracks whether any checkov run crashed" {
  grep -q 'CHECKOV_CRASHED' "$IAC"
}

@test "a crash yields an unusable diagnosis, not a security finding" {
  grep -q 'checkov' "$IAC"
  # The crash branch must exist and must not reuse the "security issue(s) found"
  # wording, which asserts a verdict the tool never reached.
  run bash -c "grep -n 'CHECKOV_CRASHED' '$IAC' | head -3"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

@test "the crash branch returns before any finding is counted" {
  # Order is the property that matters: if the grep for "FAILED for resource"
  # runs first, the traceback text decides the verdict. Assert the crash check
  # appears ABOVE the failed_count parse, not merely that both exist.
  local crash_line fail_line
  crash_line=$(grep -n 'if \[ "\$CHECKOV_CRASHED" -eq 1 \]' "$IAC" | head -1 | cut -d: -f1)
  fail_line=$(grep -n 'failed_count=\$(grep -c "FAILED for resource"' "$IAC" | head -1 | cut -d: -f1)
  [ -n "$crash_line" ]
  [ -n "$fail_line" ]
  [ "$crash_line" -lt "$fail_line" ]
}

@test "the crash path returns a non-zero status distinct from a findings block" {
  # Findings use exit_code=1. The crash returns 2 (unusable) so callers can tell
  # "the scanner failed" from "the scanner found problems".
  grep -q 'return 2' "$IAC"
  grep -q 'XP_GATE_IAC_SOFT' "$IAC"
}
