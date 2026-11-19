#!/usr/bin/env bats
#
# @test REQ-GATE2-NO-FILES Gate 2 must not report "clean" when jscpd analysed
#       zero files
# @intent `classify_jscpd_run` decides the gate's verdict from one line:
#
#             _report=$(printf '%s' "$_out" | grep -oE 'Found [0-9]+ (clones?|duplicates?)' | tail -1)
#             ...
#             if [ "$_count" -gt 0 ]; then printf 'duplicates\n'; else printf 'clean\n'; fi
#
#         "Found 0 clones" means "no duplicate found", which is only the same thing
#         as "no duplicate exists" if something was examined. jscpd says when that
#         is not the case, on stderr, and exits 0 anyway:
#
#             Warning: jscpd analyzed no files: check the paths and the --format,
#             --ignore and --pattern filters
#             Found 0 clones.
#
#         Measured 2026-11-19 on a Dart fixture: Gate 2 printed its table with
#         Total: 0 files / 0 lines / 0 tokens, then
#
#             PASSED - jscpd duplicate code check failed to run? no --
#             ✅ PASSED - jscpd duplicate code check completed.
#
#         and the summary recorded "Gate 2: Duplicate Code  PASS". A gate that
#         examined nothing was indistinguishable from one that examined the change
#         set and found it clean -- the precise failure family both AGENTS.md files
#         name, and the same shape as the Gate 5 skips recorded as passes.
#
#         The outcome vocabulary needs a fourth value. "error" is wrong (jscpd did
#         not fail), "clean" is wrong (nothing was read), "duplicates" is wrong.
#         It is "no_files": the run completed and examined nothing, which must
#         reach the gate as SKIP with that reason.
#
# @covers AC-GATE2-NO-FILES-01  the warning is classified as no_files, not clean
# @covers AC-GATE2-NO-FILES-02  a real scan with 0 clones is still clean
# @covers AC-GATE2-NO-FILES-03  a real scan with clones is still duplicates
# @covers AC-GATE2-NO-FILES-04  a non-zero exit is still error
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/jscpd-run.sh"
}

load_lib() {
  # shellcheck source=/dev/null
  . "$LIB"
}

require_classifier() {
  declare -F classify_jscpd_run >/dev/null 2>&1 || {
    echo "classify_jscpd_run is not defined"
    false
  }
}

@test "AC-GATE2-NO-FILES-01: jscpd's 'analyzed no files' warning is not clean" {
  load_lib
  require_classifier

  # The exact shape jscpd 4.x prints on a real fixture, ANSI codes stripped
  # (the gate's classifier sees the raw stream; the codes do not touch this line).
  local out
  out='No duplicates found.
| Format | Files analyzed | Total lines | Total tokens | Clones found |
| Total: | 0              | 0           | 0            | 0            |
Found 0 clones.
time: 8.279ms
Warning: jscpd analyzed no files: check the paths and the --format, --ignore and --pattern filters'

  run classify_jscpd_run 0 "$out"
  [ "$output" = "no_files" ] || {
    echo "expected no_files, got: $output"
    echo "a run that analysed zero files was reported as a verdict"
    false
  }
}

@test "AC-GATE2-NO-FILES-02: a real scan that found no clones is still clean" {
  # Anti-vacuity. If every "Found 0 clones" became no_files, Gate 2 would stop
  # reporting clean for any project -- trading a silent pass for a permanent skip.
  load_lib
  require_classifier

  local out
  out='No duplicates found.
| Total: | 12             | 340         | 2100         | 0            |
Found 0 clones.'

  run classify_jscpd_run 0 "$out"
  [ "$output" = "clean" ] || {
    echo "expected clean, got: $output"
    false
  }
}

@test "AC-GATE2-NO-FILES-03: a real scan that found clones is still duplicates" {
  load_lib
  require_classifier

  local out
  out='| Total: | 12 | 340 | 2100 | 3 |
Found 3 clones.'

  run classify_jscpd_run 0 "$out"
  [ "$output" = "duplicates" ] || {
    echo "expected duplicates, got: $output"
    false
  }
}

@test "AC-GATE2-NO-FILES-04: a non-zero exit is still an error" {
  # Ordering matters: an error must win over the no-files warning, because a
  # failed run is the more specific fact and calling it no_files would hide it.
  load_lib
  require_classifier

  run classify_jscpd_run 2 "Warning: jscpd analyzed no files: check the paths"
  [ "$output" = "error" ] || {
    echo "expected error, got: $output"
    false
  }
}

@test "AC-GATE2-NO-FILES-05: exit 0 with no report at all is not clean either" {
  # The other empty-scan shape, measured 2026-11-19 by running jscpd with an
  # --ignore that excludes everything:
  #
  #     $ jscpd --ignore "**/*" lib.dart ; echo $?
  #     time: 0.156ms
  #     0
  #
  # One line, no table, no "Found N clones", exit 0. The classifier's final
  # fallback turns that into "clean" with the comment "leave the gate's verdict as
  # it was" -- but the verdict it leaves is PASS, so a scan that produced no report
  # whatsoever is recorded as a clean codebase.
  #
  # This is the same conflation as AC-01 through a different door: the absence of
  # an output is being read as the absence of a problem. A run that printed a
  # timing and nothing else examined nothing, and the gate must say so.
  #
  # What must NOT change: a report that IS present but in an unfamiliar shape must
  # still not become an error or a skip, which is why the "Found N clones" line is
  # checked before this. That behaviour has its own guard below.
  load_lib
  require_classifier

  run classify_jscpd_run 0 'time: 0.156ms'
  [ "$output" = "no_files" ] || {
    echo "expected no_files, got: $output"
    echo "a run that printed nothing but a timing was recorded as a clean scan"
    false
  }
}

@test "AC-GATE2-NO-FILES-06: an unfamiliar but non-empty report is not turned into a skip" {
  # Anti-vacuity for AC-05. The pre-existing behaviour -- "Exit 0 with no report
  # ... Leave the gate's verdict as it was" -- existed because turning every
  # unfamiliar jscpd format into a SKIP would disable the gate for anyone whose
  # jscpd printed something unexpected. An output with real content must keep
  # being treated as a scan that happened.
  load_lib
  require_classifier

  run classify_jscpd_run 0 'some future jscpd format
format v9
clones: none detected
files scanned: 14'
  [ "$output" = "clean" ] || {
    echo "expected clean for a non-empty unrecognised report, got: $output"
    echo "the gate would now skip every project whose jscpd output it does not parse"
    false
  }
}
