#!/usr/bin/env bash
# ============================================================================
# Gate 2 duplicate-code helpers (issue #477, #591)
#
# Extracted from pre-commit so the outcome contract is unit-testable without
# executing the hook, and so an installed hook can source it the same way it
# sources the other libraries in this directory.
# ============================================================================

# The default ignore set: what Gate 2 must NOT treat as refactorable source when
# the project expresses no preference (#591).
#
# jscpd's own defaults treat .yaml, .txt and .log as scannable formats. On a
# data-heavy project that reports an exemptions manifest, a golden snapshot and
# two build logs as "duplicate code" — measured as 48.72% duplication on a
# fixture that contained no source at all. The number is worse than noise: a
# reader cannot tell "yaml rows that must repeat" from "two methods that were
# really copy-pasted", so the honest response is to stop reading Gate 2 and take
# the real duplicates down with it. The reporter's own tally: 176 clones
# reported, 6 refactorable.
#
# Deliberately NARROW. Every entry is a file class whose duplication is its data
# shape or its artifact nature, never a refactoring target. Real source
# extensions are untouched — pinned by a control case, because an ignore set that
# also swallowed .ts/.java/.py would report a permanent clean and look healthier
# than before the fix.
JSCPD_DEFAULT_IGNORE_PATTERNS='(^|/)(node_modules|dist|build|target|coverage|out|\.next|\.nuxt|vendor)/|\.log$|\.txt$|\.(ya?ml)$|golden|baseline\.json$|evidence'

# The BUILD-OUTPUT half of the set above, alone (#649).
#
# The combined set answers "is this worth comparing for duplication", which is a
# question only Gate 2 asks. Filtering file list inputs with the whole set also
# drops *.yaml, *.yml, *.txt and *.log -- and those are perfectly real project
# files everywhere else. Doing that broke a live test on the first attempt:
# `YAML staged files activate lint and IaC but skip SAST` expects a staged
# infra/deployment.yaml to count as a code change, and whole-set filtering made
# the hook announce "No code files changed, skipping lint" for a commit that
# added a deployment manifest.
#
# So the two notions are separated here rather than shared:
#
#   BUILD OUTPUT (this)  - a directory tree that is generated or vendored:
#                          not our code for ANY gate. Used to filter file lists.
#   NON-REFACTORABLE (the combined set) - files whose duplication is data shape:
#                          still project files, just not duplication candidates.
#                          Gate 2 only.
#
# Same directory names, one definition; a directory added to the build-output
# list reaches every gate at once, which is the point of #649.
# Directory names that are generated or vendored in any mainstream toolchain.
#
# The second group (caches, virtualenvs, Python bytecode) is here because the
# first version of this list did not have it and the same class of bug was one
# `git add -A` away: __pycache__ is written by CPython itself and .pytest_cache
# by pytest, so a Python project that commits its workspace stages .pyc-adjacent
# artefacts and every scanner would read them as source. None of these can hold
# hand-written project code.
#
# NOT included on purpose: bin/ and obj/ (real source trees in plenty of
# projects -- e.g. cmd/bin layout, C# projects where obj/ IS output but bin/ is
# often committed scripts) and .venv/venv (genuinely ambiguous: some projects
# keep a small committed venv for reproducibility). Adding a name here removes
# it from EVERY gate at once, so the list stays the names that are unambiguous.
JSCPD_BUILD_OUTPUT_PATTERNS='(^|/)(node_modules|dist|build|target|coverage|out|\.next|\.nuxt|vendor|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox|\.turbo|\.cache)/'

# Is this path inside a dependency tree or a build-output directory?
#
# XP_GATE_JSCPD_DEFAULT_IGNORE=0 still disables it, so the escape hatch keeps
# covering "some project really does want its vendor/ tree linted".
jscpd_is_build_output() {
  local _path="$1"
  if [ "${XP_GATE_JSCPD_DEFAULT_IGNORE:-1}" = "0" ]; then
    return 1
  fi
  printf '%s\n' "$_path" | grep -qE "$JSCPD_BUILD_OUTPUT_PATTERNS"
}

