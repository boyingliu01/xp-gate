#!/usr/bin/env bats
# @test REQ-GATE-TIMING-REPORT
#
# @intent The efficiency standard says a gate's p90 must be proportionate to its
# value. Before this report there was no timing baseline in the repository at all,
# so "this gate is slow" was an impression. The data was always present --
# pre-commit records duration_ms on every audit line -- it simply had never been
# read.
#
# These cases guard the report's two load-bearing properties: that it reads the
# journal rather than inventing numbers, and that it refuses to present a p90 from
# a handful of samples as if it were a percentile.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  REPORT="$REPO_ROOT/scripts/gate-timing-report.cjs"
  FIXTURE="$BATS_TEST_TMPDIR/audit.jsonl"
}

# A synthetic journal with KNOWN durations, so the assertions below are about the
# arithmetic rather than about whatever this machine happened to run.
write_fixture() {
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  {
    for d in 100 200 300 400 500 600 700 800 900 1000; do
      echo "{\"timestamp\":\"$now\",\"gate_id\":\"gate-1\",\"duration_ms\":$d}"
    done
    # A second gate with one huge sample: 10x the median, so it should be reported
    # as bimodal.
    for d in 50 50 50 50 600; do
      echo "{\"timestamp\":\"$now\",\"gate_id\":\"gate-10\",\"duration_ms\":$d}"
    done
  } > "$FIXTURE"
}

# @covers the script parses and runs
@test "the timing report runs" {
  run node "$REPORT"
  [ "$status" -eq 0 ]
}

# @covers it reads the journal rather than printing canned numbers
@test "the report computes statistics from the journal it is given" {
  write_fixture
  run node "$REPORT" --journal "$FIXTURE" --json
  [ "$status" -eq 0 ]
  # gate-1 median of 100..1000 is 600ms; max is 1000ms.
  echo "$output" | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c)).on("end", () => {
      const r = JSON.parse(d);
      const g1 = r.gates.find((g) => g.gate === "gate-1");
      const g10 = r.gates.find((g) => g.gate === "gate-10");
      if (!g1 || !g10) { console.error("missing gate"); process.exit(1); }
      if (g1.median !== 600) { console.error("gate-1 median " + g1.median); process.exit(1); }
      if (g1.max !== 1000) { console.error("gate-1 max " + g1.max); process.exit(1); }
      if (g10.max !== 600) { console.error("gate-10 max " + g10.max); process.exit(1); }
    });
  '
  [ "$output" != "" ]
}

# @covers a small sample is flagged rather than presented as a percentile
@test "a small sample size is marked, not hidden" {
  write_fixture
  run node "$REPORT" --journal "$FIXTURE"
  [[ "$output" == *"fewer than"* ]]
  [[ "$output" == *"worst few runs"* ]]
}

# @covers bimodality is called out, because a mean would hide it
@test "a p90 far above the median is reported as two execution paths" {
  write_fixture
  run node "$REPORT" --journal "$FIXTURE"
  [[ "$output" == *"Bimodal runtime"* ]]
  [[ "$output" == *"gate-10"* ]]
}

# @covers the report refuses to be read as an argument for deleting gates
@test "the report says slow is not a reason to delete" {
  write_fixture
  run node "$REPORT" --journal "$FIXTURE"
  [[ "$output" == *"SLOW IS NOT A REASON TO DELETE"* ]]
}

# @covers a missing journal is a message, not a crash
@test "a missing journal exits cleanly" {
  run node "$REPORT" --journal "$BATS_TEST_TMPDIR/does-not-exist.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No timing records"* ]]
}

# @covers one truncated line does not destroy the whole report, because the
# journal is appended to while a commit is running
@test "a truncated final line is skipped, not fatal" {
  write_fixture
  echo '{"timestamp":"2026-01-01T00:00:00.000Z","gate_id":"gate-1","dura' >> "$FIXTURE"
  run node "$REPORT" --journal "$FIXTURE" --json
  [ "$status" -eq 0 ]
  [[ "$output" == *"gate-1"* ]]
}
