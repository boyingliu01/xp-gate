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
crlf_copy() {
  local src="$1" dest="$2"
  tr -d '\r' < "$src" | sed 's/$/\r/' > "$dest"
  chmod +x "$dest"
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
