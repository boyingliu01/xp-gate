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
# `.xp-gate` is in the directory list for the same reason node_modules and dist
# are: it is generated state, not project source. It is not a BUILD output but
# xp-gate's own report/journal tree, and leaving it out made the tool compare its
# reports to each other. Measured on this repo with `check 2`:
#
#   total 49-52 s (stable), jscpd alone 6-7 s, "Found 3886 clones"
#   by path prefix: 4949 .xp-gate / 1923 src/npm-package / 1306 plugins / 1152 skills
#
# More findings about its own output than about the code it was asked to check,
# in a report nobody can act on. Every other build-output directory was already
# listed; the one this tool writes itself was the omission.
# `src/npm-package` joins for the same reason, and it was the largest remaining
# offender in that measurement (1923 files). It is a BYTE-IDENTICAL mirror of
# githooks/, plugins/ and skills/, regenerated at prepack -- two files that must
# be identical are not duplicated code, and a finding nobody can act on costs
# 28 s per run (measured 2026-11-24: `check 2` took 28.4 s and FAILED on exactly
# these pairs). Mirror drift is a real defect with its own gate (12b); Gate 2
# re-deriving it from line similarity is both wrong and slow.
#
# *.md joins the set for the same reason *.yaml did: duplicate detection is
# about CODE, and a prose document mirrored into several plugin directories is
# duplicate by design. Measured before: 581 of 1410 findings were skill docs
JSCPD_DEFAULT_IGNORE_PATTERNS='(^|/)(node_modules|dist|build|target|coverage|out|\.next|\.nuxt|vendor|\.xp-gate|src/npm-package)/|\.log$|\.txt$|\.(ya?ml)$|golden|baseline\.json$|evidence|\.md$'

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
  # A failed run outranks everything else: it is the most specific fact, and
  # calling a crash "no_files" would hide the crash.
  if [ "$_exit" -ne 0 ] 2>/dev/null; then
    printf 'error\n'
    return 0
  fi
  # "Found 0 clones" means "no duplicate was found", which equals "no duplicate
  # exists" only if something was examined. jscpd reports the difference on stderr
  # and still exits 0:
  #
  #     Warning: jscpd analyzed no files: check the paths and the --format,
  #     --ignore and --pattern filters
  #     Found 0 clones.
  #
  # Measured 2026-11-19 on a Dart fixture: the table read Total: 0 files /
  # 0 lines / 0 tokens, Gate 2 printed "PASSED - jscpd duplicate code check
  # completed" and the summary recorded PASS. A gate that examined nothing was
  # indistinguishable from one that examined the change set and found it clean.
  #
  # The reason it happens on a Dart project is itself worth naming: the file list
  # the gate hands jscpd is built from the change set, and jscpd only accepts the
  # extensions its `--format` set covers. When the two disagree the scan is empty,
  # which is an environment/configuration fact, not a verdict. `no_files` reaches
  # the gate as SKIP with this name attached.
  if printf '%s' "$_out" | grep -qiE 'analy[sz]ed no files|analy[sz]e[sd]? (no|zero) files'; then
    printf 'no_files\n'
    return 0
  fi
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
  # Exit 0 with no report at all. Two sub-cases, and they are not the same:
  #
  #   - Nothing but a timing line: measured by running jscpd with an --ignore that
  #     excludes everything --
  #           $ jscpd --ignore "**/*" lib.dart ; echo $?
  #           time: 0.156ms
  #           0
  #     No table, no counts, no warning. The scan examined nothing, so "leave the
  #     verdict as it was" leaves it as PASS -- a clean bill for a codebase nobody
  #     looked at.
  #   - Anything else (an unfamiliar format, a version banner, a partial report):
  #     the run did produce evidence we cannot parse. Turning that into a SKIP
  #     would disable the gate for every project whose jscpd prints something new,
  #     which is why this fallback existed in the first place.
  #
  # Only the first is a "nothing happened" run. Strip ANSI, drop blank lines and
  # the timing line, and see whether anything remains.
  local _meaningful
  _meaningful=$(printf '%s' "$_out" \
    | sed -E 's/\x1b\[[0-9;]*m//g' \
    | grep -vE '^[[:space:]]*$' \
    | grep -viE '^[[:space:]]*(time|duration)[[:space:]]*:' \
    | head -1)
  if [ -z "$_meaningful" ]; then
    printf 'no_files\n'
    return 0
  fi
  printf 'clean\n'
}
