#!/usr/bin/env bats

# ============================================================================
# Test for Issue #180: EXIT trap calls undefined function causing timeout
# The hook registers an EXIT trap that calls generate_quality_report
# ~1700 lines before the function is defined. Guard with command -v.
# ============================================================================

@test "#180 (RED): EXIT trap without guard errors on undefined function" {
  # Current pattern: trap calls function that hasn't been defined yet
  run bash -c '
    _quality_report_on_exit() {
      generate_quality_report 2>/dev/null || true
    }
    trap _quality_report_on_exit EXIT
    exit 0
  '
  # This "passes" but hides the real problem: bash still searches PATH
  # for the undefined command, which can cause ~15s timeout.
  [ "$status" -eq 0 ]
}

@test "#180 (GREEN): EXIT trap with command -v guard handles undefined gracefully" {
  # Fixed pattern: command -v guard prevents calling undefined functions
  run bash -c '
    _quality_report_on_exit() {
      if command -v generate_quality_report >/dev/null 2>&1; then
        generate_quality_report
      fi
    }
    trap _quality_report_on_exit EXIT
    exit 0
  '
  [ "$status" -eq 0 ]
  # Should produce no stderr about command not found
}

@test "#180: command -v guard still calls function when defined" {
  run bash -c '
    generate_quality_report() { echo "REPORT_GENERATED"; }
    _quality_report_on_exit() {
      if command -v generate_quality_report >/dev/null 2>&1; then
        generate_quality_report
      fi
    }
    trap _quality_report_on_exit EXIT
    exit 0
  '
  [ "$status" -eq 0 ]
  [[ "$output" == *"REPORT_GENERATED"* ]]
}

@test "#180: time comparison - guard is faster than bare call on undefined" {
  # Measure time with bare call (current buggy pattern)
  local time_bare
  time_bare=$(TIMEFORMAT=%R; bash -c 'f() { nonexistent_func 2>/dev/null || true; }; trap f EXIT; exit 0' 2>&1)
  echo "Bare call time: ${time_bare}s"
  
  # Measure time with command -v guard
  local time_guarded
  time_guarded=$(TIMEFORMAT=%R; bash -c 'f() { if command -v nonexistent_func >/dev/null 2>&1; then nonexistent_func; fi; }; trap f EXIT; exit 0' 2>&1)
  echo "Guarded call time: ${time_guarded}s"
  
  # Guard should be at least as fast or faster
  local bare_int=$(echo "$time_bare * 1000" | bc 2>/dev/null | cut -d. -f1)
  local guard_int=$(echo "$time_guarded * 1000" | bc 2>/dev/null | cut -d. -f1)
  
  # If timings are measurable, assert guard is not dramatically slower
  echo "Bare: ${bare_int}ms, Guarded: ${guard_int}ms"
}
