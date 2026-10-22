#!/usr/bin/env bats
# @test REQ-578
# @intent Declaration files in this project are edited on Windows, and
#         `Set-Content -Encoding UTF8` under PowerShell 5.1 writes a UTF-8 BOM.
#         The first line of the file therefore starts with `\xEF\xBB\xBF` before
#         any content — invisible in every editor, present in every byte
#         comparison.
#
#         For `.xp-gate-powershell-analysis-paths` that is not a cosmetic problem:
#         the BOM glues itself to the first entry, so
#
#             <BOM>src/product
#
#         is a path that does not exist, which the adapter correctly reports as
#         `analysis-path-missing` and now (since #576) returns 3 for — turning a
#         perfectly valid scope declaration into a permanent fail-closed WARN on
#         every single PowerShell commit. The user sees "product code may have
#         escaped the gate" for a file whose only sin is its byte-order mark.
#
#         Same hazard for the `#` header: a BOM before `#` means the line no
#         longer LOOKS like a comment to a byte comparison, so the documented
#         header becomes a phantom path.
#
#         Fix: strip a leading BOM before classifying any line, in both
#         declaration files (scope and prune).
# @covers AC-578-01, AC-578-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/repo" "$WORK/bin"
  cd "$WORK/repo" || return 1
  cat > "$WORK/bin/pwsh" << 'STUB'
#!/bin/bash
exit 0
STUB
  chmod +x "$WORK/bin/pwsh"
  export PATH="$WORK/bin:$PATH"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# Write a file whose first byte sequence is a UTF-8 BOM, then the given text.
write_with_bom() {
  local file="$1"
  local text="$2"
  printf '\xEF\xBB\xBF%s' "$text" > "$file"
}

run_analysis() {
  bash -c '
    set -u
    # shellcheck disable=SC1090
    source "$1" >/dev/null 2>&1
    run_static_analysis 2>&1
    echo "___EXIT___$?"
  ' _ "$ADAPTER"
}

@test "AC-578-01: a BOM on the first scope entry does not fabricate a missing path" {
  mkdir -p src/product
  echo 'Write-Host "hi"' > src/product/a.ps1
  # BOM directly before the first (and only) entry.
  write_with_bom .xp-gate-powershell-analysis-paths 'src/product
'

  run run_analysis
  [ -n "$output" ]
  [[ "$output" != *"analysis-path-missing"* ]] || {
    echo "the BOM manufactured a missing scope entry; output: $(printf '%s' "$output" | tr '\n' ' ')"
    return 1
  }
  [[ "$output" != *"___EXIT___3"* ]] || {
    echo "a valid scope file was rejected because of its BOM; output: $(printf '%s' "$output" | tr '\n' ' ')"
    return 1
  }
}

@test "AC-578-02: a BOM before the '#' header does not turn it into a path" {
  mkdir -p src/product
  echo 'Write-Host "hi"' > src/product/a.ps1
  write_with_bom .xp-gate-powershell-analysis-paths '# product scope
src/product
'

  run run_analysis
  [[ "$output" != *"analysis-path-missing"* ]] || {
    echo "the BOM turned the '#' header into a path; output: $(printf '%s' "$output" | tr '\n' ' ')"
    return 1
  }
}
