#!/usr/bin/env bats
#
# @test REQ-GATE2-SELF-SCAN
# @intent Gate 2 spends most of its time comparing xp-gate's own reports to each
#         other, and reports thousands of clones that are not code.
#
#         Measured on this repo with `xp-gate check 2`:
#
#           total           49-52 s   (stable across repeats)
#           jscpd alone      6-7 s
#           "Found 3886 clones"
#
#         Where the hits come from, counted by path prefix in the output:
#
#            4949  .xp-gate        <- xp-gate's own report/journal directory
#            1923  src/npm-package
#            1306  plugins
#            1152  skills
#
#         `.xp-gate/reports/**` holds one JSON report per gate per run, written by
#         xp-gate itself. Those files are near-identical to each other by
#         construction, so jscpd matches them against each other and against every
#         previous run: 4949 findings about the tool's own output, dwarfing the
#         source it was asked to check.
#
#         The default ignore set already excludes node_modules, dist, build,
#         target, coverage, out and vendor -- every build-output directory EXCEPT
#         the one this tool generates. That is the gap.
#
#         Note this is a cost problem with a correctness edge: a 3886-clone
#         report is not actionable, so the signal is buried in what the gate wrote
#         itself. Two smaller things fall out of the same measurement:
#           - `check 2` with no staged set scans the WHOLE project (jscpd is
#             invoked with no file arguments), which is why the run is slow
#             outside a hook at all;
#           - a concurrent run reported "Gate 2 FAILED: Command failed: npx -y
#             jscpd ." -- i.e. it fell back to a network install.
#
# @covers AC-GATE2-SELF-SCAN-01 AC-GATE2-SELF-SCAN-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO/githooks/lib/jscpd-run.sh"
}

@test "AC-GATE2-SELF-SCAN-01: xp-gate's own report directory is in the default ignore set" {
  # Behavioural where possible: drive the real predicate.
  run bash -c "
    source '$LIB'
    if jscpd_is_default_ignored '.xp-gate/reports/pre-push/2026-11-19-01.json'; then
      echo IGNORED
    else
      echo SCANNED
    fi
  "
  [ "$status" -eq 0 ] || { echo "could not source $LIB"; return 1; }

  if [[ "$output" == *SCANNED* ]]; then
    echo "xp-gate's own report files are treated as project source. Measured:"
    echo "  4949 of the findings in one \`check 2\` run came from .xp-gate/, more"
    echo "  than plugins/ and skills/ combined, and the run took 49-52 s for a"
    echo "  report nobody can act on."
    return 1
  fi
}

@test "AC-GATE2-SELF-SCAN-02: the ignore set covers tool-generated state generally" {
  # Pin the general rule, not just the one directory: a tool that writes its own
  # artifacts must exclude them all. `.xp-gate` is the current one; this asserts
  # the predicate rejects a report AND a journal, so a future rename inside the
  # same tree does not silently reopen the hole.
  run bash -c "
    source '$LIB'
    ok=1
    jscpd_is_default_ignored '.xp-gate/reports/pre-push/x.json' || ok=0
    jscpd_is_default_ignored '.xp-gate/audit.jsonl' || ok=0
    [ \"\$ok\" = 1 ] && echo ALL_IGNORED || echo LEAKED
  "
  [[ "$output" == *ALL_IGNORED* ]] || {
    echo "not every path under .xp-gate/ is excluded from duplicate scanning"
    return 1
  }

  # And the escape hatch must still work: a project that really wants these
  # compared can set XP_GATE_JSCPD_DEFAULT_IGNORE=0.
  run bash -c "
    source '$LIB'
    XP_GATE_JSCPD_DEFAULT_IGNORE=0
    if jscpd_is_default_ignored '.xp-gate/reports/x.json'; then echo STILL_IGNORED; else echo OPT_OUT_HONOURED; fi
  "
  [[ "$output" == *OPT_OUT_HONOURED* ]] || {
    echo "XP_GATE_JSCPD_DEFAULT_IGNORE=0 no longer disables the set"
    return 1
  }
}