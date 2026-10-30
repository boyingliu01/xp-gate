#!/usr/bin/env bats
# @test REQ-617
# @intent Gate 3's own comment states the rule: "Grade exactly the population the
#         baseline was written from. The two must match or the ratchet reports
#         pre-existing code as 'new', which is a false BLOCK no repair can clear."
#
#         The rule was only a comment. A repo whose baseline is produced by a
#         project script that scans fewer roots/extensions than Gate 3 grades got:
#
#           CCN drift between gate run and re-scan:
#             src/main/webapp/static/base/js/jquery.min.js (anonymous)
#             gate=3 rescan=1
#           BLOCKED - complexity could not be span-verified; refusing to grade
#             unverified CCN.
#
#         --staged never saw it (those commits only touched Java); --all did, because
#         vendored minified JS reaches --csv-verified, where brace-balanced
#         re-derivation disagrees with lizard on single-line code.
#
#         The file blocks with a message about "drift" that has no actionable fix:
#         the file never appears in the baseline, so there is no ratchet entry to
#         repair and no way for the user to say "this file is outside my baseline".
#
#         The fix (the issue's option 1, which matches the existing design intent)
#         is to make the population DECLARED rather than assumed: the baseline
#         records which roots/extensions it covers, and Gate 3 grades that set.
#         "Writer and gate grade the same set" then becomes an enforced invariant
#         instead of a comment.
#
#         A baseline written before this change carries no population metadata, so
#         the reader must ALSO accept the legacy shape (treat it as "unrestricted")
#         rather than refusing to load every existing baseline in the field.
# @covers AC-670-51, AC-670-52, AC-670-53

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-3.sh"
  LIB="$REPO_ROOT/githooks/lib/ccn-ratchet.sh"
  TMP="$BATS_TEST_TMPDIR"
}

load_ratchet() {
  # shellcheck source=/dev/null
  source "$LIB"
}

# AC-670-51: the baseline can declare its own population, and the reader sees it.
@test "AC-670-51: a declared population is read from the baseline" {
  [ -f "$LIB" ]
  load_ratchet
  declare -F ccn_baseline_population >/dev/null \
    || { echo "no ccn_baseline_population() reader"; return 1; }

  cat > "$TMP/b.json" <<'JSON'
{
  "population": { "roots": ["src/main/java"], "extensions": [".java"] },
  "entries": { "src/main/java/A.java::f": 4 }
}
JSON
  run ccn_baseline_population "$TMP/b.json"
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | grep -q 'src/main/java'
  printf '%s\n' "$output" | grep -q 'java'
}

# AC-670-52: a file outside the declared population is NOT graded, and says so.
@test "AC-670-52: a vendored file outside the declared population is skipped with a reason" {
  load_ratchet
  declare -F ccn_file_in_population >/dev/null \
    || { echo "no ccn_file_in_population() predicate"; return 1; }

  cat > "$TMP/b.json" <<'JSON'
{
  "population": { "roots": ["src/main/java"], "extensions": [".java"] },
  "entries": {}
}
JSON
  # The vendored minified asset from the report: outside the roots AND the
  # extension set, so it must not be graded at all.
  run ccn_file_in_population "$TMP/b.json" "src/main/webapp/static/base/js/jquery.min.js"
  [ "$status" -ne 0 ]

  # A Java file under the declared root is in scope.
  run ccn_file_in_population "$TMP/b.json" "src/main/java/com/e/Box.java"
  [ "$status" -eq 0 ]
}

# AC-670-53: a legacy baseline (no population metadata) stays unrestricted.
@test "AC-670-53: a legacy baseline without metadata grades everything, as before" {
  load_ratchet
  cat > "$TMP/legacy.json" <<'JSON'
{ "src/main/java/A.java::f": 4, "web/app.js::g": 2 }
JSON
  # Every existing baseline in the field has this shape. Refusing to load it would
  # break every install on upgrade; treating it as "unrestricted" reproduces the
  # historical behaviour exactly.
  run ccn_file_in_population "$TMP/legacy.json" "src/main/webapp/static/base/js/jquery.min.js"
  [ "$status" -eq 0 ] || { echo "legacy baseline is no longer permissive"; return 1; }
  # And the reader must not invent a population that was never declared.
  run ccn_baseline_population "$TMP/legacy.json"
  [ -z "$output" ] || { echo "reader invented population for a legacy baseline"; return 1; }
}
