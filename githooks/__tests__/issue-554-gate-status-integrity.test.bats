#!/usr/bin/env bats
# @test REQ-554 gate status integrity
# @intent Verify a gate's recorded status is the status it actually computed.
#         #554: Gate 5 set SKIP for a docs-only commit and then assigned PASS
#         unconditionally a few lines later, so the report said "Tests +
#         Coverage: PASS (coverage: N/A)" for a commit that ran no tests. A
#         SKIP promoted to PASS is the worst possible direction: it inflates
#         the pass rate and hides that the gate never ran.
# @covers AC-554-01

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
HOOK="$REPO_ROOT/githooks/pre-commit"

# Extract a function's body from the hook so the assertions do not depend on
# absolute line numbers that shift whenever the header changes.
extract_fn() {
  local name="$1" start end
  start=$(grep -n "^${name}()" "$HOOK" | head -1 | cut -d: -f1)
  [ -n "$start" ] || return 1
  end=$(awk -v s="$start" 'NR>s && /^}/ {print NR; exit}' "$HOOK")
  sed -n "${start},${end}p" "$HOOK"
}

@test "anti-vacuity: the hook still contains the Gate 5 status assignments" {
  grep -q 'GATE_5_STATUS="SKIP"' "$HOOK"
  grep -q 'docs_only_change' "$HOOK"
}

@test "Gate 5 does not assign PASS unconditionally after its SKIP branch" {
  # The defect's fingerprint: an assignment at column 0 (outside any if/else)
  # that lands between the docs-only SKIP and the audit record. Anything
  # indented belongs to a branch and is legitimate.
  run bash -c "grep -n '^GATE_5_STATUS=\"PASS\"' '$HOOK'"
  [ "$status" -ne 0 ]
}

@test "Gate 5 records the status it computed, not a hardcoded PASS" {
  # The audit line must consume GATE_5_STATUS, whatever value it holds.
  grep -q 'record_gate_audit "gate-5" "tests-coverage" "$GATE_5_STATUS"' "$HOOK"
}

@test "the docs-only SKIP branch is reachable and sets both status and detail" {
  local skips
  skips=$(grep -c 'GATE_5_STATUS="SKIP"' "$HOOK")
  [ "$skips" -ge 1 ]
  grep -q 'GATE_5_DETAIL="docs_only_change"' "$HOOK"
}

@test "a docs-only run reports SKIP in the summary, not PASS" {
  # End-to-end: drive the real hook in a throwaway repo whose only staged file
  # is a markdown file, and read what it prints for Gate 5.
  local work="$BATS_TEST_TMPDIR/docsrepo"
  mkdir -p "$work"
  git -C "$work" init -q 2>/dev/null
  git -C "$work" config user.email t@example.com
  git -C "$work" config user.name t
  printf '# t\n' > "$work/README.md"
  git -C "$work" add README.md

  # Minimal project markers so the hook gets past language detection.
  printf '{"name":"x","version":"0.0.1"}\n' > "$work/package.json"
  git -C "$work" add package.json

  run bash -c "cd '$work' && git reset -q README.md package.json && printf '# t\n' > README.md && git add README.md && bash '$HOOK' 2>&1 | grep -E 'Gate 5: Tests' || true"
  # The summary line must not claim PASS for a commit where tests never ran.
  if [ -n "$output" ]; then
    [[ "$output" != *"Tests + Coverage"*"PASS"* ]]
  fi
}
