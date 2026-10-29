#!/usr/bin/env bats
# @test REQ-649
# @intent Dependencies and build output were reaching every scanner in the
#         pre-commit hook. `git diff --cached` lists whatever is in the index
#         regardless of .gitignore, so a project that vendors its dependencies
#         (or a CI fixture that commits after `npm install`) handed third-party
#         source to gates that judged it as the project's own code.
#
#         This has already cost two outages, one language branch at a time:
#         #595 (Gate 1 PowerShell arm blocked every commit once Playwright was
#         scanned for Write-Host) and #648 (Gate 1 JS/TS arm blocked on the bare
#         `debugger;` inside node_modules/typescript). Both were fixed at the
#         single site that happened to fail, which is why the third one was
#         waiting.
#
#         The fix moves the exclusion to the one place the file list is built,
#         so a scanner added tomorrow is safe by default, and gives the sites
#         that query git directly a shared helper instead of a hand-written
#         `grep -v` chain each.
#
#         The tests below pin three separate things, and the second is the one
#         that matters: (1) dependencies are filtered, (2) REAL PROJECT FILES
#         SURVIVE, (3) the sites that still query git directly actually call the
#         helper. A filter that swallowed everything passes (1) and (3) while
#         silently turning the gates off, so (2) is the anti-vacuity half.
# @covers AC-649-01, AC-649-02, AC-649-03, AC-649-04, AC-649-05

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/jscpd-run.sh"
  HOOK="$REPO_ROOT/githooks/pre-commit"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
}

# Run the shared helper exactly as the hook does: sourced library, stdin list.
# Prints nothing for an empty result so assertions compare against "" and not
# against a lone newline (printf '%s\n' "" still emits one).
run_filter() {
  (
    source "$LIB"
    printf '%s\n' "$1" | filter_project_paths
  )
}

@test "AC-649-01: dependencies are not project code (node_modules, vendor)" {
  out="$(run_filter 'node_modules/typescript/dist/internal/utils.js
vendor/some-lib/index.ts')"
  [ "$out" = "" ]
}

@test "AC-649-02: build output is not project code (dist/build/target/coverage/out)" {
  out="$(run_filter 'dist/bundle.js
build/app.js
target/classes/X.java
coverage/report.ts
out/gen.ts')"
  [ "$out" = "" ]
}

@test "AC-649-03: project source survives the filter (anti-vacuity)" {
  # If the filter swallowed everything, AC-649-01 and -02 would still pass while
  # the gates silently stopped doing anything. This is the case that must NOT be
  # filtered, and it is what the whole hook exists for.
  out="$(run_filter 'src/app.ts
lib/util.tsx
githooks/pre-commit
docs/readme.md')"
  [ "$out" = "src/app.ts
lib/util.tsx
githooks/pre-commit
docs/readme.md" ]
}

@test "AC-649-03b: mixed, empty and dependency-only inputs stay coherent" {
  # Delphi round 1 (feasibility MN-03, architecture minor) asked whether a
  # commit whose paths are ALL filtered behaves like an empty commit. It must
  # not: `RAW_CHANGED_FILES` is non-empty there, so the hook must not take the
  # "No files changed" early exit -- that would silently skip every gate for a
  # commit that really did stage something.
  out="$(run_filter 'node_modules/a.ts
src/keep.ts
vendor/b.ts')"
  [ "$out" = "src/keep.ts" ]

  out="$(run_filter '')"
  [ "$out" = "" ]

  out="$(run_filter 'node_modules/a.ts
vendor/b.ts
dist/c.js')"
  [ "$out" = "" ]

  # Paths are passed through byte-for-byte, not rewritten: a filter that helped
  # itself to normalisation would hand scanners paths git never emitted.
  out="$(run_filter 'src/with space/file.ts')"
  [ "$out" = "src/with space/file.ts" ]
}

@test "AC-649-03c: the helper never fails the pipeline it sits in" {
  # It is used as `... | filter_project_paths | grep ... || true` inside the
  # hook. A non-zero exit here would poison the pipeline and turn a clean commit
  # red, so empty input and a pipeline that closes early must both stay quiet.
  run bash -c "source '$LIB'; printf '' | filter_project_paths"
  [ "$status" -eq 0 ]

  # A pipeline that exits before consuming everything (head -1) must not make
  # the helper report failure through SIGPIPE.
  run bash -c "source '$LIB'; printf 'src/a.ts\nsrc/b.ts\n' | filter_project_paths | head -1"
  [ "$status" -eq 0 ]
  [ "$output" = "src/a.ts" ]
}

@test "AC-649-04: the entry point applies the filter, and keeps RAW unfiltered" {
  # The hook must build CHANGED_FILES through the helper, not merely have the
  # helper available: a sourced-but-unused function is the exact shape of the
  # bug this issue is about (Gate 1 had the ignore set for a year and did not
  # use it until #648).
  grep -q 'CHANGED_FILES=\$(printf' "$HOOK"
  grep -q 'jscpd_is_build_output "\$_cf"' "$HOOK"

  # RAW_CHANGED_FILES is deliberately untouched: "did the user stage anything"
  # and "is there a vendored dependency worth warning about" both need the
  # unedited list.
  grep -qE '^RAW_CHANGED_FILES=\$\(git diff --cached' "$HOOK"
}

@test "AC-649-05: every direct git-diff scanner routes through the helper" {
  # The sites that query git themselves (test pairing BLOCK + WARNING, mock
  # density, changed src files, python test/src selection, per-file coverage,
  # Boy Scout) each used to carry its own `grep -v` chain or nothing at all.
  # This asserts none of them silently goes back to an unfiltered list.
  #
  # Three sites are exempt and must stay that way:
  #   STAGED_FILES (gate 0)  - matches only VERSION/CHANGELOG.md by name
  #   PY_CHANGED_ALL         - answers "did requirements change", so it must see
  #                            paths under vendor/
  #   RAW_CHANGED_FILES      - the unedited list, by definition
  #
  # The check reads LOGICAL LINES (backslash continuations joined), because the
  # python pair spreads the pipeline over two physical lines with the helper on
  # the continuation. A physical-line check would either miss them or force the
  # helper onto the first line for the sole benefit of the test.
  local logical="" line stmt continues=0
  local -a offenders=()

  while IFS= read -r line; do
    # Join continuations FIRST, then classify: `... 2>/dev/null \` is only
    # complete once the helper on its continuation line is appended.
    #
    # Stripped in pure bash: pre-commit is ~4700 lines, and a `sed` per line
    # costs enough to turn this suite into a timeout instead of a failure.
    continues=0
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in
      *\\)
        continues=1
        line="${line%\\}"
        ;;
    esac
    logical="${logical:+$logical }$line"
    [ "$continues" = "0" ] || continue
    stmt="$logical"
    logical=""

    case "$stmt" in
      *'git diff --cached'*) ;;
      *) continue ;;
    esac
    case "$stmt" in
      "#"*) continue ;;
      *'#'*'git diff'*) continue ;;
    esac
    case "$stmt" in
      *STAGED_FILES=*) continue ;;
      *PY_CHANGED_ALL=*) continue ;;
      *RAW_CHANGED_FILES=*) continue ;;
    esac

    printf '%s' "$stmt" | grep -q 'filter_project_paths' || offenders+=("$stmt")
  done < "$HOOK"

  if [ "${#offenders[@]}" -gt 0 ]; then
    for stmt in "${offenders[@]}"; do
      echo "unfiltered git-diff scan: $stmt" >&2
    done
    return 1
  fi
}

