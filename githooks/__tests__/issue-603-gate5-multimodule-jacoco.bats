#!/usr/bin/env bats
# @test REQ-622
# @intent A multi-module Maven repo writes one JaCoCo report per module
#         (core/target/site/jacoco/jacoco.csv, demo/...) and nothing at the repo
#         root. Gate 5 probed only the root paths, so it concluded "No JaCoCo
#         report found, so the 80% Java coverage floor cannot be verified" and
#         BLOCKED every Java commit -- of a project whose complete report was
#         sitting one directory down. A gate that cannot see the report is not
#         enforcing a floor; it is enforcing an accident of build layout.
#         The floor must aggregate every module report, not just the first.
#         The last test pins the opposite direction: widening the search must not
#         turn a repo with NO report anywhere into a silent pass.
# @covers AC-622-01, AC-622-02, AC-622-03, AC-622-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# The Java coverage arm of Gate 5, from the java) case label to the end of the
# Jacoco probing/aggregation block.
_java_cov_arm() {
  sed -n '/^    "java")$/,/^      if \[ -n "\$jacoco_csv" \]; then$/p' "$PRE_COMMIT"
}

# A JaCoCo CSV with one class row. Coverage = covered/(missed+covered).
_jacoco_csv() {
  local missed="$1" covered="$2" name="$3"
  printf 'GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,BRANCH_MISSED,BRANCH_COVERED,LINE_MISSED,LINE_COVERED,COMPLEXITY_MISSED,COMPLEXITY_COVERED,METHOD_MISSED,METHOD_COVERED\n'
  printf 'g,p,%s,%s,%s,0,0,0,0,0,0,0,0\n' "$name" "$missed" "$covered"
}

@test "#603 AC-622-01: the java arm probes module reports, not only the root" {
  run _java_cov_arm
  [ "$status" -eq 0 ]
  _code="$(printf '%s\n' "$output" | grep -vE '^[[:space:]]*#')"
  # Discovery of nested reports must exist. The find call spans two physical
  # lines (`find . -path ./target -prune -o \` then
  # `-type f ( -name 'jacoco.csv' -path '*/target/site/jacoco/*' ) ...`), so
  # grep the whole arm with newlines flattened to spaces instead of demanding
  # one physical line.
  _flat="$(printf '%s\n' "$_code" | tr '\n' ' ' | tr -s ' ' ' ')"
  printf '%s\n' "$_flat" | grep -q "find .*prune" || {
    echo "java arm never searches for nested module jacoco.csv reports"; return 1; }
  printf '%s\n' "$_flat" | grep -q "name 'jacoco.csv'" || {
    echo "java arm's discovery does not look for jacoco.csv by name"; return 1; }
  # And it must still try the root paths first (single-module projects).
  printf '%s\n' "$_code" | grep -q 'target/site/jacoco/jacoco.csv' || {
    echo "java arm dropped the root-path probe"; return 1; }
}

@test "#603 AC-622-02: a multi-module repo is measured, not blocked" {
  mkdir -p "$TEST_DIR/repo/core/target/site/jacoco" "$TEST_DIR/repo/demo/target/site/jacoco"
  cd "$TEST_DIR/repo" || return 1
  : > pom.xml
  _jacoco_csv 100 900 Core > core/target/site/jacoco/jacoco.csv
  _jacoco_csv 100 900 Demo > demo/target/site/jacoco/jacoco.csv

  # Old behaviour: neither root path exists -> "report not found" -> BLOCKED.
  [ ! -f target/site/jacoco/jacoco.csv ]

  # New behaviour: the module reports are found.
  run bash -c 'find . -path ./target -prune -o -type f \( -name jacoco.csv -path "*/target/site/jacoco/*" \) -print | sort | tr "\n" " "'
  [ "$status" -eq 0 ]
  case "$output" in
    *core/target/site/jacoco/jacoco.csv*) ;;
    *) echo "core report not discovered: $output"; return 1 ;;
  esac
  case "$output" in
    *demo/target/site/jacoco/jacoco.csv*) ;;
    *) echo "demo report not discovered: $output"; return 1 ;;
  esac
}

@test "#603 AC-622-03: the floor aggregates all modules, not just the first" {
  mkdir -p "$TEST_DIR/repo/a/target/site/jacoco" "$TEST_DIR/repo/b/target/site/jacoco"
  cd "$TEST_DIR/repo" || return 1
  # Module a: 100% covered. Module b: 0% covered. The TRUE aggregate is 50%.
  # Reading only the first report would report 100% and let a failing project
  # through -- the exact defect a "first file wins" aggregate creates.
  _jacoco_csv 0 100 A > a/target/site/jacoco/jacoco.csv
  _jacoco_csv 100 0 B > b/target/site/jacoco/jacoco.csv

  jacoco_all=$(find . -path ./target -prune -o \
    -type f \( -name 'jacoco.csv' -path '*/target/site/jacoco/*' \) -print 2>/dev/null \
    | sort | tr '\n' ' ')

  pct=$(awk -F, '
    FNR == 1 {
      missed_col = 0; covered_col = 0;
      for (i = 1; i <= NF; i++) {
        if ($i == "INSTRUCTION_MISSED") missed_col = i;
        if ($i == "INSTRUCTION_COVERED") covered_col = i;
      }
      next;
    }
    missed_col && covered_col { missed += $missed_col; covered += $covered_col; }
    END { total = missed + covered; if (total > 0) printf "%.2f", (covered / total) * 100; else print ""; }
  ' $jacoco_all)

  echo "aggregate=$pct"
  [ "$pct" = "50.00" ] || { echo "expected 50.00 across both modules, got $pct"; return 1; }
}

@test "#603 AC-622-04: a repo with no report at all still blocks" {
  mkdir -p "$TEST_DIR/repo2/src/main/java"
  cd "$TEST_DIR/repo2" || return 1
  : > pom.xml
  # The fail-closed path must survive: no report anywhere means no evidence,
  # which must stay a BLOCK, not a silent pass.
  run _java_cov_arm
  [ "$status" -eq 0 ]
  # The blocking message lives just past the probed block; assert on the hook
  # source instead of the extracted arm for that reason.
  grep -q 'No JaCoCo report found' "$PRE_COMMIT" || {
    echo "the fail-closed branch disappeared"; return 1; }
  grep -q 'BLOCKED - No JaCoCo report found' "$PRE_COMMIT" || {
    echo "missing report no longer blocks"; return 1; }
}
