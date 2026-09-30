#!/usr/bin/env bats

# ============================================================================
# post-merge hook: VERSION sync after merge.
#
# Before the fix, the hook detected and ran only scripts/sync-version.sh. On
# Windows the .sh implementation builds MSYS-style paths and dies with ENOENT,
# so the sync silently failed. scripts/sync-version.cjs is the cross-platform
# superset (10 package targets + AGENTS.md headers) and must be preferred,
# with .sh kept as a last-resort fallback. Executable-bit (-x) probing is
# useless on Windows checkouts and must not gate the run.
#
# Structural assertions guard BOTH shipped copies of the hook; behavioural
# tests exercise the real script against a scratch repo.
# ============================================================================

setup() {
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q
  # Isolate from machine-wide core.hooksPath: without this, every scratch
  # commit runs the full global gate matrix (slow) and pollutes the fixture.
  git config core.hooksPath "$TEST_DIR/.git/no-hooks"
  git config user.email "test@test.com"
  git config user.name "Test"
  echo "1.0.0.0" > VERSION
  git add VERSION
  git commit -qm init
  git update-ref ORIG_HEAD "$(git rev-parse HEAD)"
  echo "1.0.0.1" > VERSION
  git add VERSION
  git commit -qm bump
  HOOK="$BATS_TEST_DIRNAME/../post-merge"
}

teardown() {
  cd /
  rm -rf "$TEST_DIR"
}

# ── Structural assertions (both shipped copies) ──────────────────────

check_hook_structure() {
  local hook="$1"
  [ -f "$hook" ]

  # --- detects the .cjs carrier ---------------------------------------
  run grep -F 'sync-version.cjs' "$hook"
  [ "$status" -eq 0 ]

  # --- node runs the .cjs, bash runs the legacy .sh -------------------
  run grep -F 'node "$SYNC_CJS"' "$hook"
  [ "$status" -eq 0 ]
  run grep -F 'bash "$SYNC_SH"' "$hook"
  [ "$status" -eq 0 ]

  # --- executable-bit check gone (bogus on Windows checkouts) ---------
  run grep -F '-x "$PROJECT_ROOT/scripts/sync-version.sh"' "$hook"
  [ "$status" -ne 0 ]
}

@test "post-merge: githooks copy prefers sync-version.cjs" {
  check_hook_structure "$BATS_TEST_DIRNAME/../post-merge"
}

@test "post-merge: npm-package copy prefers sync-version.cjs" {
  check_hook_structure "$BATS_TEST_DIRNAME/../../src/npm-package/hooks/post-merge"
}

# ── Behaviour ────────────────────────────────────────────────────────

@test "post-merge: runs sync-version.cjs when present" {
  mkdir -p scripts
  printf 'console.log("[stub-cjs] synced");\n' > scripts/sync-version.cjs
  printf '#!/usr/bin/env bash\necho "[stub-sh] synced"\n' > scripts/sync-version.sh

  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[stub-cjs]"* ]]
  [[ "$output" != *"[stub-sh]"* ]]
}

@test "post-merge: falls back to sync-version.sh without .cjs" {
  mkdir -p scripts
  printf '#!/usr/bin/env bash\necho "[stub-sh] synced"\n' > scripts/sync-version.sh

  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[stub-sh]"* ]]
}

@test "post-merge: silently exits when no sync script exists" {
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [[ "$output" == "" ]]
}

@test "post-merge: skips when VERSION unchanged in merge" {
  echo "same" > other.txt
  git add other.txt
  git commit -qm "unrelated"
  git update-ref ORIG_HEAD "$(git rev-parse HEAD~1)"

  mkdir -p scripts
  printf 'console.log("[stub-cjs] synced");\n' > scripts/sync-version.cjs

  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [[ "$output" != *"[stub-cjs]"* ]]
}
