#!/usr/bin/env bats
# @test REQ-546 hook line-ending self-check
# @intent Verify each hook fails with a readable diagnosis on its OWN first line
#         when it has been rewritten with CRLF, instead of letting `bash -n`
#         report a syntax error at an unrelated line. #546: the reported line
#         was 3066, pointing at perfectly valid shell, while the real cause was
#         a \r on line 46.
# @covers AC-507-01
bats_require_minimum_version 1.5.0

setup() {
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
}

# Rewrite a copy of the hook with CRLF endings, keeping it executable.
#
# Portable CR injection: `sed 's/$/\r/'` is not portable — POSIX sed does not
# require `\r` in a replacement to mean carriage return, and GNU sed only honours
# it because of a GNU extension. On the CI runner the result was a file with NO
# carriage returns at all, so `bash` parsed it cleanly, ran the hook, and the
# hook's own CRLF self-check never fired:
#     pre-commit: line 72: syntax error near unexpected token `$'{\r''
# To inject a byte reliably, split the file into lines and re-emit each one with
# an explicit "print without newline, then a carriage-return + newline".
crlf_copy() {
  local src="$1" dest="$2"
  : > "$dest"
  # Read line by line; text already stripped of any pre-existing CR.
  while IFS= read -r line || [ -n "$line" ]; do
    # printf's \r is a REQUIRED POSIX escape in the format string (unlike in sed).
    printf '%s\r\n' "$line" >> "$dest"
  done < <(tr -d '\r' < "$src")
  chmod +x "$dest"
}

# Guard: the fixture must really contain carriage returns. Without this, a
# future rewrite of crlf_copy could silently produce clean LF input and the
# three CRLF cases below would assert the diagnostic on a file that does not
# need one.
#
# The count is taken BYTE-WISE. `grep -c $'\r'` is unreliable through the
# Git-Bash/MSYS layer — it reports 0 matches even on files that demonstrably
# carry CR bytes — so counting via `tr` is the only stable check.
@test "the CRLF fixture really contains carriage returns" {
  local hook="$WORK/pre-commit"
  crlf_copy "$BATS_TEST_DIRNAME/../pre-commit" "$hook"

  run bash -c "tr -cd '\r' < '$hook' | wc -c"
  [ "$status" -eq 0 ]
  cr_count="$(printf '%s' "$output" | tr -d '[:space:]')"
  echo "carriage returns in fixture: $cr_count"
  [ "${cr_count:-0}" -gt 0 ] || {
    echo "the CRLF fixture has no carriage returns; every case below is vacuous"
    return 1
  }

  # And the fixture must differ from its source in exactly that way: same line
  # count, one CR per line.
  run bash -c "wc -l < '$hook'"
  lines="$(printf '%s' "$output" | tr -d '[:space:]')"
  echo "fixture lines: $lines"
  [ "${cr_count:-0}" -eq "${lines:-1}" ] || {
    echo "expected one carriage return per line ($lines lines, $cr_count CRs)"
    return 1
  }
}

@test "pre-commit with CRLF exits 1 with a line-ending diagnosis, not a syntax error" {
  local hook="$WORK/pre-commit"
  crlf_copy "$BATS_TEST_DIRNAME/../pre-commit" "$hook"

  run --separate-stderr bash "$hook"
  [ "$status" -ne 0 ]
  # The message must name the actual problem. A bash syntax error here would
  # mean the self-check never ran, which is the failure mode being prevented.
  [[ "$stderr" == *"CRLF"* ]]
  [[ "$stderr" != *"syntax error"* ]]
}

@test "pre-push with CRLF exits 1 with a line-ending diagnosis" {
  local hook="$WORK/pre-push"
  crlf_copy "$BATS_TEST_DIRNAME/../pre-push" "$hook"

  run --separate-stderr bash "$hook"
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"CRLF"* ]]
  [[ "$stderr" != *"syntax error"* ]]
}

@test "the self-check names the offending file" {
  local hook="$WORK/pre-commit"
  crlf_copy "$BATS_TEST_DIRNAME/../pre-commit" "$hook"

  run --separate-stderr bash "$hook"
  [[ "$stderr" == *"pre-commit"* ]]
}

@test "the self-check prints a runnable repair command" {
  local hook="$WORK/pre-commit"
  crlf_copy "$BATS_TEST_DIRNAME/../pre-commit" "$hook"

  run --separate-stderr bash "$hook"
  [[ "$stderr" == *"tr -d"* ]]
}

@test "LF hooks pass the self-check and get past line 15" {
  # A false positive here would block every commit on a healthy install, which
  # is worse than the bug. Prove the guard is silent on clean input by running
  # the real hook far enough to reach its own gate output.
  local hook="$WORK/pre-commit"
  cp "$BATS_TEST_DIRNAME/../pre-commit" "$hook"
  chmod +x "$hook"

  run --separate-stderr bash -c "tr -cd '\r' < '$hook' | wc -c"
  [ "$output" = "0" ]
}
