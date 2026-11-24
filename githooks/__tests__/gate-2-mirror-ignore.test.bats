#!/usr/bin/env bats
#
# @test REQ-GATE2-MIRROR-IGNORE Gate 2 must not report the build mirrors as
#       duplicated code
# @intent `src/npm-package/**` is a BYTE-IDENTICAL mirror of `githooks/**`,
#         `plugins/**` and `skills/**`, regenerated at prepack. Two files that
#         are required to be identical are not "duplicated code", and reporting
#         them as such is a finding nobody can act on.
#
#         Measured 2026-11-24: `check 2` took 28.4 s and FAILED, every finding a
#         pair like
#             .git/hooks/gate-registry.sh  ==  src/npm-package/hooks/gate-registry.sh
#         The ignore set already excluded `.xp-gate` -- whose comment records
#         the same measurement ("1923 src/npm-package" among the top
#         offenders) -- but not the mirror itself.
#
#         Mirror drift is a real defect and it has its own gate (12b). Making
#         Gate 2 re-derive it from line similarity is both wrong (it compares
#         content that must match) and slow.
#
# @covers AC-GATE2-MIRROR-IGNORE-01  the default ignore set excludes src/npm-package
# @covers AC-GATE2-MIRROR-IGNORE-02  the canonical sources remain in scope
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/jscpd-run.sh"
  [ -f "$LIB" ] || skip "jscpd-run.sh not found"
}

@test "AC-GATE2-MIRROR-IGNORE-01: the default ignore set excludes the npm-package mirror" {
  run grep -F "src/npm-package" "$LIB"
  [ "$status" -eq 0 ]
  # It must be in the IGNORE set, not merely mentioned in a comment.
  run grep -E "JSCPD_DEFAULT_IGNORE_PATTERNS=.*src/npm-package" "$LIB"
  [ "$status" -eq 0 ]
}

@test "AC-GATE2-MIRROR-IGNORE-02: canonical sources are still scanned" {
  # The mirror is excluded; the files it mirrors are NOT. An ignore set that
  # swallowed githooks/ too would report a permanent clean.
  run grep -E "JSCPD_DEFAULT_IGNORE_PATTERNS=.*(^|[|(])(githooks|plugins|skills)/" "$LIB"
  [ "$status" -ne 0 ]
}
