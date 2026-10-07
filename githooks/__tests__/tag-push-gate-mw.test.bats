#!/usr/bin/env bats

# @issue #491 — pre-push treated new tags as new branches, so Gate MW demanded
# walkthrough evidence bound to the LOCAL HEAD. After a squash merge the master
# commit hash can never equal the reviewed feature-branch HEAD, permanently
# false-blocking every release tag push.
#
# Test matrix:
#   - tag on an already-published commit + stale evidence → PASS
#   - tag on an already-published commit + no evidence file → PASS
#   - tag on a local-only commit + no evidence → BLOCK (no smuggling path)
#   - mixed push (branch ref + published tag) + no evidence → BLOCK
#   - lightweight tag on an already-published commit + no evidence → PASS
#   - tag-before-branch line order: branch side still gated (Round-1 arch)
#   - tag reachable only from a NON-base remote branch → BLOCK (Round-1 tech)

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

ZEROS="0000000000000000000000000000000000000000"

setup() {
  export TEST_DIR="$(mktemp -d)"
  git init -q --bare "$TEST_DIR/remote.git"
  mkdir -p "$TEST_DIR/work"
  cd "$TEST_DIR/work" || exit 1
  git init -q -b main
  git config user.email "test@test.com"
  git config user.name "Test"
  # Isolate from machine-global hooks IMMEDIATELY (xp-gate installs a global
  # core.hooksPath; without this, the setup push below would run the real
  # pre-push gates against the fixture and stall the suite).
  mkdir -p .git/hooks
  git config core.hooksPath .git/hooks

  # Mock jscpd so Gate 2 does not block on a missing tool.
  mkdir -p "$TEST_DIR/bin"
  cat > "$TEST_DIR/bin/jscpd" << 'MOCK'
#!/bin/bash
echo '{"duplicates":[]}'
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/jscpd"
  export PATH="$TEST_DIR/bin:$PATH"

  # Two commits; the tag will point at the SECOND one so diff-tree against
  # its parent yields src/foo.ts (a root commit would produce no file list).
  echo "init" > README.md
  git add . && git commit -q -m "init"
  mkdir -p src
  echo "export const a = 1;" > src/foo.ts
  git add . && git commit -q -m "add source"

  # Publish BEFORE installing hooks so setup never triggers the hook itself.
  git remote add origin "$TEST_DIR/remote.git"
  git push -q origin main

  mkdir -p .git/hooks/lib
  cp "$SOURCE_GITHOOKS/pre-push" .git/hooks/pre-push
  chmod +x .git/hooks/pre-push
  cp "$SOURCE_GITHOOKS/lib/validate-code-walkthrough.cjs" .git/hooks/lib/validate-code-walkthrough.cjs
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true
  git config core.hooksPath .git/hooks
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

write_stale_evidence() {
  cat > .code-walkthrough-result.json << 'EOF'
{
  "commit": "0000000000000000000000000000000000000001",
  "verdict": "APPROVED",
  "timestamp": "2026-01-01T00:00:00Z",
  "expires": "2099-01-01T00:00:00Z",
  "branch": "main",
  "consensus_ratio": 0.95,
  "experts": [
    {"role":"architecture","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-a","resolved_model":"model-a","channel":"external"},
    {"role":"technical","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-b","resolved_model":"model-b","channel":"external"},
    {"role":"feasibility","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-c","resolved_model":"model-c","channel":"external"}
  ]
}
EOF
}

# push_tag_ref TAG [EXTRA_STDIN_LINE] — simulate the pre-push stdin lines.
push_tag_ref() {
  local tag="$1" extra_stdin="${2:-}"
  local local_sha
  local_sha="$(git rev-parse "$tag")"
  local stdin_tag_line="refs/tags/${tag} ${local_sha} refs/tags/${tag} ${ZEROS}"
  if [ -n "$extra_stdin" ]; then
    run bash -c "printf '%s\n' '${extra_stdin}' '${stdin_tag_line}' | '$PWD/.git/hooks/pre-push' origin https://example.com"
  else
    run bash -c "printf '%s\n' '${stdin_tag_line}' | '$PWD/.git/hooks/pre-push' origin https://example.com"
  fi
}

@test "tag on an already-published commit passes despite stale evidence" {
  git tag -a v1.0.0 -m "Release v1.0.0"
  write_stale_evidence
  push_tag_ref v1.0.0
  [ "$status" -eq 0 ]
  [[ "$output" != *"commit does not match HEAD"* ]]
}

@test "tag on an already-published commit passes with no evidence file at all" {
  git tag -a v1.0.0 -m "Release v1.0.0"
  rm -f .code-walkthrough-result.json
  push_tag_ref v1.0.0
  [ "$status" -eq 0 ]
  [[ "$output" != *"CODE WALKTHROUGH REQUIRED"* ]]
}

@test "tag on a local-only commit without evidence is still blocked" {
  git tag -a v1.0.0 -m "Release v1.0.0"
  echo "export const b = 2;" >> src/foo.ts
  git add . && git commit -q -m "unreviewed change"
  git tag -a v2.0.0 -m "Release v2.0.0"
  rm -f .code-walkthrough-result.json
  push_tag_ref v2.0.0
  [ "$status" -ne 0 ]
  [[ "$output" == *"WALKTHROUGH"* ]]
}

@test "mixed push (branch ref plus published tag) without evidence is blocked" {
  git tag -a v1.0.0 -m "Release v1.0.0"
  echo "export const c = 3;" >> src/foo.ts
  git add . && git commit -q -m "unreviewed change"
  rm -f .code-walkthrough-result.json
  branch_line="refs/heads/main $(git rev-parse HEAD) refs/heads/main $(git rev-parse HEAD^)"
  push_tag_ref v1.0.0 "$branch_line"
  [ "$status" -ne 0 ]
  [[ "$output" == *"WALKTHROUGH"* ]]
}

@test "lightweight tag on an already-published commit passes with no evidence" {
  git tag v1.0.0
  rm -f .code-walkthrough-result.json
  push_tag_ref v1.0.0
  [ "$status" -eq 0 ]
  [[ "$output" != *"CODE WALKTHROUGH REQUIRED"* ]]
}

@test "tag listed BEFORE the branch ref still gates the branch side" {
  git tag -a v1.0.0 -m "Release v1.0.0"
  echo "export const d = 4;" >> src/foo.ts
  echo "const y = 4;" >> src/foo.test.ts
  git add . && git commit -q -m "unreviewed change"
  rm -f .code-walkthrough-result.json
  local tag_sha head_sha prev_sha
  tag_sha="$(git rev-parse v1.0.0)"
  head_sha="$(git rev-parse HEAD)"
  prev_sha="$(git rev-parse HEAD^)"
  run bash -c "printf '%s\n' 'refs/tags/v1.0.0 ${tag_sha} refs/tags/v1.0.0 ${ZEROS}' 'refs/heads/main ${head_sha} refs/heads/main ${prev_sha}' | '$PWD/.git/hooks/pre-push' origin https://example.com"
  [ "$status" -ne 0 ]
  [[ "$output" == *"WALKTHROUGH"* ]]
}

@test "tag on a commit only on a NON-BASE remote branch is blocked (scope = protected base)" {
  git tag -a v1.0.0 -m "Release v1.0.0"
  echo "export const e = 5;" >> src/foo.ts
  echo "const z = 5;" >> src/foo.test.ts
  git add . && git commit -q -m "side branch work"
  # --no-verify here only simulates pre-existing remote state for the fixture;
  # the hook under test is invoked explicitly via stdin, not by this push.
  git push -q --no-verify origin HEAD:refs/heads/feature/side
  git tag -a v9.9.9 -m "tagged on side branch"
  rm -f .code-walkthrough-result.json
  push_tag_ref v9.9.9
  [ "$status" -ne 0 ]
  [[ "$output" == *"WALKTHROUGH"* ]]
}
