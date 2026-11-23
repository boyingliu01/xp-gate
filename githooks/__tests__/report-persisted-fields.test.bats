#!/usr/bin/env bats
#
# @test REQ-PERSIST-FIELDS the persisted report keeps every field the template emits
# @intent generate_quality_report() writes a rich report, then a second step rewrites
#         it into the "persisted" copy. That rewrite used to rebuild the document from
#         a fixed literal:
#
#             const r = {timestamp, trigger, branch, commit, changed_files,
#                        overall, gates, warnings, errors}
#
#         Every field the template had grown since -- gateTimings, coverageMatrix,
#         coverageWarnings, languagesSource, reportVersion, language -- was silently
#         dropped from the file anything downstream actually reads.
#
#         Measured 2026-11-20 on this repo, eight consecutive real reports:
#
#             top-level keys: timestamp, trigger, branch, commit, changed_files,
#                             overall, gates, warnings, errors, duration_ms
#             gateTimings  : absent from all eight
#
#         The template comment says of gateTimings: "published so 'which gate is
#         slow' is a measurement instead of an estimate". It was publishing into a
#         document that was then thrown away and replaced with a shorter one.
#
#         This is the same defect family as the rest of this series -- a channel that
#         reports success while carrying nothing -- but one level down: not a verdict
#         that lies, a MEASUREMENT that never survives to disk.
#
# @covers AC-PF-01  the persisted copy spreads the parsed source rather than a literal
# @covers AC-PF-02  gateTimings survives to a real report
# @covers AC-PF-03  a genuinely recomputed field still wins over the spread
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  G13="$REPO/githooks/gate-entries/gate-13-entry.sh"
}

@test "AC-PF-01: the persisted rewrite spreads the source document" {
  # The literal rebuild is the bug. Its absence is the fix's precondition: with a
  # fixed key list, every future template field is dropped again by construction.
  #
  # Checked on the PERSIST line specifically. The first version of this assertion
  # grepped the whole file for Object.assign, and Object.assign appears elsewhere in
  # it -- so restoring the broken literal rebuild left the test green. A guard that
  # passes while the bug is present is worse than no guard.
  local line
  line=$(grep '_XP_RF="$REPORT_FILE"' "$G13" | grep 'node -e' | head -1)
  [ -n "$line" ] || {
    echo "could not find the persisted-report rewrite"
    false
  }
  printf '%s' "$line" | grep -qE 'Object\.assign\(\{\},br|\.\.\.br|Object\.assign\(\{\}, *br' || {
    echo "the persisted rewrite drops any field it does not name explicitly:"
    printf '%s\n' "$line" | cut -c1-300
    false
  }
}

@test "AC-PF-02: gateTimings survives to a real report" {
  # Run the real hook on a throwaway repo and read the PERSISTED file -- the one
  # downstream tooling reads, not the intermediate the template writes first.
  local dir="$BATS_TEST_TMPDIR/pf"
  mkdir -p "$dir"
  cd "$dir" || return 1
  printf 'def f() -> int:\n    return 1\n' > a.py
  : > .architecture-skip
  git init -q -b probe-pf . >/dev/null 2>&1
  git config user.email p@example.com
  git config user.name p
  git config core.hooksPath "$REPO/githooks"
  git add -A >/dev/null 2>&1
  git -c core.hooksPath= commit -q --no-verify -m base >/dev/null 2>&1

  printf 'def f() -> int:\n    return 2\n' > a.py
  git add a.py >/dev/null 2>&1
  # The hook chain must RUN here: this test asserts the report it writes.
  # core.hooksPath was pinned to "$REPO/githooks" above, so this never reaches
  # the HOST chain -- that pin, not --no-verify, is what FC-04 recognises.
  timeout 600 git -c core.hooksPath="$REPO/githooks" commit -m probe >/dev/null 2>&1 || true

  local rep
  rep=$(ls .xp-gate/reports/pre-commit/*.json 2>/dev/null | sort | tail -1)
  [ -n "$rep" ] || {
    echo "no report was written"
    false
  }

  node -e "const j=require(process.argv[1]);if(!(\"gateTimings\" in j)){console.error(\"keys:\",Object.keys(j).join(\",\"));process.exit(1)}" "$PWD/$rep" || {
    echo "gateTimings was dropped from the persisted report"
    false
  }
}

@test "AC-PF-03: a field this step genuinely recomputes still overrides the spread" {
  # Anti-over-reach. Spreading the source must not resurrect a stale duration_ms that
  # the guard above deliberately rejected: the explicit `delete r.duration_ms` plus
  # the conditional re-assignment have to survive the change.
  grep -q 'delete r.duration_ms' "$G13" || {
    echo "the spread can now resurrect a rejected duration_ms"
    false
  }
  grep -q 'Number.isFinite(d)&&d>0' "$G13" || {
    echo "duration_ms is no longer validated before being written"
    false
  }
}