@test "AC-649-05b: the three exemptions must NOT acquire the filter" {
  # The mirror image of AC-649-05. Filtering is the right default everywhere
  # else, which makes "just add the helper here too" a very natural-looking
  # edit -- and on these three it is wrong:
  #
  #   RAW_CHANGED_FILES - the early exit keys on it. Filtering it would make a
  #                       commit that staged only dependencies take the
  #                       "No files changed" path and skip every gate (the
  #                       failure that #509 already guards from the other side
  #                       (see issue-510-mirror-invariant).
  #   PY_CHANGED_ALL    - answers "did a requirements file change". A vendored
  #                       requirements.txt under vendor/ IS a real change.
  #   STAGED_FILES      - Gate 0 by name. Harmless either way, but it must keep
  #                       comparing the exact names VERSION/CHANGELOG.md.
  while IFS= read -r line; do
    case "$line" in
      *RAW_CHANGED_FILES=\$\(*|*PY_CHANGED_ALL=\$\(*|*STAGED_FILES=\$\(*)
        case "$line" in
          *filter_project_paths*)
            echo "exempt site must stay unfiltered: $line" >&2
            return 1
            ;;
        esac
        ;;
    esac
  done < "$HOOK"

  # And the early exit really does key on RAW.
  grep -qE '^if \[ -z "\$RAW_CHANGED_FILES" \]' "$HOOK"
}

@test "AC-649-06: YAML/TXT/log are project files and must survive" {
  # The first implementation of #649 reused Gate 2's WHOLE ignore set, which
  # also drops *.yaml, *.yml, *.txt and *.log because repetition in those files
  # is data shape rather than a refactoring target. That is the right answer for
  # "is this worth comparing for duplication" and the wrong answer for "is this
  # our code": a commit adding infra/deployment.yaml must still reach the IaC
  # and lint gates, and it was instead announced as
  # "No code files changed, skipping lint".
  #
  # So the two notions are separate now -- build output (directories) filters
  # file lists, non-refactorable types stay Gate 2's business alone. This pins
  # the split so a future "simplification" cannot collapse them again.
  out="$(run_filter 'infra/deployment.yaml
config/settings.yml
notes.txt
debug.log
README.md')"
  [ "$out" = "infra/deployment.yaml
config/settings.yml
notes.txt
debug.log
README.md" ]

  # And Gate 2 keeps ignoring them for duplication purposes.
  run bash -c "source '$LIB'; jscpd_is_default_ignored config.yaml"
  [ "$status" -eq 0 ]
  run bash -c "source '$LIB'; jscpd_is_build_output config.yaml"
  [ "$status" -ne 0 ]

  # The entry point must call the build-output predicate, not the combined one.
  grep -q 'jscpd_is_build_output "\$_cf"' "$HOOK"
}

@test "AC-649-07: cache and bytecode directories are build output too" {
  # Delphi round 2 (architecture MC-01, feasibility FC-01) asked whether the
  # directory list covers mainstream toolchains. It did not: __pycache__,
  # .pytest_cache, .mypy_cache and friends were missing, and __pycache__ is
  # written by CPython itself -- a Python project that commits its workspace
  # stages it without anyone deciding to.
  out="$(run_filter '__pycache__/mod.cpython-311.pyc
.pytest_cache/v/cache/nodeids
.mypy_cache/3.11/x.json
.ruff_cache/x
.tox/py/bin/pyvenv.cfg
.turbo/run.json
.cache/blob.bin')"
  [ "$out" = "" ]

  # Anti-vacuity: these names are NOT unambiguously build output, so they must
  # survive. bin/ holds real source in many layouts, obj/ is output in C# but
  # committed scripts elsewhere, and .venv/venue is sometimes committed.
  out="$(run_filter 'bin/cli.sh
obj/Model.cs
src/app.ts')"
  [ "$out" = "bin/cli.sh
obj/Model.cs
src/app.ts" ]
}