# Human-readable form, printed by the gate so the baseline is auditable (#591
# point 3). Silence about the default is the same defect as silence about a
# skipped gate: the user cannot answer "what did it scan".
jscpd_default_ignore_patterns() {
  printf '%s\n' "jscpd default ignore (no jscpd.conf.json): build output (node_modules, dist, build, target, coverage, out, vendor), *.log, *.txt, *.yaml/*.yml, *golden*, *baseline.json, *evidence*"
}

# Is this path covered by the default ignore set? Exit 0 = ignore it.
#
# XP_GATE_JSCPD_DEFAULT_IGNORE=0 disables the set entirely: a project that
# genuinely wants YAML compared must be able to say so, or the default would make
# some real duplicates unreachable.
#
# SCOPE CHANGED IN #648: Gate 1's debugger check now calls this too, so the
# switch governs "what counts as our code" for BOTH gates — not just jscpd.
# Setting it to 0 makes Gate 1 scan dependencies and build output for debugger
# statements as well, which is rarely what someone disabling duplicate detection
# intends. Kept as one switch deliberately: two gates disagreeing about what a
# build artifact is would be its own defect, and a project that vendors code
# wants it treated consistently everywhere. Override per-run rather than
# permanently if you only meant to widen Gate 2's scan.
jscpd_is_default_ignored() {
  local _path="$1"
  if [ "${XP_GATE_JSCPD_DEFAULT_IGNORE:-1}" = "0" ]; then
    return 1
  fi
  printf '%s\n' "$_path" | grep -qE "$JSCPD_DEFAULT_IGNORE_PATTERNS"
}

# Drop dependency and build-output paths from a newline-separated file list on
# stdin, echoing what remains (#649).
#
# Every scanner that builds its own list from `git diff --cached` used to
# re-derive the exclusions by hand, and they drifted. The test-pairing check
# excluded node_modules/.next/.nuxt/dist/build/.turbo/.cache but not vendor,
# target, coverage or out -- so a staged `vendor/x.ts` was reported as a new
# source file with no test. Six more sites had no exclusions at all. The one
# place that got a shared ignore set (Gate 2) is the one that stopped having
# this bug.
#
# This is the shared answer: callers pipe their staged list through it and stop
# maintaining their own list. It reads stdin and writes stdout so it composes
# with whatever selection the caller already did:
#
#     NEW_TS_FILES=$(git diff --cached --name-only --diff-filter=A \
#       | filter_project_paths | grep -E '\.(ts|tsx)$' || true)
#
# Deliberately a filter, not a generator: a caller that needs a different git
# query (only-added, only-modified) keeps it, and only the exclusion rule is
# shared. Fail-open on empty input so `|| true` pipelines stay quiet.
#
# ON THE COUPLING (Delphi round 1, MC-01/FC-01): yes, this makes Gate 2's
# ignore set load-bearing for every gate. Widening it now widens what every
# scanner skips. That risk is accepted deliberately, and the alternative is
# worse: the bug this fixes WAS a set of per-scanner definitions that drifted
# apart, so N independent sets would reproduce it N times. The guard against
# silent widening is that every change to the set lands in one reviewable
# place, and #649's tests pin the boundary cases (vendor/target/coverage/out
# ignored; src/lib/docs kept). If a gate ever needs a genuinely different
# notion of "our code", introduce a second named set HERE rather than letting a
# caller edit this one.
filter_project_paths() {
  local _fp
  while IFS= read -r _fp || [ -n "$_fp" ]; do
    [ -n "$_fp" ] || continue
    if ! jscpd_is_build_output "$_fp"; then
      printf '%s\n' "$_fp"
    fi
  done
  return 0
}

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
