#!/usr/bin/env bats
# @test REQ-558 gate-10 dedups scan targets exactly, not by substring
# @intent Verify Gate 10 does not silently drop a staged file from the scan.
#         #558: target dedup used `case "$SEEN" in *"$dir"*)`, a substring
#         match with no separator. Once ./fastdl/tests was recorded, the parent
#         ./fastdl matched it and was never added as a target -- so a staged
#         fastdl/a.py contributed only an --include= with no directory to scan
#         it in. Nothing errors; the file is simply not analysed, which is the
#         worst possible outcome for a security gate: a silent net loss.
# @covers AC-558-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE10="$REPO_ROOT/githooks/gate-10.sh"
}

# Run the REAL dedup block extracted from gate-10.sh against a pinned file list.
# Extracting rather than re-typing the logic is the point: a hand-copied "fixed"
# version in the test would pass no matter what the script actually does.
#
# The block is written to a file and sourced, not inlined into `bash -c`: the
# code contains `$'\n'`, and any second round of shell expansion (an embedded
# " logic " or $(cat ...)) mangles it into a command-not-found. Sourcing a file
# executes the bytes exactly as the script ships them.
run_dedup() {
  local files="$1"
  local harness="$BATS_TEST_TMPDIR/dedup-harness.sh"
  {
    echo 'SEMGREP_ARGS=()'
    echo 'SEMGREP_FILE_COUNT=0'
    awk '/^[[:space:]]*SEMGREP_DIRS_SEEN=/,/^EOF$/' "$GATE10"
    echo 'printf "%s\n" "${SEMGREP_ARGS[@]}"'
  } > "$harness"
  # Guard against a silent extraction failure making every test vacuous.
  grep -q 'while IFS= read' "$harness" || return 1
  SEMGREP_FILES="$files" bash "$harness"
}

@test "anti-vacuity: the dedup block exists and the extractor finds it" {
  grep -q 'SEMGREP_DIRS_SEEN' "$GATE10"
  grep -q 'SEMGREP_ARGS+=' "$GATE10"
  # Extraction must yield real code, otherwise the tests below are vacuous.
  local logic
  logic=$(awk '/^[[:space:]]*SEMGREP_ARGS=\(\)/,/^EOF$/' "$GATE10")
  [ -n "$logic" ]
  printf '%s\n' "$logic" | grep -q 'SEMGREP_DIRS_SEEN'
}

@test "the dedup does not use an unanchored substring match" {
  # The defect's fingerprint is a case pattern quoting the variable with no
  # newline anchors. Scan only NON-COMMENT lines: the fix's own comment quotes
  # the old pattern to explain it, and counting that would fail forever.
  run bash -c "grep -vE '^[[:space:]]*#' '$GATE10' | grep -E '\\*\"\\\$_semgrep_dir\"\\*'"
  [ "$status" -ne 0 ]
}

@test "a subdir seen first does not suppress its parent (issue ordering)" {
  run run_dedup "fastdl/tests/test_x.py
fastdl/a.py"
  [ "$status" -eq 0 ]
  local dirs
  dirs=$(printf '%s\n' "$output" | grep -E '^\./' || true)
  printf '%s\n' "$dirs" | grep -qx './fastdl/tests'
  printf '%s\n' "$dirs" | grep -qx './fastdl'
}

@test "sibling dirs sharing a name prefix are both scanned" {
  run run_dedup "src/api/x.py
src/app/y.py"
  [ "$status" -eq 0 ]
  # "./src/ap" is a prefix of both; a substring match collapses them.
  local dirs
  dirs=$(printf '%s\n' "$output" | grep -E '^\./' || true)
  printf '%s\n' "$dirs" | grep -qx './src/api'
  printf '%s\n' "$dirs" | grep -qx './src/app'
}

@test "duplicate directories are still deduplicated" {
  run run_dedup "src/a.py
src/b.py"
  [ "$status" -eq 0 ]
  local n
  n=$(printf '%s\n' "$output" | grep -cx './src' || true)
  [ "$n" -eq 1 ]
}

@test "a repo-root file yields the . target exactly once" {
  run run_dedup "x.ts
y.ts"
  [ "$status" -eq 0 ]
  local n
  n=$(printf '%s\n' "$output" | grep -cx '\.' || true)
  [ "$n" -eq 1 ]
}

@test "a root file plus a nested file yields both targets" {
  run run_dedup "x.ts
src/a.py"
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | grep -qx '\.'
  printf '%s\n' "$output" | grep -qx './src'
}
