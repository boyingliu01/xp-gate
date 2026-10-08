#!/usr/bin/env bash
# ============================================================================
# Gate 2 duplicate-code helpers (issue #477)
#
# Extracted from pre-commit so the outcome contract is unit-testable without
# executing the hook, and so an installed hook can source it the same way it
# sources the other libraries in this directory.
# ============================================================================

# Echo the jscpd config the gate should pass, or nothing when the project has
# none.
#
# pre-commit used to hand jscpd `--config jscpd.conf.json` unconditionally. When
# that file was not in the working directory jscpd printed
# "config file jscpd.conf.json: ... (os error 2)" and the gate then read the
# non-zero exit as "duplicates found" -- a fabricated finding on top of a
# fabricated error (#477). The probe is anchored at PROJECT_ROOT first because
# git hands the gate repo-root-relative state while the hook may have cd'd into
# a language subdirectory.
resolve_jscpd_config() {
  local _base="${PROJECT_ROOT:-$(pwd)}" _candidate
  for _candidate in "$_base/jscpd.conf.json" "$(pwd)/jscpd.conf.json"; do
    if [ -f "$_candidate" ]; then
      printf '%s\n' "$_candidate"
      return 0
    fi
  done
  return 0
}

# Echo exactly one of `clean`, `duplicates`, `error` for a finished jscpd run.
#
#   $1 -- the tool's exit status
#   $2 -- everything it printed (stdout and stderr together)
#
# jscpd's exit status cannot carry this distinction: the default CLI exits 0
# after a report that contains clones, and exits non-zero for a config or IO
# failure that produced no report at all. The report is the evidence; the exit
# status only explains a run that left none.
#
# Nothing here blocks or unblocks: Gate 2's severity is unchanged (duplicates
# stay a warning). This only stops the gate from naming the wrong reason.
classify_jscpd_run() {
  local _exit="$1" _out="$2" _report _count
  _report=$(printf '%s' "$_out" | grep -oE 'Found [0-9]+ (clones?|duplicates?)' | tail -1)
  if [ -n "$_report" ]; then
    _count=$(printf '%s' "$_report" | sed -E 's/^Found ([0-9]+).*/\1/')
    if [ "$_count" -gt 0 ] 2>/dev/null; then
      printf 'duplicates\n'
    else
      printf 'clean\n'
    fi
    return 0
  fi
  if [ "$_exit" -ne 0 ] 2>/dev/null; then
    printf 'error\n'
    return 0
  fi
  # Exit 0 with no report: the run said nothing we can stand behind, but calling
  # it an error would turn every unfamiliar jscpd format into a SKIP. Leave the
  # gate's verdict as it was.
  printf 'clean\n'
}
