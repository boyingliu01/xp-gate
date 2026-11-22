#!/usr/bin/env bats
# @test REQ-GATE4-NOT-ANALYSED-RECORDED
#
# @intent Gate 4 (principles) can only read languages a clean-code RULE supports.
# An adapter that merely makes a language DETECTABLE -- parseable, countable,
# classifiable -- does not mean any rule examines it. Only TypeScript declares
# `declaresRuleCoverage = true`; the other fourteen language adapters inherit
# `false` from BaseAdapter.
#
# The checker has always been honest about this ON THE CONSOLE:
#
#     ⚠️  NOT ANALYSED: python — an adapter exists (the language is detected and
#         counted below) but no clean-code rule can read it. These files were not
#         checked; their absence from the list above is not a pass.
#
# and its JSON has always carried summary.unanalysedLanguages. The GATE read
# neither. MEASURED 2026-11-22 on a probe repo whose only staged file was a .py:
#
#     console: ⚠️ NOT ANALYSED: python
#     report : {"name":"Clean Code + SOLID","status":"PASS","reason":"","warnings":0}
#
# So the journal recorded a PASS with no reason, indistinguishable from a commit
# whose TypeScript actually was reviewed. The verdict was honest where a human
# was looking and dishonest where a later reader looks -- the family's exact
# shape, one level below the verdict itself.
#
# THE STATUS STAYS PASS. Some files really were analysed, and demoting a real
# review to SKIP because a sibling file's language has no rules would trade one
# wrong record for another. What must survive is the REASON.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-4.sh"
  WORK="$(mktemp -d)"
}

teardown() {
  cd /
  rm -rf "$WORK"
}

# @covers the JSON field the fix depends on still exists upstream
@test "the principles summary exposes unanalysedLanguages" {
  run grep -c 'unanalysedLanguages' "$REPO_ROOT/src/principles/analyzer.ts"
  [ "$output" -ge 1 ]
}

# @covers the gate reads that field at all
@test "gate-4 reads summary.unanalysedLanguages" {
  run grep -c 'unanalysedLanguages' "$GATE"
  [ "$output" -ge 1 ]
}

# @covers the reason is assigned, not merely echoed
@test "gate-4 records the unanalysed languages in GATE_4_REASON" {
  run grep -c 'GATE_4_REASON="unanalysed:' "$GATE"
  [ "$output" = "1" ]
}

# @covers the pretty-printed array is flattened before extraction
@test "the extraction survives a multi-line JSON array" {
  # `JSON.stringify(out, null, 2)` puts the array across three lines. A single-line
  # sed range matches nothing, and the bug would look fixed while recording
  # nothing -- so this pins the flatten step and proves the extraction works on
  # the REAL shape the reporter emits.
  cat > "$WORK/report.json" <<'JSON'
{
  "violations": [],
  "summary": {
    "totalViolations": 0,
    "filesChecked": 3,
    "unanalysedLanguages": [
      "python"
    ]
  }
}
JSON

  # The exact pipeline the gate uses.
  run bash -c '
    _PJ_FLAT=$(tr -d "\n" < "'"$WORK"'/report.json" | tr -s " ")
    printf "%s" "$_PJ_FLAT" | sed -n "s/.*\"unanalysedLanguages\"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p" \
      | tr -d "\"" | tr "," " " | tr -s " " | sed "s/^ *//; s/ *$//"
  '
  [ "$output" = "python" ]
}

# @covers a clean run does NOT claim an unanalysed language
@test "an empty unanalysedLanguages list leaves the reason untouched" {
  cat > "$WORK/clean.json" <<'JSON'
{
  "violations": [],
  "summary": {
    "unanalysedLanguages": []
  }
}
JSON

  run bash -c '
    _PJ_FLAT=$(tr -d "\n" < "'"$WORK"'/clean.json" | tr -s " ")
    printf "%s" "$_PJ_FLAT" | sed -n "s/.*\"unanalysedLanguages\"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p" \
      | tr -d "\"" | tr "," " " | tr -s " " | sed "s/^ *//; s/ *$//"
  '
  [ -z "$output" ]
}

# @covers several unanalysed languages are all named
@test "multiple unanalysed languages are all recorded" {
  cat > "$WORK/multi.json" <<'JSON'
{
  "summary": {
    "unanalysedLanguages": [
      "python",
      "go"
    ]
  }
}
JSON

  run bash -c '
    _PJ_FLAT=$(tr -d "\n" < "'"$WORK"'/multi.json" | tr -s " ")
    printf "%s" "$_PJ_FLAT" | sed -n "s/.*\"unanalysedLanguages\"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p" \
      | tr -d "\"" | tr "," " " | tr -s " " | sed "s/^ *//; s/ *$//"
  '
  [ "$output" = "python go" ]
}

# @covers the report writer consumes the variable the gate sets
@test "the quality report reads GATE_4_REASON into its reason field" {
  run grep -c '"reason": "\${GATE_4_REASON:-}"' "$REPO_ROOT/githooks/gate-entries/gate-13-entry.sh"
  [ "$output" = "1" ]
}
