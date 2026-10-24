#!/usr/bin/env bats
# #404 P0: every Gate M outcome must leave a reason and a duration in the
# pre-push journal.
#
# The journals held 68 runs with `details: {}` on Gate M, so the RFC question
# "how often is mutation testing skipped, and why?" could not be answered:
# 91.8% of rows were SKIP with no distinguishing information. A missing tool and
# "this push changed no mutable file" are opposite findings.
#
# #597: these cases used to read the journal row by grepping pre-push for the
# literal source line
#     grep "'id': 'M', 'name': 'Mutation Testing'" "$PRE_PUSH"
# and expanding it with eval. That made the test a snapshot of the hook's TEXT:
# as soon as the emitter changed (the row is now built with printf so the journal
# can be written from the EXIT trap without depending on stdin), all cases failed
# while the emitted JSON was unchanged and correct.
#
# They now RUN the real hook and parse the JSON it actually writes — which is
# what #404 is about: the journal's CONTENT, not its source spelling.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_PUSH="$REPO_ROOT/githooks/pre-push"
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR" || exit 1
  git init -q -b feature/journal-fixture . || exit 1
  git config user.email "test@test.com"
  git config user.name "Test"
  git config commit.gpgsign false

  mkdir -p .git/hooks/lib
  cp "$REPO_ROOT/githooks/pre-push" .git/hooks/pre-push
  chmod +x .git/hooks/pre-push
  cp "$REPO_ROOT/githooks/lib/validate-code-walkthrough.cjs" .git/hooks/lib/ 2>/dev/null || true
  # The scorer is a real install artefact (install.sh copies lib/*.py beside the
  # hook), and pre-push fails closed without it (#580-04), so the fixture installs
  # it like a real install does. Local runs used to pass only because the hook's
  # last-resort lookup found ../githooks/lib/ by luck of the checkout layout.
  cp "$REPO_ROOT/githooks/lib/prepush-score.py" .git/hooks/lib/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/adapter-common.sh" .git/hooks/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/hook-module-resolution.sh" .git/hooks/ 2>/dev/null || true
  git config core.hooksPath .git/hooks

  # Gate 8 is fail-closed: stub the scanners so the hook reaches the journal.
  mkdir -p "$TEST_DIR/bin"
  for t in gitleaks jscpd lizard semgrep checkov hadolint; do
    printf '#!/bin/bash\nexit 0\n' > "$TEST_DIR/bin/$t"
    chmod +x "$TEST_DIR/bin/$t"
  done
  export PATH="$TEST_DIR/bin:$PATH"

  echo "init" > README.md
  git add . >/dev/null 2>&1
  git commit -q --no-verify -m "init"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Run the hook with the given Gate M state injected, then print the Gate M row.
render_row() {
  rm -rf .xp-gate
  local sha
  sha="$(git rev-parse HEAD)"
  local stdin_file="$TEST_DIR/push-stdin.txt"
  printf 'refs/heads/feature/journal-fixture %s refs/heads/feature/journal-fixture %s\n' \
    "$sha" "0000000000000000000000000000000000000000" > "$stdin_file"

  GATE_M_STATUS="$1" \
  GATE_M_SKIP_REASON="$2" \
  M_DURATION_MS="$3" \
  M_SCORE="$4" \
    .git/hooks/pre-push origin https://example.com < "$stdin_file" >/dev/null 2>&1 || true

  local f
  f="$(ls -1t .xp-gate/reports/pre-push/*.json 2>/dev/null | head -n1)"
  [ -n "$f" ] || { echo 'NO_JOURNAL_FILE'; return 0; }
  node -e '
    const r = require("fs").readFileSync(process.argv[1], "utf8");
    const j = JSON.parse(r);
    const row = (j.gates || []).find((g) => g.id === "M");
    process.stdout.write(JSON.stringify(row || {missing: true}));
  ' "$f"
}

@test "AC-404-01: the Gate M journal row carries skip_reason, duration_ms and mutation_score" {
  row=$(render_row "SKIP" "x" 0 "")

  [ "$row" != "NO_JOURNAL_FILE" ] || {
    echo "the hook wrote no journal file at all"
    return 1
  }
  [[ "$row" == *'"skip_reason"'* ]]
  [[ "$row" == *'"duration_ms"'* ]]
  [[ "$row" == *'"mutation_score"'* ]]
}

@test "AC-404-02: a skip reason reaches the journal verbatim" {
  row=$(render_row "SKIP" "no changed TypeScript source files in this push" 0 "")

  [[ "$row" == *"no changed TypeScript source files in this push"* ]]
}

@test "AC-404-03: a completed run records its duration and score" {
  row=$(render_row "PASS" "" 2450 "73.4")

  [[ "$row" == *"2450"* ]]
  [[ "$row" == *"73.4"* ]]
}

@test "AC-404-04: every Gate M skip site assigns a reason" {
  skips=$(grep -c 'SKIP — Gate M' "$PRE_PUSH" || true)
  reasons=$(grep -c 'GATE_M_SKIP_REASON=' "$PRE_PUSH" || true)

  [ "$skips" -ge 5 ]
  # One reason per skip site, plus the TIMEOUT and unexpected-exit branches.
  [ "$reasons" -ge 5 ]
}

@test "AC-404-05: skipping is distinguishable from running in the journal" {
  skipped=$(render_row "SKIP" "stryker not installed" 0 "")
  ran=$(render_row "PASS" "" 1200 "81")

  [[ "$skipped" == *'"status":"SKIP"'* ]]
  [[ "$ran" == *'"status":"PASS"'* ]]
  [ "$skipped" != "$ran" ]
}
