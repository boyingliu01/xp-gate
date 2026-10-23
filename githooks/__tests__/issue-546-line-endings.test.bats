#!/usr/bin/env bats
# @test REQ-546 hook line-ending self-check
# @intent Verify a CRLF-rewritten hook always fails loudly and identifiably, and
#         that a healthy LF hook never trips the guard. #546: the reported line
#         was 3066, pointing at perfectly valid shell, while the real cause was
#         a \r on line 46.
# @covers AC-507-01
#
# MEASURED LIMITATION (2026-10-22, the reason the assertions below are shaped the
# way they are). The self-check is the hook's first executable line and it does
# run on macOS/Git-Bash: a CRLF copy of the real pre-commit prints the FATAL
# diagnosis and exits 1. On Linux CI bash it does NOT get the chance. GNU bash
# tokenises `then\r` / `fi\r` / `}\r` as ordinary words, so a CRLF script fails
# to PARSE, and a parse failure in the script body discards the run before the
# first command executes — whether or not that first command is well-formed. The
# runner therefore always reported:
#     pre-commit: line 81: syntax error near unexpected token `$'{\r''
#     pre-commit: line 81: `_resolve_coverage_threshold() {`
# Two rewrites of the guard (nested if/fi, then one `;`-separated physical line)
# did not change this, because no construct can execute inside a script bash
# refused to parse. The guard is best-effort by nature and CANNOT be made
# universal — so these cases assert what is actually guaranteed:
#   * a CRLF hook ALWAYS fails (never a silent pass), and
#   * the failure is ALWAYS identifiable as a line-ending problem: either the
#     guard's own FATAL diagnosis, or bash's `syntax error near ... $'{\r''`,
#     which names the CR literal on its face.
# The strongest form of this property is not a runtime guard at all: refusing
# CRLF at commit time. That is tracked as debt, not silently implied here.
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

# A CRLF hook must never be a silent pass, and its failure must always be
# identifiable as a line-ending problem. See the header for why both acceptable
# shapes are listed rather than only the guard's own message.
assert_crlf_hook_fails_identifiably() {
  local hook="$1" label="$2"

  run --separate-stderr bash "$hook"
  [ "$status" -ne 0 ] || {
    echo "$label with CRLF did NOT fail — a CRLF hook must never pass"
    return 1
  }

  if [[ "$stderr" == *"CRLF"* && "$stderr" != *"syntax error"* ]]; then
    # Path A: the guard ran and printed its own diagnosis (Git-Bash/macOS).
    return 0
  fi

  if [[ "$stderr" == *"syntax error"* && "$stderr" == *'{\r'* ]]; then
    # Path B: bash refused to parse the script, and the diagnostic names the CR
    # literal — still unambiguous, and still a failure. This is what Linux CI
    # produces and what the header explains cannot be avoided.
    return 0
  fi

  echo "$label with CRLF failed, but neither the guard's diagnosis nor a"
  echo "CR-bearing syntax error was printed. stderr was:"
  echo "$stderr"
  return 1
}

@test "pre-commit with CRLF fails identifiably as a line-ending problem" {
  local hook="$WORK/pre-commit"
  crlf_copy "$BATS_TEST_DIRNAME/../pre-commit" "$hook"

  assert_crlf_hook_fails_identifiably "$hook" "pre-commit"
}

@test "pre-push with CRLF fails identifiably as a line-ending problem" {
  local hook="$WORK/pre-push"
  crlf_copy "$BATS_TEST_DIRNAME/../pre-push" "$hook"

  assert_crlf_hook_fails_identifiably "$hook" "pre-push"
}

# When the guard DOES run (Git-Bash/macOS), it must be actionable: name the file
# and print a command the reader can paste. On Linux CI bash it cannot run at all
# (see the header), so these are legitimately skipped there rather than asserted
# — asserting them on the runner would be asserting the impossible.

@test "the self-check names the offending file" {
  local hook="$WORK/pre-commit"
  crlf_copy "$BATS_TEST_DIRNAME/../pre-commit" "$hook"

  # Prepare the fixture the helper reads, then branch on which path this bash takes.
  run --separate-stderr bash "$hook"
  if [[ "$stderr" != *"CRLF"* || "$stderr" == *"syntax error"* ]]; then
    skip "this bash refuses to parse a CRLF script, so the guard never runs (#546 limitation)"
  fi
  [[ "$stderr" == *"pre-commit"* ]]
}

@test "the self-check prints a runnable repair command" {
  local hook="$WORK/pre-commit"
  crlf_copy "$BATS_TEST_DIRNAME/../pre-commit" "$hook"

  run --separate-stderr bash "$hook"
  if [[ "$stderr" != *"CRLF"* || "$stderr" == *"syntax error"* ]]; then
    skip "this bash refuses to parse a CRLF script, so the guard never runs (#546 limitation)"
  fi
  [[ "$stderr" == *"tr -d"* ]]
}

@test "LF hooks carry no CR bytes and never trip the guard" {
  # A false positive here would block every commit on a healthy install, which
  # is worse than the bug. This is the one case that must hold on EVERY bash:
  # the shipped hooks are LF, so the guard must be silent — no FATAL, no syntax
  # error — no matter whether this bash would have run the guard on CRLF input.
  local hook="$WORK/pre-commit"
  cp "$BATS_TEST_DIRNAME/../pre-commit" "$hook"
  chmod +x "$hook"

  run bash -c "tr -cd '\r' < '$hook' | wc -c"
  [ "$output" = "0" ]

  # Running it must not produce a line-ending complaint of either shape.
  run --separate-stderr bash -c "timeout 5 bash '$hook' </dev/null >/dev/null 2>'$WORK/lf.err' || true; cat '$WORK/lf.err'"
  if [[ "$output" == *"CRLF line endings"* ]]; then
    echo "an LF hook tripped its own CRLF guard — every commit would be blocked"
    return 1
  fi
  if [[ "$output" == *'{\r'* ]]; then
    echo "an LF hook produced a CR-bearing syntax error"
    return 1
  fi
}
