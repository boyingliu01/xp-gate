#!/usr/bin/env bats

# @test REQ-TDD-004
# @intent Verify that CommonJS/ESM source files (.cjs/.mjs) are classified as source code by the pre-push walkthrough gate (Gate MW) and by the pre-commit Gate 5c annotation check, instead of falling through the documentation-only fast paths
# @covers AC-TDD-002-11
#
# Regression context: githooks/pre-push SOURCE_EXTENSIONS and githooks/pre-commit
# Gate 5c annotation regex enumerated .js but not .cjs/.mjs, so a push or commit
# carrying only CommonJS source (e.g. scripts/normalize-lock-registry.cjs) was
# classified as documentation-only and skipped review/annotation enforcement.
# Found on 2026-09-30 while pushing PR #441.
#
# Execution: these BATS suites are manual-only — no `bats` invocation exists in
# package.json or .github/workflows, so `npm test` (vitest) does not run them.
# Run: npx bats githooks/__tests__/gate-cjs-source-detection.test.bats
#
# Test matrix:
#   - Push containing only .cjs → NOT documentation-only (walkthrough path entered)
#   - Push containing only .mjs → NOT documentation-only
#   - Push containing only .md → still documentation-only (guard against over-broad regex)
#   - Gate 5c: @test REQ-BOGUS in a staged .test.cjs → BLOCK (regex now matches)
#   - Gate 5c: same fixture with .test.ts still BLOCKs (harness self-check)

# Resolve source repo
SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup_push_fixture() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks

  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-push" .git/hooks/pre-push
  chmod +x .git/hooks/pre-push
  mkdir -p .git/hooks/lib
  cp "$SOURCE_GITHOOKS/lib/validate-code-walkthrough.cjs" .git/hooks/lib/
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true

  echo "init" > README.md
  git add . && git commit -q -m "init"
  INIT_SHA="$(git rev-parse HEAD)"
}

# Commit the pushed payload, then simulate pre-push stdin for an existing branch
run_pre_push_with_files() {
  local head_sha
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "fixture source" > "$1"
  git add -- "$1"
  git commit -q -m "payload"
  head_sha="$(git rev-parse HEAD)"

  # Valid walkthrough evidence so the hook, once it stops classifying the push
  # as documentation-only, reaches the validator and proceeds rather than
  # failing for an unrelated reason.
  cat > .code-walkthrough-result.json << EOF
{
  "commit": "$head_sha",
  "verdict": "APPROVED",
  "timestamp": "$(date -u -d '-1 minute' +%Y-%m-%dT%H:%M:%SZ)",
  "expires": "$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)",
  "branch": "test-branch",
  "consensus_ratio": 0.95,
  "experts": [
    {"role":"architecture","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-a","resolved_model":"model-a"},
    {"role":"technical","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-b","resolved_model":null},
    {"role":"feasibility","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-c","resolved_model":"model-c"}
  ]
}
EOF
  run bash -c "echo 'refs/heads/test-branch $head_sha refs/heads/test-branch $INIT_SHA' | .git/hooks/pre-push origin https://example.com"
}

setup_commit_fixture() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks

  mkdir -p "$TEST_DIR/bin"
  cat > "$TEST_DIR/bin/jscpd" << 'MOCK'
#!/bin/bash
echo '{"duplicates":[]}'
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/jscpd"
  export PATH="$TEST_DIR/bin:$PATH"

  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true
  mkdir -p .git/hooks/lib
  cp "$SOURCE_GITHOOKS/lib/now-ms.sh" .git/hooks/lib/now-ms.sh 2>/dev/null || true

  # Docs/config only: the setup commit must not look like a code change, otherwise
  # Gate 5 resolves vitest from the ambient PATH and blocks the fixture itself.
  echo "init" > README.md
  echo "ignore: []" > .archlint.yaml
  git add . && git commit -q -m "init"

  # Fresh req-ids list so Gate 5c runs (specification.yaml absent → not stale)
  mkdir -p .sprint-state/phase-outputs
  echo '["REQ-001"]' > .sprint-state/phase-outputs/req-ids.json
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# ── Gate MW: .cjs/.mjs are source, not documentation ─────────────────

@test "push containing only .cjs is NOT classified as documentation-only" {
  setup_push_fixture
  run_pre_push_with_files "scripts/tool.cjs"

  [[ ! "$output" =~ "Documentation-only push" ]]
  [[ "$output" =~ "GATE MW: CODE WALKTHROUGH VERIFIED" ]]
}

@test "push containing only .mjs is NOT classified as documentation-only" {
  setup_push_fixture
  run_pre_push_with_files "src/entry.mjs"

  [[ ! "$output" =~ "Documentation-only push" ]]
  [[ "$output" =~ "GATE MW: CODE WALKTHROUGH VERIFIED" ]]
}

@test "push containing only .md is still classified as documentation-only" {
  setup_push_fixture
  run_pre_push_with_files "docs/notes.md"

  [[ "$output" =~ "Documentation-only push" ]]
}

# ── Gate 5c: annotation regex covers .test.cjs ───────────────────────

@test "Gate 5c blocks @test REQ-BOGUS inside a staged .test.cjs" {
  # Gate 5c degrades to SKIP without jq (repo convention), so the check is
  # unobservable there rather than passing vacuously.
  command -v jq >/dev/null 2>&1 || skip "jq not installed — Gate 5c skips by design"
  setup_commit_fixture
  mkdir -p scripts
  printf '/**\n * @test REQ-BOGUS\n */\nconst { test } = require("node:test");\ntest("t", () => {});\n' > scripts/tool.test.cjs
  git add scripts/tool.test.cjs

  run bash -c "SKIP_VERSION_CHECK=1 bash .git/hooks/pre-commit"
  [[ "$output" =~ "Gate 5c" ]]
  [[ "$output" =~ "REQ ID not found" ]]
}

@test "Gate 5c harness self-check: .test.ts with REQ-BOGUS still blocks" {
  command -v jq >/dev/null 2>&1 || skip "jq not installed — Gate 5c skips by design"
  setup_commit_fixture
  mkdir -p src
  printf '/**\n * @test REQ-BOGUS\n */\nexport const t = () => {};\n' > src/tool.test.ts
  git add src/tool.test.ts

  run bash -c "SKIP_VERSION_CHECK=1 bash .git/hooks/pre-commit"
  [[ "$output" =~ "Gate 5c" ]]
  [[ "$output" =~ "REQ ID not found" ]]
}
