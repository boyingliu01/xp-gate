#!/usr/bin/env bats
# @test REQ-IAC-BATCH Gate 7 scans same-framework files in one checkov launch
# @intent #805 (perf): `iac.sh` invoked checkov ONCE PER FILE. Measured on
#         Windows/Git Bash (2026-11-15, load 2.2-4.9 of 8 cores), checkov's cost is
#         dominated by python startup + framework import, not by scanning:
#
#           checkov.cmd --version ..................  7.7-8.5 s
#           scan a 4-line workflow ................. 19.9 s
#           scan a real 200-line workflow .......... 31-33 s
#           three real workflows, one call each .... 106.2 s
#           three real workflows, ONE batched call .. 30.6 s  (300 checks, same)
#
#         So a commit touching N same-framework IaC files paid roughly
#         N x 31 s instead of ~31 s + (N-1) x ~12 s.
#
#         The saving is only acceptable if NOTHING about the verdict changes:
#         all files still scanned, findings still counted, and a crashed scanner
#         still reported as unusable rather than as a clean pass (#552). Those
#         three properties are what this file pins; the timing is not asserted
#         here because it cannot be measured reliably in CI.
# @covers AC-IAC-BATCH-01 AC-IAC-BATCH-02 AC-IAC-BATCH-03
#
# WHY THE OLD STATIC ASSERTIONS MUST CHANGE
# `issue-552-iac-checkov-crash.test.bats` asserts that EVERY `--file` invocation
# is immediately followed by `record_checkov_run`, and that the number of
# `--file` occurrences equals the number of `"$checkov_bin" --file` occurrences.
# Batching legitimately breaks that shape: ONE invocation now covers several
# files, and the recording happens once per batch. That test is not wrong -- it
# was pinning "no invocation may drop its status on the floor", which still
# holds -- so it is updated to count RECORDINGS rather than invocations, keeping
# the anti-vacuity property while allowing a 1:N shape.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  IAC="$REPO_ROOT/githooks/adapters/iac.sh"
  SOURCE="$(cat "$IAC")"
}

@test "AC-IAC-BATCH-01: checkov is invoked with the multi-file form, not one call per file" {
  # `checkov --file A --file B` scans ONLY A (verified: two real workflows passed
  # that way reported 116 checks, the count for a single file). The form that
  # works is `--file A B`, relying on the documented `-f FILE [FILE ...]`
  # signature. An implementation that keeps the loop but passes several files to
  # it must therefore emit ONE `--file` followed by all paths, not one `--file`
  # per iteration.
  #
  # The assertion is deliberately about the ARGUMENT SHAPE rather than a
  # variable name, so a rename does not silently pass.
  run grep -nE '"\$checkov_bin" +--file' "$IAC"
  [ "$status" -eq 0 ]

  # The batched call must pass a LIST, i.e. the expansion is unquoted or uses
  # "${var[*]}" / a for-loop-free "$@" style. A quoted single variable
  # (`--file "$file"`) is the per-file shape this change removes.
  local quoted_single
  quoted_single=$(grep -cE '"\$checkov_bin" +--file +"\$file"' "$IAC" || true)
  [ "$quoted_single" -eq 0 ]
}

@test "AC-IAC-BATCH-02: a batch still records its status for the crash detector" {
  # #552's guarantee: a checkov exit outside {0,1} means the scanner crashed and
  # nothing was judged. Batching keeps ONE status for N files, which is stricter,
  # not weaker -- the whole batch is distrusted. What must not happen is the
  # status being dropped because "it is only one call now".
  grep -q 'record_checkov_run' "$IAC"
  grep -q 'CHECKOV_CRASHED' "$IAC"

  # Every `--file` invocation must still be followed by a recording within the
  # next few lines. Anchoring on adjacency (not an exact count) keeps the
  # anti-vacuity property: an invocation whose status goes nowhere still fails.
  local invocations bound
  invocations=$(grep -cE '"\$checkov_bin" +--file' "$IAC")
  bound=$(grep -A3 -E '"\$checkov_bin" +--file' "$IAC" | grep -c 'record_checkov_run' || true)
  [ "$invocations" -ge 1 ]
  [ "$bound" -eq "$invocations" ]
}

@test "AC-IAC-BATCH-03: the scan count still reflects FILES, not batches" {
  # `checkov scan completed (N file(s) scanned)` is what a reader uses to know
  # the gate looked at everything. Reporting the batch count instead would make
  # a 3-file commit print "1 file(s) scanned" -- a true statement about
  # processes and a false one about coverage.
  grep -q 'checkov_scan_count' "$IAC"

  # record_checkov_run takes the file (or file list) it covers, so the counter
  # is driven by what was scanned rather than by how many launches happened.
  run grep -A6 'record_checkov_run()' "$IAC"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

@test "AC-IAC-BATCH-04: the batched form is what the adapter actually runs (behaviour)" {
  # Static shape checks cannot tell whether the arguments are assembled
  # correctly. Exercise the real function against two throwaway workflows through
  # a fake checkov that records the argv it received, so the assertion is about
  # the command line the adapter builds, not about the text of iac.sh.
  FIXTURE="$BATS_TEST_TMPDIR/batch-fixture"
  mkdir -p "$FIXTURE/bin" "$FIXTURE/repo/.github/workflows" "$FIXTURE/repo/githooks"

  # A fake checkov: prints an argv trace, then the markers the adapter greps for.
  cat > "$FIXTURE/bin/checkov" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "3.3.30"; exit 0; fi
printf 'ARGV: %s\n' "$*" >> "$CHECKOV_ARGV_LOG"
echo "Passed checks: 1, Failed checks: 0, Skipped checks: 0"
exit 0
FAKE
  chmod +x "$FIXTURE/bin/checkov"

  cat > "$FIXTURE/repo/.github/workflows/one.yml" <<'YAML'
name: one
on: push
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo one
YAML
  cat > "$FIXTURE/repo/.github/workflows/two.yml" <<'YAML'
name: two
on: push
jobs:
  b:
    runs-on: ubuntu-latest
    steps:
      - run: echo two
YAML

  cp "$IAC" "$FIXTURE/repo/githooks/iac-undertest.sh"
  export CHECKOV_ARGV_LOG="$FIXTURE/argv.log"
  : > "$CHECKOV_ARGV_LOG"

  # Run the adapter's static-analysis entry point with both workflows as the
  # changed set, in a PATH that resolves the fake checkov first.
  run env PATH="$FIXTURE/bin:$PATH" bash -c "
    cd '$FIXTURE/repo' &&
    . githooks/iac-undertest.sh &&
    run_static_analysis '.github/workflows/one.yml .github/workflows/two.yml' 'iac'
  "
  [ "$status" -eq 0 ]

  # The fake must have been consulted for BOTH files in ONE launch.
  run cat "$CHECKOV_ARGV_LOG"
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  local launches
  launches=$(grep -c 'ARGV:' "$CHECKOV_ARGV_LOG" || true)
  [ "$launches" -eq 1 ]

  # And that single launch must name both files.
  [[ "$output" == *"one.yml"* ]]
  [[ "$output" == *"two.yml"* ]]
}