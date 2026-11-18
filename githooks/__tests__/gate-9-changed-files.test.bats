#!/usr/bin/env bats
#
# @test REQ-GATE9-VERDICT-HONESTY
# @intent Gate 9 handed its checker a corrupted file list, on every invocation.
#
#         CHANGED_FILES is NEWLINE-separated -- gate-0-entry.sh builds it with
#         `printf '%s\n'`. Gate 9 converted it with:
#
#             CHANGED_FILES_CSV=$(echo "$CHANGED_FILES" | tr ' ' ',')
#
#         which is wrong twice over:
#
#           - the actual separator (newline) was never converted, so every
#             newline reached the checker inside the argument, and
#           - any space INSIDE a path was converted, so "src/my file.ts" arrived
#             as "src/my,file.ts" -- two fragments, neither of which exists.
#
#         Measured: `--changed-files "src/my file.ts"` produced the import scan
#         line "All relative imports in 2 file(s) resolve ..." for a single real
#         file, i.e. the scan reported on paths it had never opened.
#
#         It never blocked anything, because the tsc half compiles from
#         projectRoot rather than from this list. The consequence is quieter and
#         worse than a block: for any file with a space in its path, the import
#         check silently stopped covering it. "Found nothing" and "looked at
#         nothing" printed the same thing.
#
# @covers AC-GATE9-VERDICT-04
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ENTRY="$REPO/githooks/gate-entries/gate-9-entry.sh"
}

@test "AC-GATE9-VERDICT-04: a path containing a space survives the comma conversion" {
  # The conversion itself, isolated: same input shape gate 0 produces.
  local converted
  converted=$(CHANGED_FILES=$'src/a.ts\nsrc/my file.ts' bash -c 'printf "%s" "$CHANGED_FILES" | tr "\n" ","')
  [ "$converted" = "src/a.ts,src/my file.ts" ] || {
    echo "newline-to-comma conversion produced: [$converted]"
    return 1
  }

  # And the gate must use THAT, not the space-to-comma one.
  # Exclude comment lines: the explanation of the old defect quotes the old
  # code, and a bare grep would match the explanation instead of a live call.
  ! grep -v '^[[:space:]]*#' "$ENTRY" | grep -q "tr ' ' ','" || {
    echo "gate-9-entry.sh still converts spaces, which are part of a filename"
    return 1
  }
  grep -q 'tr .\\n. .,.' "$ENTRY" || {
    echo "gate-9-entry.sh no longer converts the newline separator"
    return 1
  }
}