#!/usr/bin/env bash
# test-plugins.sh: Integration tests for plugin build pipeline
# Verifies both Claude Code and OpenCode plugins build correctly with valid manifests.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1" >&2; FAIL=$((FAIL + 1)); }

echo "=== Plugin Integration Tests ==="
echo ""

# Test 1: Directory structure exists
echo "Test 1: Directory structure"
[ -d "$REPO_ROOT/plugins/claude-code/.claude-plugin" ] && pass "claude-code/.claude-plugin/" || fail "claude-code/.claude-plugin/ missing"
[ -d "$REPO_ROOT/plugins/claude-code/hooks" ] && pass "claude-code/hooks/" || fail "claude-code/hooks/ missing"
[ -d "$REPO_ROOT/plugins/claude-code/bin" ] && pass "claude-code/bin/" || fail "claude-code/bin/ missing"
[ -d "$REPO_ROOT/plugins/opencode" ] && pass "opencode/" || fail "opencode/ missing"

# Test 2: Manifests are valid JSON
echo ""
echo "Test 2: Manifest JSON validity"
if node -e "JSON.parse(require('fs').readFileSync('$REPO_ROOT/plugins/claude-code/.claude-plugin/plugin.json', 'utf8'))" 2>/dev/null; then
  pass "Claude plugin.json valid JSON"
else
  fail "Claude plugin.json invalid JSON"
fi
if node -e "JSON.parse(require('fs').readFileSync('$REPO_ROOT/plugins/claude-code/hooks/hooks.json', 'utf8'))" 2>/dev/null; then
  pass "Claude hooks.json valid JSON"
else
  fail "Claude hooks.json invalid JSON"
fi
if node -e "JSON.parse(require('fs').readFileSync('$REPO_ROOT/plugins/opencode/package.json', 'utf8'))" 2>/dev/null; then
  pass "OpenCode package.json valid JSON"
else
  fail "OpenCode package.json invalid JSON"
fi

# Test 3: Version consistency
echo ""
echo "Test 3: Version consistency across manifests"
VERSION_FILE=$(cat "$REPO_ROOT/VERSION" | tr -d '[:space:]')
NPM_VERSION=$(echo "$VERSION_FILE" | sed 's/\.[0-9]*$//')
CLAUDE_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$REPO_ROOT/plugins/claude-code/.claude-plugin/plugin.json', 'utf8')).version)")
OPENCODE_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$REPO_ROOT/plugins/opencode/package.json', 'utf8')).version)")
NPM_PKG_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$REPO_ROOT/src/npm-package/package.json', 'utf8')).version)")

[ "$CLAUDE_VERSION" = "$NPM_VERSION" ] && pass "Claude plugin matches VERSION ($NPM_VERSION)" || fail "Claude plugin version mismatch: $CLAUDE_VERSION vs $NPM_VERSION"
[ "$OPENCODE_VERSION" = "$NPM_VERSION" ] && pass "OpenCode plugin matches VERSION ($NPM_VERSION)" || fail "OpenCode plugin version mismatch: $OPENCODE_VERSION vs $NPM_VERSION"
[ "$NPM_PKG_VERSION" = "$NPM_VERSION" ] && pass "npm package matches VERSION ($NPM_VERSION)" || fail "npm package version mismatch: $NPM_PKG_VERSION vs $NPM_VERSION"

# Test 4: bin/xp-gate-check is executable
echo ""
echo "Test 4: bin/xp-gate-check executable"
[ -x "$REPO_ROOT/plugins/claude-code/bin/xp-gate-check" ] && pass "xp-gate-check is executable" || fail "xp-gate-check not executable"

# Test 5: Build script runs successfully for both platforms
echo ""
echo "Test 5: Build scripts run successfully"
if bash "$REPO_ROOT/scripts/build-plugin.sh" --platform claude-code >/dev/null 2>&1; then
  pass "claude-code build succeeds"
else
  fail "claude-code build failed"
fi
if bash "$REPO_ROOT/scripts/build-plugin.sh" --platform opencode >/dev/null 2>&1; then
  pass "opencode build succeeds"
else
  fail "opencode build failed"
fi

# Test 6: All expected skills present in built plugins
echo ""
echo "Test 6: Skill packaging"
EXPECTED_SKILLS=(sprint-flow delphi-review test-specification-alignment ralph-loop test-driven-development improve-codebase-architecture to-issues)
for skill in "${EXPECTED_SKILLS[@]}"; do
  if [ -f "$REPO_ROOT/plugins/claude-code/skills/$skill/SKILL.md" ]; then
    pass "claude-code/skills/$skill/SKILL.md"
  else
    fail "claude-code/skills/$skill/SKILL.md missing"
  fi
  if [ -f "$REPO_ROOT/plugins/opencode/skills/$skill/SKILL.md" ]; then
    pass "opencode/skills/$skill/SKILL.md"
  else
    fail "opencode/skills/$skill/SKILL.md missing"
  fi
done

# Test 7: xp-gate-check graceful degradation
echo ""
echo "Test 7: bin/xp-gate-check graceful degradation"
set +e
bash "$REPO_ROOT/plugins/claude-code/bin/xp-gate-check" /tmp/nonexistent-file.ts >/dev/null 2>&1
exit_code=$?
set -e
if [ "$exit_code" -eq 0 ]; then
  pass "xp-gate-check exits 0 on missing file (graceful degradation)"
else
  fail "xp-gate-check exited $exit_code on missing file (expected 0)"
fi

# Test 8: OpenCode plugin TypeScript compilation
echo ""
echo "Test 8: OpenCode TypeScript compilation"
cd "$REPO_ROOT/plugins/opencode"
if [ -d "node_modules" ]; then
  if npx tsc --noEmit >/dev/null 2>&1; then
    pass "opencode tsc --noEmit passes"
  else
    fail "opencode tsc --noEmit failed"
  fi
else
  npm install --no-fund --no-audit >/dev/null 2>&1
  if npx tsc --noEmit >/dev/null 2>&1; then
    pass "opencode tsc --noEmit passes (after install)"
  else
    fail "opencode tsc --noEmit failed after install"
  fi
fi
cd "$REPO_ROOT"

# Summary
echo ""
echo "=== Summary ==="
echo "Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
